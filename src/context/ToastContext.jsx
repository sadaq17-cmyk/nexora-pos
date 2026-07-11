import { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2 } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null);

  const showToast = useCallback((msg) => {
    setMessage(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setMessage(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0B1C3D] text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-slidein">
          <CheckCircle2 size={16} className="text-[#4ADE80]" />
          <span className="text-sm">{message}</span>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
