/** Shared marketing copy for public Home / Features / FAQ pages. */

export const CAPABILITIES = [
  {
    title: "Retail & supermarket POS",
    text: "Fast checkout, barcodes, weighted items, and multi-lane retail workflows.",
  },
  {
    title: "Restaurant & cafe ready",
    text: "Order tickets, modifiers, and quick payment for hospitality counters.",
  },
  {
    title: "Pharmacy & specialty",
    text: "Structured catalogs, batch-friendly stock, and controlled user access.",
  },
  {
    title: "Hardware & electronics",
    text: "Serial-friendly inventory, high-value SKUs, and detailed sales history.",
  },
  {
    title: "Multi-company & branches",
    text: "Run separate companies and locations with branch-aware stock and sales.",
  },
  {
    title: "Multi-currency",
    text: "Company currency settings for regional pricing and reporting.",
  },
  {
    title: "Barcode scanning",
    text: "Scan, generate, and print barcodes for faster product lookup.",
  },
  {
    title: "Inventory control",
    text: "Stock levels, adjustments, transfers, and low-stock visibility.",
  },
  {
    title: "Purchasing",
    text: "Purchase orders, receiving, and supplier-linked procurement.",
  },
  {
    title: "Supplier management",
    text: "Central supplier records tied to purchases and balances.",
  },
  {
    title: "Customers & CRM",
    text: "Customer profiles, purchase history, and relationship follow-up.",
  },
  {
    title: "Employees & attendance",
    text: "Team accounts with session visibility and attendance-friendly ops.",
  },
  {
    title: "Roles & permissions",
    text: "Granular RBAC so cashiers, managers, and owners see only what they need.",
  },
  {
    title: "Expenses",
    text: "Track store expenses alongside sales for clearer margins.",
  },
  {
    title: "Sales & profit reports",
    text: "Daily sales, product performance, and profit-oriented summaries.",
  },
  {
    title: "Analytics dashboard",
    text: "Live KPIs for revenue, stock, and team activity.",
  },
  {
    title: "Tax & discounts",
    text: "Configurable tax and flexible discounts at checkout.",
  },
  {
    title: "Receipt printing",
    text: "Thermal-ready receipts with store branding and line detail.",
  },
  {
    title: "Offline-capable workflows",
    text: "Keep counters moving with resilient front-of-house flows.",
  },
  {
    title: "Cloud sync",
    text: "Centralized SaaS data so branches stay aligned.",
  },
  {
    title: "Backup & restore",
    text: "Platform tools to protect and recover operational data.",
  },
  {
    title: "Platform super admin",
    text: "Tenant isolation with a dedicated platform console for owners.",
  },
  {
    title: "Subscription billing",
    text: "Plan-based packaging, limits, and renewal-ready billing controls.",
  },
  {
    title: "Secure authentication",
    text: "Protected login, sessions, and company-scoped access.",
  },
];

/** Prefer site.config media industries on Home; kept for Features text fallbacks. */
export const INDUSTRIES = [
  { title: "Supermarket", text: "High-volume scanning, inventory, and multi-branch control." },
  { title: "Restaurant", text: "Counter service, modifiers, and quick settlement." },
  { title: "Pharmacy", text: "Structured catalogs with tightly controlled staff access." },
  { title: "Hardware", text: "Dense catalogs, suppliers, and purchase workflows." },
  { title: "Electronics", text: "High-value products, detailed history, and stock alerts." },
  { title: "Boutique", text: "Fashion and specialty retail with CRM follow-up." },
  { title: "Wholesale", text: "Bulk purchasing, warehouse stock, and B2B sales history." },
  { title: "Mini Market", text: "Compact stores that need speed, barcodes, and daily reports." },
];

export const WHY_NEXORA = [
  {
    title: "Built for real counters",
    text: "Checkout speed, barcode flow, and receipts designed for busy retail days.",
  },
  {
    title: "Multi-tenant by design",
    text: "Company data stays isolated while platform administration stays separate.",
  },
  {
    title: "Operations in one place",
    text: "POS, inventory, purchasing, people, and reports without tool-switching chaos.",
  },
  {
    title: "Secure from day one",
    text: "Roles, permissions, and authenticated access for every company workspace.",
  },
];

export const STATISTICS = [
  { value: "24+", label: "Core operational modules" },
  { value: "Multi", label: "Branch & company ready" },
  { value: "RBAC", label: "Granular team permissions" },
  { value: "Cloud", label: "SaaS sync & backups" },
];

/** Empty — real reviews only. Wired via site.config.ts / siteMedia. */
export const TESTIMONIALS = [];

export const FAQ_ITEMS = [
  {
    q: "What is Nexora POS?",
    a: "Nexora POS is a cloud SaaS platform for running retail and specialty store operations — checkout, inventory, purchasing, teams, reporting, and subscription billing.",
  },
  {
    q: "Which businesses can use it?",
    a: "Retail shops, supermarkets, restaurants, pharmacies, hardware, and electronics businesses — including multi-branch and multi-company setups.",
  },
  {
    q: "Does Nexora support barcodes and receipts?",
    a: "Yes. Scan and print barcodes, manage product codes, and print thermal-ready receipts from the POS workflow.",
  },
  {
    q: "Can I manage employees and permissions?",
    a: "Yes. Invite staff, assign roles, and control module-level permissions so each user only sees what they need.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes. Every new company receives a 7-day Free Trial with all Enterprise features. After expiry, only the Company Owner can log in to choose Starter, Business, Professional, or Enterprise (KES pricing). All company data is preserved.",
  },
  {
    q: "How do I get help?",
    a: "Email support@httpsnexorapos.com anytime, or use the Contact, Help, and Support pages on this site.",
  },
];
