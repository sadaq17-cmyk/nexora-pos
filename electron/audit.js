const { db } = require("./db/database");
const { getCurrentUser } = require("./session");

function logAudit(action, module, details) {
  const user = getCurrentUser();
  db.prepare(
    "INSERT INTO audit_log (user_id, user_name, action, module, details) VALUES (?, ?, ?, ?, ?)"
  ).run(
    user?.id ?? null,
    user?.name ?? "System",
    action,
    module,
    typeof details === "string" ? details : JSON.stringify(details ?? {})
  );
}

module.exports = { logAudit };
