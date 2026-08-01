import { Link } from "react-router-dom";
import Seo from "../../components/public/Seo";
import { FeatureSpotlights, IndustryMediaGrid, MediaCredit } from "../../components/public/MediaSections";
import { ScreenshotGallery } from "../../components/public/ProductMockups";
import { CAPABILITIES } from "../../lib/publicSiteContent";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../../lib/supportContact";

export default function Features() {
  return (
    <div>
      <Seo
        title="Features — Nexora POS Pro"
        description="Explore Nexora POS Pro capabilities: retail checkout, inventory, barcodes, purchasing, CRM, roles, analytics, multi-branch, subscriptions, and secure authentication."
      />

      <section className="nx-section" style={{ paddingTop: "3.5rem" }}>
        <div className="nx-section__label">Platform capabilities</div>
        <h1 className="nx-section__title">Features that run the full store stack</h1>
        <p className="nx-section__lead">
          Nexora POS Pro covers front-of-house checkout and back-office operations for retail, supermarket, restaurant, pharmacy, hardware, electronics, boutique, wholesale, and mini market businesses.
        </p>
      </section>

      <section className="nx-section" style={{ paddingTop: 0 }}>
        <h2 className="nx-section__title" style={{ fontSize: "1.65rem" }}>
          Core capabilities
        </h2>
        <div className="nx-grid-features">
          {CAPABILITIES.map((item) => (
            <article key={item.title} className="nx-feature-tile">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Product screenshots</div>
        <h2 className="nx-section__title">Real Nexora POS Pro interface</h2>
        <p className="nx-section__lead">Product UI previews only — no stock application screenshots.</p>
        <ScreenshotGallery />
      </section>

      <section className="nx-section">
        <div className="nx-section__label">Feature spotlights</div>
        <h2 className="nx-section__title">Key workflows</h2>
        <FeatureSpotlights />
      </section>

      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Industries</div>
        <h2 className="nx-section__title">Where teams use Nexora</h2>
        <IndustryMediaGrid />
        <MediaCredit />
      </section>

      <section className="nx-section" style={{ textAlign: "center" }}>
        <h2 className="nx-section__title">Ready to try Nexora?</h2>
        <p className="nx-section__lead" style={{ marginLeft: "auto", marginRight: "auto" }}>
          Start a trial, compare packages, or email{" "}
          <a className="nx-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center", marginTop: "1.5rem" }}>
          <Link to="/signup" className="nx-btn-primary" style={{ background: "#2563EB", color: "#fff" }}>
            Start Free Trial
          </Link>
          <Link to="/pricing" className="nx-btn-secondary" style={{ borderColor: "#D9E3F2", color: "#0B1C3D" }}>
            View pricing
          </Link>
        </div>
      </section>
    </div>
  );
}
