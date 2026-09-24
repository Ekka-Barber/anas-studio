# Architecture: Next.js with a custom Supabase admin (D29)

One Next.js 16 app at the repo root, one Supabase PostgreSQL database, one Cloudflare Worker through OpenNext. The public site is the P01 rooms. The owner admin lives in the same app at `/admin`. Payload is not used (D29). Supabase plan limits and package choices are in `research-final.md`.

## Proven and to be re-measured

P00 proved on Workers Free: the public route with the ISR cache (R2 incremental cache, D1 tag cache, I20), the revalidate gate ahead of OpenNext (I21), Hyperdrive to the Supabase transaction pooler with caching disabled (D26), R2 through the binding, and Cron Trigger delivery. The Payload admin criteria were withdrawn by D29, not passed. P00's D29 swap proves the new stack locally; P10 repeats hosted CPU, bundle and connection measurements for the whole app. Local preview never closes a hosted gate.

## Three data paths

1. **Admin: browser to the Supabase Data API, as the signed-in staff member.** Admin screens are client components using `@supabase/supabase-js`. Every query carries the staff JWT and RLS decides per person. The Worker serves only the admin shell, so admin work costs almost no Worker CPU.
2. **Public reads: Worker to the Data API with the publishable key.** RLS exposes published rows only (D20). Pages are cached by ISR and revalidated on publish or within 60 seconds.
3. **Server-only writes: Worker to Postgres through Hyperdrive, as `app_server`.** Contact, notify, checkout, payment webhooks, downloads, bookings and jobs call named SQL functions. `app_server` has EXECUTE on those functions only. No secret or service-role key reaches the Worker or the browser.

## Auth and roles

- Supabase Auth, passwordless: a 6-digit email code, plus Google sign-in once Anas supplies a Google OAuth client. Public sign-up is disabled; only invited staff can sign in. P03 verifies that a Google identity links to an invited email with sign-up disabled.
- Password hashing never runs on the Worker (I17). The admin is a client-rendered shell: it gates its UI on the session and `current_staff_role()`, while RLS and function checks are the enforcement. Server actions (P04) verify the caller's JWT with `getClaims()`. There is no middleware.
- `staff (user_id, role owner|editor|operations, active)`. A `security definer` helper returns the caller's active role, and every policy uses it, so revocation applies to the next query (D13). A trigger keeps at least one active owner.
- Owner step-up: refunds, role changes and invites require `aal = 'aal2'` and a TOTP entry in `amr` from the last 5 minutes, checked inside the SQL function or Edge Function. The MFA challenge limit is fixed by Supabase at 15 per minute per IP.
- Team invites go through one Edge Function, `staff-admin`, which holds the secret key inside Supabase and checks that the caller is an owner at aal2. Revoking access sets `active = false`.
- Auth email: local Mailpit during development. The built-in sender allows 2 emails per hour, so hosting requires Resend as custom SMTP (E01).

## Collections, drafts and versions (Payload's ideas, not its code)

- **Collections.** One TypeScript config per collection in `src/admin/collections/` lists its fields: type, Arabic label, required, Zod rule. Field types: text, textarea, rich text, number, money (halalas), boolean, select, date, relation, media, slug and ordered sections. One generic list screen and one generic edit form render every config. Custom screens exist only for orders, refunds, reconciliation, stats, backups and the P12 board.
- **Drafts and versions.** Editorial collections (pages, posts, projects, scenes, shelf entries, policies, site settings) store only their *published* state in typed columns. Every save appends a row to `content_versions (collection, doc_id, seq, data jsonb, status draft|published|archived, author, created_at)`. A `publish` SQL function copies one version into the typed row in a single transaction, using a fixed allowlist of collections written as static SQL, never table names supplied by the caller. Restoring an old version creates a new version. A `version` column gives optimistic locking, and a conflict keeps the editor's unsaved text.
- **Autosave, preview, schedule, archive.** Autosave writes a draft version. Preview uses Next `draftMode` behind a verified staff session. A pg_cron job publishes due scheduled versions every minute; public pages revalidate within 60 seconds, and a manual publish revalidates at once through a server action.
- **Rich text.** Lexical (`lexical`, `@lexical/react` and the needed `@lexical/*` packages) with a small Arabic RTL toolbar. The stored Lexical JSON renders publicly through the D14 allowlist.
- **Field access.** Postgres column privileges replace Payload field access. For example, `authenticated` cannot update `reserved_qty`, redemption counters, totals, payment or fulfillment state; only SQL functions can.

Commercial collections (products, variants, coupons, customers, shipping rates, services, availability) use the same configs and generic screens without drafts. Order snapshots keep history.

## Media

A `media` table records purpose, alt, rights, dimensions, crop, the private original key and derivative keys, with a folder column and a where-used check before deletion. Objects live in R2 (D03), never in Supabase Storage. Upload is a server-issued ticket, a browser crop, and WebP derivatives made in the browser at 360/720/1200/1800 px without upscaling (D15). The server validates bytes before promotion. The rules are in DATA-AND-SECURITY.

## Jobs

- pg_cron runs pure-SQL jobs: scheduled publish, hold expiry, retention purges.
- One Worker Cron Trigger in `worker-entry.ts` runs jobs that need HTTP: the email outbox and Moyasar reconciliation. It claims leased work through `app_server` functions. No in-memory timers and no second deployed Worker.

## Local-first until the whole project is done

- The Supabase CLI stack in Docker (Postgres, Auth, Studio, Mailpit, Edge runtime, pg_cron) is the only database during development. `supabase db reset` rebuilds it from `supabase/migrations/`, which is the only migration history.
- `next dev` gets local R2 and D1 through OpenNext's dev bindings. The Worker preview is for acceptance only. `pnpm build:worker` runs in Linux (container or CI), not on Windows (I05).
- Nothing is deployed until P11, and only with the owner's authorization. The hosted Free project may pause while idle; that is harmless. The P08 Moyasar sandbox proof (E02) needs a public webhook URL: a short-lived tunnel authorized by the owner at that time, or the gate stays open.

## File map

| Exact path | Responsibility |
|---|---|
| `supabase/config.toml`, `supabase/migrations/`, `supabase/seed.sql` | Local stack settings (auth providers, sign-up off, Mailpit), the only migration history, synthetic local seed |
| `supabase/functions/staff-admin/index.ts` | Owner-only invite, role change and revoke; holds the secret key inside Supabase |
| `src/lib/supabase/browser.ts`, `src/lib/supabase/server.ts` | Browser client for the admin (P03); server client for public reads and claims checks (P04) |
| `src/lib/db.ts` | `app_server` pg client through Hyperdrive; named-function calls only |
| `src/admin/collections/*.ts` | Collection configs |
| `src/app/(admin)/layout.tsx`, `src/app/(admin)/admin/**` | Admin root layout and screens: sign-in, collections, media, settings, inbox, team, orders, stats, backups, board |
| `src/components/admin/*` | Generic list and form, rich text editor, media upload, custom views, `admin.module.css` on the main tokens |
| `src/lib/{content,richtext,format,validation,env}.ts` | Published loaders, safe Lexical renderer, formatting, input and env schemas |
| `src/lib/{checkout,orders,booking,calendar,outbox,jobs,stats,media,r2}.ts`, `src/lib/payments/moyasar.ts` | Money and state protocols, bookings and ICS, durable jobs, factual stats, media tickets |
| `worker-entry.ts`, `wrangler.jsonc`, `open-next.config.ts` | One Worker: OpenNext fetch, the revalidate gate and one scheduled handler |

Shorthand sibling names in this table and in WORK-PACKAGES are relative to the directory named at the start of the cell. Builders enumerate expanded exact paths in the lock before writing. Asset destinations are basename-preserving copies of approved runtime faces and images, never whole source folders.

## Public routes and identity

Under `src/app/(public)/`: `page.tsx`, `started/page.tsx`, `built/page.tsx`, `passed/page.tsx`, `book/page.tsx`, `shelf/page.tsx`, `scenes/page.tsx`, `contact/page.tsx`, `journal/page.tsx`, `journal/[slug]/page.tsx`, `projects/[slug]/page.tsx`, `store/page.tsx`, `store/[slug]/page.tsx`, `cart/page.tsx`, `checkout/page.tsx`, `orders/[token]/page.tsx`, `services/page.tsx`, `services/[slug]/page.tsx`, `policies/[slug]/page.tsx`, plus `not-found.tsx` and `error.tsx`. The public and admin groups each have their own root layout. Metadata endpoints are `src/app/sitemap.ts` and `src/app/robots.ts`.

Use `src/components/site/{Header,Footer,Navigation,MotionPreference}.tsx`, `src/styles/{tokens,globals}.css` and page CSS Modules. The frozen room compositions, copy and assets are the visual reference; the journal uses the same literary voice with a readable dated list. Do not ship design `support.js`, customization controls, demo prices or dead form handlers. Arabic `lang`/`dir`, licensed typography, Latin digits and logical CSS throughout. Public `Link`s keep `prefetch={false}` until I23 is resolved.

Public loaders select only the fields they need, rely on published-only RLS and never read drafts. Admin, preview, order, download and board routes are `no-store` and `noindex`.

## Custom API routes

Under `src/app/api/`: `contact`, `notify`, `notify/confirm`, `notify/unsubscribe`, `media/upload`, `media/complete`, `checkout/quote`, `checkout`, `payments/moyasar/webhook`, `payments/moyasar/return`, `orders/access`, `orders/[token]/request`, `download/[token]`, `services/[id]/slots`, `bookings`, `calendar/[token]`, `email/resend/webhook`, `revalidate`, `health`, `admin/stats`, `admin/refunds`, each as `route.ts`. Admin publish and revalidation run as server actions that verify the staff JWT.

JSON contract `{ok:true,data}` or `{ok:false,error:{code,message,fields?},requestId}`; Arabic messages, ASCII codes, no stack traces or secrets. Limit JSON to 64 KiB, contact to 8 KiB, webhooks to 256 KiB. Use 400/401/403/404/409/413/422/429/503 appropriately. Check content type, origin and schema; forms verify Turnstile action and hostname. Upload tickets limit purpose, key, size and expiry. Token recovery responses are generic.

The Resend webhook verifies the provider's documented signature against the raw bounded body (`RESEND_WEBHOOK_SECRET`, server-only), then durably deduplicates delivery, bounce and complaint events. All outbound mail, including Supabase Auth mail through SMTP, follows the same suppression and quota policy.

## Statistics

Owner stats come from an owner-only SQL function: paid order count, gross paid, confirmed refunds, net collected and distinct purchasing customers in a selected UTC range, shown in Riyadh time. Pending, cancelled and test-mode payments are excluded; gross minus refunds excludes fees, chargebacks and payout timing and is neither bank-settled cash nor profit.

Visits come from the account's verified `httpRequestsAdaptiveGroups` schema: `sum.visits`, plus a separate path-grouped request count for successful public HTML pages, filtered to the production hostname and eyeball traffic, excluding admin, API, asset and health paths. Label the latter "most requested public pages". If required fields or filters are unavailable, data is delayed, or `avg.sampleInterval` exceeds 1, show that KPI as unavailable. Never substitute sampled estimates or turn missing into zero. Cache stats 5 minutes and show the last update.

## Environment and operations

`.env.example` names only: `SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, the Hyperdrive binding, `DATABASE_URL` (migrations, local/CI only), R2 bindings, `RESEND_API_KEY`/`EMAIL_FROM`, Turnstile site and secret keys, `MOYASAR_SECRET_KEY`/`MOYASAR_WEBHOOK_SECRET`/`PAYMENTS_MODE`, `JOBS_SECRET`, `REVALIDATE_SECRET`, `TOKEN_HASH_PEPPER`, `CLOUDFLARE_ACCOUNT_ID`/`ANALYTICS_TOKEN`, `SENTRY_DSN`. The Supabase secret key exists only as an Edge Function secret. No secret `NEXT_PUBLIC_` variables. Separate test and live buckets, keys and domains.

Backups: Supabase Free has none. A nightly Linux CI job runs `supabase db dump` (data, roles, grants) plus an R2 object manifest, encrypted and stored off-site with the key held separately; it continues on Pro. P06 records the destination, key custodian, retention, footprint and measured restore. An alert is not a spending cap.

Email retries are bounded, and exhausted work is visible in the admin. Sign-in codes and receipts take precedence over availability announcements. Sentry Free for checkout, webhook and scheduler errors with redaction and no replay; one UptimeRobot Free HTTPS check against `/api/health`. Live orders wait for E07 (Workers Paid and Supabase Pro). No paid Images dependency.

## Bonus P12

Owner-only `boards`, `board_columns` and `board_cards` tables under RLS; one custom board screen. Free-form named columns and stable sort keys; cards have title, body, optional due date and an optional link to a post, project or shelf entry. @dnd-kit with pointer, touch and keyboard sensors, RTL mapping and an accessible move menu; moves are transactional and version-checked. No implicit workflow, auto-publication, teams or public route.
