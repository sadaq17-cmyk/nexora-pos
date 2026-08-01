-- =============================================================================
-- 027_enterprise_warehouse_management.sql
-- Enterprise Warehouse Management: "Main Store" central warehouse rule.
--
-- Business rules enforced by this migration + the application layer:
--   1. Every company has exactly one Main Store warehouse (is_main = true).
--   2. All approved purchases post stock into the Main Store warehouse —
--      never into any other warehouse.
--   3. Stock only reaches any other warehouse/store via Stock Transfer,
--      which must always touch the Main Store on one side (out of it, or
--      back into it), deducting one warehouse_stock row and crediting the
--      other, with a stock_transfers row + stock_movements audit trail.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. warehouses.is_main — marks the single central warehouse per company.
-- ---------------------------------------------------------------------------
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS is_main boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.warehouses.is_main IS
  'Main Store flag — the single central warehouse that receives all approved purchases. Exactly one per company.';

-- Backfill: promote the oldest warehouse of every company that has at least
-- one warehouse but none flagged as Main Store yet.
WITH ranked AS (
  SELECT id, company_id,
         row_number() OVER (PARTITION BY company_id ORDER BY id ASC) AS rn
  FROM public.warehouses
),
needs_main AS (
  SELECT DISTINCT company_id FROM public.warehouses
  EXCEPT
  SELECT DISTINCT company_id FROM public.warehouses WHERE is_main = true
)
UPDATE public.warehouses w
SET is_main = true
FROM ranked r
WHERE w.id = r.id
  AND r.rn = 1
  AND r.company_id IN (SELECT company_id FROM needs_main);

-- Exactly one Main Store per company (DB-enforced invariant).
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_main_per_company_uidx
  ON public.warehouses (company_id)
  WHERE is_main = true;

-- ---------------------------------------------------------------------------
-- 2. resolve_main_warehouse_id() — single source of truth for "which
--    warehouse is the Main Store for this company", with self-healing
--    (promotes the oldest warehouse if none is flagged) and auto-provision
--    (creates a "Main Store" warehouse if the company has none at all).
--    Used by pos_approve_purchase() below and mirrored from the API layer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_main_warehouse_id(p_company_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id FROM public.warehouses
  WHERE company_id = p_company_id AND is_main = true
  ORDER BY id ASC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Self-heal: no warehouse flagged Main Store yet — promote the oldest one.
  SELECT id INTO v_id FROM public.warehouses
  WHERE company_id = p_company_id
  ORDER BY id ASC LIMIT 1;

  IF v_id IS NOT NULL THEN
    BEGIN
      UPDATE public.warehouses SET is_main = true WHERE id = v_id;
    EXCEPTION WHEN unique_violation THEN
      -- Lost a promotion race — re-read whichever row won.
      SELECT id INTO v_id FROM public.warehouses
      WHERE company_id = p_company_id AND is_main = true
      ORDER BY id ASC LIMIT 1;
    END;
    RETURN v_id;
  END IF;

  -- No warehouse exists at all for this company — provision the Main Store.
  BEGIN
    INSERT INTO public.warehouses (company_id, name, code, is_main, active)
    VALUES (p_company_id, 'Main Store', 'MAIN', true, true)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.warehouses
    WHERE company_id = p_company_id AND is_main = true
    ORDER BY id ASC LIMIT 1;
  END;

  RETURN v_id;
EXCEPTION WHEN undefined_table THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_main_warehouse_id(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_main_warehouse_id(bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. pos_approve_purchase(): the fast-path atomic approve RPC (026) posted
--    stock to products.stock only — it never touched warehouse_stock, so
--    Main Store balances silently drifted whenever this RPC succeeded.
--    Re-create it so it always resolves + posts into the Main Store.
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
  v_warehouse_id bigint;
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

  -- Enterprise rule: every approved purchase receives into the Main Store —
  -- any warehouse_id supplied by the caller is informational only and is
  -- always overridden here.
  v_warehouse_id := public.resolve_main_warehouse_id(v_po.company_id);

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
        company_id, product_id, warehouse_id, type, qty, note, user_id, user_name, reference_type, reference_id, created_at
      ) VALUES (
        v_po.company_id,
        v_product.id,
        v_warehouse_id,
        'in',
        v_qty,
        'Purchase approve ' || COALESCE(v_po.po_number, v_po.id::text) || ' → Main Store',
        v_user_id,
        v_user_name,
        'purchase',
        v_po.id,
        now()
      );

      -- Post the receipt into the Main Store warehouse ledger (018).
      IF v_warehouse_id IS NOT NULL THEN
        BEGIN
          INSERT INTO public.warehouse_stock (company_id, warehouse_id, product_id, qty, updated_at)
          VALUES (v_po.company_id, v_warehouse_id, v_product.id, v_qty, now())
          ON CONFLICT (company_id, warehouse_id, product_id)
          DO UPDATE SET qty = public.warehouse_stock.qty + EXCLUDED.qty, updated_at = now();
        EXCEPTION WHEN undefined_table THEN
          NULL;
        END;
      END IF;

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
      'stock_value', v_stocked_value,
      'warehouse_id', v_warehouse_id
    )::text,
    v_po.company_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_po.id,
    'status', 'Approved',
    'invoice_no', v_invoice,
    'qty_received', v_stocked_qty,
    'stock_value', v_stocked_value,
    'warehouse_id', v_warehouse_id
  );
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_approve_purchase(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_approve_purchase(jsonb) TO authenticated, service_role;
