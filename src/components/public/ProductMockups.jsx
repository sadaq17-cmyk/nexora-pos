import { useState } from "react";

const NAVY = "#0B1C3D";
const BLUE = "#2563EB";
const SOFT = "#F5F8FC";
const MUTED = "#64748B";

const SIDEBAR_ITEMS = [
  "Dashboard",
  "POS",
  "Products",
  "Inventory",
  "Sales",
  "Reports",
  "Settings",
];

function Bar({ w = "100%", h = 8, color = "#E2E8F0", radius = 4, style }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        background: color,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

function Pill({ children, tone = "blue" }) {
  const styles =
    tone === "green"
      ? { background: "#ECFDF5", color: "#047857" }
      : tone === "amber"
        ? { background: "#FFFBEB", color: "#B45309" }
        : { background: "#EEF4FF", color: BLUE };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 9,
        fontWeight: 600,
        ...styles,
      }}
    >
      {children}
    </span>
  );
}

function MockFrame({ title, activeNav = "Dashboard", children, wide }) {
  return (
    <div
      className="nx-mock-frame"
      style={{
        width: "100%",
        maxWidth: wide ? 720 : 560,
        aspectRatio: wide ? "16 / 10" : "16 / 11",
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid #D9E3F2",
        background: "#fff",
        boxShadow: "0 18px 48px rgba(11, 28, 61, 0.12)",
        display: "flex",
        flexDirection: "column",
        fontFamily: 'var(--font-sans, "Plus Jakarta Sans", sans-serif)',
      }}
    >
      <div
        style={{
          height: 28,
          background: NAVY,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 12px",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#F87171" }} />
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#FBBF24" }} />
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#34D399" }} />
        <span style={{ marginLeft: 10, color: "rgba(255,255,255,0.75)", fontSize: 10, fontWeight: 600 }}>
          Nexora POS Pro · {title}
        </span>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <aside
          style={{
            width: 92,
            background: NAVY,
            color: "#fff",
            padding: "10px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.02em", marginBottom: 6 }}>Nexora</div>
          {SIDEBAR_ITEMS.map((item) => {
            const active = item === activeNav || (activeNav === "POS" && item === "POS");
            return (
              <div
                key={item}
                style={{
                  fontSize: 8,
                  padding: "5px 6px",
                  borderRadius: 6,
                  background: active ? BLUE : "transparent",
                  color: active ? "#fff" : "rgba(255,255,255,0.65)",
                  fontWeight: active ? 700 : 500,
                }}
              >
                {item}
              </div>
            );
          })}
        </aside>
        <div style={{ flex: 1, background: SOFT, padding: 12, minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>{title}</div>
              <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>Live workspace preview</div>
            </div>
            <Pill>Synced</Pill>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function StatRow({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 8, marginBottom: 10 }}>
      {items.map(([label, value]) => (
        <div key={label} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 8 }}>
          <div style={{ fontSize: 8, color: MUTED }}>{label}</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: NAVY, marginTop: 2 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function TableMock({ headers, rows }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${headers.length}, 1fr)`,
          gap: 4,
          padding: "6px 8px",
          background: "#EEF4FF",
          fontSize: 8,
          fontWeight: 700,
          color: NAVY,
        }}
      >
        {headers.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${headers.length}, 1fr)`,
            gap: 4,
            padding: "6px 8px",
            borderTop: "1px solid #F1F5F9",
            fontSize: 8,
            color: MUTED,
          }}
        >
          {row.map((cell, j) => (
            <span key={j} style={{ color: j === 0 ? NAVY : MUTED, fontWeight: j === 0 ? 600 : 500 }}>
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ——— Individual mockups ——— */

function DashboardMock() {
  return (
    <MockFrame title="Dashboard" activeNav="Dashboard">
      <StatRow items={[["Today sales", "$12,480"], ["Orders", "186"], ["Low stock", "14"], ["Staff online", "8"]]} />
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8 }}>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 10, height: 110 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Revenue trend</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 70 }}>
            {[40, 55, 48, 70, 62, 88, 76].map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${h}%`, background: i === 5 ? BLUE : "#BFDBFE", borderRadius: "4px 4px 0 0" }} />
            ))}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Top products</div>
          {["Milk 1L", "Rice 5kg", "USB Cable"].map((p, i) => (
            <div key={p} style={{ display: "flex", justifyContent: "space-between", fontSize: 8, marginBottom: 6, color: MUTED }}>
              <span style={{ color: NAVY, fontWeight: 600 }}>{p}</span>
              <span>{[42, 31, 28][i]} sold</span>
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}

function PosCheckoutMock() {
  return (
    <MockFrame title="POS Checkout" activeNav="POS" wide>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.9fr", gap: 8, height: "78%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {["Cola 500ml", "Bread", "Soap", "Rice 2kg", "Oil 1L", "Water"].map((p, i) => (
            <div key={p} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, padding: 8 }}>
              <Bar w="100%" h={28} color="#DBEAFE" radius={6} />
              <div style={{ fontSize: 8, fontWeight: 700, color: NAVY, marginTop: 6 }}>{p}</div>
              <div style={{ fontSize: 8, color: BLUE, fontWeight: 700 }}>${(1.2 + i * 0.8).toFixed(2)}</div>
            </div>
          ))}
        </div>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: NAVY }}>Current sale</div>
          {[["Cola 500ml", "x2", "$2.40"], ["Bread", "x1", "$1.50"], ["Oil 1L", "x1", "$4.20"]].map(([a, b, c]) => (
            <div key={a} style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: MUTED, marginTop: 6 }}>
              <span style={{ color: NAVY }}>{a}</span>
              <span>{b}</span>
              <span style={{ fontWeight: 700, color: NAVY }}>{c}</span>
            </div>
          ))}
          <div style={{ marginTop: "auto", borderTop: "1px solid #E2E8F0", paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 800, color: NAVY }}>
              <span>Total</span>
              <span>$8.10</span>
            </div>
            <div style={{ marginTop: 8, background: BLUE, color: "#fff", textAlign: "center", borderRadius: 8, padding: 8, fontSize: 9, fontWeight: 700 }}>
              Charge & print
            </div>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function InventoryMock() {
  return (
    <MockFrame title="Inventory" activeNav="Inventory">
      <StatRow items={[["SKUs", "2,480"], ["Warehouses", "3"], ["Alerts", "14"]]} />
      <TableMock
        headers={["Product", "Branch", "Qty", "Status"]}
        rows={[
          ["Rice 5kg", "Main", "42", "OK"],
          ["USB-C Cable", "East", "6", "Low"],
          ["Paracetamol", "Main", "120", "OK"],
        ]}
      />
    </MockFrame>
  );
}

function ProductsMock() {
  return (
    <MockFrame title="Products" activeNav="Products">
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <Bar w="55%" h={22} color="#fff" style={{ border: "1px solid #E2E8F0" }} />
        <Pill>Categories</Pill>
        <Pill tone="green">+ Add product</Pill>
      </div>
      <TableMock
        headers={["SKU", "Name", "Price", "Tax"]}
        rows={[
          ["NX-1042", "Espresso Beans", "$18.00", "16%"],
          ["NX-1188", "HDMI Cable", "$12.50", "16%"],
          ["NX-2201", "Hand Soap", "$3.20", "0%"],
        ]}
      />
    </MockFrame>
  );
}

function BarcodeScannerMock() {
  return (
    <MockFrame title="Barcode Scanner" activeNav="Products">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 12, textAlign: "center" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: NAVY }}>Scan target</div>
          <div
            style={{
              margin: "12px auto",
              width: 120,
              height: 56,
              border: `2px dashed ${BLUE}`,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#EFF6FF",
            }}
          >
            <div style={{ width: 90, height: 28, background: `repeating-linear-gradient(90deg, ${NAVY} 0 2px, transparent 2px 4px)` }} />
          </div>
          <div style={{ fontSize: 8, color: MUTED }}>Awaiting barcode…</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Matched product</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: NAVY }}>Cola 500ml</div>
          <div style={{ fontSize: 8, color: MUTED, marginTop: 4 }}>EAN · 5449000000996</div>
          <div style={{ marginTop: 10 }}><Pill tone="green">In stock · 86</Pill></div>
        </div>
      </div>
    </MockFrame>
  );
}

function PurchasesMock() {
  return (
    <MockFrame title="Purchases" activeNav="Inventory">
      <TableMock
        headers={["PO", "Supplier", "Total", "Status"]}
        rows={[
          ["PO-1042", "Bidco", "$450", "Received"],
          ["PO-1041", "Brookside", "$185", "Pending"],
          ["PO-1040", "Coca-Cola", "$620", "Ordered"],
        ]}
      />
    </MockFrame>
  );
}

function SuppliersMock() {
  return (
    <MockFrame title="Suppliers" activeNav="Inventory">
      <TableMock
        headers={["Supplier", "Category", "Orders", "Balance"]}
        rows={[
          ["Bidco Africa", "Groceries", "18", "$44"],
          ["Brookside", "Dairy", "12", "$0"],
          ["TechSource", "Electronics", "9", "$210"],
        ]}
      />
    </MockFrame>
  );
}

function CustomersMock() {
  return (
    <MockFrame title="Customers" activeNav="Sales">
      <StatRow items={[["Customers", "1,240"], ["Loyalty", "318"], ["Due", "$920"]]} />
      <TableMock
        headers={["Name", "Phone", "Visits", "Spend"]}
        rows={[
          ["Amina K.", "0700…", "22", "$840"],
          ["Daniel O.", "0711…", "14", "$510"],
          ["Sara M.", "0722…", "9", "$290"],
        ]}
      />
    </MockFrame>
  );
}

function SalesMock() {
  return (
    <MockFrame title="Sales" activeNav="Sales">
      <StatRow items={[["Gross", "$48.2k"], ["Refunds", "$420"], ["Net", "$47.8k"]]} />
      <TableMock
        headers={["Receipt", "Cashier", "Total", "Pay"]}
        rows={[
          ["R-8821", "James", "$42.10", "Card"],
          ["R-8820", "Grace", "$18.50", "Cash"],
          ["R-8819", "Peter", "$96.00", "M-Pesa"],
        ]}
      />
    </MockFrame>
  );
}

function ReturnsMock() {
  return (
    <MockFrame title="Returns" activeNav="Sales">
      <TableMock
        headers={["Return", "Original", "Reason", "Status"]}
        rows={[
          ["RT-221", "R-8790", "Damaged", "Approved"],
          ["RT-220", "R-8782", "Wrong item", "Pending"],
          ["RT-219", "R-8771", "Customer", "Refunded"],
        ]}
      />
    </MockFrame>
  );
}

function ExpensesMock() {
  return (
    <MockFrame title="Expenses" activeNav="Reports">
      <StatRow items={[["This month", "$3,240"], ["Utilities", "$880"], ["Supplies", "$1,120"]]} />
      <TableMock
        headers={["Date", "Category", "Amount", "Branch"]}
        rows={[
          ["Jul 18", "Rent", "$1,200", "Main"],
          ["Jul 16", "Utilities", "$210", "East"],
          ["Jul 14", "Packaging", "$96", "Main"],
        ]}
      />
    </MockFrame>
  );
}

function ProfitReportsMock() {
  return (
    <MockFrame title="Profit Reports" activeNav="Reports">
      <StatRow items={[["Revenue", "$128k"], ["COGS", "$74k"], ["Profit", "$41k"]]} />
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 10, height: 100 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Margin by category</div>
        {[
          ["Grocery", 72],
          ["Electronics", 48],
          ["Pharmacy", 61],
        ].map(([label, pct]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ width: 56, fontSize: 8, color: MUTED }}>{label}</span>
            <div style={{ flex: 1, height: 6, background: "#E2E8F0", borderRadius: 99 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: BLUE, borderRadius: 99 }} />
            </div>
            <span style={{ fontSize: 8, fontWeight: 700, color: NAVY }}>{pct}%</span>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

function AnalyticsDashboardMock() {
  return (
    <MockFrame title="Analytics Dashboard" activeNav="Dashboard">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        {[
          ["Conversion", "3.8%"],
          ["AOV", "$24.10"],
          ["Repeat", "41%"],
        ].map(([l, v]) => (
          <div key={l} style={{ background: NAVY, color: "#fff", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 8, opacity: 0.7 }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 10, height: 90 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: NAVY }}>Branch comparison</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 58, marginTop: 8 }}>
          {[
            ["Main", 90],
            ["East", 68],
            ["West", 54],
          ].map(([n, h]) => (
            <div key={n} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: `${h}%`, background: `linear-gradient(180deg, ${BLUE}, #93C5FD)`, borderRadius: "6px 6px 0 0" }} />
              <div style={{ fontSize: 8, color: MUTED, marginTop: 4 }}>{n}</div>
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}

function EmployeeManagementMock() {
  return (
    <MockFrame title="Employee Management" activeNav="Settings">
      <TableMock
        headers={["Employee", "Role", "Branch", "Status"]}
        rows={[
          ["Grace W.", "Cashier", "Main", "Active"],
          ["Peter O.", "Manager", "East", "Active"],
          ["James M.", "Cashier", "West", "Break"],
        ]}
      />
    </MockFrame>
  );
}

function RolesPermissionsMock() {
  return (
    <MockFrame title="Roles & Permissions" activeNav="Settings">
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Manager role</div>
        {["POS checkout", "Inventory adjust", "View reports", "Manage users"].map((perm, i) => (
          <div key={perm} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 8, color: MUTED }}>
            <span style={{ color: NAVY }}>{perm}</span>
            <span
              style={{
                width: 28,
                height: 14,
                borderRadius: 99,
                background: i === 3 ? "#E2E8F0" : BLUE,
                position: "relative",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: i === 3 ? 2 : 14,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#fff",
                }}
              />
            </span>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

function MultiBranchMock() {
  return (
    <MockFrame title="Multi-Branch" activeNav="Settings">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          ["Main Street", "Open", "42 staff"],
          ["East Mall", "Open", "18 staff"],
          ["West Hub", "Closed", "12 staff"],
        ].map(([name, status, staff]) => (
          <div key={name} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: NAVY }}>{name}</div>
            <div style={{ marginTop: 6 }}><Pill tone={status === "Open" ? "green" : "amber"}>{status}</Pill></div>
            <div style={{ fontSize: 8, color: MUTED, marginTop: 8 }}>{staff}</div>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

function CompanySettingsMock() {
  return (
    <MockFrame title="Company Settings" activeNav="Settings">
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 12 }}>
        {[
          ["Company name", "Nexora Retail Ltd"],
          ["Currency", "USD"],
          ["Tax rate", "16%"],
          ["Receipt footer", "Thank you for shopping"],
        ].map(([l, v]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 9 }}>
            <span style={{ color: MUTED }}>{l}</span>
            <span style={{ color: NAVY, fontWeight: 700 }}>{v}</span>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

function PlatformSuperAdminMock() {
  return (
    <MockFrame title="Platform Super Admin" activeNav="Dashboard">
      <StatRow items={[["Tenants", "128"], ["Active", "114"], ["Trials", "22"]]} />
      <TableMock
        headers={["Company", "Plan", "Users", "Status"]}
        rows={[
          ["FreshMart", "Pro", "24", "Active"],
          ["City Pharma", "Enterprise", "48", "Active"],
          ["ByteStore", "Basic", "6", "Trial"],
        ]}
      />
    </MockFrame>
  );
}

function SubscriptionManagementMock() {
  return (
    <MockFrame title="Subscription Management" activeNav="Settings">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{ background: NAVY, color: "#fff", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 8, opacity: 0.7 }}>Current plan</div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>Professional</div>
          <div style={{ fontSize: 9, marginTop: 8, opacity: 0.85 }}>Renews Aug 19, 2026</div>
          <div style={{ marginTop: 12, background: BLUE, borderRadius: 8, padding: 8, textAlign: "center", fontSize: 9, fontWeight: 700 }}>
            Manage billing
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Usage</div>
          {[
            ["Users", "18 / 25"],
            ["Branches", "3 / 5"],
            ["Products", "2.1k / 10k"],
          ].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: MUTED, marginBottom: 6 }}>
              <span>{l}</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}

function MobilePosMock() {
  return (
    <div
      className="nx-mock-frame"
      style={{
        width: 220,
        margin: "0 auto",
        borderRadius: 28,
        border: `8px solid ${NAVY}`,
        background: SOFT,
        boxShadow: "0 18px 48px rgba(11, 28, 61, 0.14)",
        overflow: "hidden",
        fontFamily: 'var(--font-sans, "Plus Jakarta Sans", sans-serif)',
      }}
    >
      <div style={{ height: 18, background: NAVY }} />
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: NAVY }}>Mobile POS</div>
        <div style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>Counter mode</div>
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {["Scan item", "Cola 500ml · $1.20", "Bread · $1.50"].map((row, i) => (
            <div key={row} style={{ background: "#fff", borderRadius: 10, padding: 8, fontSize: 8, color: i ? NAVY : BLUE, fontWeight: 700, border: "1px solid #E2E8F0" }}>
              {row}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, background: BLUE, color: "#fff", borderRadius: 10, padding: 10, textAlign: "center", fontSize: 10, fontWeight: 800 }}>
          Pay $2.70
        </div>
      </div>
    </div>
  );
}

function TabletPosMock() {
  return (
    <MockFrame title="Tablet POS" activeNav="POS" wide>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, padding: 8, minHeight: 48 }}>
              <Bar h={18} color="#DBEAFE" />
              <div style={{ fontSize: 7, fontWeight: 700, color: NAVY, marginTop: 6 }}>Item {i + 1}</div>
            </div>
          ))}
        </div>
        <div style={{ background: NAVY, borderRadius: 12, padding: 12, color: "#fff" }}>
          <div style={{ fontSize: 10, fontWeight: 800 }}>Tablet cart</div>
          <div style={{ fontSize: 8, opacity: 0.7, marginTop: 4 }}>Landscape checkout</div>
          <div style={{ marginTop: 16, fontSize: 18, fontWeight: 800 }}>$64.20</div>
          <div style={{ marginTop: 12, background: BLUE, borderRadius: 8, padding: 10, textAlign: "center", fontSize: 9, fontWeight: 700 }}>
            Complete sale
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function ReceiptPrintingMock() {
  return (
    <MockFrame title="Receipt Printing" activeNav="POS">
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: 160, background: "#fff", border: "1px dashed #94A3B8", borderRadius: 4, padding: 12, fontFamily: "ui-monospace, monospace" }}>
          <div style={{ textAlign: "center", fontSize: 10, fontWeight: 800, color: NAVY }}>NEXORA STORE</div>
          <div style={{ textAlign: "center", fontSize: 7, color: MUTED, marginTop: 2 }}>Main Branch · Jul 19</div>
          <div style={{ borderTop: "1px dashed #CBD5E1", margin: "8px 0" }} />
          {[["Cola", "1.20"], ["Bread", "1.50"], ["Oil", "4.20"]].map(([a, b]) => (
            <div key={a} style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: NAVY, marginBottom: 3 }}>
              <span>{a}</span>
              <span>${b}</span>
            </div>
          ))}
          <div style={{ borderTop: "1px dashed #CBD5E1", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontWeight: 800, color: NAVY }}>
            <span>TOTAL</span>
            <span>$6.90</span>
          </div>
          <div style={{ textAlign: "center", fontSize: 7, color: MUTED, marginTop: 10 }}>Thank you</div>
        </div>
      </div>
    </MockFrame>
  );
}

function StockAlertsMock() {
  return (
    <MockFrame title="Stock Alerts" activeNav="Inventory">
      <div style={{ display: "grid", gap: 6 }}>
        {[
          ["USB-C Cable", "6 left", "Reorder soon"],
          ["Hand Soap", "3 left", "Critical"],
          ["A4 Paper", "12 left", "Watch"],
        ].map(([name, qty, level]) => (
          <div key={name} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: NAVY }}>{name}</div>
              <div style={{ fontSize: 8, color: MUTED }}>{qty}</div>
            </div>
            <Pill tone={level === "Critical" ? "amber" : "blue"}>{level}</Pill>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

function BackupRestoreMock() {
  return (
    <MockFrame title="Backup & Restore" activeNav="Settings">
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: NAVY }}>Latest backup</div>
        <div style={{ fontSize: 8, color: MUTED, marginTop: 4 }}>Jul 19, 2026 · 02:15 UTC · Encrypted</div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <div style={{ flex: 1, background: BLUE, color: "#fff", borderRadius: 8, padding: 8, textAlign: "center", fontSize: 9, fontWeight: 700 }}>
            Create backup
          </div>
          <div style={{ flex: 1, background: SOFT, color: NAVY, borderRadius: 8, padding: 8, textAlign: "center", fontSize: 9, fontWeight: 700, border: "1px solid #D9E3F2" }}>
            Restore
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

export const PRODUCT_MOCKUPS = {
  "Dashboard": DashboardMock,
  "POS Checkout": PosCheckoutMock,
  "Inventory": InventoryMock,
  "Products": ProductsMock,
  "Barcode Scanner": BarcodeScannerMock,
  "Purchases": PurchasesMock,
  "Suppliers": SuppliersMock,
  "Customers": CustomersMock,
  "Sales": SalesMock,
  "Returns": ReturnsMock,
  "Expenses": ExpensesMock,
  "Profit Reports": ProfitReportsMock,
  "Analytics Dashboard": AnalyticsDashboardMock,
  "Employee Management": EmployeeManagementMock,
  "Roles & Permissions": RolesPermissionsMock,
  "Multi-Branch": MultiBranchMock,
  "Company Settings": CompanySettingsMock,
  "Platform Super Admin": PlatformSuperAdminMock,
  "Subscription Management": SubscriptionManagementMock,
  "Mobile POS": MobilePosMock,
  "Tablet POS": TabletPosMock,
  "Receipt Printing": ReceiptPrintingMock,
  "Stock Alerts": StockAlertsMock,
  "Backup & Restore": BackupRestoreMock,
};

export const MOCKUP_KEYS = Object.keys(PRODUCT_MOCKUPS);

export function ProductMockup({ name, className = "" }) {
  const Comp = PRODUCT_MOCKUPS[name] || DashboardMock;
  return (
    <div className={className} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <Comp />
    </div>
  );
}

export function HeroPosPlane() {
  return (
    <div className="nx-hero-plane" aria-hidden="true">
      <div className="nx-hero-plane__glow" />
      <div className="nx-hero-plane__stage">
        <ProductMockup name="POS Checkout" />
      </div>
    </div>
  );
}

export function ScreenshotGallery() {
  const [active, setActive] = useState(MOCKUP_KEYS[0]);
  const Active = PRODUCT_MOCKUPS[active] || DashboardMock;

  return (
    <div className="nx-gallery">
      <div className="nx-gallery__stage public-animate-fade">
        <Active />
      </div>
      <div className="nx-gallery__grid" role="listbox" aria-label="Product screenshots">
        {MOCKUP_KEYS.map((key) => {
          const selected = key === active;
          return (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={selected}
              className={`nx-gallery__thumb ${selected ? "is-active" : ""}`}
              onClick={() => setActive(key)}
            >
              <span className="nx-gallery__thumb-label">{key}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PRODUCT_MOCKUPS;
