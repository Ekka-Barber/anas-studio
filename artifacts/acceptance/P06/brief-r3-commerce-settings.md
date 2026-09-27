# Brief: P06 round 3, step 3, commerce settings without tax (D34)

You work under `.anasaq-execution.lock` at base commit `3520028`. Do this one task, run the checks, report, stop.

## Goal

The owner records the seller details the store will need, from `/admin/settings`, behind the same owner step-up as the team screen. Nothing else about the store changes: no products, no checkout, no prices. The contract is `PLANS/DATA-AND-SECURITY.md`, row `commerce_settings`: a singleton, owner-only, aal2 to change, `checkout_enabled=false`, seller legal name/address/registration (the freelance certificate), policy revision IDs, currency SAR, `configured_at`/`approved_by`/`version`. **No tax field of any kind (D34).** Read `PLANS/DECISIONS.md` D08, D13, D32 and D34 first.

## What to build

1. **Migration** `supabase/migrations/20260927130000_commerce_settings.sql`.
   - `finance.commerce_settings`, one row (`id integer primary key default 1 check (id = 1)`, inserted by the migration): `checkout_enabled boolean not null default false check (checkout_enabled = false)` (comment: P08 lifts the check after the verified gateway); `seller_legal_name`, `seller_address`, `seller_registration` (nullable text; length checks 1–200, 1–500, 1–100; no control characters); `policy_revisions jsonb not null default '{}'` (must be an object; P07 fills it); `currency text not null default 'SAR' check (currency = 'SAR')`; `version integer not null default 0`; `configured_at timestamptz`; `approved_by uuid references auth.users (id) on delete set null`. No grants to any API role.
   - `public.commerce_settings_get()`: security definer, `set search_path = ''`, returns the row as `jsonb`. Raises `42501` unless `public.current_staff_role()` is `owner`. Granted to `authenticated` only.
   - `public.commerce_settings_save(p_actor uuid, p_expected_version integer, p_seller_legal_name text, p_seller_address text, p_seller_registration text)` returns the new version. Security definer. It rechecks that `p_actor` is an active owner in `public.staff` (`42501` otherwise), raises `40001` when `version <> p_expected_version`, trims the values, sets `version = version + 1`, `configured_at = now()`, `approved_by = p_actor`, and inserts one `public.audit_events` row (`action 'commerce.settings'`, `entity 'commerce_settings'`, summary: the new version and the names of the changed fields, never the values). Granted to `service_role` only; revoked from `public, anon, authenticated`.
   - Follow the style of `supabase/migrations/20260927120000_rebuild_delivery_and_media_sweep.sql`. Apply it with `supabase migration up --local`.
2. **Step-up in the `admin` function.** Move `supabase/functions/staff-admin/recent-totp.ts` to `supabase/functions/_shared/recent-totp.ts` (unchanged content). Update its two importers: `supabase/functions/staff-admin/index.ts` and `tests/unit/recent-totp.test.ts`. Add `recentTotp: boolean` to `StaffIdentity` in `supabase/functions/_shared/staff.ts`, computed in `staffFromRequest` with `hasRecentTotp(claims, nowSeconds)` from the claims it already reads.
3. **One schema, shared.** `supabase/functions/_shared/commerce-settings.ts`: a strict Zod object (unknown keys refused) for the three seller fields, the same limits as the SQL, trimmed, with Arabic messages. Zod is its only import, like `_shared/media-rules.ts`, so the browser form imports it the way `src/lib/media-ref.ts` imports `media-rules.ts`.
4. **Admin action** `commerce-settings-save` in `supabase/functions/_shared/admin.ts`, body `{ action, expectedVersion, settings }`: not owner → 403 `FORBIDDEN`; owner without `recentTotp` → 403 `STEP_UP_REQUIRED` with the same Arabic message `staff-admin` uses, and the RPC is not called; invalid body → 422 with field errors; SQL `40001` → 409 `CONFLICT` «تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.»; success → `{ ok: true, data: { version } }`.
5. **UI.** A new `src/components/admin/CommerceSettingsForm.tsx` rendered as a section «إعدادات المتجر» in `src/components/admin/SettingsView.tsx` (the page is already owner-only). It loads through `commerce_settings_get`, shows the currency (SAR, read-only), states that payment is off until the payment gateway (P08), shows the policy revisions read-only («لم تُعتمد بعد» while empty), the version and the last change time with `formatRiyadh`, and edits the three seller fields with native inputs and labels. Saving calls `callFunction('admin', …)`; on `STEP_UP_REQUIRED` it opens the existing `StepUp` dialog and retries once, exactly the way `src/components/admin/TeamView.tsx` does. Reuse `admin.module.css` classes; add CSS only if nothing fits. Arabic RTL, Latin digits. **No em dashes in new text** (`PLANS/DESIGN-AUDIT.md` item 2). You make no visual decisions beyond this; if one is needed, stop and ask.

Do not touch `supabase/functions/_shared/stats.ts`: the store stays «غير مُهيأ» until P07 has products.

## Tests (write them, run them)

- `tests/unit/admin-function.test.ts`: the five outcomes of step 4, including a body with a `tax` or `vat` key refused with 422.
- `tests/unit/recent-totp.test.ts`: the new import path only.
- New `tests/integration/commerce-settings.test.ts`, in the style of `tests/integration/static-site.test.ts` (rolled-back transactions): the grants; the get refused to editor and operations; the save refused for a non-owner actor; a stale version → `40001`; a save bumps the version and writes `approved_by`, `configured_at` and one audit row; `checkout_enabled = true` and a currency other than SAR are refused by the table; no column of `finance.commerce_settings` matches `tax|vat`.
- `tests/e2e/owner-operations.spec.ts`: the owner signs in, saves the three fields through the step-up dialog (the TOTP helpers in `tests/e2e/helpers.ts`, as `auth.spec.ts` uses them), reloads and sees them; add `settings-360.png` and `settings-1440.png` to that spec's screenshot test.

## Checks to run and report

`pnpm check`; `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db`; `pnpm exec playwright test tests/e2e/owner-operations.spec.ts tests/e2e/auth.spec.ts` (no `ACCEPTANCE_PACKAGE`). No `pnpm build`: the orchestrator runs acceptance.

## Paths you may write

`supabase/migrations/20260927130000_commerce_settings.sql`, `supabase/functions/_shared/{recent-totp,commerce-settings,staff,admin}.ts`, `supabase/functions/staff-admin/index.ts`, `supabase/functions/staff-admin/recent-totp.ts` (delete), `src/components/admin/{CommerceSettingsForm,SettingsView}.tsx`, `src/components/admin/admin.module.css`, `tests/unit/{admin-function,recent-totp}.test.ts`, `tests/integration/commerce-settings.test.ts`, `tests/e2e/owner-operations.spec.ts`, `docs/operations.md` (a short "Commerce settings" section), and the screenshots your runs write under `artifacts/acceptance/`. Anything else: stop and ask.

## Report (40 lines or fewer)

Files changed; each check as `command → exit code` with test counts; screenshot paths written; anything skipped or open.
