import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/**
 * CODE128 SVG barcode for receipt numbers.
 * Encodes the receipt number exactly (e.g. NX-2026-0004567).
 */
export default function ReceiptBarcode({
  value,
  height = 40,
  width = 1.2,
  className = "",
  displayValue = true,
}) {
  const svgRef = useRef(null);
  const code = String(value || "").trim();

  useEffect(() => {
    if (!svgRef.current || !code) return;
    try {
      JsBarcode(svgRef.current, code, {
        format: "CODE128",
        height,
        width,
        displayValue,
        margin: 0,
        background: "#ffffff",
        lineColor: "#0f172a",
        fontSize: 11,
        textMargin: 2,
        fontOptions: "bold",
      });
    } catch {
      while (svgRef.current.firstChild) {
        svgRef.current.removeChild(svgRef.current.firstChild);
      }
    }
  }, [code, height, width, displayValue]);

  if (!code) return null;

  return (
    <div className={className} style={{ textAlign: "center" }}>
      <svg
        ref={svgRef}
        role="img"
        aria-label={`Barcode ${code}`}
        style={{ maxWidth: "100%", height: "auto" }}
      />
    </div>
  );
}
