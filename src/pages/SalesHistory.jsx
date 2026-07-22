import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, Receipt, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function SalesHistory() {
  const { formatMoney: money, formatMoneyForCurrency } = useEnterpriseSettings();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [items, setItems] = useState({});
  const [returnQty, setReturnQty] = useState({});

  const load = async () => setSales(await api.sales.getRecent(100));

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, []);

  const toggle = async (sale) => {
    if (openId === sale.id) { setOpenId(null); return; }
    setOpenId(sale.id);
    if (!items[sale.id]) {
      const lines = await api.sales.getItems(sale.id);
      setItems((prev) => ({ ...prev, [sale.id]: lines }));
      setReturnQty((prev) => ({
        ...prev,
        [sale.id]: Object.fromEntries(lines.map((line) => [line.product_id, 0])),
      }));
    }
  };

  const processReturn = async (sale) => {
    const lines = items[sale.id] || [];
    const payload = lines
      .filter((line) => Number(returnQty[sale.id]?.[line.product_id] || 0) > 0)
      .map((line) => ({
        product_id: line.product_id,
        qty: Number(returnQty[sale.id][line.product_id]),
        price: line.price,
      }));
    if (payload.length === 0) {
      showToast("Select quantities to return");
      return;
    }
    const result = await api.sales.createReturn({ sale_id: sale.id, items: payload, reason: "Customer return" });
    if (!result.success) {
      showToast(result.error || "Return failed");
      return;
    }
    showToast(`Return processed: ${formatMoneyForCurrency(result.refund, sale.currency_code)}`);
    await load();
  };

  const todayTotal = sales
    .filter((s) => new Date(s.created_at).toDateString() === new Date().toDateString())
    .reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Sales</h1>
          <p className="mt-1 text-base text-app-muted">Sales history, returns, and payment records.</p>
        </div>
        <div className="text-sm text-app-muted">
          Today: <span className="font-semibold font-mono">{money(todayTotal)}</span>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-app-muted">Loading sales…</div>
      ) : sales.length === 0 ? (
        <div className="card py-16 text-center">
          <Receipt size={28} className="mx-auto mb-2 text-app-subtle" />
          <p className="text-sm text-app-muted">No sales recorded yet — completed POS sales will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sales.map((s) => {
            const open = openId === s.id;
            const saleMoney = (value) => formatMoneyForCurrency(value, s.currency_code);
            return (
              <div key={s.id} className="card overflow-hidden !p-0">
                <button onClick={() => toggle(s)} className="flex w-full items-center justify-between px-5 py-4 text-left">
                  <div>
                    <div className="text-sm font-medium text-app-text">{s.customer}</div>
                    <div className="text-xs text-app-muted">
                      {fmtDate(s.created_at)} · {s.item_count} item{s.item_count !== 1 ? "s" : ""} · {s.payment_method}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold font-mono text-brand">{saleMoney(s.total)}</span>
                    {open ? <ChevronDown size={16} className="text-app-muted" /> : <ChevronRight size={16} className="text-app-muted" />}
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-3 border-t border-dashed border-app font-mono text-sm">
                    {(items[s.id] || []).map((it) => (
                      <div key={`${s.id}-${it.product_id}`} className="flex items-center justify-between gap-3 py-1 text-app-muted">
                        <span>{it.qty}× {it.name}</span>
                        <div className="flex items-center gap-2">
                          {can("sales", "edit") && (
                            <input
                              type="number"
                              min={0}
                              max={it.qty}
                              value={returnQty[s.id]?.[it.product_id] || 0}
                              onChange={(e) =>
                                setReturnQty((prev) => ({
                                  ...prev,
                                  [s.id]: { ...prev[s.id], [it.product_id]: Number(e.target.value) },
                                }))
                              }
                              className="w-16 rounded border border-app px-2 py-1 text-xs"
                            />
                          )}
                          <span>{saleMoney(it.price * it.qty)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-dashed border-app text-app-text font-medium">
                      <span>Total</span><span>{saleMoney(s.total)}</span>
                    </div>
                    {can("sales", "edit") && (
                      <button
                        onClick={() => processReturn(s)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-app px-3 py-1.5 text-xs font-medium text-app-text"
                      >
                        <RotateCcw size={13} /> Process Return
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
