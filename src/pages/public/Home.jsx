import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Building2,
  ChevronDown,
  MessageCircle,
  Package,
  Percent,
  ScanBarcode,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
  Users,
  WifiOff,
  Zap,
  Store,
  ShoppingCart,
  Pill,
  Cpu,
  Tv,
  Smartphone,
  Laptop,
  Wrench,
  Shirt,
  UtensilsCrossed,
  Croissant,
  BookOpen,
  Sofa,
  Car,
  Wallet,
  PawPrint,
  Wheat,
  Star,
  Smartphone as PhoneIcon,
} from "lucide-react";
import Seo from "../../components/public/Seo";
import {
  BrandMark,
  DarkDashboardMock,
  HeroShowcase,
  FeatureShot,
  PhoneMock,
} from "../../components/public/landing/LandingMocks";
import { CANONICAL_PLANS, planPriceLabel } from "../../lib/subscriptionPlans";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../../lib/supportContact";
import { BUSINESS_CATEGORIES } from "../../data/businessCategories";
import { TESTIMONIALS } from "../../data/testimonials";
import { HOME_FAQS } from "../../data/homeFaqs";

const fadeUp = {
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
};

const CATEGORY_ICONS = {
  Store, ShoppingCart, Pill, Cpu, Tv, Smartphone, Laptop, Wrench, Shirt,
  Sparkles, UtensilsCrossed, Croissant, Truck, BookOpen, Sofa, Car, Wallet,
  PawPrint, Wheat,
};

const FEATURES = [
  {
    icon: Zap,
    shot: "pos",
    title: "Smart POS",
    description: "Fast billing, multiple payment methods, receipts & invoices in seconds.",
  },
  {
    icon: Package,
    shot: "inventory",
    title: "Inventory Management",
    description: "Real-time stock tracking, low-stock alerts, batch & expiry management.",
  },
  {
    icon: Truck,
    shot: "purchases",
    title: "Purchases & Suppliers",
    description: "Manage purchase orders, supplier balances, and automatic payments.",
  },
  {
    icon: Users,
    shot: "customers",
    title: "Sales & Customers",
    description: "Track customers, loyalty points, discounts, and full purchase history.",
  },
  {
    icon: BarChart3,
    shot: "reports",
    title: "Reports & Analytics",
    description: "Powerful reports with charts that turn data into decisions.",
  },
  {
    icon: Building2,
    shot: "branches",
    title: "Multi-Branch",
    description: "Manage all branches from one dashboard, in real time.",
  },
  {
    icon: WifiOff,
    shot: "offline",
    title: "Offline Mode",
    description: "Keep selling with no internet — everything syncs automatically online.",
  },
  {
    icon: ScanBarcode,
    shot: "barcode",
    title: "Barcode & Labels",
    description: "Generate, print, and scan barcodes across every product line.",
  },
];

const STATS = [
  { value: "500+", label: "Businesses" },
  { value: "10K+", label: "Users" },
  { value: "99.9%", label: "Uptime" },
  { value: "24/7", label: "Support" },
  { value: "100%", label: "Secure" },
];

const MOBILE_FEATURES = [
  {
    icon: Zap,
    title: "Sell from anywhere",
    desc: "Ring up sales on your phone at the counter, market stall, or on delivery.",
  },
  {
    icon: WifiOff,
    title: "Works fully offline",
    desc: "No signal? Keep selling — everything queues locally and syncs the moment you're back online.",
  },
  {
    icon: Sparkles,
    title: "Real-time sync everywhere",
    desc: "Every sale instantly updates stock, reports, and every device your team uses.",
  },
];

const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "Features", to: "/features" },
  { label: "Industries", to: "/#categories" },
  { label: "Pricing", to: "/pricing" },
];

const RESOURCE_LINKS = [
  { label: "Download", to: "/download" },
  { label: "FAQ", to: "/faq" },
  { label: "Support", to: "/support" },
  { label: "Help Center", to: "/help" },
];

function ProNav() {
  const [open, setOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);

  return (
    <header className="npp-nav">
      <div className="npp-container npp-nav__inner">
        <Link to="/" className="npp-brand" aria-label="Nexora POS Pro home">
          <BrandMark />
          <span className="npp-brand__name">
            Nexora<em>POS Pro</em>
          </span>
        </Link>

        <nav className="npp-nav__links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.label} href={link.to} className="npp-nav__link">
              {link.label}
            </a>
          ))}
          <div
            className="npp-nav__dropdown"
            onMouseEnter={() => setResourcesOpen(true)}
            onMouseLeave={() => setResourcesOpen(false)}
          >
            <button type="button" className="npp-nav__link npp-nav__link--btn">
              Resources <ChevronDown size={14} />
            </button>
            {resourcesOpen && (
              <div className="npp-nav__menu">
                {RESOURCE_LINKS.map((r) => (
                  <Link key={r.label} to={r.to}>
                    {r.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <Link to="/contact" className="npp-nav__link">
            Contact
          </Link>
        </nav>

        <div className="npp-nav__actions">
          <Link to="/login" className="npp-btn npp-btn--soft">Log In</Link>
          <Link to="/signup" className="npp-btn npp-btn--navy">Get Started</Link>
        </div>
        <button type="button" className="npp-menu-btn" aria-label="Menu" onClick={() => setOpen((v) => !v)}>
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open && (
        <div className="npp-mobile">
          {NAV_LINKS.map((link) => (
            <a key={link.label} href={link.to} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          {RESOURCE_LINKS.map((r) => (
            <Link key={r.label} to={r.to} onClick={() => setOpen(false)}>
              {r.label}
            </Link>
          ))}
          <Link to="/contact" onClick={() => setOpen(false)}>Contact</Link>
          <Link to="/login" onClick={() => setOpen(false)}>Log In</Link>
          <Link to="/signup" className="npp-btn npp-btn--navy" onClick={() => setOpen(false)}>Start Free Trial</Link>
        </div>
      )}
    </header>
  );
}

function CategoryCard({ category, index }) {
  const Icon = CATEGORY_ICONS[category.icon] || Sparkles;
  const isMore = !category.image;

  return (
    <motion.article
      className={`npp-cat-card ${isMore ? "npp-cat-card--more" : ""}`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.04, 0.4), ease: [0.22, 1, 0.36, 1] }}
    >
      <Link to="/features" className="npp-cat-card__link">
        {isMore ? (
          <div className="npp-cat-card__more-visual">
            <Sparkles size={28} />
          </div>
        ) : (
          <div className="npp-cat-card__media">
            <img src={category.image} alt={category.name} loading="lazy" />
            <span className="npp-cat-card__icon">
              <Icon size={16} />
            </span>
          </div>
        )}
        <div className="npp-cat-card__body">
          <h3>{category.name}</h3>
          <p>{category.description}</p>
          <span className="npp-cat-card__cta">
            Learn more <ArrowRight size={14} />
          </span>
        </div>
      </Link>
    </motion.article>
  );
}

function FeatureCard({ feature, index }) {
  return (
    <motion.article
      className="npp-feature-card"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.05, 0.3) }}
      whileHover={{ y: -4 }}
    >
      <div className="npp-feature-card__frame">
        <div className="npp-feature-card__chrome">
          <span /><span /><span />
        </div>
        <FeatureShot kind={feature.shot} />
      </div>
      <div className="npp-feature-card__body">
        <span className="npp-feature-card__icon">
          <feature.icon size={20} />
        </span>
        <h3>{feature.title}</h3>
        <p>{feature.description}</p>
      </div>
    </motion.article>
  );
}

function TestimonialCard({ item, index }) {
  return (
    <motion.article
      className="npp-testimonial-card"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.06, 0.3) }}
    >
      <div className="npp-testimonial-card__stars" aria-hidden>
        {Array.from({ length: item.rating }).map((_, i) => (
          <Star key={i} size={14} />
        ))}
      </div>
      <p className="npp-testimonial-card__quote">&ldquo;{item.quote}&rdquo;</p>
      <div className="npp-testimonial-card__person">
        <span className="npp-testimonial-card__avatar">{item.initials}</span>
        <div>
          <strong>{item.name}</strong>
          <span>{item.role}</span>
        </div>
      </div>
    </motion.article>
  );
}

function FaqItem({ item, isOpen, onToggle }) {
  return (
    <div className={`npp-faq-item ${isOpen ? "is-open" : ""}`}>
      <button type="button" className="npp-faq-item__q" onClick={onToggle} aria-expanded={isOpen}>
        {item.q}
        <ChevronDown size={18} />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.p
            className="npp-faq-item__a"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {item.a}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Home() {
  const [yearly, setYearly] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const plans = useMemo(
    () => CANONICAL_PLANS.filter((p) => p.public_visible && p.active).sort((a, b) => a.sort_order - b.sort_order),
    []
  );

  return (
    <div className="npp-page" id="home">
      <Seo
        title="Nexora POS Pro — The Complete POS System for Every Business"
        description="Nexora POS Pro helps you sell, manage inventory, track finances, and grow your business from one powerful platform. Trusted by supermarkets, pharmacies, electronics stores, and more."
      />

      <div className="npp-shell">
        <ProNav />

        {/* 1. Hero */}
        <section className="npp-hero" aria-labelledby="npp-hero-title">
          <div className="npp-container">
            <div className="npp-hero__grid">
              <motion.div
                className="npp-hero__copy"
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="npp-eyebrow npp-eyebrow--chip">
                  <Sparkles size={13} /> All-in-One Business Solution
                </p>
                <h1 id="npp-hero-title" className="npp-hero__title">
                  The Complete POS <br />
                  System for <span className="npp-hero__reflect">Every Business</span>
                </h1>
                <p className="npp-hero__sub">
                  Nexora POS Pro helps you sell, manage inventory, track finances, and grow
                  your business from one powerful platform.
                </p>
                <ul className="npp-hero__badges">
                  <li><ShieldCheck size={15} /> Secure</li>
                  <li><Zap size={15} /> Fast</li>
                  <li><Package size={15} /> Reliable</li>
                  <li><WifiOff size={15} /> Offline Ready</li>
                </ul>
                <div className="npp-hero__cta">
                  <Link to="/signup" className="npp-btn npp-btn--navy npp-btn--lg">
                    Start Free Trial <ArrowRight size={16} />
                  </Link>
                  <Link to="/features" className="npp-btn npp-btn--soft npp-btn--lg">View Demo</Link>
                </div>
                <p className="npp-hero__note">No credit card required · Setup in 5 minutes</p>
              </motion.div>

              <motion.div
                className="npp-hero__visual"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              >
                <HeroShowcase />
              </motion.div>
            </div>

            <motion.div className="npp-stats-band" {...fadeUp}>
              {STATS.map((s) => (
                <div key={s.label} className="npp-stats-band__item">
                  <strong>{s.value}</strong>
                  <span>{s.label}</span>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* 2. Industries We Serve */}
        <section className="npp-section" id="categories">
          <div className="npp-container">
            <motion.div className="npp-section__head" {...fadeUp}>
              <p className="npp-eyebrow"><ShoppingBag size={13} /> Every Industry</p>
              <h2>Industries We Serve</h2>
              <p>Nexora POS Pro is built to fit the way your industry actually works.</p>
            </motion.div>
            <div className="npp-cat-grid">
              {BUSINESS_CATEGORIES.map((category, i) => (
                <CategoryCard key={category.slug} category={category} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* 3. Enterprise Features */}
        <section className="npp-section npp-section--muted" id="features">
          <div className="npp-container">
            <motion.div className="npp-section__head" {...fadeUp}>
              <p className="npp-eyebrow"><Zap size={13} /> Enterprise Features</p>
              <h2>Powerful Features to Grow Your Business</h2>
              <p>Everything you need to run and scale your business, in one platform.</p>
            </motion.div>
            <div className="npp-feature-grid">
              {FEATURES.map((f, i) => (
                <FeatureCard key={f.title} feature={f} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* 4. Dashboard Preview */}
        <section className="npp-section npp-section--ink" id="dashboard">
          <div className="npp-container">
            <motion.div className="npp-section__head is-light" {...fadeUp}>
              <p className="npp-eyebrow"><BarChart3 size={13} /> Dashboard Preview</p>
              <h2>
                Automatic Inventory &amp; Reports
                <span className="npp-underline" aria-hidden />
              </h2>
              <p>Live stock alerts, regional sales, and executive charts — without spreadsheet chaos.</p>
            </motion.div>
            <motion.div
              className="npp-stage npp-stage--tilt"
              initial={{ opacity: 0, y: 48, scale: 0.97 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              <DarkDashboardMock />
            </motion.div>
          </div>
        </section>

        {/* 5. Mobile App Preview */}
        <section className="npp-section" id="mobile-app">
          <div className="npp-container">
            <motion.div className="npp-section__head" {...fadeUp}>
              <p className="npp-eyebrow"><PhoneIcon size={13} /> Mobile App Preview</p>
              <h2>Run Your Business From Your Pocket</h2>
              <p>Every screen, every feature — reachable from a phone in your hand.</p>
            </motion.div>
            <div className="npp-mobile-preview__grid">
              <motion.div
                className="npp-mobile-preview__phones"
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="npp-phone-mock npp-phone-mock--side npp-phone-mock--left">
                  <PhoneMock variant="inventory" />
                </div>
                <div className="npp-phone-mock npp-phone-mock--center">
                  <PhoneMock variant="sales" />
                </div>
                <div className="npp-phone-mock npp-phone-mock--side npp-phone-mock--right">
                  <PhoneMock variant="reports" />
                </div>
              </motion.div>
              <motion.div {...fadeUp}>
                <p className="npp-eyebrow"><Sparkles size={13} /> Anywhere, Anytime</p>
                <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.6rem", letterSpacing: "-0.02em" }}>
                  A full POS in your pocket
                </h3>
                <p style={{ color: "var(--npp-muted)", lineHeight: 1.6, margin: 0 }}>
                  Sell, track stock, and check reports without ever touching a desktop.
                </p>
                <ul className="npp-mobile-preview__features">
                  {MOBILE_FEATURES.map((f) => (
                    <li key={f.title}>
                      <span className="npp-mobile-preview__ic"><f.icon size={18} /></span>
                      <div>
                        <strong>{f.title}</strong>
                        <span className="npp-mobile-preview__desc">{f.desc}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 6. Customer Testimonials */}
        <section className="npp-section npp-section--muted" id="testimonials">
          <div className="npp-container">
            <motion.div className="npp-section__head" {...fadeUp}>
              <p className="npp-eyebrow"><Star size={13} /> Customer Testimonials</p>
              <h2>Trusted by Businesses Like Yours</h2>
              <p>Real feedback from owners running Nexora POS Pro every day.</p>
            </motion.div>
            <div className="npp-testimonial-grid">
              {TESTIMONIALS.map((t, i) => (
                <TestimonialCard key={t.name} item={t} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* Trust band */}
        <section className="npp-trust-band">
          <div className="npp-container">
            <motion.div className="npp-trust-band__inner" {...fadeUp}>
              <div className="npp-trust-band__copy">
                <h2>Ready to grow your business?</h2>
                <p>Join hundreds of businesses running on Nexora POS Pro every day.</p>
              </div>
              <div className="npp-trust-band__cta">
                <Link to="/signup" className="npp-btn npp-btn--blue npp-btn--lg">
                  Start Free Trial Today <ArrowRight size={16} />
                </Link>
              </div>
            </motion.div>
            <motion.div className="npp-trust-band__logos" {...fadeUp}>
              {["Supermarkets", "Pharmacies", "Electronics Retailers", "Hardware Stores", "Restaurants & Cafes"].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </motion.div>
          </div>
        </section>

        {/* 7. Pricing */}
        <section className="npp-section" id="pricing">
          <div className="npp-container">
            <motion.div className="npp-section__head" {...fadeUp}>
              <p className="npp-eyebrow"><Percent size={13} /> Pricing</p>
              <h2>Simple plans for serious retailers</h2>
              <p>7-day Enterprise trial. Keep your data when you upgrade.</p>
              <div className="npp-toggle" role="group" aria-label="Billing period">
                <button type="button" className={!yearly ? "is-on" : ""} onClick={() => setYearly(false)}>Monthly</button>
                <button type="button" className={yearly ? "is-on" : ""} onClick={() => setYearly(true)}>
                  Yearly <span>Save 20%</span>
                </button>
              </div>
            </motion.div>
            <div className="npp-pricing">
              {plans.map((plan) => {
                const popular = plan.code === "business";
                const amount = yearly
                  ? Math.round(Number(plan.price_monthly || 0) * 12 * 0.8)
                  : Number(plan.price_monthly || 0);
                const label = plan.contact_sales
                  ? planPriceLabel(plan)
                  : `KES ${amount.toLocaleString("en-KE")}`;
                return (
                  <motion.article
                    key={plan.code}
                    className={`npp-price ${popular ? "is-popular" : ""}`}
                    whileHover={{ y: -4 }}
                    transition={{ duration: 0.2 }}
                  >
                    {popular && <span className="npp-price__badge">Most Popular</span>}
                    <h3>{plan.name}</h3>
                    <div className="npp-price__amount">
                      {label}
                      {!plan.contact_sales && <span>/{yearly ? "yr" : "mo"}</span>}
                    </div>
                    <ul>
                      {(plan.features || []).slice(0, 5).map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <Link to="/signup" className={`npp-btn ${popular ? "npp-btn--navy" : "npp-btn--soft"} npp-btn--block`}>
                      {plan.contact_sales ? "Contact Sales" : "Start Free Trial"}
                    </Link>
                  </motion.article>
                );
              })}
            </div>
          </div>
        </section>

        {/* 8. FAQ */}
        <section className="npp-section npp-section--muted" id="faq">
          <div className="npp-container">
            <motion.div className="npp-section__head" {...fadeUp}>
              <p className="npp-eyebrow"><MessageCircle size={13} /> FAQ</p>
              <h2>Frequently Asked Questions</h2>
              <p>Everything you need to know before you get started.</p>
            </motion.div>
            <div className="npp-faq-list">
              {HOME_FAQS.map((item, i) => (
                <FaqItem
                  key={item.q}
                  item={item}
                  isOpen={openFaq === i}
                  onToggle={() => setOpenFaq(openFaq === i ? -1 : i)}
                />
              ))}
            </div>
          </div>
        </section>

        {/* 9. Final CTA */}
        <section className="npp-finale">
          <div className="npp-finale__bg" aria-hidden />
          <div className="npp-finale__veil" />
          <motion.div
            className="npp-glass-card"
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.35 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="npp-glass-card__brand">
              <span className="npp-glass-card__check" aria-hidden>✓</span>
              <strong>Nexora POS Pro</strong>
            </div>
            <div className="npp-glass-card__url">www.nexorapospro.com</div>
            <p>Download for Windows or start your free cloud trial in minutes.</p>
            <div className="npp-glass-card__cta">
              <Link to="/download" className="npp-btn npp-btn--navy">Download for Windows</Link>
              <Link to="/signup" className="npp-btn npp-btn--blue">Start Free Trial</Link>
            </div>
          </motion.div>
        </section>

        <footer className="npp-footer">
          <div className="npp-container">
            <div className="npp-footer__grid">
              <div>
                <div className="npp-footer__brand">
                  <BrandMark />
                  Nexora POS Pro
                </div>
                <p>The complete cloud POS platform for retail, grocery, pharmacy, and multi-branch networks.</p>
              </div>
              <div>
                <h4>Product</h4>
                <Link to="/features">Features</Link>
                <a href="/#categories">Industries</a>
                <Link to="/pricing">Pricing</Link>
                <Link to="/download">Download</Link>
              </div>
              <div>
                <h4>Resources</h4>
                <Link to="/faq">FAQ</Link>
                <Link to="/support">Support</Link>
                <Link to="/help">Help Center</Link>
              </div>
              <div>
                <h4>Company</h4>
                <Link to="/contact">Contact Us</Link>
                <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
                <Link to="/login">Log In</Link>
              </div>
            </div>
            <div className="npp-footer__bar">
              <span>© {new Date().getFullYear()} Nexora POS Pro</span>
              <span>Privacy · Terms · Security</span>
            </div>
          </div>
        </footer>
      </div>

      <Link to="/contact" className="npp-chat" aria-label="Chat with support">
        <MessageCircle size={22} />
      </Link>
    </div>
  );
}
