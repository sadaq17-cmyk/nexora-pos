import { useEffect } from "react";

/**
 * Sets document.title and meta description for public marketing pages.
 */
export default function Seo({ title, description }) {
  useEffect(() => {
    if (title) document.title = title;

    if (!description) return undefined;

    let meta = document.querySelector('meta[name="description"]');
    const previous = meta?.getAttribute("content") ?? "";
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", description);

    return () => {
      if (meta && previous) meta.setAttribute("content", previous);
    };
  }, [title, description]);

  return null;
}
