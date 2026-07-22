import Seo from "../../components/public/Seo";

const INSTALLER_HREF =
  "https://github.com/sadaq17-cmyk/nexora-pos/releases/download/v1.0.0/Nexora-POS-Setup-1.0.0.exe";
const INSTALLER_LABEL = "Nexora-POS-Setup-1.0.0.exe";

export default function Download() {
  return (
    <div>
      <Seo
        title="Download — Nexora POS"
        description="Download the Nexora POS Windows desktop installer for offline-capable retail checkout and store operations."
      />

      <section className="nx-section" style={{ paddingTop: "3.5rem", textAlign: "center" }}>
        <div className="nx-section__label">Windows desktop</div>
        <h1 className="nx-section__title">Download Nexora POS</h1>
        <p className="nx-section__lead" style={{ marginLeft: "auto", marginRight: "auto" }}>
          Install the official Windows setup for Nexora POS. Run the installer, sign in with your company account, and start selling at the counter.
        </p>
        <div className="nx-hero__cta" style={{ justifyContent: "center", marginTop: "1.75rem" }}>
          <a
            href={INSTALLER_HREF}
            className="nx-btn-primary"
            rel="noopener noreferrer"
          >
            Download for Windows
          </a>
        </div>
        <p className="nx-section__lead" style={{ marginTop: "1.25rem", marginLeft: "auto", marginRight: "auto", fontSize: "0.95rem" }}>
          File: {INSTALLER_LABEL} · Version 1.0.0 · Windows 10/11 (64-bit)
        </p>
      </section>

      <section className="nx-section nx-section--soft">
        <div className="nx-section__label">Setup</div>
        <h2 className="nx-section__title">After you download</h2>
        <div className="nx-grid-features">
          <article className="nx-feature-tile">
            <h3>1. Run the installer</h3>
            <p>Open {INSTALLER_LABEL} and follow the Windows setup prompts. Allow the app if SmartScreen asks to confirm a new publisher install.</p>
          </article>
          <article className="nx-feature-tile">
            <h3>2. Sign in</h3>
            <p>Use your Nexora company owner or staff credentials. Need an account? Start a free trial from the website first.</p>
          </article>
          <article className="nx-feature-tile">
            <h3>3. Start selling</h3>
            <p>Open the POS module, select a branch, and check out customers with barcodes, cash, or card as configured for your plan.</p>
          </article>
        </div>
      </section>
    </div>
  );
}
