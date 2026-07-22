import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Renders a barcode as SVG via JsBarcode (EAN-13 or CODE128). */
export default function BarcodePreview({
  value,
  format = "EAN-13",
  height = 48,
  width = 1.6,
  displayValue = true,
  className = "",
  background = "#ffffff",
  lineColor = "#0f172a",
}) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    const fmt = String(format || "EAN-13").toUpperCase().includes("128") ? "CODE128" : "EAN13";
    try {
      // EAN13 requires exactly 12 or 13 digits; fall back to CODE128 otherwise
      let useFormat = fmt;
      if (fmt === "EAN13" && !/^\d{12,13}$/.test(String(value))) {
        useFormat = "CODE128";
      }
      JsBarcode(svgRef.current, String(value), {
        format: useFormat,
        height,
        width,
        displayValue,
        background,
        lineColor,
        margin: 4,
        fontSize: 12,
        textMargin: 2,
      });
    } catch {
      // Invalid value for chosen format — leave SVG empty
      while (svgRef.current.firstChild) svgRef.current.removeChild(svgRef.current.firstChild);
    }
  }, [value, format, height, width, displayValue, background, lineColor]);

  if (!value) {
    return <div className={`text-xs text-app-muted ${className}`}>No barcode</div>;
  }

  return <svg ref={svgRef} className={className} role="img" aria-label={`Barcode ${value}`} />;
}
