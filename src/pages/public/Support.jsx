import { Link } from "react-router-dom";
import Seo from "../../components/public/Seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO, supportMailto } from "../../lib/supportContact";

export default function Support() {
  return (
    <div>
      <Seo
        title="Support — Nexora POS"
        description="Contact Nexora POS support at support@httpsnexorapos.com for trials, billing, onboarding, and operational questions."
      />

      <section className="nx-section" style={{ paddingTop: "3.5rem" }}>
        <div className="nx-section__label">Support</div>
        <h1 className="nx-section__title">Nexora customer support</h1>
        <p className="nx-section__lead">
          Our primary support channel is email. Reach us anytime at{" "}
          <a className="nx-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section className="nx-section nx-section--soft">
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto",
            textAlign: "center",
            padding: "2rem 1.25rem",
            border: "1px solid #D9E3F2",
            borderRadius: "1.25rem",
            background: "linear-gradient(180deg, #FFFFFF 0%, #F5F8FC 100%)",
          }}
        >
          <div className="nx-section__label">Direct email</div>
          <p
            className="nx-display"
            style={{ margin: "0.75rem 0 0", fontSize: "clamp(1.35rem, 3vw, 1.85rem)", fontWeight: 700, color: "#0B1C3D" }}
          >
            <a className="nx-support-link" href={SUPPORT_MAILTO} style={{ textDecoration: "none" }}>
              {SUPPORT_EMAIL}
            </a>
          </p>
          <p style={{ margin: "0.85rem auto 0", maxWidth: "36ch", color: "#64748B", lineHeight: 1.65 }}>
            Include your company name, the issue, and screenshots when possible so we can respond faster.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center", marginTop: "1.5rem" }}>
            <a
              href={supportMailto({ subject: "Nexora POS support request" })}
              className="nx-btn-primary"
              style={{ background: "#2563EB", color: "#fff" }}
            >
              Open email
            </a>
            <Link to="/contact" className="nx-btn-secondary" style={{ borderColor: "#D9E3F2", color: "#0B1C3D" }}>
              Use contact form
            </Link>
          </div>
        </div>
      </section>

      <section className="nx-section">
        <div className="nx-section__label">Also useful</div>
        <h2 className="nx-section__title">More ways to get answers</h2>
        <div className="nx-grid-features" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          <article className="nx-feature-tile">
            <h3>FAQ</h3>
            <p>Common product and trial questions in one place.</p>
            <Link to="/faq" style={{ display: "inline-block", marginTop: "0.75rem", fontWeight: 700, color: "#2563EB" }}>
              Browse FAQ
            </Link>
          </article>
          <article className="nx-feature-tile">
            <h3>Help center</h3>
            <p>Getting started, packages, and account access tips.</p>
            <Link to="/help" style={{ display: "inline-block", marginTop: "0.75rem", fontWeight: 700, color: "#2563EB" }}>
              Open Help
            </Link>
          </article>
          <article className="nx-feature-tile">
            <h3>Contact</h3>
            <p>Send a structured message with company and phone details.</p>
            <Link to="/contact" style={{ display: "inline-block", marginTop: "0.75rem", fontWeight: 700, color: "#2563EB" }}>
              Contact us
            </Link>
          </article>
        </div>
      </section>
    </div>
  );
}
