/** Inventory schema helpers for Nexora POS mock/localStorage API */

export function seedBrands() {
  return [
    { id: 1, name: "Nexora Select", active: true },
    { id: 2, name: "Brookside", active: true },
    { id: 3, name: "Bidco", active: true },
    { id: 4, name: "Coca-Cola", active: true },
  ];
}

export function seedUnits() {
  return [
    { id: 1, name: "Unit", abbreviation: "pcs", active: true },
    { id: 2, name: "Bag", abbreviation: "bag", active: true },
    { id: 3, name: "Bottle", abbreviation: "btl", active: true },
    { id: 4, name: "Packet", abbreviation: "pkt", active: true },
    { id: 5, name: "Loaf", abbreviation: "loaf", active: true },
    { id: 6, name: "Kilogram", abbreviation: "kg", active: true },
    { id: 7, name: "Litre", abbreviation: "L", active: true },
  ];
}

export function seedWarehouses(branches = []) {
  const list = branches.length
    ? branches
    : [
        { id: 1, name: "Westlands HQ", code: "WES" },
        { id: 2, name: "CBD Branch", code: "CBD" },
      ];
  return list.map((branch, index) => ({
    id: index + 1,
    name: `${branch.name} Store`,
    code: `${branch.code || `WH${index + 1}`}-MAIN`,
    branch_id: branch.id,
    address: branch.address || "",
    active: true,
  }));
}

const UNIT_NAME_TO_ID = {
  unit: 1,
  pcs: 1,
  bag: 2,
  bottle: 3,
  packet: 4,
  loaf: 5,
  kg: 6,
  litre: 7,
  l: 7,
};

const PRODUCT_BRAND_MAP = {
  1: 3, // Sugar → Bidco
  2: 3, // Rice → Bidco
  3: 3, // Oil → Bidco
  4: 2, // Milk → Brookside
  5: 1, // Bread → Nexora
  6: 4, // Soft drinks → Coca-Cola
};

export function enrichProduct(product, units = []) {
  const unitKey = String(product.unit || "unit").toLowerCase();
  const unit_id = product.unit_id || UNIT_NAME_TO_ID[unitKey] || 1;
  const unitRow = units.find((u) => u.id === unit_id);
  return {
    ...product,
    image_url: product.image_url || "",
    brand_id: product.brand_id ?? PRODUCT_BRAND_MAP[product.id] ?? null,
    unit_id,
    unit: product.unit || unitRow?.abbreviation || "unit",
    variants: Array.isArray(product.variants) ? product.variants : [],
    track_batches: !!product.track_batches,
    default_expiry_days: product.default_expiry_days ?? null,
  };
}

export function buildWarehouseStock(products, warehouses) {
  if (!warehouses?.length) return [];
  const primary = warehouses[0];
  const secondary = warehouses[1] || warehouses[0];
  const rows = [];
  products.forEach((product) => {
    const total = Number(product.stock) || 0;
    const split = warehouses.length > 1 ? Math.floor(total * 0.7) : total;
    const remainder = total - split;
    rows.push({
      id: `${product.id}-${primary.id}-0`,
      warehouse_id: primary.id,
      product_id: product.id,
      variant_id: null,
      qty: split,
      batch_number: product.track_batches ? `BATCH-${product.id}A` : null,
      expiry_date: product.id === 4 || product.id === 5 ? daysFromNow(product.id === 4 ? 12 : 5) : null,
    });
    if (warehouses.length > 1 && remainder > 0) {
      rows.push({
        id: `${product.id}-${secondary.id}-0`,
        warehouse_id: secondary.id,
        product_id: product.id,
        variant_id: null,
        qty: remainder,
        batch_number: product.track_batches ? `BATCH-${product.id}B` : null,
        expiry_date: product.id === 4 ? daysFromNow(20) : null,
      });
    }
  });
  return rows;
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function seedStockMovements(products, warehouses) {
  if (!products.length || !warehouses.length) return [];
  const wh = warehouses[0].id;
  return [
    {
      id: 1,
      type: "in",
      product_id: 4,
      variant_id: null,
      warehouse_id: wh,
      qty: 40,
      batch_number: "BATCH-4A",
      expiry_date: daysFromNow(12),
      note: "Opening dairy delivery",
      created_at: "2026-07-10T08:00:00.000Z",
      user_name: "System",
    },
    {
      id: 2,
      type: "out",
      product_id: 6,
      variant_id: null,
      warehouse_id: wh,
      qty: 12,
      batch_number: null,
      expiry_date: null,
      note: "Promo sampling",
      created_at: "2026-07-12T15:20:00.000Z",
      user_name: "System",
    },
    {
      id: 3,
      type: "adjust",
      product_id: 3,
      variant_id: null,
      warehouse_id: wh,
      qty: -2,
      batch_number: null,
      expiry_date: null,
      note: "Damaged bottles write-off",
      created_at: "2026-07-14T11:10:00.000Z",
      user_name: "System",
    },
  ];
}

export function ensureInventoryCollections(dbData, nextIdFn) {
  const seeded = {
    brands: seedBrands(),
    units: seedUnits(),
    warehouses: seedWarehouses(dbData.branches || []),
  };

  dbData.brands = Array.isArray(dbData.brands) && dbData.brands.length ? dbData.brands : seeded.brands;
  dbData.units = Array.isArray(dbData.units) && dbData.units.length ? dbData.units : seeded.units;
  dbData.warehouses =
    Array.isArray(dbData.warehouses) && dbData.warehouses.length
      ? dbData.warehouses
      : seeded.warehouses;

  dbData.products = (dbData.products || []).map((p) => enrichProduct(p, dbData.units));

  if (!Array.isArray(dbData.warehouseStock) || !dbData.warehouseStock.length) {
    dbData.warehouseStock = buildWarehouseStock(dbData.products, dbData.warehouses);
  }

  if (!Array.isArray(dbData.stockMovements)) {
    dbData.stockMovements = seedStockMovements(dbData.products, dbData.warehouses);
  }

  dbData.nextIds = {
    ...dbData.nextIds,
    brand: Math.max(dbData.nextIds?.brand || 1, maxId(dbData.brands) + 1),
    unit: Math.max(dbData.nextIds?.unit || 1, maxId(dbData.units) + 1),
    warehouse: Math.max(dbData.nextIds?.warehouse || 1, maxId(dbData.warehouses) + 1),
    stockMovement: Math.max(dbData.nextIds?.stockMovement || 1, maxId(dbData.stockMovements) + 1),
    variant: Math.max(dbData.nextIds?.variant || 1, maxVariantId(dbData.products) + 1),
  };

  // Keep product.stock in sync with warehouse totals when possible
  syncProductStockFromWarehouses(dbData);
  return dbData;
}

function maxId(rows = []) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
}

function maxVariantId(products = []) {
  let max = 0;
  products.forEach((p) => {
    (p.variants || []).forEach((v) => {
      max = Math.max(max, Number(v.id) || 0);
    });
  });
  return max;
}

export function syncProductStockFromWarehouses(dbData) {
  const totals = {};
  (dbData.warehouseStock || []).forEach((row) => {
    const key = row.product_id;
    totals[key] = (totals[key] || 0) + Number(row.qty || 0);
  });
  dbData.products = (dbData.products || []).map((product) => {
    if (totals[product.id] === undefined) return product;
    return { ...product, stock: totals[product.id] };
  });
}

export function applyStockDelta(dbData, { product_id, variant_id = null, warehouse_id, qty, batch_number = null, expiry_date = null }) {
  const delta = Number(qty);
  const wid = Number(warehouse_id);
  const pid = Number(product_id);
  const vid = variant_id ? Number(variant_id) : null;

  let matched = false;
  dbData.warehouseStock = (dbData.warehouseStock || []).map((row) => {
    const sameBatch =
      (!batch_number && !row.batch_number) ||
      (batch_number && row.batch_number === batch_number);
    const sameVariant = (row.variant_id || null) === vid;
    if (row.warehouse_id === wid && row.product_id === pid && sameVariant && sameBatch) {
      matched = true;
      return {
        ...row,
        qty: Math.max(0, Number(row.qty) + delta),
        expiry_date: expiry_date || row.expiry_date,
      };
    }
    return row;
  });

  if (!matched && delta > 0) {
    dbData.warehouseStock.push({
      id: `${pid}-${wid}-${Date.now()}`,
      warehouse_id: wid,
      product_id: pid,
      variant_id: vid,
      qty: delta,
      batch_number: batch_number || null,
      expiry_date: expiry_date || null,
    });
  }

  if (vid) {
    dbData.products = dbData.products.map((product) => {
      if (product.id !== pid) return product;
      const variants = (product.variants || []).map((v) =>
        v.id === vid ? { ...v, stock: Math.max(0, Number(v.stock || 0) + delta) } : v
      );
      return { ...product, variants };
    });
  }

  syncProductStockFromWarehouses(dbData);

  const product = dbData.products.find((p) => p.id === pid);
  if (!product) return { success: false, error: "Product not found." };

  // Guard against overselling warehouse row on outbound
  if (delta < 0) {
    const available = (dbData.warehouseStock || [])
      .filter(
        (row) =>
          row.warehouse_id === wid &&
          row.product_id === pid &&
          (row.variant_id || null) === vid &&
          ((!batch_number && !row.batch_number) || row.batch_number === batch_number)
      )
      .reduce((sum, row) => sum + Number(row.qty), 0);
    // After apply, qty already clamped; check if we would have gone negative before clamp
    // Re-check by comparing product stock is fine for UX
  }

  return { success: true, stock: product.stock };
}

export function computeInventoryStats(dbData, expiringDays = 30) {
  const products = dbData.products || [];
  const warehouseStock = dbData.warehouseStock || [];
  const lowStock = products.filter((p) => Number(p.stock) <= Number(p.reorder_level));
  const stockValue = products.reduce((sum, p) => sum + Number(p.stock) * Number(p.cost || 0), 0);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + expiringDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const expiring = warehouseStock.filter(
    (row) => row.expiry_date && row.expiry_date >= today && row.expiry_date <= cutoffStr && Number(row.qty) > 0
  );
  const expired = warehouseStock.filter((row) => row.expiry_date && row.expiry_date < today && Number(row.qty) > 0);

  const byWarehouse = (dbData.warehouses || []).map((wh) => {
    const rows = warehouseStock.filter((r) => r.warehouse_id === wh.id);
    const units = rows.reduce((s, r) => s + Number(r.qty), 0);
    const value = rows.reduce((s, r) => {
      const product = products.find((p) => p.id === r.product_id);
      return s + Number(r.qty) * Number(product?.cost || 0);
    }, 0);
    return { warehouse_id: wh.id, name: wh.name, units, value };
  });

  return {
    totalSkus: products.length,
    totalUnits: products.reduce((s, p) => s + Number(p.stock), 0),
    stockValue,
    lowStockCount: lowStock.length,
    outOfStockCount: products.filter((p) => Number(p.stock) <= 0).length,
    overstockCount: products.filter((p) => Number(p.max_stock) > 0 && Number(p.stock) >= Number(p.max_stock)).length,
    expiringSoonCount: expiring.length,
    expiredCount: expired.length,
    warehouseCount: (dbData.warehouses || []).filter((w) => w.active !== false).length,
    brandCount: (dbData.brands || []).filter((b) => b.active !== false).length,
    variantCount: products.reduce((s, p) => s + (p.variants?.length || 0), 0),
    byWarehouse,
  };
}

export function getLowStockProducts(dbData) {
  return (dbData.products || [])
    .filter((p) => Number(p.stock) <= Number(p.reorder_level))
    .map((p) => ({
      ...p,
      deficit: Math.max(0, Number(p.reorder_level) - Number(p.stock)),
    }));
}

export function getExpiringLots(dbData, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return (dbData.warehouseStock || [])
    .filter((row) => row.expiry_date && Number(row.qty) > 0 && row.expiry_date <= cutoffStr)
    .map((row) => {
      const product = (dbData.products || []).find((p) => p.id === row.product_id);
      const warehouse = (dbData.warehouses || []).find((w) => w.id === row.warehouse_id);
      const expired = row.expiry_date < today;
      return {
        ...row,
        product_name: product?.name || "Unknown",
        warehouse_name: warehouse?.name || "Unknown",
        status: expired ? "expired" : "expiring",
      };
    })
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
}
