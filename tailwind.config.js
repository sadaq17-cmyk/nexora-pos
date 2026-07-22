/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0B1C3D",
        blue: "#2563EB",
        bg: "#E8EDF5",
        border: "#D5DEEB",
        ink: "#0F172A",
        brand: "#2563EB",
        success: "#15803D",
        warning: "#B45309",
        danger: "#DC2626",
        background: "var(--app-bg)",
        foreground: "var(--app-text)",
        card: {
          DEFAULT: "var(--app-panel)",
          foreground: "var(--app-text)",
        },
        popover: {
          DEFAULT: "var(--app-panel)",
          foreground: "var(--app-text)",
        },
        primary: {
          DEFAULT: "var(--brand)",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "var(--app-panel-muted)",
          foreground: "var(--app-text)",
        },
        muted: {
          DEFAULT: "var(--app-panel-muted)",
          foreground: "var(--app-muted)",
        },
        accent: {
          DEFAULT: "var(--brand-soft)",
          foreground: "var(--brand)",
        },
        destructive: {
          DEFAULT: "var(--danger)",
          foreground: "#ffffff",
        },
        input: "var(--app-border)",
        ring: "var(--brand)",
      },
      maxWidth: {
        content: "1400px",
      },
      borderRadius: {
        card: "16px",
        control: "8px",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      transitionDuration: {
        DEFAULT: "180ms",
        fast: "150ms",
        slow: "200ms",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Segoe UI", "ui-sans-serif", "sans-serif"],
        display: ["Fraunces", "Georgia", "ui-serif", "serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      fontSize: {
        page: ["28px", { lineHeight: "1.2", fontWeight: "700", letterSpacing: "-0.03em" }],
        section: ["22px", { lineHeight: "1.3", fontWeight: "700", letterSpacing: "-0.02em" }],
        card: ["17px", { lineHeight: "1.35", fontWeight: "600" }],
        body: ["15px", { lineHeight: "1.55" }],
        small: ["13px", { lineHeight: "1.5" }],
        label: ["12px", { lineHeight: "1.4", fontWeight: "500" }],
      },
      boxShadow: {
        card: "0 1px 2px rgb(15 23 42 / 0.04), 0 4px 14px rgb(15 23 42 / 0.05)",
        "card-hover": "0 2px 6px rgb(15 23 42 / 0.06), 0 8px 22px rgb(15 23 42 / 0.07)",
      },
    },
  },
  plugins: [],
};
