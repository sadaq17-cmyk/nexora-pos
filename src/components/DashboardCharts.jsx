import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

const CHART_TOOLTIP = {
  borderRadius: 8,
  borderColor: "var(--app-border)",
  fontSize: 12,
  boxShadow: "var(--shadow-card)",
  background: "var(--app-panel)",
  color: "var(--app-text)",
};

export function SalesTrendChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="nxSalesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--app-border)" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--app-muted)" />
        <YAxis tick={{ fontSize: 11 }} stroke="var(--app-muted)" width={48} />
        <Tooltip contentStyle={CHART_TOOLTIP} />
        <Area type="monotone" dataKey="sales" stroke="var(--brand)" fill="url(#nxSalesFill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PurchasesTrendChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="nxPurchaseFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--warning)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--app-border)" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--app-muted)" />
        <YAxis tick={{ fontSize: 11 }} stroke="var(--app-muted)" width={48} />
        <Tooltip contentStyle={CHART_TOOLTIP} />
        <Area type="monotone" dataKey="total" stroke="var(--warning)" fill="url(#nxPurchaseFill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default SalesTrendChart;
