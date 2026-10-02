# SITE-STATE-1: the site's state, switched from the admin

Contract for one side package (D46, D47). Owner, 2026-10-02: "now build the maintenance page, do the same three designs idea, make sure all get activated from admin dashboard (settings ..) check the best place there".

## What exists already (outside the product, live)

`artifacts/soon/` (its README): three soon designs (`site/v/<letter>/`) and three maintenance designs (`site/m/<letter>/`), served by the Worker `anas-studio-soon` on anas.studio. `worker.js` shows one design at random per load, never the same twice in a row; maintenance answers 503 with `Retry-After`. The state is the Worker variable `MODE` (`soon` or `maintenance`), switched today by a deploy: `node --env-file=.env artifacts/soon/deploy.cjs --mode=maintenance`. Proven on the live domain on 2026-10-02 (on: 503 and the maintenance title; off: 200 and the soon title). `https://anas.studio/m/` shows a maintenance design without switching anything.

## What this package adds

The owner switches the state in the admin, and the domain follows it within half a minute, with no deploy.

Three states, one stored word:

| State | Stored | A visitor sees |
|---|---|---|
| «مفتوح» | `open` | the site |
| «قريباً» | `soon` | a soon design, 200 |
| «صيانة» | `maintenance` | a maintenance design, 503 |

### Where in the admin

`/admin/settings` («الإعدادات», owner only), as its first section, «حالة الموقع», above «إعدادات الموقع». It is the one control there that changes what every visitor sees, so it comes first. It is built like the «الشراء» switch in `CommerceSettingsForm.tsx`: the `switchBox` fieldset, the `admin` function, a fresh TOTP through `StepUp`, the state read back after the change.

Words (the owner approves them before acceptance):
- the current state as a sentence: «الموقع الآن: مفتوح» / «الموقع الآن: قريباً» / «الموقع الآن: صيانة»;
- under it: «مفتوح: يرى الزائر الموقع كاملاً.» · «قريباً: يرى الزائر صفحة «قريباً» بدل الموقع.» · «صيانة: يرى الزائر صفحة الصيانة إلى أن تفتح الموقع.» · «لوحة التحكم تعمل في كل الحالات.» · «يظهر التغيير للزوار خلال نصف دقيقة.»;
- the two actions that are not the current state, as buttons: «افتح الموقع», «اعرض صفحة قريباً», «ضع الموقع في الصيانة»;
- after a change: «تم. الموقع الآن: صيانة.» (the state read back, not the one sent).

### Exact paths

Product (inside the lock; add them to its allowlist before writing):
- `supabase/migrations/<timestamp>_site_state.sql`: table `public.site_state`, one row (`id boolean primary key default true check (id)`, `mode text not null check (mode in ('open','soon','maintenance'))`, `version integer not null default 0`, `updated_at timestamptz not null default now()`, `updated_by uuid references auth.users (id) on delete set null`), seeded `soon`: the migration must not change what the live domain shows, and the launch is the owner pressing «افتح الموقع». RLS on, with a select policy and column grants, so the public reads one word and nothing else: `grant select (mode) on public.site_state to anon; grant select (mode, version) on public.site_state to authenticated;`. No insert, update or delete policy or grant. `site_state_set(p_actor uuid, p_expected_version integer, p_mode text)`: security definer, following `commerce_checkout_set` in full: the owner recheck, the row locked with `for update` before the version is compared with `is distinct from`, a stale version refused with 23505, the row written, an audit row (`'site.state'`, `'site_state'`, with `{from, to, version}`), the new version returned. Execute revoked from `public`, `anon` and `authenticated`; granted to `service_role`.
- `supabase/functions/_shared/site-state.ts`: the Zod schema of the action body (`{ action: 'site-state-set', mode, expectedVersion }`, strict), shared with the browser form the way `commerce-settings.ts` is.
- `supabase/functions/_shared/admin.ts`: the case `site-state-set`: owner only, `STEP_UP_REQUIRED` without a fresh TOTP, then the RPC; 409 on a version conflict.
- `src/components/admin/SiteStateForm.tsx` and its mount in `src/components/admin/SettingsView.tsx`. The form reads `mode, version` from the table itself; there is no new read RPC.
- `src/components/admin/StepUp.tsx`: its input id comes from `useId()`. The settings page will hold two `StepUp` dialogs (the store's and this one), and today's fixed `id="step-up-code"` would be duplicated.
- `PLANS/DATA-AND-SECURITY.md`: the table's row.
- Tests: `tests/unit/admin-site-state.test.ts` (the action: editor refused, no TOTP refused, bad mode refused, conflict, success). `tests/integration/site-state.test.ts`: anon reads `mode` and is refused `version`, `updated_by` and `*`; an authenticated owner's PATCH, POST and DELETE on the table are refused; `site_state_set` cannot be executed by `anon` or `authenticated`; it refuses a non-owner actor; of two calls with the same expected version exactly one succeeds; the audit row. One case in `tests/e2e/owner-operations.spec.ts` (the owner sees the section first, switches with the code, the sentence changes; an editor does not see it), restoring the row in `afterAll`.

Outside the product (no lock needed):
- `artifacts/soon/worker.js`: read the state from `GET <SUPABASE_URL>/rest/v1/site_state?select=mode` with the publishable key (two Worker variables, both public values), remembered for 30 seconds per isolate, with a 1.5 second timeout. Anything other than a 200 with exactly one row holding one of the three words is a failed read, and a failed read is remembered for the 30 seconds like a good one. A failed read keeps the last answer; with no answer yet it uses `MODE`, which is `soon` before the launch and `open` from the launch (`worker.js` and `deploy.cjs` accept `open`; P11 sets it), so a database that cannot answer never puts «قريباً» over the launched site. `MODE = "maintenance"` set by a deploy wins over the stored state: that is the switch for a restore or any work that takes the database itself down. `open` passes the request through to the site. In `soon` and `maintenance` these addresses still pass through, so the owner can always switch back and a buyer is not stranded: `/admin`, `/admin.txt`, `/admin/*`, `/checkout/return`, `/orders`, `/notify/unsubscribe`, `/book/*` (the admin's preview reads it), and the site's static files (`/_next/*`, `/fonts/*`, `/images/*`, `/brand/*`, `/media/*`, the icons).
- The gate's decision is one pure function (the state, the path, the last answer) with one `node --test` file beside it in `artifacts/soon/`: the exempt paths and their near misses, the failed-read fallback, and `open` left untouched.
- `artifacts/soon/deploy.cjs`, `wrangler.toml`, `README.md`.

### What P11 decides

Where the gate stands in front of the real site, chosen from the Cloudflare docs and recorded with their address, not recalled: a Worker route in front of the Pages domain, or a Pages Function (`_middleware`) with `_routes.json` so that only pages, not files, call it. Either way the free plan's daily request allowance is checked against measured traffic first. Until the hosted Supabase project has this migration, the domain keeps following `MODE`.

Also decided there, from the docs:
- whether the gate fails open or closed when the daily allowance runs out;
- the Worker's own copies of addresses the site also serves (`/fonts/*`, `/images/*`, `/brand/*`, the icons): removed, moved under one prefix, or the script run first, so nothing of the Worker shadows the site;
- the `pages.dev` address of the Pages project, which the gate does not cover: restricted or accepted.

The way back when the owner cannot pass TOTP or the `admin` function is down while the state is «صيانة»: the same function run in the Supabase SQL editor, `select public.site_state_set('<owner user id>', <current version>, 'open');`, which is audited like any other change. It goes in the runbook and in the hosted acceptance.

## Rules

- Truthful states: the form shows the state it read back; a failed read says «تعذّر قراءة حالة الموقع», never a guess. No return time is promised anywhere; `Retry-After` is for crawlers.
- Security: owner only, fresh TOTP, the SQL rechecks the owner, every change is audited, and the public can read one word and nothing else. An editor cannot take the site down. The gate never serves a design on `/admin`.
- The store's own pause stays the «الشراء» switch (P08). This switch does not touch orders, holds or payments; the Edge Functions keep answering in every state.
- Not in this package: a schedule, a message the owner edits (the pages' words are files; changing them is a deploy), choosing which designs rotate, a state per page.

## Acceptance

`pnpm check`, `pnpm test:db`, the whole of `owner-operations.spec.ts` and `store-admin.spec.ts` (both use the step-up dialog), `deno check` for the function, the gate's `node --test` file; the Opus audit of the diff (D45), with the migration and the action read line by line by the orchestrator; then, on a hosted preview in P11: right after the migration the domain still shows a soon design; the three states switched from the admin and seen on the domain within half a minute, `/admin` reachable in each, and the fallback when the read fails.

## Dispatch

After P08 releases `.anasaq-execution.lock`, or as a P08 round on the owner's word (it touches `_shared/admin.ts`, which P08's rounds also edit, so never beside a P08 worker). One `sonnet-worker` (Sonnet 5.5, effort max) for the migration, the action, the form and the tests; the orchestrator writes the Worker part; an `auditor` (Opus 5.5, effort xhigh) audits both.
