import { Link } from "react-router-dom";
import Seo from "../../components/public/Seo";
import { FAQ_ITEMS } from "../../lib/publicSiteContent";
import { SUPPORT_EMAIL, SUPPORT_MAILTO, supportMailto } from "../../lib/supportContact";

export default function Faq() {
  return (
    <div>
      <Seo
        title="FAQ — Nexora POS"
        description="Answers about Nexora POS trials, industries, barcodes, roles, and how to reach support at support@httpsnexorapos.com."
      />

      <section className="nx-section" style={{ paddingTop: "3.5rem" }}>
        <div className="nx-section__label">FAQ</div>
        <h1 className="nx-section__title">Frequently asked questions</h1>
        <p className="nx-section__lead">
          Quick answers about Nexora POS. For anything else, email{" "}
          <a className="nx-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section className="nx-section" style={{ paddingTop: 0 }}>
        <div className="nx-faq" style={{ maxWidth: 720 }}>
          {FAQ_ITEMS.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="nx-section nx-section--soft" style={{ textAlign: "center" }}>
        <h2 className="nx-section__title">Still need help?</h2>
        <p className="nx-section__lead" style={{ marginLeft: "auto", marginRight: "auto" }}>
          Visit Help or Support, or write to{" "}
          <a className="nx-support-link" href={supportMailto({ subject: "Nexora POS FAQ question" })}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center", marginTop: "1.5rem" }}>
          <Link to="/help" className="nx-btn-primary" style={{ background: "#2563EB", color: "#fff" }}>
            Help center
          </Link>
          <Link to="/support" className="nx-btn-secondary" style={{ borderColor: "#D9E3F2", color: "#0B1C3D" }}>
            Support
          </Link>
          <Link to="/contact" className="nx-btn-secondary" style={{ borderColor: "#D9E3F2", color: "#0B1C3D" }}>
            Contact
          </Link>
        </div>
      </section>
    </div>
  );
}
