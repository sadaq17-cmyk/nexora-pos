import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import QRCode from "qrcode";

/**
 * Production SVG QR for receipts (error correction Level Q).
 * Vector output — sanitized before DOM injection for thermal print and PDF embedding.
 */
export default function ReceiptQrCode({
  value,
  size = 96,
  className = "",
  label = "Scan to verify invoice",
}) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let cancelled = false;
    const payload = String(value || "").trim();
    if (!payload) {
      setSvg("");
      return undefined;
    }
    QRCode.toString(payload, {
      type: "svg",
      errorCorrectionLevel: "Q",
      margin: 1,
      width: size,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((markup) => {
        if (cancelled) return;
        const clean = DOMPurify.sanitize(markup, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ["svg", "path", "rect", "g"],
          ADD_ATTR: ["viewBox", "xmlns", "width", "height", "fill", "d", "x", "y", "shape-rendering"],
        });
        setSvg(clean);
      })
      .catch(() => {
        if (!cancelled) setSvg("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!value || !svg) {
    return null;
  }

  return (
    <div className={className} style={{ textAlign: "center" }}>
      <div
        aria-label={`QR code: ${value}`}
        role="img"
        style={{ display: "inline-block", width: size, height: size, lineHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {label ? (
        <div style={{ marginTop: 4, fontSize: 10, color: "#6B7690" }}>{label}</div>
      ) : null}
    </div>
  );
}
