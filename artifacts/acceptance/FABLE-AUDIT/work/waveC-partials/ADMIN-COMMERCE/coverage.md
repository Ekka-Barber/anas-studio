# ADMIN-COMMERCE coverage (final, 2026-10-07 ~05:55 AST)
Read in full: src/lib/{money-input,format,digits,admin-money,admin-orders,admin-commerce}.ts;
src/components/admin/{OrderView,OrdersView,RefundView,DisputeForm,ReconciliationView,VariantCommerce,TableForm,TableList,StatsView,CommerceSettingsForm}.tsx;
src/admin/tables/{index,coupons,customers,notifications,products,shipping-rates,variants}.ts; src/admin/fields.ts;
src/app/(admin)/admin/(shell)/{orders,orders/view,orders/reconciliation,store,store/StoreHome,store/[table],store/[table]/edit,stats}.
Dependencies read for the slice: StepUp.tsx, AdminShell.tsx (session/role part), FieldInput.tsx (money, number, date, datetime, text), src/lib/supabase/functions.ts, src/lib/orders.ts (clampQuantity, takeFragment), quote.ts preorderSentence, admin.module.css (tables, responsive).
Server cross-checks: admin.ts, refunds.ts (incl. the in-progress diff at 05:52), disputes.ts, paid-files.ts (header, store), payments.ts settlePayment, payments/moyasar.ts currency parse, email.ts receipt line; SQL latest definitions incl. the uncommitted 20261007100000/20261007110000 migrations.
Tests: orders-money.spec.ts (setup, mocks, seeds, fixtures), store-admin.spec.ts stats tests (1208-1345), orders-admin.spec.ts view test (566-650) and titles of all three; unit test titles of admin-money, admin-orders, money-*; headers of the server-side admin-* unit tests; integration order-operations PAYMENT_REVERSED case; Moyasar emulator refundPayment.
Not read line by line: the remaining e2e test bodies, unit test bodies of admin-orders/admin-commerce/admin-function/admin-ops/admin-publish/admin-editor (outside the money path), AdminHome.
Next with more time: run the two cross-tab refund and partial-refund-then-resolve recipes on the stack; read the remaining e2e bodies for hollow assertions.
