import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, Receipt } from "lucide-react";
import { api } from "../lib/api";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function SalesHistory() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [items, setItems] = useState({});

  useEffect(() => {
    (async () => {
      setSales(await api.sales.getRecent(100));
      setLoading(false);
    })();
  }, []);

  const toggle = async (sale) => {
    if (openId === sale.id) { setOpenId(null); return; }
    setOpenId(sale.id);
    if (!items[sale.id]) {
      const lines = await api.sales.getItems(sale.id);
      setItems((prev) => ({ ...prev, [sale.id]: lines }));
    }
  };

  const todayTotal = sales
    .filter((s) => new Date(s.created_at).toDateString() === new Date().toDateString())
    .reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="animate-fadein max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439]">Sales History</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">Every completed sale, recorded in real time.</p>
        </div>
        <div className="text-sm text-[#4B5675]">
          Today: <span className="font-semibold font-mono">{money(todayTotal)}</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-[#6B7690]">Loading sales…</div>
      ) : sales.length === 0 ? (
        <div className="text-center py-16 bg-white border border-[#E4E9F2] rounded-2xl">
          <Receipt size={28} className="mx-auto mb-2 text-[#C9D2E3]" />
          <p className="text-sm text-[#6B7690]">No sales recorded yet — completed POS sales will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sales.map((s) => {
            const open = openId === s.id;
            return (
              <div key={s.id} className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden">
                <button onClick={() => toggle(s)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                  <div>
                    <div className="text-sm font-medium text-[#1B2439]">{s.customer}</div>
                    <div className="text-xs text-[#6B7690]">
                      {fmtDate(s.created_at)} · {s.item_count} item{s.item_count !== 1 ? "s" : ""} · {s.payment_method}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold font-mono text-[#2563EB]">{money(s.total)}</span>
                    {open ? <ChevronDown size={16} className="text-[#6B7690]" /> : <ChevronRight size={16} className="text-[#6B7690]" />}
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-3 border-t border-dashed border-[#E4E9F2] font-mono text-sm">
                    {(items[s.id] || []).map((it) => (
                      <div key={it.id} className="flex justify-between py-1 text-[#4B5675]">
                        <span>{it.qty}× {it.product_name}</span>
                        <span>{money(it.price * it.qty)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-2 mt-1 border-t border-dashed border-[#E4E9F2] text-[#1B2439] font-medium">
                      <span>Total</span><span>{money(s.total)}</span>
                    </div>
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
