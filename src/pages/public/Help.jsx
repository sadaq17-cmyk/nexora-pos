import { Link } from "react-router-dom";
import Seo from "../../components/public/Seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO, supportMailto } from "../../lib/supportContact";

const TOPICS = [
  {
    title: "Getting started",
    text: "Create a workspace from Signup, choose a public package, and invite your first store users.",
  },
  {
    title: "Billing & packages",
    text: "Compare Starter (KES 5,500), Business (KES 10,000), Professional (KES 15,000), and Enterprise (KES 25,000) on the Pricing page. New companies get a 7-day free trial with all Enterprise features.",
  },
  {
    title: "Store operations",
    text: "Use Features to review POS, inventory, purchasing, CRM, roles, and analytics before you go live.",
  },
  {
    title: "Account access",
    text: "Use Login for existing accounts, or Forgot Password if you need a reset link sent to your email.",
  },
];

export default function Help() {
  return (
    <div>
      <Seo
        title="Help — Nexora POS Pro"
        description="Nexora POS Pro help center. Get started with trials, packages, and store ops — or email support@httpsnexorapos.com."
      />

      <section className="nx-section" style={{ paddingTop: "3.5rem" }}>
        <div className="nx-section__label">Help center</div>
        <h1 className="nx-section__title">How can we help?</h1>
        <p className="nx-section__lead">
          Browse common topics below. Prefer a direct line? Email{" "}
          <a className="nx-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section className="nx-section" style={{ paddingTop: 0 }}>
        <div className="nx-grid-features">
          {TOPICS.map((item) => (
            <article key={item.title} className="nx-feature-tile">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Contact support</div>
        <h2 className="nx-section__title">Email the Nexora POS Pro team</h2>
        <p className="nx-section__lead">
          Write to{" "}
          <a className="nx-support-link" href={supportMailto({ subject: "Nexora POS Pro help request" })}>
            {SUPPORT_EMAIL}
          </a>
          {" "}with your company name, branch count, and what you need. We also accept messages through the contact form.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1.5rem" }}>
          <a
            href={supportMailto({ subject: "Nexora POS Pro help request" })}
            className="nx-btn-primary"
            style={{ background: "#2563EB", color: "#fff" }}
          >
            Email {SUPPORT_EMAIL}
          </a>
          <Link to="/faq" className="nx-btn-secondary" style={{ borderColor: "#D9E3F2", color: "#0B1C3D" }}>
            View FAQ
          </Link>
          <Link to="/contact" className="nx-btn-secondary" style={{ borderColor: "#D9E3F2", color: "#0B1C3D" }}>
            Contact form
          </Link>
        </div>
      </section>
    </div>
  );
}
