import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ImagePlus,
  Loader2,
  SendHorizontal,
  Sparkles,
  X,
  Trash2,
  Shield,
  Maximize2,
  Search,
  Package,
  ReceiptText,
  CreditCard,
  Barcode,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { isOwner, isPlatformOwner, isSuperAdmin } from "../../lib/rbac";
import {
  fetchNexoraAiMeta,
  fileToBase64DataUrl,
  sendNexoraAiChat,
} from "../../lib/nexoraAiApi";

const EXECUTIVE_TABS = [
  { id: "dashboard", label: "Executive Dashboard", prompt: "Give me an executive company overview with key counts and sales snapshot." },
  { id: "bi", label: "Business Intelligence", prompt: "Provide a business intelligence summary of sales, purchases, expenses, and trends." },
  { id: "inventory", label: "Inventory", prompt: "Summarize inventory health: low stock, stock stats, and reorder priorities." },
  { id: "suppliers", label: "Suppliers", prompt: "Provide supplier analytics: list suppliers and any balance or purchase signals." },
  { id: "customers", label: "Customers", prompt: "Provide customer analytics overview from the customer list." },
  { id: "finance", label: "Finance", prompt: "Provide a financial analysis covering revenue, expenses, purchases, P&L, and cash-flow signals." },
  { id: "reports", label: "Reports", prompt: "Summarize key sales and profit reports available for this company." },
  { id: "audit", label: "Audit Logs", prompt: "Summarize the most recent audit log activity." },
  { id: "users", label: "User Monitoring", prompt: "List company users with roles, status, and last login. Include employee performance signals if available." },
  { id: "security", label: "Security", prompt: "Report security signals: locked accounts, failed logins, and force-logout flags." },
  { id: "forecast", label: "Forecast", prompt: "Give a simple sales forecast outlook based on recent trends." },
  { id: "settings", label: "Settings", prompt: "Where should I review company settings, login security, backup, and subscription as Owner?" },
];

const ASSISTANT_ACTIONS = [
  { id: "search", label: "Search Product", icon: Search, prompt: "Help me search products. Ask what I am looking for if needed, or list a few available products." },
  { id: "stock", label: "Check Stock", icon: Package, prompt: "Which products are low on stock or out of stock?" },
  { id: "orders", label: "Today's Orders", icon: ClipboardList, prompt: "Show today's orders / invoices for operational assistance." },
  { id: "invoice", label: "Track Invoice", icon: ReceiptText, prompt: "Help me track an invoice. Ask for the invoice or receipt number if I have not provided one." },
  { id: "payment", label: "Payment Help", icon: CreditCard, prompt: "Explain how cash, card, and credit payments work at checkout." },
  { id: "barcode", label: "Barcode Search", icon: Barcode, prompt: "Help me look up a product by barcode. Ask for the barcode if needed." },
];

function canOpenExecutive(role) {
  return isOwner(role) || isPlatformOwner(role) || isSuperAdmin(role);
}

function welcomeMessage(executive, configured) {
  if (!configured) {
    return {
      role: "system",
      content:
        "Nexora AI is installed but not configured yet. An administrator must set OPENAI_API_KEY (or NEXORA_AI_API_KEY) in the server environment. No answers will be fabricated.",
    };
  }
  if (executive) {
    return {
      role: "assistant",
      content:
        "Nexora Executive AI is ready. I can review executive dashboard, BI, inventory, suppliers, customers, finance, reports, audit logs, users, security, forecast, and settings — using your authorized company data only. I reply in your language.",
    };
  }
  return {
    role: "assistant",
    content:
      "Hi — I’m Nexora Assistant AI. I can help with product search, prices, barcodes, stock, today’s orders, invoices, payments, and FAQ. I reply in your language. I cannot access profit, revenue, expenses, audit logs, or owner settings.",
  };
}

/**
 * Floating AI window — opened from top-nav only (never shared with receipt panel).
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void }} props
 */
export default function NexoraAiAssistant({ open = false, onOpenChange }) {
  const { user } = useAuth();
  const executive = canOpenExecutive(user?.role);
  const [meta, setMeta] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState(executive ? "dashboard" : "search");
  const [attachment, setAttachment] = useState(null);
  const [size, setSize] = useState({ w: 440, h: 620 });
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const resizeRef = useRef(null);

  const brand = executive ? "Nexora Executive AI" : "Nexora Assistant AI";
  const configured = meta?.configured !== false;
  const starters = useMemo(() => (executive ? EXECUTIVE_TABS : ASSISTANT_ACTIONS), [executive]);

  const setOpen = (next) => {
    onOpenChange?.(Boolean(next));
  };

  const bootstrap = useCallback(async () => {
    const result = await fetchNexoraAiMeta();
    if (result?.success === false && result.code === "UNAUTHENTICATED") {
      setMeta({ configured: false });
      return;
    }
    setMeta(result?.success === false ? { configured: false, error: result.error } : result);
    setMessages([welcomeMessage(executive, result?.configured !== false && result?.success !== false)]);
  }, [executive]);

  useEffect(() => {
    if (!user?.id) return undefined;
    bootstrap();
    return () => {
      abortRef.current?.abort?.();
    };
  }, [user?.id, bootstrap]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, busy]);

  const clearChat = () => {
    setError("");
    setAttachment(null);
    setMessages([welcomeMessage(executive, configured)]);
  };

  const runPrompt = async (promptText, { withAttachment = true } = {}) => {
    const text = String(promptText || "").trim();
    if (!text && !attachment) return;
    if (busy) return;

    setError("");
    const userMsg = { role: "user", content: text || "Please analyze the attached screenshot." };
    const nextHistory = [...messages.filter((m) => m.role !== "system"), userMsg];
    setMessages((prev) => [...prev.filter((m) => m.role !== "system" || prev.length === 1), userMsg]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payloadMessages = nextHistory
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));

      const result = await sendNexoraAiChat({
        mode: executive ? "executive" : "assistant",
        messages: payloadMessages,
        image_base64: withAttachment && attachment?.dataUrl ? attachment.dataUrl : null,
        signal: controller.signal,
      });

      if (result?.success === false) {
        const errText = result.error || "Nexora AI request failed.";
        setError(errText);
        setMessages((prev) => [...prev, { role: "system", content: errText }]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.reply || "No response.",
          tools: result.tools_used || [],
        },
      ]);
      if (attachment) setAttachment(null);
    } catch (err) {
      const errText = err?.message || "Nexora AI request failed.";
      setError(errText);
      setMessages((prev) => [...prev, { role: "system", content: errText }]);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const onPickFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await fileToBase64DataUrl(file);
      setAttachment({ name: file.name, dataUrl });
      setError("");
    } catch (err) {
      setError(err?.message || "Could not attach image.");
    }
  };

  const resizeCleanupRef = useRef(null);
  useEffect(() => () => {
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
  }, []);

  const onResizePointerDown = (event) => {
    event.preventDefault();
    resizeCleanupRef.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = size.w;
    const startH = size.h;
    const onMove = (e) => {
      const nextW = Math.min(Math.max(340, startW + (e.clientX - startX)), Math.min(920, window.innerWidth - 24));
      const nextH = Math.min(Math.max(420, startH + (e.clientY - startY)), Math.min(900, window.innerHeight - 72));
      setSize({ w: nextW, h: nextH });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  if (!user) return null;
  if (!open) return null;

  return (
    <section
      className={`nx-ai-panel ${executive ? "is-executive" : "is-assistant"}`}
      role="dialog"
      aria-label={brand}
      aria-modal="false"
      style={{ width: `min(${size.w}px, calc(100vw - 16px))`, height: `min(${size.h}px, calc(100dvh - 72px))` }}
    >
      <header className="nx-ai-header">
        <div className="nx-ai-brand-mark" aria-hidden>
          {executive ? <Shield size={18} /> : <Bot size={18} />}
        </div>
        <div className="nx-ai-brand-copy">
          <h2 className="nx-ai-brand-title">{brand}</h2>
          <p className="nx-ai-brand-sub">
            {executive
              ? "Owner / Super Admin · company-scoped · audited"
              : "Staff helper · role-scoped · replies in your language"}
          </p>
        </div>
        <div className="nx-ai-header-actions">
          <button type="button" className="nx-ai-icon-btn" onClick={clearChat} aria-label="Clear chat" title="Clear">
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            className="nx-ai-icon-btn"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="nx-ai-sections" role="tablist" aria-label={executive ? "Executive panels" : "Quick actions"}>
        {starters.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={`nx-ai-chip ${activeSection === item.id ? "is-active" : ""}`}
              onClick={() => {
                setActiveSection(item.id);
                runPrompt(item.prompt);
              }}
            >
              {Icon ? <Icon size={12} className="nx-ai-chip-icon" aria-hidden /> : null}
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="nx-ai-messages" ref={listRef}>
        {messages.map((msg, index) => (
          <div
            key={`${msg.role}-${index}`}
            className={`nx-ai-msg is-${msg.role === "user" ? "user" : msg.role === "system" ? "system" : "assistant"}`}
          >
            {msg.content}
            {msg.tools?.length > 0 && (
              <span className="nx-ai-msg-meta">Tools: {msg.tools.join(", ")}</span>
            )}
          </div>
        ))}
        {busy && (
          <div className="nx-ai-msg is-assistant">
            <Loader2 size={14} className="inline animate-spin" aria-hidden /> Thinking with verified data…
          </div>
        )}
      </div>

      <div className="nx-ai-composer">
        {executive && (
          <div className="nx-ai-attach-row">
            <button
              type="button"
              className="nx-ai-chip"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <ImagePlus size={12} className="mr-1 inline" aria-hidden />
              Attach screenshot
            </button>
            {attachment && (
              <span className="nx-ai-attach-name" title={attachment.name}>
                {attachment.name}
                <button
                  type="button"
                  className="nx-ai-icon-btn"
                  style={{ display: "inline-grid", width: 22, height: 22, marginLeft: 4 }}
                  onClick={() => setAttachment(null)}
                  aria-label="Remove attachment"
                >
                  <X size={12} />
                </button>
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={onPickFile}
            />
          </div>
        )}
        <div className="nx-ai-input-row">
          <textarea
            className="nx-ai-input"
            rows={2}
            value={input}
            placeholder={
              executive
                ? "Ask Executive AI about finance, audit, security, forecast…"
                : "Ask about products, stock, invoices, payments…"
            }
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runPrompt(input);
              }
            }}
            disabled={busy}
          />
          <button
            type="button"
            className="nx-ai-send"
            onClick={() => runPrompt(input)}
            disabled={busy || (!input.trim() && !attachment)}
            aria-label="Send message"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
          </button>
        </div>
        <p className="nx-ai-hint">
          {error
            ? error
            : executive
              ? "Owner / Super Admin only · actions logged · never reveals secrets · replies in your language"
              : "No financial or security data · role-filtered · replies in your language"}
        </p>
      </div>

      <button
        type="button"
        className="nx-ai-resize"
        aria-label="Resize AI window"
        title="Resize"
        ref={resizeRef}
        onPointerDown={onResizePointerDown}
      >
        <Maximize2 size={12} aria-hidden />
      </button>
    </section>
  );
}

/** Compact top-nav trigger — never mounts inside receipt panels. */
export function NexoraAiNavButton({ onClick, className = "" }) {
  const { user } = useAuth();
  if (!user) return null;
  const executive = canOpenExecutive(user.role);
  const label = executive ? "Executive AI" : "Assistant AI";
  return (
    <button
      type="button"
      className={`nx-ai-nav-btn ${executive ? "is-executive" : "is-assistant"} ${className}`.trim()}
      onClick={onClick}
      aria-label={`Open ${label}`}
      title={label}
    >
      <span className="nx-ai-nav-btn-icon" aria-hidden>
        {executive ? <Shield size={15} /> : <Sparkles size={15} />}
      </span>
      <span className="nx-ai-nav-btn-label">{label}</span>
    </button>
  );
}
