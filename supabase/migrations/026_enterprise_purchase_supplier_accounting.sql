-- Enterprise Purchase & Supplier Accounting
-- - Supplier opening debit/credit + outstanding formula
-- - Purchase statuses include Approved
-- - Ledger only books Approved/Received (not Draft/Pending)
-- - Atomic approve RPC: invoice + stock + avg cost + AP + movements in one transaction

-- ---------------------------------------------------------------------------
-- 1. Supplier opening debit / credit
-- ---------------------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS opening_debit numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric(12,2) NOT NULL DEFAULT 0;

UPDATE public.suppliers
SET opening_debit = COALESCE(opening_balance, 0)
WHERE COALESCE(opening_debit, 0) = 0
  AND COALESCE(opening_balance, 0) <> 0;

COMMENT ON COLUMN public.suppliers.opening_debit IS
  'Opening AP debit (amount owed to supplier at onboarding)';
COMMENT ON COLUMN public.suppliers.opening_credit IS
  'Opening AP credit (prepayment / credit with supplier at onboarding)';

-- Outstanding = Opening Debit - Opening Credit + Purchases - Payments - Credit Notes
-- (ledger debit/credit rows already encode purchases vs payments/returns)

-- ---------------------------------------------------------------------------
-- 2. Purchase status: add Approved; track inventory posting
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS inventory_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accounting_posted_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN (
    'Draft', 'Pending', 'Ordered', 'Approved',
    'PartiallyReceived', 'Received', 'Cancelled', 'Rejected'
  ));

-- Legacy "Ordered" rows are treated as Approved for AP/stock purposes.
UPDATE public.purchases
SET status = 'Approved'
WHERE status = 'Ordered';

-- ---------------------------------------------------------------------------
-- 3. Ledger view: only Approved / Received / PartiallyReceived book AP
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.supplier_ledger_v AS
SELECT
  s.company_id,
  s.id AS supplier_id,
  s.code AS supplier_code,
  s.name AS supplier_name,
  e.entry_date,
  e.entry_type,
  e.reference,
  e.description,
  e.debit,
  e.credit,
  e.source_table,
  e.source_id,
  e.branch_id
FROM public.suppliers s
JOIN LATERAL (
  SELECT
    COALESCE(p.approved_at, p.ordered_at, p.created_at) AS entry_date,
    'purchase'::text AS entry_type,
    COALESCE(p.invoice_no, p.po_number, '#' || p.id::text) AS reference,
    ('Purchase ' || COALESCE(p.po_number, '#' || p.id::text) || ' (' || p.status || ')') AS description,
    COALESCE(p.total, 0)::numeric(12,2) AS debit,
    0::numeric(12,2) AS credit,
    p.branch_id,
    'purchases'::text AS source_table,
    p.id AS source_id
  FROM public.purchases p
  WHERE p.supplier_id = s.id
    AND p.status IN ('Approved', 'Ordered', 'Received', 'PartiallyReceived')

  UNION ALL

  SELECT
    sp.created_at,
    'payment'::text,
    COALESCE(sp.reference, sp.method, 'Payment'),
    ('Payment via ' || COALESCE(sp.method, 'Cash')),
    0::numeric(12,2),
    COALESCE(sp.amount, 0)::numeric(12,2),
    sp.branch_id,
    'supplier_payments'::text,
    sp.id
  FROM public.supplier_payments sp
  WHERE sp.supplier_id = s.id

  UNION ALL

  SELECT
    pp.created_at,
    'payment'::text,
    COALESCE(pp.reference, pp.method, 'PO payment'),
    ('PO payment via ' || COALESCE(pp.method, 'Cash')),
    0::numeric(12,2),
    COALESCE(pp.amount, 0)::numeric(12,2),
    pp.branch_id,
    'purchase_payments'::text,
    pp.id
  FROM public.purchase_payments pp
  WHERE pp.supplier_id = s.id

  UNION ALL

  SELECT
    pr.created_at,
    'purchase_return'::text,
    COALESCE(p2.po_number, p2.invoice_no, '#' || pr.purchase_id::text),
    ('Purchase return / credit note' || CASE WHEN pr.reason IS NOT NULL AND btrim(pr.reason) <> '' THEN ' — ' || pr.reason ELSE '' END),
    0::numeric(12,2),
    (COALESCE(pr.qty, 0) * COALESCE(pr.cost, 0))::numeric(12,2),
    COALESCE(pr.branch_id, p2.branch_id),
    'purchase_returns'::text,
    pr.id
  FROM public.purchase_returns pr
  JOIN public.purchases p2 ON p2.id = pr.purchase_id
  WHERE COALESCE(pr.supplier_id, p2.supplier_id) = s.id

  UNION ALL

  SELECT
    la.created_at,
    la.entry_type,
    la.reference,
    la.description,
    la.debit,
    la.credit,
    la.branch_id,
    'supplier_ledger_adjustments'::text,
    la.id
  FROM public.supplier_ledger_adjustments la
  WHERE la.supplier_id = s.id
) e ON true;

COMMENT ON VIEW public.supplier_ledger_v IS
  'AP subledger: purchases book only after Approval (Approved/Received). Payments and credit notes credit AP.';

GRANT SELECT ON public.supplier_ledger_v TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Atomic approve: invoice + stock + avg cost + supplier AP + movements
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_approve_purchase(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_id bigint := NULLIF(payload->>'purchase_id','')::bigint;
  v_company_id bigint := COALESCE((payload->>'company_id')::bigint, public.jwt_company_id());
  v_user_id uuid := NULLIF(payload->>'user_id','')::uuid;
  v_user_name text := COALESCE(payload->>'user_name', '');
  v_warehouse_id bigint := NULLIF(payload->>'warehouse_id','')::bigint;
  v_po public.purchases%ROWTYPE;
  v_item record;
  v_product public.products%ROWTYPE;
  v_qty numeric(12,3);
  v_unit_cost numeric(12,2);
  v_prev_stock numeric(12,3);
  v_prev_avg numeric(12,2);
  v_next_stock numeric(12,3);
  v_next_avg numeric(12,2);
  v_stocked_value numeric(12,2) := 0;
  v_stocked_qty numeric(12,3) := 0;
  v_invoice text;
  v_opening_debit numeric(12,2);
  v_opening_credit numeric(12,2);
  v_debit_sum numeric(12,2);
  v_credit_sum numeric(12,2);
  v_purchase_total numeric(12,2);
  v_paid_total numeric(12,2);
  v_order_count integer;
BEGIN
  IF v_purchase_id IS NULL THEN
    RAISE EXCEPTION 'purchase_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_po
  FROM public.purchases
  WHERE id = v_purchase_id
    AND (v_company_id IS NULL OR company_id = v_company_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_po.status IN ('Approved', 'Received', 'PartiallyReceived') THEN
    RETURN jsonb_build_object('success', true, 'id', v_po.id, 'status', v_po.status, 'already_approved', true);
  END IF;

  IF v_po.status IN ('Cancelled', 'Rejected') THEN
    RAISE EXCEPTION 'Cancelled or rejected purchases cannot be approved' USING ERRCODE = '22023';
  END IF;

  IF v_po.status NOT IN ('Draft', 'Pending', 'Ordered') THEN
    RAISE EXCEPTION 'Purchase status % cannot be approved', v_po.status USING ERRCODE = '22023';
  END IF;

  v_invoice := COALESCE(NULLIF(btrim(v_po.invoice_no), ''), v_po.po_number, 'PI-' || v_po.id::text);

  -- Mark approved + purchase invoice identity first (still inside transaction).
  UPDATE public.purchases
  SET
    status = 'Approved',
    invoice_no = v_invoice,
    approved_at = COALESCE(approved_at, now()),
    approved_by = COALESCE(approved_by, v_user_id),
    ordered_at = COALESCE(ordered_at, now()),
    warehouse_id = COALESCE(v_warehouse_id, warehouse_id),
    accounting_posted_at = COALESCE(accounting_posted_at, now()),
    inventory_posted_at = COALESCE(inventory_posted_at, now()),
    received_at = COALESCE(received_at, now()),
    updated_at = now()
  WHERE id = v_po.id;

  -- Apply full ordered qty to inventory / costing when not yet posted.
  IF v_po.inventory_posted_at IS NULL THEN
    FOR v_item IN
      SELECT
        COALESCE(pi.product_id, (ji->>'product_id')::bigint) AS product_id,
        COALESCE(pi.qty_ordered, pi.qty, (ji->>'qty_ordered')::numeric, (ji->>'qty')::numeric, 0) AS qty_ordered,
        COALESCE(pi.qty_received, (ji->>'qty_received')::numeric, 0) AS qty_received,
        COALESCE(pi.cost, (ji->>'cost')::numeric, 0) AS cost,
        COALESCE(pi.batch_no, ji->>'batch_no') AS batch_no,
        COALESCE(pi.expiry_date::text, ji->>'expiry_date') AS expiry_date,
        COALESCE(pi.mfg_date::text, ji->>'mfg_date') AS mfg_date,
        COALESCE(pi.id, NULL) AS line_id
      FROM public.purchases p
      LEFT JOIN public.purchase_items pi ON pi.purchase_id = p.id
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(p.items_json, '[]'::jsonb)) AS ji ON pi.id IS NULL
      WHERE p.id = v_po.id
        AND COALESCE(pi.product_id, (ji->>'product_id')::bigint) IS NOT NULL
    LOOP
      v_qty := GREATEST(0, COALESCE(v_item.qty_ordered, 0) - COALESCE(v_item.qty_received, 0));
      IF v_qty <= 0 THEN
        CONTINUE;
      END IF;
      v_unit_cost := COALESCE(v_item.cost, 0);

      SELECT * INTO v_product
      FROM public.products
      WHERE id = v_item.product_id
        AND (v_company_id IS NULL OR company_id = v_company_id)
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found for purchase line', v_item.product_id USING ERRCODE = 'P0002';
      END IF;

      v_prev_stock := COALESCE(v_product.stock, 0);
      v_prev_avg := COALESCE(v_product.avg_cost, v_product.cost, v_unit_cost);
      v_next_stock := v_prev_stock + v_qty;
      IF v_prev_stock <= 0 THEN
        v_next_avg := v_unit_cost;
      ELSE
        v_next_avg := (v_prev_stock * v_prev_avg + v_qty * v_unit_cost) / NULLIF(v_next_stock, 0);
      END IF;

      UPDATE public.products
      SET
        stock = v_next_stock,
        cost = v_unit_cost,
        last_cost = v_unit_cost,
        avg_cost = v_next_avg
      WHERE id = v_product.id;

      IF v_item.line_id IS NOT NULL THEN
        UPDATE public.purchase_items
        SET qty_received = COALESCE(qty_ordered, qty, v_qty)
        WHERE id = v_item.line_id;
      END IF;

      INSERT INTO public.stock_movements (
        company_id, product_id, type, qty, note, user_id, user_name, created_at
      ) VALUES (
        v_po.company_id,
        v_product.id,
        'in',
        v_qty,
        'Purchase approve ' || COALESCE(v_po.po_number, v_po.id::text),
        v_user_id,
        v_user_name,
        now()
      );

      v_stocked_qty := v_stocked_qty + v_qty;
      v_stocked_value := v_stocked_value + (v_qty * v_unit_cost);
    END LOOP;

    -- Keep items_json qty_received in sync when present.
    UPDATE public.purchases p
    SET items_json = COALESCE((
      SELECT jsonb_agg(
        jsonb_set(
          COALESCE(elem, '{}'::jsonb),
          '{qty_received}',
          to_jsonb(COALESCE((elem->>'qty_ordered')::numeric, (elem->>'qty')::numeric, 0))
        )
      )
      FROM jsonb_array_elements(COALESCE(p.items_json, '[]'::jsonb)) elem
    ), p.items_json)
    WHERE p.id = v_po.id
      AND p.items_json IS NOT NULL
      AND jsonb_typeof(p.items_json) = 'array';
  END IF;

  -- Recompute supplier AP from ledger + opening debit/credit.
  IF v_po.supplier_id IS NOT NULL THEN
    SELECT
      COALESCE(s.opening_debit, s.opening_balance, 0),
      COALESCE(s.opening_credit, 0)
    INTO v_opening_debit, v_opening_credit
    FROM public.suppliers s
    WHERE s.id = v_po.supplier_id
    FOR UPDATE;

    SELECT
      COALESCE(SUM(e.debit), 0),
      COALESCE(SUM(e.credit), 0),
      COALESCE(SUM(CASE WHEN e.entry_type = 'purchase' THEN e.debit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_type = 'payment' THEN e.credit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_type = 'purchase' THEN 1 ELSE 0 END), 0)
    INTO v_debit_sum, v_credit_sum, v_purchase_total, v_paid_total, v_order_count
    FROM public.supplier_ledger_v e
    WHERE e.supplier_id = v_po.supplier_id;

    UPDATE public.suppliers
    SET
      balance = (v_opening_debit - v_opening_credit) + v_debit_sum - v_credit_sum,
      total_ordered = v_purchase_total,
      total_paid = v_paid_total,
      order_count = v_order_count,
      last_purchase_at = now(),
      opening_balance = v_opening_debit - v_opening_credit
    WHERE id = v_po.supplier_id;
  END IF;

  -- Best-effort journal (non-fatal if table missing).
  BEGIN
    IF v_stocked_value > 0 THEN
      INSERT INTO public.journal_entries (company_id, account, debit, credit, ref_type, ref_id, memo, created_by)
      VALUES
        (v_po.company_id, 'Inventory', v_stocked_value, 0, 'purchase_approve', v_po.id, 'Approve ' || COALESCE(v_po.po_number, v_po.id::text), v_user_id),
        (v_po.company_id, 'Accounts Payable', 0, v_stocked_value, 'purchase_approve', v_po.id, 'Approve ' || COALESCE(v_po.po_number, v_po.id::text), v_user_id);
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  INSERT INTO public.audit_log (user_id, user_name, action, module, details, company_id)
  VALUES (
    v_user_id,
    v_user_name,
    'approve_purchase',
    'purchases',
    jsonb_build_object(
      'id', v_po.id,
      'po_number', v_po.po_number,
      'invoice_no', v_invoice,
      'qty', v_stocked_qty,
      'stock_value', v_stocked_value
    )::text,
    v_po.company_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_po.id,
    'status', 'Approved',
    'invoice_no', v_invoice,
    'qty_received', v_stocked_qty,
    'stock_value', v_stocked_value
  );
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_approve_purchase(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_approve_purchase(jsonb) TO authenticated, service_role;
