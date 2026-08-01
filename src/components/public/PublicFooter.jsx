import { Link } from "react-router-dom";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../../lib/supportContact";

export default function PublicFooter() {
  return (
    <footer className="nx-public-footer">
      <div className="nx-public-footer__inner">
        <div>
          <div className="nx-public-footer__brand">Nexora POS Pro</div>
          <p className="nx-public-footer__copy">
            Enterprise retail operations for growing multi-branch businesses.
          </p>
          <p className="nx-public-footer__copy">
            Support:{" "}
            <a className="nx-support-link" href={SUPPORT_MAILTO}>
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
        <div>
          <div className="nx-public-footer__heading">Product</div>
          <div className="nx-public-footer__links">
            <Link to="/features">Features</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/download">Download</Link>
            <Link to="/signup">Signup</Link>
          </div>
        </div>
        <div>
          <div className="nx-public-footer__heading">Company</div>
          <div className="nx-public-footer__links">
            <Link to="/contact">Contact</Link>
            <Link to="/faq">FAQ</Link>
            <Link to="/help">Help</Link>
            <Link to="/support">Support</Link>
            <Link to="/login">Login</Link>
          </div>
        </div>
        <div>
          <div className="nx-public-footer__heading">Legal</div>
          <div className="nx-public-footer__links">
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
          </div>
        </div>
      </div>
      <div className="nx-public-footer__bar">
        © {new Date().getFullYear()} Nexora POS Pro
      </div>
    </footer>
  );
}
