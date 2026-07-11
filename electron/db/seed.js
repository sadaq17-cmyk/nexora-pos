const bcrypt = require("bcryptjs");
const { db } = require("./database");

function seed() {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount === 0) {
    const insertUser = db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
    );
    const hash = (pw) => bcrypt.hashSync(pw, 10);
    insertUser.run("Jane Mwikali", "admin@nexorapos.com", hash("admin123"), "admin");
    insertUser.run("Brian Otieno", "cashier@nexorapos.com", hash("cashier123"), "cashier");
    insertUser.run("Lucy Wambui", "manager@nexorapos.com", hash("manager123"), "manager");
  }

  const catCount = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  let catIds = {};
  if (catCount === 0) {
    const insertCat = db.prepare("INSERT INTO categories (name, color) VALUES (?, ?)");
    const cats = [
      ["Groceries", "#2563EB"],
      ["Dairy", "#38BDF8"],
      ["Bakery", "#F59E0B"],
      ["Beverages", "#8B5CF6"],
    ];
    cats.forEach(([name, color]) => {
      const info = insertCat.run(name, color);
      catIds[name] = info.lastInsertRowid;
    });
  } else {
    db.prepare("SELECT id, name FROM categories")
      .all()
      .forEach((c) => (catIds[c.name] = c.id));
  }

  const productCount = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  if (productCount === 0) {
    const insertP = db.prepare(
      `INSERT INTO products (name, barcode, category_id, price, cost, stock, reorder_level, unit)
       VALUES (@name, @barcode, @category_id, @price, @cost, @stock, @reorder_level, @unit)`
    );
    const products = [
      { name: "Sugar 2kg", barcode: "8901030001", category_id: catIds["Groceries"], price: 280, cost: 220, stock: 45, reorder_level: 20, unit: "bag" },
      { name: "Rice 5kg", barcode: "8901030002", category_id: catIds["Groceries"], price: 650, cost: 520, stock: 30, reorder_level: 15, unit: "bag" },
      { name: "Cooking Oil 2L", barcode: "8901030003", category_id: catIds["Groceries"], price: 480, cost: 400, stock: 18, reorder_level: 20, unit: "bottle" },
      { name: "Milk 500ml", barcode: "8901030004", category_id: catIds["Dairy"], price: 65, cost: 50, stock: 8, reorder_level: 25, unit: "packet" },
      { name: "Bread 400g", barcode: "8901030005", category_id: catIds["Bakery"], price: 60, cost: 42, stock: 22, reorder_level: 15, unit: "loaf" },
      { name: "Soft Drinks 500ml", barcode: "8901030006", category_id: catIds["Beverages"], price: 70, cost: 50, stock: 60, reorder_level: 20, unit: "bottle" },
    ];
    products.forEach((p) => insertP.run(p));
  }

  const customerCount = db.prepare("SELECT COUNT(*) AS n FROM customers").get().n;
  if (customerCount === 0) {
    const insertC = db.prepare("INSERT INTO customers (name, phone, email, points) VALUES (?, ?, ?, ?)");
    insertC.run("Ahmed Ali", "+254 712 345 678", "ahmed.ali@email.com", 245);
    insertC.run("Fatima Hassan", "+254 723 456 789", "fatima.h@email.com", 182);
    insertC.run("Mohamed Noor", "+254 733 567 890", "m.noor@email.com", 317);
  }

  const supplierCount = db.prepare("SELECT COUNT(*) AS n FROM suppliers").get().n;
  if (supplierCount === 0) {
    const insertS = db.prepare(
      "INSERT INTO suppliers (name, contact_person, phone, category, status) VALUES (?, ?, ?, ?, ?)"
    );
    insertS.run("Coca-Cola Kenya", "James Mwangi", "+254 700 111 222", "Beverages", "Active");
    insertS.run("Brookside Dairy", "Grace Wanjiru", "+254 700 222 333", "Dairy", "Active");
    insertS.run("Bidco Africa", "Peter Otieno", "+254 700 333 444", "Groceries", "Active");
  }
}

module.exports = { seed };
