/**
 * Server-side report analytics (mirrors src/lib/reportAnalytics.js shape).
 * Never import from src/.
 */

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function idEquals(left, right) {
  return String(left ?? "") === String(right ?? "");
}

export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function localDateRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59.999`);
  return {
    start: Number.isNaN(start.getTime()) ? new Date(0) : start,
    end: Number.isNaN(end.getTime()) ? new Date(8640000000000000) : end,
  };
}

function inRange(value, range) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= range.start.getTime() && time <= range.end.getTime();
}

function dateSequence(start, end) {
  const rows = [];
  const cursor = new Date(start);
  cursor.setHours(12, 0, 0, 0);
  const last = new Date(end);
  last.setHours(12, 0, 0, 0);
  while (cursor <= last && rows.length < 370) {
    rows.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function saleAdjustments(sale) {
  const returned = Math.max(
    number(sale.returned),
    number(sale.return_amount),
    number(sale.returned_amount)
  );
  const refundCandidate = Math.max(number(sale.refund), number(sale.refund_amount), number(sale.refunded_amount));
  return {
    returns: returned,
    refunds: Math.max(0, refundCandidate - returned),
    total: Math.max(returned, refundCandidate),
  };
}

function aggregate(db, filters, startDate, endDate) {
  const range = localDateRange(startDate, endDate);
  const products = new Map((db.products || []).map((row) => [String(row.id), row]));
  const categories = new Map((db.categories || []).map((row) => [String(row.id), row]));
  const productTotals = new Map();
  const categoryTotals = new Map();
  const cashierTotals = new Map();
  const daily = new Map(
    dateSequence(range.start, range.end).map((key) => [
      key,
      { date: key, sales: 0, profit: 0, expenses: 0, transactions: 0 },
    ])
  );
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    sales: 0,
    transactions: 0,
  }));

  const result = {
    revenue: 0,
    transactions: 0,
    cashSales: 0,
    discounts: 0,
    vat: 0,
    returns: 0,
    refunds: 0,
    cogs: 0,
    expenses: 0,
    salesRows: [],
    productTotals,
    categoryTotals,
    cashierTotals,
    daily,
    hourly,
  };

  const itemsBySale = new Map();
  for (const item of db.saleItems || []) {
    const key = String(item.sale_id);
    if (!itemsBySale.has(key)) itemsBySale.set(key, []);
    itemsBySale.get(key).push(item);
  }

  const hasItemFilter = !!(filters.product_id || filters.category_id);
  for (const sale of db.sales || []) {
    if (!inRange(sale.created_at, range)) continue;
    if (filters.branch_id && !idEquals(sale.branch_id, filters.branch_id)) continue;
    if (filters.cashier_id && !idEquals(sale.user_id, filters.cashier_id)) continue;

    const allItems = itemsBySale.get(String(sale.id)) || (Array.isArray(sale.items) ? sale.items : []);
    const matchedItems = allItems.filter((item) => {
      const product = products.get(String(item.product_id)) || {};
      const categoryId = item.category_id ?? product.category_id;
      return (
        (!filters.product_id || idEquals(item.product_id, filters.product_id)) &&
        (!filters.category_id || idEquals(categoryId, filters.category_id))
      );
    });
    if (hasItemFilter && matchedItems.length === 0) continue;

    const sourceItems = hasItemFilter ? matchedItems : allItems;
    const allItemGross = allItems.reduce((sum, item) => sum + number(item.price) * number(item.qty), 0);
    const matchedGross = sourceItems.reduce((sum, item) => sum + number(item.price) * number(item.qty), 0);
    const ratio = hasItemFilter ? (allItemGross > 0 ? matchedGross / allItemGross : 0) : 1;
    const explicitSubtotal = number(sale.subtotal) || allItemGross || number(sale.total);
    const discount = number(sale.discount ?? sale.discount_amount) * ratio;
    const vat = number(sale.vat ?? sale.vat_amount);
    const grossRevenue = hasItemFilter
      ? matchedGross - discount + vat * ratio
      : number(sale.total) || Math.max(0, explicitSubtotal - discount + vat);
    const adjustments = saleAdjustments(sale);
    const returns = adjustments.returns * ratio;
    const refunds = adjustments.refunds * ratio;
    const netRevenue = Math.max(0, grossRevenue - adjustments.total * ratio);
    const cogs = sourceItems.reduce((sum, item) => {
      const product = products.get(String(item.product_id));
      return sum + number(item.cost ?? product?.cost) * number(item.qty);
    }, 0);
    const cashierName = sale.user_name || sale.cashier_name || (sale.user_id ? "Unknown" : "System");
    const dateKey = localDateKey(sale.created_at);
    const dateRow = daily.get(dateKey);
    const hour = new Date(sale.created_at).getHours();

    result.revenue += netRevenue;
    result.transactions += 1;
    result.cashSales += String(sale.payment_method || "").trim().toUpperCase() === "CASH" ? netRevenue : 0;
    result.discounts += discount;
    result.vat += vat * ratio;
    result.returns += returns;
    result.refunds += refunds;
    result.cogs += cogs;
    if (dateRow) {
      dateRow.sales += netRevenue;
      dateRow.profit += netRevenue - cogs;
      dateRow.transactions += 1;
    }
    if (hourly[hour]) {
      hourly[hour].sales += netRevenue;
      hourly[hour].transactions += 1;
    }
    const cashierRow = cashierTotals.get(String(sale.user_id ?? "system")) || {
      id: sale.user_id ?? "system",
      name: cashierName,
      revenue: 0,
      transactions: 0,
    };
    cashierRow.revenue += netRevenue;
    cashierRow.transactions += 1;
    cashierTotals.set(String(cashierRow.id), cashierRow);

    for (const item of sourceItems) {
      const product = products.get(String(item.product_id)) || {};
      const categoryId = item.category_id ?? product.category_id ?? "uncategorized";
      const itemRatio = matchedGross > 0 ? (number(item.price) * number(item.qty)) / matchedGross : 0;
      const itemRevenue = Math.max(
        0,
        number(item.price) * number(item.qty) - discount * itemRatio - adjustments.total * ratio * itemRatio
      );
      const productRow = productTotals.get(String(item.product_id)) || {
        id: item.product_id,
        name: item.name || product.name || "Unknown product",
        units: 0,
        revenue: 0,
      };
      productRow.units += number(item.qty);
      productRow.revenue += itemRevenue;
      productTotals.set(String(item.product_id), productRow);
      const categoryRow = categoryTotals.get(String(categoryId)) || {
        id: categoryId,
        name: product.category || categories.get(String(categoryId))?.name || "Uncategorized",
        units: 0,
        revenue: 0,
      };
      categoryRow.units += number(item.qty);
      categoryRow.revenue += itemRevenue;
      categoryTotals.set(String(categoryId), categoryRow);
    }

    result.salesRows.push({
      id: sale.id,
      invoice_no: sale.invoice_no || `SALE-${sale.id}`,
      created_at: sale.created_at,
      cashier: cashierName,
      payment_method: sale.payment_method || "Unknown",
      total: netRevenue,
      discount,
      vat: vat * ratio,
      returns,
      refunds,
    });
  }

  for (const expense of db.expenses || []) {
    const expenseDate = expense.expense_date || expense.created_at;
    if (!inRange(expenseDate, range)) continue;
    if (filters.branch_id && !idEquals(expense.branch_id, filters.branch_id)) continue;
    const amount = number(expense.amount);
    result.expenses += amount;
    const dateRow = daily.get(localDateKey(expenseDate));
    if (dateRow) dateRow.expenses += amount;
  }
  for (const row of daily.values()) row.profit -= row.expenses;
  return result;
}

function summarize(aggregateResult) {
  const grossProfit = aggregateResult.revenue - aggregateResult.cogs;
  const netProfit = grossProfit - aggregateResult.expenses;
  return {
    sales: aggregateResult.revenue,
    revenue: aggregateResult.revenue,
    transactions: aggregateResult.transactions,
    cashSales: aggregateResult.cashSales,
    discounts: aggregateResult.discounts,
    vat: aggregateResult.vat,
    returns: aggregateResult.returns,
    refunds: aggregateResult.refunds,
    cogs: aggregateResult.cogs,
    grossProfit,
    expenses: aggregateResult.expenses,
    netProfit,
    profitMargin: aggregateResult.revenue ? (netProfit / aggregateResult.revenue) * 100 : 0,
  };
}

function groupTrend(rows, mode) {
  const groups = new Map();
  for (const row of rows) {
    const date = new Date(`${row.date}T12:00:00`);
    let key;
    let label;
    if (mode === "month") {
      key = row.date.slice(0, 7);
      label = date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    } else {
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      key = localDateKey(monday);
      label = `Week ${monday.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }
    const target = groups.get(key) || { period: label, sales: 0, profit: 0, expenses: 0, transactions: 0 };
    target.sales += row.sales;
    target.profit += row.profit;
    target.expenses += row.expenses;
    target.transactions += row.transactions;
    groups.set(key, target);
  }
  return [...groups.values()];
}

/**
 * @param {object} db - { sales, saleItems, products, categories, expenses, branches, users }
 * @param {object} filters - start_date, end_date, branch_id, cashier_id, category_id, product_id
 */
export function buildReportAnalytics(db, filters = {}) {
  const today = localDateKey(new Date());
  const startDate = filters.start_date || today;
  const endDate = filters.end_date || startDate;
  const period = aggregate(db, filters, startDate, endDate);
  const todayResult = aggregate(db, filters, today, today);
  const now = new Date();
  const monthStart = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = localDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const monthResult = aggregate(db, filters, monthStart, monthEnd);
  const dailyTrend = [...period.daily.values()];
  const sortTop = (map) => [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const topCashier = [...period.cashierTotals.values()].sort((a, b) => b.revenue - a.revenue)[0] || null;

  return {
    range: { start_date: startDate, end_date: endDate },
    filters: { ...filters },
    summary: summarize(period),
    cards: { today: summarize(todayResult), month: summarize(monthResult) },
    dailyPL: summarize(period),
    monthlyPL: summarize(monthResult),
    charts: {
      daily: dailyTrend,
      weekly: groupTrend(dailyTrend, "week"),
      monthly: groupTrend(dailyTrend, "month"),
      profit: dailyTrend.map((row) => ({
        date: row.date,
        profit: row.profit,
        revenue: row.sales,
        expenses: row.expenses,
      })),
      hourly: period.hourly,
      topProducts: sortTop(period.productTotals),
      topCategories: sortTop(period.categoryTotals),
    },
    topProducts: sortTop(period.productTotals),
    topCategories: sortTop(period.categoryTotals),
    topCashier,
    dailyComparison: dailyTrend,
    sales: period.salesRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    options: {
      branches: (db.branches || []).map(({ id, name }) => ({ id, name })),
      cashiers: (db.users || [])
        .filter((user) => user.active !== 0 && user.active !== false)
        .map(({ id, name }) => ({ id, name })),
      categories: (db.categories || []).map(({ id, name }) => ({ id, name })),
      products: (db.products || []).map(({ id, name, category_id }) => ({ id, name, category_id })),
    },
  };
}
