# Nexora POS — Entity Relationship Diagram

Companion to [`DATABASE_ARCHITECTURE_REPORT.md`](./DATABASE_ARCHITECTURE_REPORT.md).  
Inferred from migrations `001`–`013`. **Documentation only — no schema changes.**

```mermaid
erDiagram
  %% ===== Auth & tenancy =====
  auth_users ||--|| profiles : "profiles.id"
  companies ||--o{ profiles : company_id
  companies ||--|| company_subscriptions : company_id
  companies ||--|| company_settings : company_id
  companies ||--o{ company_currencies : company_id
  companies ||--o{ currency_rate_history : company_id
  companies ||--o{ branches : company_id
  companies ||--o{ warehouses : company_id
  companies ||--o{ brands : company_id
  companies ||--o{ units : company_id
  companies ||--o{ categories : company_id
  companies ||--o{ products : company_id
  companies ||--o{ customers : company_id
  companies ||--o{ suppliers : company_id
  companies ||--o{ sales : company_id
  companies ||--o{ held_sales : company_id
  companies ||--o{ purchases : company_id
  companies ||--o{ purchase_items : company_id
  companies ||--o{ purchase_payments : company_id
  companies ||--o{ purchase_returns : company_id
  companies ||--o{ supplier_payments : company_id
  companies ||--o{ customer_payments : company_id
  companies ||--o{ expenses : company_id
  companies ||--o{ stock_transfers : company_id
  companies ||--o{ stock_movements : company_id
  companies ||--o{ audit_log : company_id

  %% ===== Org =====
  branches ||--o{ profiles : branch_id
  branches ||--o{ warehouses : branch_id
  branches ||--o{ products : branch_id
  branches ||--o{ sales : branch_id
  branches ||--o{ held_sales : branch_id
  branches ||--o{ purchases : branch_id
  branches ||--o{ expenses : branch_id
  branches ||--o{ stock_transfers : "from/to"

  %% ===== Catalog =====
  categories ||--o{ products : category_id
  brands ||--o{ products : brand_id
  units ||--o{ products : unit_id

  %% ===== Inventory =====
  products ||--o{ stock_movements : product_id
  warehouses ||--o{ stock_movements : warehouse_id
  products ||--o{ stock_transfers : product_id

  %% ===== Customers / sales =====
  customers ||--o{ customer_payments : customer_id
  customers ||--o{ sales : customer_id
  profiles ||--o{ sales : user_id
  profiles ||--o{ held_sales : user_id
  sales ||--o{ sale_items : sale_id
  products ||--o{ sale_items : product_id

  %% ===== Suppliers / purchases =====
  suppliers ||--o{ purchases : supplier_id
  suppliers ||--o{ supplier_payments : supplier_id
  suppliers ||--o{ purchase_payments : supplier_id
  purchases ||--o{ purchase_items : purchase_id
  purchases ||--o{ purchase_payments : purchase_id
  purchases ||--o{ purchase_returns : purchase_id
  purchases ||--o{ supplier_payments : purchase_id
  products ||--o{ purchase_items : product_id
  products ||--o{ purchase_returns : product_id
  profiles ||--o{ purchase_payments : created_by
  profiles ||--o{ currency_rate_history : changed_by

  %% ===== Legacy globals (no company FK) =====
  %% settings, permissions, subscription, expense_categories

  companies {
    bigint id PK
    text name
    text code UK
    text currency
    text status
    uuid owner_user_id
    text plan_code
  }

  profiles {
    uuid id PK
    text email UK
    text role
    boolean active
    bigint company_id FK
    bigint branch_id FK
    text account_status
    text employee_id
  }

  branches {
    bigint id PK
    text name
    text code UK
    bigint company_id FK
    boolean active
  }

  warehouses {
    bigint id PK
    bigint company_id FK
    bigint branch_id FK
    text name
    text code
  }

  products {
    bigint id PK
    bigint company_id FK
    bigint category_id FK
    bigint brand_id FK
    bigint unit_id FK
    text name
    text sku
    text barcode
    numeric price
    numeric cost
    int stock
    jsonb variants
  }

  customers {
    bigint id PK
    bigint company_id FK
    text name
    numeric balance
    numeric credit_limit
  }

  suppliers {
    bigint id PK
    bigint company_id FK
    text code
    text name
    text payment_terms
    numeric balance
    numeric credit_limit
  }

  sales {
    bigint id PK
    bigint company_id FK
    text invoice_no UK
    text receipt_no
    bigint customer_id FK
    uuid user_id FK
    numeric total
    jsonb items_json
    jsonb split_payments
    text currency_code
  }

  sale_items {
    bigint id PK
    bigint sale_id FK
    bigint product_id FK
    int qty
    numeric price
    numeric cost
  }

  purchases {
    bigint id PK
    bigint company_id FK
    text po_number UK
    bigint supplier_id FK
    text status
    numeric total
    numeric amount_paid
    numeric balance
    date due_date
    jsonb items_json
  }

  purchase_items {
    bigint id PK
    bigint purchase_id FK
    bigint company_id FK
    bigint product_id FK
    int qty_ordered
    int qty_received
  }

  purchase_payments {
    bigint id PK
    bigint purchase_id FK
    bigint supplier_id FK
    bigint company_id FK
    numeric amount
    text payment_currency
  }

  supplier_payments {
    bigint id PK
    bigint supplier_id FK
    bigint company_id FK
    bigint purchase_id FK
    numeric amount
  }

  customer_payments {
    bigint id PK
    bigint customer_id FK
    bigint company_id FK
    numeric amount
  }

  expenses {
    bigint id PK
    bigint company_id FK
    text category
    date expense_date
    numeric amount
    text currency_code
  }

  stock_movements {
    bigint id PK
    bigint company_id FK
    bigint product_id FK
    bigint warehouse_id FK
    text type
    int qty
  }

  company_currencies {
    bigint id PK
    bigint company_id FK
    text code
    boolean is_base
    boolean is_default
    numeric exchange_rate_to_base
  }

  currency_rate_history {
    bigint id PK
    bigint company_id FK
    text currency_code
    numeric new_rate
    uuid changed_by FK
  }

  company_subscriptions {
    bigint id PK
    bigint company_id FK_UK
    text plan_code
    text status
    jsonb limits
  }

  company_settings {
    bigint company_id PK
    jsonb settings
    jsonb permission_matrix
  }

  audit_log {
    bigint id PK
    bigint company_id FK
    uuid user_id
    text action
    text module
    jsonb old_values
    jsonb new_values
  }

  invoice_verifications {
    bigint id PK
    text receipt_no UK
    text invoice_id
    bigint company_id
    jsonb items
  }
```

## Legend

| Symbol | Meaning |
|--------|---------|
| Solid FK in migrations | Drawn as relationship above |
| `owner_user_id`, `audit_log.user_id` | Logical links — **no FK constraint** |
| `settings`, `permissions`, `subscription`, `expense_categories` | Legacy globals — omitted from tenant graph |
| `notifications`, `payroll_*` | **Do not exist** in schema |
| Dual JSON | `sales.items_json`, `purchases.items_json` coexist with line tables |
