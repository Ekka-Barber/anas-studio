# QUALITY coverage (final, 2026-10-07)

## Read in full (current working tree; the slice did not change during the audit except payments.ts, read as modified)
- supabase/functions: every entry point and deno.json; all 30 _shared modules (admin, analytics, checkout, commerce-settings, contact, db, disputes, download, email, env, http, jobs, media, media-rules, media-sweep, notify, orders, outbox, paid-files, payments, payments/moyasar, rate-limit, recent-totp, refunds, resend-webhook, saudi-mobile, staff, stats, tokens, turnstile); staff-admin/index.ts.
- src/lib: all 23 modules.
- src/components/store: all 12 files.
- src/components/admin: AdminHome, OrderView, RefundView, ReconciliationView, DisputeForm, OrdersView, VariantCommerce, CommerceSettingsForm, TeamView, AdminShell, SignIn, StepUp, MfaEnroll, CollectionForm, MediaUpload, VersionHistory, RoomPreview, SettingsView (data part).
- src/admin: fields.ts, collections/index.ts, rooms.ts, policies.ts, site-settings.ts (rules part); tables/index, variants, notifications, customers.
- src/components/book: pdf.ts, BookPreview, PdfBookReader (load, build, render states).
- src/components/public/contact/*, Picture; src/app: (public)/layout, error, checkout/page, store/[slug]/page, policies/[slug]/page, (admin)/layout.
- scripts: check-export, check-budgets, local-env, bootstrap-owner, lib/cron-jobs; guards and catch sites of import-content, seed-demo-catalog, prepare-media.

## Scans (scripts in SCRATCH)
- dead-exports.cjs: 917 exported symbols, TS AST, usage across src/scripts/functions/tests.
- css-unused.cjs: every CSS module vs its importers (dynamic class access checked by hand); global CSS classes.
- nonnull.cjs: 45 non-null assertions, each reviewed (all on locally proven indexes or parsed shapes).
- sql-codes.cjs: refusal codes of the latest definition of 29 SQL functions vs every consumer map (checkout, orders, download, refunds, disputes, paid-files, admin-orders); only the in-flight codes are unmapped.
- grep: eslint-disable (12: 4 exhaustive-deps, each justified in context; 8 no-img-element, justified by the static export), ts-expect-error/ts-ignore (none), any (none), `as unknown as` (13: JSON manifests, Lexical JSON, RLS rows), TODO/FIXME/HACK (none), ponytail markers (7; no ceiling reached pre-launch; cron-jobs' «no cron.unschedule exists» still true, including the in-flight migrations), console (4, deliberate server warnings), 186 catch sites (those in files read were judged in context).
- Vendor/library facts: WebKit date parsing (fraction digits), postgrest-js 2.117.1 network-error shape and retry policy (installed source).

## Large files
- OrderView.tsx (1,084): the hazard is not size but the action scaffolding (report/act/moneyRun/reread) copied into ReconciliationView, VariantCommerce and StatsView, which has drifted (QUALITY-05). Safe split: one hook for the status/alert lines, the in-flight guard and the always-re-read; leave the render sections.
- CheckoutForm.tsx (797): cohesive; the one drifted duplicate is the city loader shared with CartView (QUALITY-07): a useCities hook.
- payments.ts (770): three cohesive parts (invoice step, HTTP handlers, reconciliation job) over one SQL contract; no hazard a split would remove. Watch: stopAfterLimit must wrap every client method the job calls (it wraps the four it uses).

## Sampled / not read line by line
- Presentational public components (rooms, home, journal, scenes views, site header/footer, weave/*), RichTextEditor, CollectionList, DocumentEditor, MediaPicker, the rest of FieldInput and MediaLibrary, EmailView/StatsView render halves, collections media/posts/scenes/taxonomies, tables products/coupons/shipping-rates, src/content/*, scripts backup/restore-check/check-frozen/check-copy/prepare-preview.py and lib/backup-format (SUPPLY slice covered backup/restore).

## Next with more time
- A runtime pass of the in-flight fix rounds' replies against the screens (order_detail `stopped`, the new alerts), the remaining CMS components line by line, and a bundle analysis of what jobs.ts pulls into the outbox function through admin.ts.
