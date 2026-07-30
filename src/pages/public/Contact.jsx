import { useState } from "react";
import { Link } from "react-router-dom";
import Seo from "../../components/public/Seo";
import { api } from "../../lib/api";
import { SUPPORT_EMAIL, SUPPORT_MAILTO, supportMailto } from "../../lib/supportContact";

const empty = { name: "", email: "", company: "", phone: "", message: "", website: "" };

export default function Contact() {
  const [form, setForm] = useState(empty);
  const [state, setState] = useState({ loading: false, error: "", sent: false });

  const submit = async (event) => {
    event.preventDefault();
    setState({ loading: true, error: "", sent: false });
    const result = await api.platformPublic.contact(form);
    setState({ loading: false, error: result.success ? "" : result.error, sent: result.success });
    if (result.success) setForm(empty);
  };

  return (
    <div>
      <Seo
        title="Contact — Nexora POS Pro"
        description="Contact Nexora POS Pro. Email support@httpsnexorapos.com or send a message about your stores, team, and requirements."
      />

      <section className="nx-section" style={{ paddingTop: "3.5rem" }}>
        <div className="nx-section__label">Contact</div>
        <h1 className="nx-section__title">Talk to Nexora POS Pro</h1>
        <p className="nx-section__lead">
          Prefer email? Reach us directly at{" "}
          <a className="nx-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          . Or use the form — messages are delivered to this inbox.
        </p>
      </section>

      <section className="nx-section" style={{ paddingTop: 0 }}>
        <div className="nx-contact-grid">
          <aside
            style={{
              border: "1px solid #D9E3F2",
              borderRadius: "1.25rem",
              padding: "1.75rem 1.5rem",
              background: "linear-gradient(165deg, #0B1C3D 0%, #122A56 55%, #1E3A8A 100%)",
              color: "#fff",
            }}
          >
            <div style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(191,219,254,0.95)" }}>
              Support email
            </div>
            <p className="nx-display" style={{ margin: "0.85rem 0 0", fontSize: "1.45rem", fontWeight: 700, lineHeight: 1.3 }}>
              <a href={SUPPORT_MAILTO} style={{ color: "#fff", textDecoration: "none" }}>
                {SUPPORT_EMAIL}
              </a>
            </p>
            <p style={{ margin: "0.85rem 0 0", fontSize: "0.925rem", lineHeight: 1.65, color: "rgba(226,232,240,0.88)" }}>
              Tell us about your stores, team size, and what you need. We respond to trial, billing, and onboarding questions.
            </p>
            <a
              href={supportMailto({ subject: "Nexora POS Pro inquiry" })}
              className="nx-btn-primary"
              style={{ marginTop: "1.5rem", display: "inline-flex" }}
            >
              Email support
            </a>
            <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
              <Link to="/faq" style={{ color: "rgba(191,219,254,0.95)", fontWeight: 600 }}>FAQ</Link>
              <Link to="/help" style={{ color: "rgba(191,219,254,0.95)", fontWeight: 600 }}>Help</Link>
              <Link to="/support" style={{ color: "rgba(191,219,254,0.95)", fontWeight: 600 }}>Support</Link>
            </div>
          </aside>

          <form
            onSubmit={submit}
            style={{
              border: "1px solid #D9E3F2",
              borderRadius: "1.25rem",
              background: "#fff",
              padding: "1.75rem 1.5rem",
              boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04)",
            }}
          >
            <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              {[
                ["name", "Name", true, "text"],
                ["email", "Email", true, "email"],
                ["company", "Company", false, "text"],
                ["phone", "Phone (optional)", false, "tel"],
              ].map(([key, label, required, type]) => (
                <label key={key} style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, color: "#0B1C3D" }}>
                  {label}
                  <input
                    required={required}
                    type={type}
                    value={form[key]}
                    onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                    className="mt-1.5 min-h-12 w-full rounded-xl border border-[#CBD5E1] px-3 outline-none focus:border-[#2563EB]"
                  />
                </label>
              ))}
            </div>
            <label className="mt-4 block text-sm font-semibold text-[#0B1C3D]">
              Message
              <textarea
                required
                minLength={10}
                rows={5}
                value={form.message}
                onChange={(event) => setForm({ ...form, message: event.target.value })}
                className="mt-1.5 w-full rounded-xl border border-[#CBD5E1] p-3 outline-none focus:border-[#2563EB]"
              />
            </label>
            {/* Honeypot — leave empty */}
            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              name="website"
              className="hidden"
              value={form.website}
              onChange={(event) => setForm({ ...form, website: event.target.value })}
            />
            {state.error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {state.error}
              </p>
            )}
            {state.sent && (
              <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
                Thanks. Your message has been received. You can also email {SUPPORT_EMAIL} anytime.
              </p>
            )}
            <button
              disabled={state.loading}
              type="submit"
              className="mt-5 rounded-xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {state.loading ? "Sending…" : "Send message"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
