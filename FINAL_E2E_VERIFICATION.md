# Nexora POS Enterprise — Final E2E Verification

**Date:** 2026-07-20T15:41:53.530Z
**Production URL:** https://www.nexorapospro.com
**Verdict:** **NOT FINAL FULL GO**

## Asset hashes

- `assets/index-D7VaJgtU.js`
- `assets/react-vendor-DmLtxZBq.js`
- `assets/pdf-CS3kvse2.js`
- `assets/supabase-Bmi-Q25R.js`
- `assets/index-CjGe6g12.css`

## Scorecard

| # | Test | Status | Evidence |
|---|------|--------|----------|
| 1 | 1. Login | **PASS** | platform super admin; user=fd2dcfac… |
| 2 | 2. Registration | **PASS** | public signUp rate-limited; /api/admin-create-user HTTP 200; user=28a8a1c6-a1a5-44fb-aa55-f8aa40d068ca; signIn=true |
| 3 | 3. Create Company | **PASS** | hydrate=200; getById=200; id=1; name=E2E Co 1784562074977 |
| 4 | 4. Create Branch | **PASS** | HTTP 200; id=6; err= |
| 5 | 5. Add Supplier | **PASS** | HTTP 200; id=6;  |
| 6 | 6. Add Customer | **PASS** | HTTP 200; id=5;  |
| 7 | 7. Add Product | **PASS** | HTTP 200; id=11; stock=25; barcode=E2E1784562074977;  |
| 8 | 8. Barcode Scan | **PASS** | HTTP 200; id=11; name=E2E Product 1784562074977 |
| 9 | 9. POS Sale | **FAIL** | HTTP 500; id=undefined; receipt=undefined; err=insert or update on table "sales" violates foreign key constraint "sales_user_id_fkey" |
| 10 | 10. Stock Reduction | **FAIL** | before=25; after=25; expected=23 |
| 11 | 11. Invoice Generation | **FAIL** | sale_id=undefined; receipt_no=undefined; invoice_public=0; found=false; body=null |
| 12 | 12. Receipt Printing | **FAIL** | No sale to print |
| 13 | 13. Dashboard Statistics | **PASS** | summary=200 keys=today_count,today_total,month_count,month_total; trend=200 n=1; inventory=200 |
| 14 | 14. Reports | **PASS** | sales=200; inventory=200; pnl=200; sales_err= |
| 15 | 15. User Roles & Permissions | **PASS** | role=admin; unauth_create=401; matrix=200; cashier_branch=200/FORBIDDEN; cashier_matrix=200; matrixDenied=true |

**Summary:** 11 PASS · 4 FAIL · 0 SKIP

## Blockers

- **9. POS Sale** (FAIL): HTTP 500; id=undefined; receipt=undefined; err=insert or update on table "sales" violates foreign key constraint "sales_user_id_fkey"
- **10. Stock Reduction** (FAIL): before=25; after=25; expected=23
- **11. Invoice Generation** (FAIL): sale_id=undefined; receipt_no=undefined; invoice_public=0; found=false; body=null
- **12. Receipt Printing** (FAIL): No sale to print
