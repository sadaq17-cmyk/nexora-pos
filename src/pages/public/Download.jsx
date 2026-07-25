import { Link } from "react-router-dom";
import {
  Cloud,
  Download as DownloadIcon,
  HardDrive,
  Lock,
  Monitor,
  RefreshCw,
  Shield,
  WifiOff,
  Building2,
  Zap,
} from "lucide-react";
import Seo from "../../components/public/Seo";

// Must exactly match the asset filename attached to the GitHub release
// (verify with: gh release view v1.0.0 --repo sadaq17-cmyk/nexora-pos --json assets)
const INSTALLER_LABEL = "Nexora-POS-Setup-1.0.0.exe";
const INSTALLER_HREF =
  `https://github.com/sadaq17-cmyk/nexora-pos/releases/download/v1.0.0/${INSTALLER_LABEL}`;

const FEATURES = [
  { title: "Offline Mode", text: "Keep selling when the network drops.", icon: WifiOff },
  { title: "Cloud Sync", text: "Reconcile securely when you reconnect.", icon: Cloud },
  { title: "Multi-Branch", text: "One desktop app for every store.", icon: Building2 },
  { title: "Fast Installation", text: "Setup in minutes on Windows 10/11.", icon: Zap },
  { title: "Automatic Updates", text: "Stay current with product releases.", icon: RefreshCw },
  { title: "Secure Login", text: "Sign in with your company account.", icon: Lock },
];

export default function Download() {
  return (
    <div className="npp-dl">
      <Seo
        title="Download Nexora POS Pro for Windows"
        description="Install the official Windows desktop application for Nexora POS Pro. Sign in with your company account and start managing your business in minutes."
      />

      <section className="npp-dl-hero">
        <div className="npp-dl-hero__glow" aria-hidden />
        <div className="npp-container npp-dl-hero__inner">
          <div className="npp-dl-glass">
            <div className="npp-dl-glass__badges">
              <span className="npp-dl-win" aria-hidden>
                <Monitor size={22} />
              </span>
              <span className="npp-dl-logo" aria-hidden>
                N
              </span>
            </div>
            <p className="npp-dl-kicker">Windows desktop</p>
            <h1>Download Nexora POS Pro for Windows</h1>
            <p className="npp-dl-lead">
              Install the official Windows desktop application for Nexora POS Pro.
              Sign in with your company account and start managing your business in minutes.
            </p>

            <a
              href={INSTALLER_HREF}
              className="npp-btn npp-btn--primary npp-dl-btn"
              rel="noopener noreferrer"
            >
              <DownloadIcon size={18} />
              Download Nexora POS Pro
            </a>

            <dl className="npp-dl-meta">
              <div>
                <dt>File</dt>
                <dd>{INSTALLER_LABEL}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>Windows 10 &amp; Windows 11 (64-bit)</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>1.0.0</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="npp-section npp-section--soft">
        <div className="npp-container npp-center">
          <div className="npp-section__label">Desktop advantages</div>
          <h2 className="npp-section__title">Built for the counter</h2>
          <p className="npp-section__lead">
            Everything you need from install to first sale — offline-capable and cloud-synced.
          </p>
          <div className="npp-dl-features">
            {FEATURES.map(({ title, text, icon: Icon }) => (
              <article key={title} className="npp-dl-feature">
                <div className="npp-dl-feature__icon">
                  <Icon size={18} />
                </div>
                <h3>✓ {title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="npp-section">
        <div className="npp-container">
          <div className="npp-dl-reqs">
            <div>
              <div className="npp-section__label">Before you install</div>
              <h2 className="npp-section__title">System Requirements</h2>
              <ul className="npp-dl-reqs__list">
                <li>
                  <HardDrive size={16} /> Windows 10 or Windows 11
                </li>
                <li>
                  <Monitor size={16} /> 4GB RAM minimum
                </li>
                <li>
                  <HardDrive size={16} /> 500MB free disk space
                </li>
                <li>
                  <Shield size={16} /> Internet required for activation
                </li>
              </ul>
            </div>
            <div className="npp-dl-reqs__card">
              <h3>After you download</h3>
              <ol>
                <li>Run <strong>{INSTALLER_LABEL}</strong> and follow Windows setup prompts.</li>
                <li>Sign in with your Nexora POS Pro company owner or staff credentials.</li>
                <li>Open POS, select a branch, and start selling.</li>
              </ol>
              <a href={INSTALLER_HREF} className="npp-btn npp-btn--primary" rel="noopener noreferrer">
                <DownloadIcon size={16} /> Download Nexora POS Pro
              </a>
              <p className="npp-dl-note">
                Need an account?{" "}
                <Link to="/signup">Start a free trial</Link> first, then install the desktop app.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
