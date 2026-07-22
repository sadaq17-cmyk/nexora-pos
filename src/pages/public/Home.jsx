import { Link } from "react-router-dom";
import Seo from "../../components/public/Seo";
import { HeroPosPlane, ScreenshotGallery } from "../../components/public/ProductMockups";
import {
  FeatureSpotlights,
  InActionGallery,
  IndustryMediaGrid,
  MediaCredit,
  TestimonialsSection,
  TrustedBySection,
} from "../../components/public/MediaSections";
import {
  CAPABILITIES,
  FAQ_ITEMS,
  STATISTICS,
  WHY_NEXORA,
} from "../../lib/publicSiteContent";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../../lib/supportContact";

export default function Home() {
  return (
    <div>
      <Seo
        title="Nexora POS — Cloud Retail & Multi-Branch Point of Sale"
        description="Nexora POS is a premium cloud SaaS platform for retail, supermarket, restaurant, pharmacy, and multi-branch businesses. Inventory, barcodes, purchasing, roles, analytics, and secure subscriptions."
      />

      {/* 1. Hero — Nexora product UI plane (not stock UI) */}
      <section className="nx-hero">
        <div className="nx-hero__inner">
          <div className="public-animate-fade">
            <h1 className="nx-hero__brand">Nexora POS</h1>
            <p className="nx-hero__headline">The cloud POS built for serious retail operations.</p>
            <p className="nx-hero__sub">
              Run checkout, inventory, purchasing, teams, and analytics across branches — with secure multi-tenant SaaS under the hood.
            </p>
            <div className="nx-hero__cta">
              <Link to="/signup" className="nx-btn-primary">
                Start Free Trial
              </Link>
              <Link to="/features" className="nx-btn-secondary">
                Explore Features
              </Link>
            </div>
          </div>
          <div className="public-animate-slide">
            <HeroPosPlane />
          </div>
        </div>
      </section>

      {/* 2. Features */}
      <section className="nx-section">
        <div className="public-animate-fade-delay">
          <div className="nx-section__label">Capabilities</div>
          <h2 className="nx-section__title">Everything your stores need to sell and scale</h2>
          <p className="nx-section__lead">
            From supermarket scanning to pharmacy controls, restaurant counters, and multi-company administration — Nexora covers the full retail stack.
          </p>
        </div>
        <div className="nx-grid-features">
          {CAPABILITIES.map((item) => (
            <article key={item.title} className="nx-feature-tile">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 3. Product Screenshots — real Nexora POS UI only */}
      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Product screenshots</div>
        <h2 className="nx-section__title">See the real Nexora POS interface</h2>
        <p className="nx-section__lead">
          Module previews use the Nexora navy-and-blue product UI — POS, inventory, analytics, platform admin, and more. No stock UI imagery.
        </p>
        <ScreenshotGallery />
      </section>

      {/* 4. Feature Spotlights — Nexora UI only */}
      <section className="nx-section">
        <div className="nx-section__label">Feature spotlights</div>
        <h2 className="nx-section__title">Workflows that matter on the floor</h2>
        <p className="nx-section__lead">Highlighted modules rendered from the Nexora POS interface.</p>
        <FeatureSpotlights />
      </section>

      {/* 5. Industries — commercial-safe photos */}
      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Industries</div>
        <h2 className="nx-section__title">Built for the businesses that move product daily</h2>
        <p className="nx-section__lead">
          Real-world retail environments — supermarket, restaurant, pharmacy, hardware, electronics, boutique, wholesale, and mini market.
        </p>
        <IndustryMediaGrid />
      </section>

      {/* 6. In Action gallery */}
      <section className="nx-section">
        <div className="nx-section__label">In action</div>
        <h2 className="nx-section__title">Nexora in the store</h2>
        <p className="nx-section__lead">
          Cashiers, barcode scanning, checkout, receipts, warehouse inventory, dashboards, mobile POS, and customer payments.
        </p>
        <InActionGallery />
        <MediaCredit />
      </section>

      {/* 7. Why Choose Nexora */}
      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Why Nexora</div>
        <h2 className="nx-section__title">Why choose Nexora</h2>
        <p className="nx-section__lead">Premium operations software with clear brand, clear roles, and clear results.</p>
        <div className="nx-grid-features" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {WHY_NEXORA.map((item) => (
            <article key={item.title} className="nx-feature-tile">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 8. Statistics */}
      <section className="nx-section">
        <div className="nx-section__label">At a glance</div>
        <h2 className="nx-section__title">Platform statistics</h2>
        <p className="nx-section__lead">A concise view of what Nexora delivers after you leave the hero.</p>
        <div className="nx-stats-grid">
          {STATISTICS.map((stat) => (
            <div key={stat.label} className="nx-stat">
              <div className="nx-display nx-stat__value">{stat.value}</div>
              <div className="nx-stat__label">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 9. Trusted By — empty until real logos */}
      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Trusted by</div>
        <h2 className="nx-section__title">Companies that run on Nexora</h2>
        <TrustedBySection />
      </section>

      {/* 10. Pricing teaser */}
      <section className="nx-section" style={{ textAlign: "center" }}>
        <div className="nx-section__label">Pricing</div>
        <h2 className="nx-section__title">Packages that grow with your company</h2>
        <p className="nx-section__lead" style={{ marginLeft: "auto", marginRight: "auto" }}>
          Compare Starter, Business, Professional, and Enterprise (KES) — every new company gets a 7-day Enterprise trial.
        </p>
        <Link
          to="/pricing"
          className="nx-btn-primary nx-btn-primary--compact"
          style={{ marginTop: "1.75rem", display: "inline-flex" }}
        >
          View pricing
        </Link>
      </section>

      {/* 11. Testimonials — empty until real reviews */}
      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Customers</div>
        <h2 className="nx-section__title">What operators say</h2>
        <TestimonialsSection />
      </section>

      {/* 12. FAQ */}
      <section className="nx-section">
        <div className="nx-section__label">FAQ</div>
        <h2 className="nx-section__title">Frequently asked questions</h2>
        <p className="nx-section__lead">
          Need a human? Email{" "}
          <a className="nx-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <div className="nx-faq" style={{ marginTop: "1.75rem", maxWidth: 720 }}>
          {FAQ_ITEMS.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
        <Link to="/faq" style={{ display: "inline-block", marginTop: "1.25rem", fontWeight: 700, color: "#2563EB" }}>
          Browse full FAQ
        </Link>
      </section>

      {/* 13. Contact teaser */}
      <section className="nx-section" style={{ textAlign: "center" }}>
        <div className="nx-section__label">Contact</div>
        <h2 className="nx-section__title">Talk to Nexora</h2>
        <p className="nx-section__lead" style={{ marginLeft: "auto", marginRight: "auto" }}>
          Reach our team at{" "}
          <a className="nx-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>{" "}
          or send a message through the contact form.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center", marginTop: "1.75rem" }}>
          <Link to="/contact" className="nx-btn-primary" style={{ background: "#2563EB", color: "#fff" }}>
            Contact us
          </Link>
          <a href={SUPPORT_MAILTO} className="nx-btn-secondary" style={{ borderColor: "#D9E3F2", color: "#0B1C3D" }}>
            Email support
          </a>
        </div>
      </section>
    </div>
  );
}
