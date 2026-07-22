import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, Store, X } from "lucide-react";

const NAV = [
  ["/", "Home"],
  ["/features", "Features"],
  ["/pricing", "Pricing"],
  ["/download", "🪟 Download"],
  ["/faq", "FAQ"],
  ["/support", "Support"],
  ["/contact", "Contact"],
];

export default function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="nx-public-header">
      <div className="nx-public-header__inner">
        <Link to="/" className="nx-public-brand">
          <span className="nx-public-brand__mark" aria-hidden>
            <Store size={18} />
          </span>
          <span className="nx-public-brand__name">Nexora POS</span>
        </Link>
        <nav className="nx-public-nav" aria-label="Marketing">
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `nx-public-nav__link ${isActive ? "is-active" : ""}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="nx-public-actions">
          <Link to="/login" className="nx-public-link">Login</Link>
          <Link to="/signup" className="nx-btn-primary nx-btn-primary--compact">Start Free Trial</Link>
        </div>
        <button type="button" className="nx-public-menu-btn" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <div className="nx-public-mobile">
          {NAV.map(([to, label]) => (
            <Link key={to} to={to} onClick={() => setOpen(false)} className="nx-public-nav__link">{label}</Link>
          ))}
          <Link to="/login" onClick={() => setOpen(false)} className="nx-public-link">Login</Link>
          <Link to="/signup" onClick={() => setOpen(false)} className="nx-btn-primary">Start Free Trial</Link>
        </div>
      )}
    </header>
  );
}
