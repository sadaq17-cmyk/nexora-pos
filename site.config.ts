/**
 * Nexora POS public site media & marketing configuration (MEDIA-GUIDE).
 * Industry / In Action photos live under /public/media (royalty-free Unsplash & Pexels).
 * Product Screenshots & Feature Spotlights use Nexora POS UI mockups only (no stock UI).
 */

export const siteConfig = {
  brand: {
    name: "Nexora POS",
    supportEmail: "support@httpsnexorapos.com",
    colors: {
      navy: "#0B1C3D",
      blue: "#2563EB",
      white: "#FFFFFF",
      soft: "#F5F8FC",
      muted: "#64748B",
    },
  },

  media: {
    credit:
      "Industry and In Action photography: Unsplash & Pexels (royalty-free, commercial-safe). Product UI: Nexora POS.",

    industries: [
      {
        id: "supermarket",
        title: "Supermarket",
        text: "High-volume scanning, multi-lane checkout, and branch inventory control.",
        src: "/media/industries/supermarket.jpg",
        alt: "Supermarket grocery aisle with stocked shelves",
      },
      {
        id: "restaurant",
        title: "Restaurant",
        text: "Counter service, modifiers, and fast settlement for hospitality teams.",
        src: "/media/industries/restaurant.jpg",
        alt: "Restaurant dining room prepared for service",
      },
      {
        id: "pharmacy",
        title: "Pharmacy",
        text: "Structured catalogs with tightly controlled staff access and stock discipline.",
        src: "/media/industries/pharmacy.jpg",
        alt: "Pharmacy product shelves organized for retail",
      },
      {
        id: "hardware",
        title: "Hardware",
        text: "Dense catalogs, supplier purchasing, and durable goods inventory.",
        src: "/media/industries/hardware.jpg",
        alt: "Hardware tools and supplies on store display",
      },
      {
        id: "electronics",
        title: "Electronics",
        text: "High-value SKUs, detailed sales history, and stock alerts.",
        src: "/media/industries/electronics.jpg",
        alt: "Consumer electronics retail display",
      },
      {
        id: "boutique",
        title: "Boutique",
        text: "Fashion and specialty retail with clean catalog and CRM follow-up.",
        src: "/media/industries/boutique.jpg",
        alt: "Boutique clothing retail floor",
      },
      {
        id: "wholesale",
        title: "Wholesale",
        text: "Bulk purchasing, warehouse stock, and B2B-ready sales history.",
        src: "/media/industries/wholesale.jpg",
        alt: "Wholesale warehouse inventory racks",
      },
      {
        id: "minimarket",
        title: "Mini Market",
        text: "Compact stores that need speed, barcodes, and reliable daily reporting.",
        src: "/media/industries/minmarket.jpg",
        alt: "Neighborhood mini market produce and grocery display",
      },
    ] as const,

    inAction: [
      {
        id: "cashiers",
        title: "Cashiers serving customers",
        src: "/media/in-action/cashiers.jpg",
        alt: "Retail cashier serving a customer at the counter",
      },
      {
        id: "barcode",
        title: "Barcode scanning",
        src: "/media/in-action/barcode.jpg",
        alt: "Warehouse team scanning inventory barcodes",
      },
      {
        id: "checkout",
        title: "Checkout",
        src: "/media/in-action/checkout.jpg",
        alt: "Point of sale checkout counter in a retail store",
      },
      {
        id: "receipt",
        title: "Receipt printing",
        src: "/media/in-action/receipt.jpg",
        alt: "Printed retail receipt on a counter",
      },
      {
        id: "warehouse",
        title: "Warehouse inventory",
        src: "/media/in-action/warehouse.jpg",
        alt: "Warehouse inventory shelves and stock handling",
      },
      {
        id: "dashboard",
        title: "Managers using dashboards",
        src: "/media/in-action/dashboard.jpg",
        alt: "Manager reviewing business analytics on a laptop",
      },
      {
        id: "mobile-pos",
        title: "Mobile POS",
        src: "/media/in-action/mobile-pos.jpg",
        alt: "Handheld mobile device used for retail operations",
      },
      {
        id: "payments",
        title: "Customer payments",
        src: "/media/in-action/payments.jpg",
        alt: "Customer completing a payment at retail checkout",
      },
    ] as const,

    /** Empty until real customer logos are provided with permission. */
    trustedBy: [] as { name: string; src: string; alt: string }[],

    /**
     * Empty until real customer reviews are collected.
     * Do not invent names, faces, companies, or quotes.
     */
    testimonials: [] as { quote: string; name: string; role: string; company?: string }[],

    /** Nexora POS UI only — rendered via ProductMockups, not stock screenshots. */
    featureSpotlights: [
      { mockup: "POS Checkout", title: "POS Checkout", blurb: "Fast barcode checkout with cash tendering and receipts." },
      { mockup: "Inventory", title: "Inventory", blurb: "Stock levels, adjustments, and warehouse visibility." },
      { mockup: "Analytics Dashboard", title: "Analytics Dashboard", blurb: "Live KPIs for revenue, stock, and team activity." },
      { mockup: "Platform Super Admin", title: "Platform Super Admin", blurb: "Multi-tenant control for companies and subscriptions." },
    ] as const,
  },
} as const;

export type SiteConfig = typeof siteConfig;
export default siteConfig;
