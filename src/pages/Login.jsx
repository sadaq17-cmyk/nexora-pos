import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Store, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@nexorapos.com");
  const [password, setPassword] = useState("admin123");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (result.success) navigate("/dashboard");
    else setError(result.error || "Login failed.");
  };

  return (
    <div className="min-h-screen flex">
      <div
        className="hidden lg:flex w-1/2 relative overflow-hidden flex-col justify-between p-12"
        style={{ background: "linear-gradient(150deg, #0B1C3D 0%, #2563EB 130%)" }}
      >
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-white/5 -mb-24 -ml-24" />
        <div className="flex items-center gap-2.5 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur">
            <Store size={20} className="text-white" />
          </div>
          <span className="text-white text-xl font-bold tracking-wide">NEXORA POS</span>
        </div>
        <div className="relative z-10">
          <h2 className="text-white text-3xl font-bold leading-tight mb-3">
            Run your supermarket<br />with total confidence.
          </h2>
          <p className="text-white/70 text-sm max-w-sm">
            Sales, inventory, purchases, and reporting — unified in one fast,
            reliable point of sale built for busy retail floors.
          </p>
        </div>
        <div className="text-white/40 text-xs relative z-10">© 2026 Nexora Retail Systems</div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-[#F3F6FB]">
        <div className="w-full max-w-sm animate-fadein">
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#2563EB]">
              <Store size={18} className="text-white" />
            </div>
            <span className="text-lg font-bold text-[#1B2439]">NEXORA POS</span>
          </div>
          <h1 className="text-2xl font-bold mb-1 text-[#1B2439]">Welcome back</h1>
          <p className="text-sm mb-7 text-[#6B7690]">Sign in to your store dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block text-[#1B2439]">Email address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7690]" />
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[#E4E9F2] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-[#1B2439]">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7690]" />
                <input
                  type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required
                  className="w-full pl-9 pr-9 py-2.5 rounded-lg border border-[#E4E9F2] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7690]">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && <div className="text-xs text-[#DC2626] bg-[#FEF6F6] border border-[#FBD5D5] rounded-lg px-3 py-2">{error}</div>}

            <button
              type="submit" disabled={submitting}
              className="w-full py-2.5 rounded-lg text-white text-sm font-semibold shadow-sm hover:shadow-md transition-all hover:brightness-110 disabled:opacity-60 bg-[#2563EB]"
            >
              {submitting ? "Signing in…" : "Sign In"}
            </button>
          </form>
          <p className="text-center text-xs mt-6 text-[#6B7690]">
            Demo accounts: admin@nexorapos.com / admin123 · cashier@nexorapos.com / cashier123
          </p>
        </div>
      </div>
    </div>
  );
}
