import { motion } from "framer-motion";
import {
  Bell,
  ChevronDown,
  Home,
  Package,
  Search,
  Settings,
  ShoppingCart,
  BarChart3,
  Users,
  AlertTriangle,
  Printer,
  Barcode,
  Archive,
  TrendingUp,
  WifiOff,
  Building2,
} from "lucide-react";

export function BrandMark({ dark = false }) {
  return (
    <span className={`npp-mark ${dark ? "is-dark" : ""}`} aria-hidden>
      <span className="npp-mark__n">N</span>
    </span>
  );
}

export function LightDashboardMock() {
  return (
    <div className="npp-mock npp-mock--light" aria-hidden>
      <aside className="npp-mock__side">
        <div className="npp-mock__brand">
          <BrandMark />
          <span>Nexora POS Pro</span>
        </div>
        <nav>
          {["Home", "Reports", "Products", "Campaigns", "Activities", "Services"].map((item, i) => (
            <div key={item} className={`npp-mock__nav ${i === 1 ? "is-active" : ""}`}>
              {item}
            </div>
          ))}
        </nav>
        <div className="npp-mock__user">
          <span className="npp-mock__avatar" />
          <span>Branch Owner</span>
        </div>
      </aside>
      <div className="npp-mock__main">
        <header className="npp-mock__top">
          <div className="npp-mock__search">
            <Search size={14} /> Search Dashboard
          </div>
          <div className="npp-mock__top-actions">
            <Bell size={16} />
            <span className="npp-mock__pill">Account</span>
          </div>
        </header>
        <div className="npp-mock__kpis">
          <div className="npp-mock__kpi is-dark">
            <span>Today&apos;s Sales</span>
            <strong>$1,257</strong>
            <em>+13.3%</em>
          </div>
          <div className="npp-mock__kpi">
            <span>Revenue</span>
            <strong>$2,466</strong>
            <em>+4.5%</em>
          </div>
          <div className="npp-mock__kpi is-dark npp-mock__kpi--chart">
            <svg viewBox="0 0 160 48" preserveAspectRatio="none">
              <path d="M0,36 C20,30 40,40 60,18 C80,4 100,22 120,14 C140,8 150,20 160,10" fill="none" stroke="#34d399" strokeWidth="2.5" />
            </svg>
          </div>
        </div>
        <div className="npp-mock__grid">
          <div className="npp-mock__panel">
            <div className="npp-mock__panel-h">Orders <ChevronDown size={12} /></div>
            <svg viewBox="0 0 240 80" className="npp-mock__svg">
              <defs>
                <linearGradient id="nppArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,50 C40,40 70,70 110,35 C150,10 180,45 240,20 L240,80 L0,80 Z" fill="url(#nppArea)" />
              <path d="M0,50 C40,40 70,70 110,35 C150,10 180,45 240,20" fill="none" stroke="#2563eb" strokeWidth="2.5" />
            </svg>
          </div>
          <div className="npp-mock__panel">
            <div className="npp-mock__panel-h">Volume</div>
            <div className="npp-mock__bars">
              {[40, 70, 55, 85, 48, 92, 60].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="npp-mock__panel">
            <div className="npp-mock__panel-h">Inventory</div>
            {[
              ["Rice 5kg", "+2.1%"],
              ["Cooking Oil", "+1.4%"],
              ["Sanitizer", "-0.8%"],
            ].map(([name, delta]) => (
              <div key={name} className="npp-mock__row">
                <span className="npp-mock__dot" />
                <span>{name}</span>
                <strong className={delta.startsWith("-") ? "is-down" : "is-up"}>{delta}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DarkDashboardMock() {
  return (
    <div className="npp-mock npp-mock--dark" aria-hidden>
      <aside className="npp-mock__side">
        <div className="npp-mock__brand">
          <BrandMark dark />
          <span>Nexora</span>
        </div>
        <nav>
          {["Home", "Inventory", "Sales", "Reports", "Cashiers", "Settings"].map((item, i) => (
            <div key={item} className={`npp-mock__nav ${i === 2 ? "is-active" : ""}`}>
              {item}
            </div>
          ))}
        </nav>
      </aside>
      <div className="npp-mock__main">
        <header className="npp-mock__top">
          <h3>Master Dashboard</h3>
          <div className="npp-mock__search is-dark">
            <Search size={14} /> Search
          </div>
          <Bell size={16} />
        </header>
        <div className="npp-mock__dark-grid">
          <div className="npp-mock__glass">
            <div className="npp-mock__panel-h">Branch Sales</div>
            <div className="npp-mock__donut">
              <svg viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="28" fill="none" stroke="#1e293b" strokeWidth="10" />
                <circle cx="40" cy="40" r="28" fill="none" stroke="#38bdf8" strokeWidth="10" strokeDasharray="60 120" strokeLinecap="round" />
                <circle cx="40" cy="40" r="28" fill="none" stroke="#facc15" strokeWidth="10" strokeDasharray="30 150" strokeDashoffset="-60" strokeLinecap="round" />
                <circle cx="40" cy="40" r="28" fill="none" stroke="#34d399" strokeWidth="10" strokeDasharray="25 155" strokeDashoffset="-90" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <div className="npp-mock__glass npp-mock__map">
            <div className="npp-mock__panel-h">Global Sales</div>
            <div className="npp-mock__map-dots">
              <span /><span /><span /><span /><span />
            </div>
            <motion.div
              className="npp-mock__toast"
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.35, type: "spring", stiffness: 260, damping: 20 }}
            >
              <AlertTriangle size={14} />
              Low Stock Notification
            </motion.div>
          </div>
          <div className="npp-mock__glass">
            <div className="npp-mock__panel-h">Regional Sales</div>
            <svg viewBox="0 0 220 70" className="npp-mock__svg">
              <path d="M0,50 C30,40 50,55 80,30 C110,10 140,45 170,25 C190,15 210,35 220,20" fill="none" stroke="#facc15" strokeWidth="2" />
              <path d="M0,55 C35,48 60,35 95,40 C130,45 160,20 220,28" fill="none" stroke="#38bdf8" strokeWidth="2" />
            </svg>
          </div>
          <div className="npp-mock__glass">
            <div className="npp-mock__panel-h">Throughput</div>
            <div className="npp-mock__bars is-dark">
              {[45, 70, 40, 88, 55, 75, 50].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LaptopDashboardMock() {
  return (
    <div className="npp-laptop-screen" aria-hidden>
      <div className="npp-laptop-screen__top">
        <div className="npp-laptop-screen__dots">
          <span /><span /><span />
        </div>
        <div className="npp-laptop-screen__search">
          <Search size={11} /> Search dashboard
        </div>
        <Bell size={13} />
      </div>
      <div className="npp-laptop-screen__kpis">
        <div>
          <span>Total Sales</span>
          <strong>KSh 1,250,000</strong>
          <em>+12.5%</em>
        </div>
        <div>
          <span>Total Profit</span>
          <strong>KSh 320,000</strong>
          <em>+8.7%</em>
        </div>
        <div>
          <span>Total Orders</span>
          <strong>2,450</strong>
          <em>+15.2%</em>
        </div>
      </div>
      <div className="npp-laptop-screen__grid">
        <div className="npp-laptop-screen__chart">
          <div className="npp-laptop-screen__chart-h">Sales Overview</div>
          <svg viewBox="0 0 240 70" className="npp-laptop-screen__chart-svg" preserveAspectRatio="none">
            <defs>
              <linearGradient id="nppHeroArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,55 C30,45 55,60 85,35 C115,12 145,45 175,25 C200,10 220,30 240,15 L240,70 L0,70 Z"
              fill="url(#nppHeroArea)"
            />
            <path
              d="M0,55 C30,45 55,60 85,35 C115,12 145,45 175,25 C200,10 220,30 240,15"
              fill="none"
              stroke="#2563eb"
              strokeWidth="2.5"
            />
          </svg>
        </div>
        <div className="npp-laptop-screen__side">
          <div className="npp-laptop-screen__side-h">Top Products</div>
          {[
            ["Paracetamol 500mg", "KSh 45,200"],
            ["Coca Cola 500ml", "KSh 38,900"],
            ["Samsung TV 55\"", "KSh 32,000"],
          ].map(([name, value]) => (
            <div key={name} className="npp-laptop-screen__side-row">
              <span />
              <span>{name}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CompactAnalyticsMock() {
  return (
    <div className="npp-mini" aria-hidden>
      <header>
        <span>Branch Overview</span>
        <TrendingUp size={13} />
      </header>
      <div className="npp-mini__kpis">
        <div>
          <span>Profit</span>
          <strong>$320K</strong>
        </div>
        <div>
          <span>Orders</span>
          <strong>2,450</strong>
        </div>
      </div>
      <svg viewBox="0 0 160 54" className="npp-mini__svg" preserveAspectRatio="none">
        <path d="M0,40 C20,32 40,44 60,26 C80,10 100,30 120,18 C135,10 150,22 160,14" fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="npp-mini__bars">
        {[35, 60, 45, 80, 50, 70].map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

const HARDWARE_CHIPS = [
  { icon: Printer, label: "Receipt Printer" },
  { icon: Barcode, label: "Barcode Scanner" },
  { icon: Archive, label: "Cash Drawer" },
];

export function HeroShowcase() {
  return (
    <div className="npp-hero-visual-wrap">
      <div className="npp-hero-stage" aria-hidden>
        <div className="npp-hero-stage__glow" />

        <motion.div
          className="npp-device npp-device--tablet"
          initial={{ opacity: 0, y: 20, rotate: -10 }}
          animate={{ opacity: 1, y: 0, rotate: -6 }}
          transition={{ duration: 0.8, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="npp-device__screen">
            <CompactAnalyticsMock />
          </div>
        </motion.div>

        <motion.div
          className="npp-device npp-device--laptop"
          initial={{ opacity: 0, y: 34, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="npp-device__cam" />
          <div className="npp-device__screen npp-device__screen--laptop">
            <LaptopDashboardMock />
          </div>
          <div className="npp-device__base" />
        </motion.div>

        <motion.div
          className="npp-device npp-device--phone"
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="npp-device__notch" />
          <div className="npp-device__screen npp-device__screen--phone">
            <PosTerminalMock />
          </div>
        </motion.div>
      </div>

      <motion.div
        className="npp-hero-hardware"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        aria-hidden
      >
        {HARDWARE_CHIPS.map(({ icon: Icon, label }) => (
          <span key={label} className="npp-hero-hardware__chip">
            <Icon size={15} />
            {label}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export function PosTerminalMock() {
  return (
    <div className="npp-pos-ui" aria-hidden>
      <header>
        <strong>Nexora POS Pro</strong>
        <div className="npp-pos-ui__search"><Search size={12} /> Search or Scan…</div>
      </header>
      <div className="npp-pos-ui__body">
        <div className="npp-pos-ui__chart">
          <span>Today&apos;s Sales</span>
          <strong>$13,593</strong>
          <svg viewBox="0 0 180 50" preserveAspectRatio="none">
            <path d="M0,35 C30,30 50,40 80,18 C110,5 140,28 180,12" fill="none" stroke="#38bdf8" strokeWidth="2.5" />
          </svg>
        </div>
        <div className="npp-pos-ui__cart">
          <div className="npp-pos-ui__line"><span>Subtotal</span><span>$20.00</span></div>
          <div className="npp-pos-ui__line"><span>Tax</span><span>$2.00</span></div>
          <div className="npp-pos-ui__line"><span>Discount</span><span>-$2.00</span></div>
          <div className="npp-pos-ui__total"><span>Total</span><strong>$20.00</strong></div>
          <button type="button" className="npp-pos-ui__pay">Pay</button>
        </div>
      </div>
      <footer>
        <Home size={14} />
        <Package size={14} />
        <ShoppingCart size={14} className="is-on" />
        <Users size={14} />
        <BarChart3 size={14} />
        <Settings size={14} />
      </footer>
    </div>
  );
}

const PHONE_META = {
  sales: { label: "New Sale", icon: ShoppingCart },
  inventory: { label: "Inventory", icon: Package },
  reports: { label: "Reports", icon: BarChart3 },
};

export function PhoneMock({ variant = "sales" }) {
  const meta = PHONE_META[variant] || PHONE_META.sales;
  const Icon = meta.icon;

  return (
    <div className="npp-phone-mock" aria-hidden>
      <div className="npp-phone-mock__notch" />
      <div className="npp-phone-mock__screen">
        <div className="npp-phone-mock__bar">
          <span>{meta.label}</span>
          <Icon size={13} />
        </div>

        {variant === "sales" && (
          <div className="npp-phone-mock__body">
            {[
              ["Rice 5kg", "KSh 850"],
              ["Cooking Oil 2L", "KSh 620"],
              ["Bread", "KSh 120"],
            ].map(([name, price]) => (
              <div key={name} className="npp-phone-mock__row">
                <span>{name}</span>
                <strong>{price}</strong>
              </div>
            ))}
            <div className="npp-phone-mock__total">
              <span>Total</span>
              <strong>KSh 1,590</strong>
            </div>
            <button type="button" className="npp-phone-mock__cta">Charge KSh 1,590</button>
          </div>
        )}

        {variant === "inventory" && (
          <div className="npp-phone-mock__body">
            {[
              ["Paracetamol 500mg", 82, "ok", "In Stock"],
              ["Cooking Oil 2L", 18, "low", "Low"],
              ["Rice 5kg", 4, "out", "Reorder"],
            ].map(([name, pct, status, label]) => (
              <div key={name} className="npp-phone-mock__stock">
                <div className="npp-phone-mock__stock-h">
                  <span>{name}</span>
                  <em className={`is-${status}`}>{label}</em>
                </div>
                <div className="npp-phone-mock__track">
                  <span className={`is-${status}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {variant === "reports" && (
          <div className="npp-phone-mock__body">
            <div className="npp-phone-mock__kpis">
              <div>
                <span>Today</span>
                <strong>KSh 84,200</strong>
              </div>
              <div>
                <span>Profit</span>
                <strong>KSh 21,300</strong>
              </div>
            </div>
            <svg viewBox="0 0 160 60" className="npp-phone-mock__svg" preserveAspectRatio="none">
              <path
                d="M0,45 C25,35 45,50 70,28 C95,8 120,35 160,18"
                fill="none"
                stroke="#2563eb"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className="npp-phone-mock__legend">
              <span><i /> This week</span>
              <span className="is-muted"><i /> Last week</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FeatureShot({ kind }) {
  switch (kind) {
    case "pos":
      return (
        <div className="npp-feature-shot" aria-hidden>
          <div className="npp-feature-shot__row"><span>Rice 5kg × 2</span><strong>KSh 1,700</strong></div>
          <div className="npp-feature-shot__row"><span>Cooking Oil 2L</span><strong>KSh 620</strong></div>
          <div className="npp-feature-shot__total"><span>Total</span><strong>KSh 2,320</strong></div>
          <span className="npp-feature-shot__pill is-mint">Paid — Cash</span>
        </div>
      );
    case "inventory":
      return (
        <div className="npp-feature-shot" aria-hidden>
          <div className="npp-feature-shot__stock">
            <span>Paracetamol 500mg</span>
            <div className="npp-feature-shot__track"><span style={{ width: "78%" }} /></div>
          </div>
          <div className="npp-feature-shot__stock">
            <span>Cooking Oil 2L</span>
            <div className="npp-feature-shot__track"><span className="is-low" style={{ width: "22%" }} /></div>
          </div>
          <span className="npp-feature-shot__pill is-amber">3 items low stock</span>
        </div>
      );
    case "purchases":
      return (
        <div className="npp-feature-shot" aria-hidden>
          <div className="npp-feature-shot__row"><span>PO #1042 — ABC Suppliers</span><strong>KSh 45,000</strong></div>
          <div className="npp-feature-shot__row"><span>Status</span><strong className="is-blue">Approved</strong></div>
          <span className="npp-feature-shot__pill is-blue">Supplier balance updated</span>
        </div>
      );
    case "customers":
      return (
        <div className="npp-feature-shot" aria-hidden>
          <div className="npp-feature-shot__people">
            {["JM", "AK", "SW"].map((i) => (
              <span key={i} className="npp-feature-shot__avatar">{i}</span>
            ))}
            <span className="npp-feature-shot__more">+248</span>
          </div>
          <span className="npp-feature-shot__pill is-mint">120 loyalty points earned today</span>
        </div>
      );
    case "reports":
      return (
        <div className="npp-feature-shot" aria-hidden>
          <div className="npp-feature-shot__bars">
            {[45, 70, 40, 88, 55, 75, 60].map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <span className="npp-feature-shot__pill is-blue">Profit up 12.4% this month</span>
        </div>
      );
    case "branches":
      return (
        <div className="npp-feature-shot" aria-hidden>
          {["Westlands Branch", "CBD Branch", "Mombasa Road Branch"].map((b) => (
            <div key={b} className="npp-feature-shot__row">
              <span><Building2 size={12} /> {b}</span>
              <strong className="is-mint">● Live</strong>
            </div>
          ))}
        </div>
      );
    case "offline":
      return (
        <div className="npp-feature-shot" aria-hidden>
          <div className="npp-feature-shot__offline">
            <WifiOff size={18} />
            <span>No connection — sales queued locally</span>
          </div>
          <span className="npp-feature-shot__pill is-mint">Synced automatically once online</span>
        </div>
      );
    case "barcode":
      return (
        <div className="npp-feature-shot" aria-hidden>
          <div className="npp-feature-shot__barcode">
            {[2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 1, 2].map((w, i) => (
              <span key={i} style={{ width: `${w}px` }} />
            ))}
          </div>
          <div className="npp-feature-shot__row"><span>SKU 6009123456789</span><strong>Rice 5kg</strong></div>
        </div>
      );
    default:
      return null;
  }
}
