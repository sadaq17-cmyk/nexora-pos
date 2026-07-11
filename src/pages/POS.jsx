import { useState, useEffect, useRef } from "react";
import {
  ShoppingCart, Barcode, Search, Package, Minus, Plus, X, Trash2,
  Banknote, CreditCard, Smartphone, Printer, Check,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const VAT_RATE = 0.16;
const CATEGORY_COLORS = { Groceries: "#2563EB", Dairy: "#38BDF8", Bakery: "#F59E0B", Beverages: "#8B5CF6" };
const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function POS() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const barcodeRef = useRef(null);

  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [barcode, setBarcode] = useState("");
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [payment, setPayment] = useState("Cash");
  const [customerId, setCustomerId] = useState("");
  const [lastSale, setLastSale] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProducts = async () => setProducts(await api.products.getAll());

  useEffect(() => {
    (async () => {
      setProducts(await api.products.getAll());
      setCustomers(await api.customers.getAll());
      setLoading(false);
    })();
    barcodeRef.current?.focus();
  }, []);

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode || "").includes(search)
  );

  const addToCart = (p) => {
    setCart((prev) => {
      const ex = prev.find((l) => l.id === p.id);
      const inCart = ex ? ex.qty : 0;
      if (inCart >= p.stock) { showToast(`Only ${p.stock} left in stock`); return prev; }
      if (ex) return prev.map((l) => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { ...p, qty: 1 }];
    });
  };

  const handleBarcodeEnter = async (e) => {
    if (e.key !== "Enter" || !barcode.trim()) return;
    const match = await api.products.getByBarcode(barcode.trim());
    if (match) { addToCart(match); setBarcode(""); }
    else showToast("No product found for that barcode");
  };

  const changeQty = (id, delta) =>
    setCart((prev) =>
      prev
        .map((l) => (l.id === id ? { ...l, qty: Math.max(0, Math.min(l.stock, l.qty + delta)) } : l))
        .filter((l) => l.qty > 0)
    );
  const removeLine = (id) => setCart((prev) => prev.filter((l) => l.id !== id));

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const discountAmt = subtotal * (discount / 100);
  const taxable = subtotal - discountAmt;
  const vat = taxable * VAT_RATE;
  const total = taxable + vat;

  const completeSale = async () => {
    if (cart.length === 0) return;
    const sale = {
      customer_id: customerId || null,
      user_id: user?.id || null,
      subtotal, discount: discountAmt, vat, total,
      payment_method: payment,
      items: cart.map((l) => ({ product_id: l.id, name: l.name, qty: l.qty, price: l.price, cost: l.cost })),
    };
    const result = await api.sales.create(sale);
    if (!result.success) { showToast(result.error || "Sale failed"); return; }

    setLastSale({
      invoice_no: result.invoice_no,
      items: cart, subtotal, discountAmt, vat, total, payment,
      customer: customers.find((c) => c.id === Number(customerId))?.name || "Walk-in",
      time: new Date().toLocaleString(),
    });
    showToast(`Sale ${result.invoice_no} completed`);
    setCart([]); setDiscount(0); setCustomerId("");
    await loadProducts();
    barcodeRef.current?.focus();
  };

  const printReceipt = () => {
    if (!lastSale && cart.length === 0) { showToast("No sale to print yet"); return; }
    window.print();
  };

  const receiptData = lastSale || (cart.length > 0 ? {
    invoice_no: "PREVIEW", items: cart, subtotal, discountAmt, vat, total, payment,
    customer: customers.find((c) => c.id === Number(customerId))?.name || "Walk-in",
    time: new Date().toLocaleString(),
  } : null);

  const paymentOpts = [
    { id: "Cash", icon: Banknote }, { id: "Card", icon: CreditCard }, { id: "M-Pesa", icon: Smartphone },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 animate-fadein">
      <div>
        <h1 className="text-2xl font-bold text-[#1B2439] mb-1">POS Sales</h1>
        <p className="text-sm text-[#6B7690] mb-4">Scan, search, and check out customers quickly.</p>

        <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
          <div className="relative flex-1">
            <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7690]" />
            <input
              ref={barcodeRef} value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={handleBarcodeEnter}
              placeholder="Scan or type barcode, then press Enter"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[#E4E9F2] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7690]" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…"
              className="pl-9 pr-3 py-2 rounded-lg border border-[#E4E9F2] text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-[#6B7690] py-10 text-center">Loading products…</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filtered.map((p) => {
              const low = p.stock <= p.reorder_level;
              const out = p.stock <= 0;
              return (
                <button
                  key={p.id} onClick={() => addToCart(p)} disabled={out}
                  className="text-left bg-white border border-[#E4E9F2] rounded-xl p-3.5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center mb-2.5"
                    style={{ backgroundColor: (CATEGORY_COLORS[p.category] || "#2563EB") + "1A" }}
                  >
                    <Package size={16} style={{ color: CATEGORY_COLORS[p.category] || "#2563EB" }} />
                  </div>
                  <div className="font-medium text-sm leading-snug mb-1 text-[#1B2439]">{p.name}</div>
                  <div className="text-xs mb-2 text-[#6B7690]">{p.category}</div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm font-mono text-[#2563EB]">{money(p.price)}</span>
                    <span className="text-xs" style={{ color: out ? "#DC2626" : low ? "#DC2626" : "#6B7690" }}>
                      {out ? "Out of stock" : `${p.stock} in stock`}
                    </span>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full text-center py-12 text-[#6B7690] text-sm">No products match.</div>
            )}
          </div>
        )}
      </div>

      {/* Cart */}
      <div className="bg-white border border-[#E4E9F2] rounded-2xl h-fit sticky top-6 overflow-hidden shadow-sm">
        <div className="px-4 py-3.5 flex items-center justify-between bg-[#0B1C3D]">
          <span className="text-white font-semibold text-sm flex items-center gap-2"><ShoppingCart size={15} /> Current Sale</span>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-white/60 hover:text-white text-xs flex items-center gap-1">
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>

        <div className="px-4 pt-3">
          <select
            value={customerId} onChange={(e) => setCustomerId(e.target.value)}
            className="w-full border border-[#E4E9F2] rounded-lg px-2.5 py-1.5 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="">Walk-in customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="max-h-[30vh] overflow-y-auto px-4 py-1">
          {cart.length === 0 ? (
            <div className="text-center py-10 text-sm text-[#6B7690]">Cart is empty. Add products to begin.</div>
          ) : cart.map((l) => (
            <div key={l.id} className="py-2.5 border-b border-[#E4E9F2]">
              <div className="flex justify-between text-sm">
                <span className="text-[#1B2439]">{l.name}</span>
                <span className="font-mono text-[#1B2439]">{money(l.price * l.qty)}</span>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex items-center gap-2">
                  <button onClick={() => changeQty(l.id, -1)} className="w-6 h-6 rounded-full border border-[#E4E9F2] flex items-center justify-center"><Minus size={11} /></button>
                  <span className="w-5 text-center text-xs font-mono">{l.qty}</span>
                  <button onClick={() => changeQty(l.id, 1)} className="w-6 h-6 rounded-full border border-[#E4E9F2] flex items-center justify-center"><Plus size={11} /></button>
                </div>
                <button onClick={() => removeLine(l.id)} className="text-[#6B7690] hover:text-[#DC2626]"><X size={14} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-[#E4E9F2] space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#6B7690]">Discount</span>
            <div className="flex items-center gap-1">
              <input
                type="number" min={0} max={100} value={discount}
                onChange={(e) => setDiscount(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-14 border border-[#E4E9F2] rounded px-1.5 py-0.5 text-xs text-right font-mono"
              />
              <span className="text-xs text-[#6B7690]">%</span>
            </div>
          </div>
          <div className="flex justify-between text-sm text-[#6B7690]"><span>Subtotal</span><span className="font-mono">{money(subtotal)}</span></div>
          <div className="flex justify-between text-sm text-[#6B7690]"><span>Discount</span><span className="font-mono">-{money(discountAmt)}</span></div>
          <div className="flex justify-between text-sm text-[#6B7690]"><span>VAT (16%)</span><span className="font-mono">{money(vat)}</span></div>
          <div className="flex justify-between text-base font-bold pt-1.5 border-t border-[#E4E9F2] text-[#1B2439]">
            <span>Total</span><span className="font-mono">{money(total)}</span>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="text-xs font-medium mb-1.5 text-[#6B7690]">Payment method</div>
          <div className="flex gap-1.5 mb-3">
            {paymentOpts.map(({ id, icon: Icon }) => (
              <button
                key={id} onClick={() => setPayment(id)}
                className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border text-xs transition-all"
                style={{
                  borderColor: payment === id ? "#2563EB" : "#E4E9F2",
                  backgroundColor: payment === id ? "#2563EB" : "white",
                  color: payment === id ? "white" : "#1B2439",
                }}
              >
                <Icon size={15} />{id}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={printReceipt} className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-[#E4E9F2] text-sm font-medium text-[#1B2439]">
              <Printer size={15} /> Print
            </button>
            <button
              onClick={completeSale} disabled={cart.length === 0}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40 transition-all hover:brightness-110 bg-[#2563EB]"
            >
              <Check size={15} /> Charge
            </button>
          </div>
        </div>
      </div>

      {/* Print-only receipt markup */}
      <div id="receipt-print">
        {receiptData && (
          <>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <strong>NEXORA SUPERMARKET</strong><br />
              Waiyaki Way, Nairobi<br />
              VAT: P051234567X
            </div>
            <div>--------------------------------</div>
            <div>Invoice: {receiptData.invoice_no}</div>
            <div>Customer: {receiptData.customer}</div>
            <div>Time: {receiptData.time}</div>
            <div>--------------------------------</div>
            {receiptData.items.map((it) => (
              <div key={it.id} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{it.qty}x {it.name}</span>
                <span>{money(it.price * it.qty)}</span>
              </div>
            ))}
            <div>--------------------------------</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{money(receiptData.subtotal)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Discount</span><span>-{money(receiptData.discountAmt)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>VAT</span><span>{money(receiptData.vat)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}><span>TOTAL</span><span>{money(receiptData.total)}</span></div>
            <div>Payment: {receiptData.payment}</div>
            <div style={{ textAlign: "center", marginTop: 8 }}>Thank you for shopping with us!</div>
          </>
        )}
      </div>
    </div>
  );
}
