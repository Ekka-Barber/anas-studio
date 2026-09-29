# Architecture: a static Next.js site, a custom Supabase admin, server work in Supabase (D29, D32)

One Next.js 16 app at the repo root, built with `output: 'export'` into static files that Cloudflare Pages serves, and one Supabase project: PostgreSQL, Auth, Storage, Edge Functions and pg_cron. The public site is the P01 rooms. The owner admin lives in the same app at `/admin`, as client screens that talk to Supabase directly. Payload is not used (D29); there is no Worker (D32). Supabase plan limits and package choices are in `research-final.md`.

## Why static (D32)

The OpenNext Worker ran the whole Next server on every visit: a cold isolate cost 19–46 ms CPU against Workers Free's 10 ms (I21), and it needed Hyperdrive, an R2 + D1 page cache, a per-minute cron through the full app and a prefetch workaround (I23). Static files cost no server CPU. It is the pattern of the owner's Ekka-Rekaz app (static front end on Pages, Supabase Edge Functions with `_shared/` code, pg_cron calling them), keeping Next.js as the offer names it. P00's Worker measurements remain as history in `docs/runtime-spike.md`.

## Three data paths

1. **Admin: browser to the Supabase Data API, as the signed-in staff member.** Admin screens are client components using `@supabase/supabase-js`. Every query and RPC carries the staff JWT and RLS or the SQL function's own role check decides per person. Pages serves only the admin shell.
2. **Public reads: at build time, with the publishable key.** The build reads published rows (D20) and writes HTML. A publish or archive requests a rebuild (see "Publishing"), so the site changes a few minutes after a publish. Client-side public features (cart, order page, booking slots) read through the Data API or an Edge Function at request time.
3. **Server-only work: Supabase Edge Functions, as `service_role`.** Contact, notify, checkout, payment webhooks, downloads, bookings, media promotion and jobs call named SQL functions. Those functions are granted to `service_role` only, and the service-role key exists only inside Supabase (it is provided to every function; nothing sets or sees it). No secret reaches Pages or the browser.

## Auth and roles

- Supabase Auth, passwordless: a 6-digit email code, plus Google sign-in once Anas supplies a Google OAuth client. Public sign-up is disabled; only invited staff can sign in. P03 verifies that a Google identity links to an invited email with sign-up disabled.
- The admin is a client-rendered shell: it gates its UI on the session and `current_staff_role()`, while RLS and function checks are the enforcement. Edge Functions verify the caller's JWT with `getClaims()` and read the role from `staff`. There is no middleware.
- `staff (user_id, role owner|editor|operations, active)`. A `security definer` helper returns the caller's active role, and every policy uses it, so revocation applies to the next query (D13). A trigger keeps at least one active owner.
- Owner step-up: refunds, role changes and invites require `aal = 'aal2'` and a TOTP entry in `amr` from the last 5 minutes, checked inside the SQL function or Edge Function. The MFA challenge limit is fixed by Supabase at 15 per minute per IP.
- Team invites go through one Edge Function, `staff-admin`, which holds the secret key inside Supabase and checks that the caller is an owner at aal2. Revoking access sets `active = false`.
- Auth email: local Mailpit during development. The built-in sender allows 2 emails per hour, so hosting requires Resend as custom SMTP (E01).

## Collections, drafts and versions (Payload's ideas, not its code)

- **Collections.** One TypeScript config per collection in `src/admin/collections/` lists its fields (type, Arabic label, required); `src/admin/fields.ts` derives the Zod schema from it, so the form, the publish check and the public loaders share one definition. Field types: text, textarea, rich text, number, money (halalas), boolean, select, date, relation, media, slug and ordered sections. One generic list screen and one generic edit form render every config. Custom screens exist only for orders, refunds, reconciliation, stats, backups and the P12 board.
- **Drafts and versions.** One generic store for every collection (the rooms are nested documents, not rows). Every save appends a row to `content_versions (collection, doc_id, seq, data jsonb, author, publish_at, created_at)`; a trigger requires `seq` to be the next number, so a save based on a stale version is a conflict and the editor keeps their text. `published_documents (collection, doc_id, seq, data)` holds the live copy; anon reads only this table. Restoring an old version appends it as a new version. Rooms and site settings cannot be archived.
- **Publishing (D32).** `publish_version`, `schedule_version`, `cancel_schedule` and `archive_document` are SQL functions granted to `authenticated`; each takes the actor from `auth.uid()` and rechecks that it is an active owner or editor. Before calling them the admin validates the saved version with the collection's Zod schema and checks that every referenced library image exists (`src/lib/admin-publish.ts`); that check is for the editor. The site is guarded at build time: the loaders parse every published document with the same schemas, so an invalid one fails the build and Pages keeps the last good deploy. Publish, archive and a scheduled publish record a build request in `finance.site_builds`; pg_cron's `site_build_trigger()` calls the Pages deploy hook (Vault `pages_deploy_hook`) at most once per two minutes, so a burst of publishes is one build. The admin says the change shows within minutes.
- **Autosave, preview, schedule.** Autosave keeps an unsaved local copy in the browser; saving creates the next version. Preview is the admin page `/admin/preview?id=<room>`: it reads the latest version under RLS, resolves library images and renders the room with the same view component the public page uses; nothing public changes. Scheduled publishing is `publish_due()` on pg_cron every minute.
- **Rich text.** Lexical (`lexical`, `@lexical/react` and the needed `@lexical/*` packages) with a small Arabic RTL toolbar. The stored Lexical JSON renders publicly through the D14 allowlist.
- **Field access.** Postgres column privileges replace Payload field access. For example, `authenticated` cannot update `reserved_qty`, redemption counters, totals, payment or fulfillment state; only SQL functions can.

Commercial collections (products, variants, coupons, customers, shipping rates, services, availability) use the same configs and generic screens without drafts. Order snapshots keep history.

## Media

A `media` table records purpose, alt, rights, dimensions, crop, the private original key and derivative keys, with a folder column and a where-used check before deletion. Objects live in Supabase Storage (D03 as amended by D32): `media-private` holds originals and the upload quarantine and has no policies, so only the service role touches it; `media-public` holds checked WebP derivatives only and is publicly readable from the Supabase Storage host, never the site's origin. Upload is a ticket from the `admin` function, a browser crop, WebP derivatives made in the browser at 360/720/1200/1800 px without upscaling (D15), a direct upload of each part to the signed URL the ticket issued, and `media-complete`, which checks every part's bytes, type and dimensions before promoting the derivatives. The rules are in DATA-AND-SECURITY.

## Jobs

pg_cron runs every scheduled job; pg_net calls an Edge Function when a job needs HTTP, with the functions URL and the jobs bearer secret in Vault:

- pure SQL: scheduled publish (`publish_due`), hold expiry, retention purges;
- `site_build_trigger()`: the Pages deploy hook, at most once per two minutes, only after a build request;
- `outbox_kick()`: the `outbox` function, only while an email is due, so an idle site makes no calls; the function claims leased rows and sends them;
- Moyasar reconciliation (P08) the same way.

No in-memory timers. Without the Vault values (the local stack) the HTTP jobs do nothing, and the tests call the functions themselves.

## Local-first until the whole project is done

- The Supabase CLI stack in Docker (Postgres, Auth, Storage, Edge runtime, Studio, Mailpit, pg_cron) is the only backend during development. `supabase db reset` rebuilds it from `supabase/migrations/`, which is the only migration history. `pnpm db:env` writes `.env.local` and `supabase/functions/.env`.
- `pnpm dev` renders every page live against the local stack. `pnpm build` writes the static export to `out/`; `pnpm check:export` confirms it is complete and holds no secret.
- Nothing is deployed until P11, and only with the owner's authorization. The hosted Free project may pause while idle; that is harmless before orders. The P08 Moyasar sandbox proof (E02) needs a public webhook URL: the hosted `payments` function, once the owner authorizes it, or the gate stays open.

## File map

| Exact path | Responsibility |
|---|---|
| `supabase/config.toml`, `supabase/migrations/`, `supabase/seed.sql` | Local stack settings (auth providers, sign-up off, Mailpit), the only migration history, synthetic local seed |
| `supabase/functions/staff-admin/index.ts` | Owner-only invite, role change and revoke |
| `supabase/functions/{contact,resend-webhook,outbox,admin}/index.ts` | One entrypoint each (`Deno.serve`), with `deno.json` import maps; the handlers live in `_shared/` |
| `supabase/functions/_shared/*.ts` | Server code shared by the functions and imported by the unit tests: env, db (`service_role` RPC client), http, staff, contact, resend-webhook, jobs, admin, email, outbox, turnstile, rate-limit, analytics, stats, media rules |
| `src/lib/supabase/browser.ts`, `src/lib/supabase/functions.ts` | The admin's browser client (P03); `callFunction()` for Edge Functions and document URLs |
| `src/lib/admin-publish.ts` | Publish, schedule, cancel, archive from the admin, with the browser-side Zod and media checks |
| `src/admin/collections/*.ts` | Collection configs |
| `src/app/(admin)/layout.tsx`, `src/app/(admin)/admin/**` | Admin root layout and screens: sign-in, collections, media, settings, email problems, team, orders, stats, board (no inbox: D31; backups are owner-run, D35) |
| `src/components/admin/*` | Generic list and form, rich text editor, media upload, custom views, `admin.module.css` on the main tokens |
| `src/lib/{content,richtext,format,validation,env,media-ref}.ts` | Build-time published loaders, safe Lexical renderer, formatting, input and env schemas, media references |
| `src/components/public/rooms/*RoomView.tsx` | Props-only room views, shared by the public pages and the admin preview |
| `supabase/functions/_shared/{checkout,orders,booking,calendar}.ts`, `supabase/functions/_shared/payments/moyasar.ts` | (P07–P09) money and state protocols, bookings and ICS |
| `public/_headers` | Pages response headers: nosniff and referrer policy everywhere; the admin noindex, no-store and unframeable |

Shorthand sibling names in this table and in WORK-PACKAGES are relative to the directory named at the start of the cell. Builders enumerate expanded exact paths in the lock before writing. Asset destinations are basename-preserving copies of approved runtime faces and images, never whole source folders.

## Public routes and identity

Under `src/app/(public)/`: `page.tsx`, `started/page.tsx`, `built/page.tsx`, `passed/page.tsx`, `book/page.tsx`, `shelf/page.tsx`, `scenes/page.tsx`, `contact/page.tsx`, `journal/page.tsx`, `journal/[slug]/page.tsx`, `store/page.tsx`, `store/[slug]/page.tsx`, `cart/page.tsx`, `checkout/page.tsx`, `orders/[token]/page.tsx`, `services/page.tsx`, `services/[slug]/page.tsx`, `policies/[slug]/page.tsx`, plus `not-found.tsx` and `error.tsx`. There is no `projects/[slug]`: projects are items of the room documents (D40). The public and admin groups each have their own root layout. Metadata endpoints are `src/app/sitemap.ts` and `src/app/robots.ts`.

Use `src/components/site/{Header,Footer,Navigation,MotionPreference}.tsx`, `src/styles/{tokens,globals}.css` and page CSS Modules. The frozen room compositions, copy and assets are the visual reference; the journal uses the same literary voice with a readable dated list. Do not ship design `support.js`, customization controls, demo prices or dead form handlers. Arabic `lang`/`dir`, Thmanyah (D33), Latin digits and logical CSS throughout. Public `Link`s keep `prefetch={false}` until a hosted check turns it back on.

A static export knows its pages at build time, so every dynamic public route (`journal/[slug]`, `store/[slug]`, `services/[slug]`, `policies/[slug]`) lists its published slugs in `generateStaticParams`; a new slug appears after the rebuild its publish triggers. Pages that depend on a private token read it from the URL fragment and call a function from the browser, so the token never reaches a server log or a Referer: `orders#<token>`, the notify confirm and unsubscribe pages, and the checkout return page. Admin documents open at `/admin/content/<collection>/edit?id=<doc>`.

Public loaders select only the fields they need, rely on published-only RLS and never read drafts. The admin and the order, download and board screens are `no-store` and `noindex` (`public/_headers`).

## Server endpoints: Edge Functions

Under `supabase/functions/`, each a `Deno.serve` entrypoint over a `_shared/` handler that the unit tests import:

- built: `contact` (public, Turnstile, the site origin only), `resend-webhook` (public, Svix signature), `outbox` (pg_cron's bearer secret), `admin` (staff JWT; `media-ticket`, `media-complete`, `media-delete`, `stats`, `status`), `staff-admin` (owner at aal2);
- planned: `notify` (P08: subscribe, confirm, unsubscribe), `checkout` (quote and create), `payments` (the Moyasar webhook and return verification), `orders` (access by token, requests), `download` (a short-lived signed Storage URL for a paid file), `bookings` (slots and booking, P09), `calendar` (the owner's private ICS feed by token), and refunds in `admin`.

Public functions set `verify_jwt = false` in `supabase/config.toml` and authenticate themselves; the rest require a Supabase JWT at the gateway and check the role again.

JSON contract `{ok:true,data}` or `{ok:false,error:{code,message,fields?},requestId}`; Arabic messages, ASCII codes, no stack traces or secrets. Limit JSON to 64 KiB, contact to 8 KiB, webhooks to 256 KiB. Use 400/401/403/404/409/413/422/429/503 appropriately. Check content type, origin and schema; forms verify Turnstile action and hostname. Upload tickets limit purpose, key, size and expiry. Token recovery responses are generic.

The Resend webhook verifies the provider's documented signature against the raw bounded body (`RESEND_WEBHOOK_SECRET`, server-only), then durably deduplicates delivery, bounce and complaint events. All outbound mail, including Supabase Auth mail through SMTP, follows the same suppression and quota policy.

## Statistics

Owner stats come from an owner-only SQL function: paid order count, gross paid, confirmed refunds, net collected and distinct purchasing customers in a selected UTC range, shown in Riyadh time. Pending, cancelled and test-mode payments are excluded; gross minus refunds excludes fees, chargebacks and payout timing and is neither bank-settled cash nor profit.

Visits come from the account's verified `httpRequestsAdaptiveGroups` schema: `sum.visits`, plus a separate path-grouped request count for successful public HTML pages, filtered to the production hostname and eyeball traffic, excluding admin, API, asset and health paths. Label the latter "most requested public pages". If required fields or filters are unavailable, data is delayed, or `avg.sampleInterval` exceeds 1, show that KPI as unavailable. Never substitute sampled estimates or turn missing into zero. Cache stats 5 minutes and show the last update.

## Environment and operations

`.env.example` names only, in three places: the Pages build (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_AUTH_GOOGLE`, all public), the Edge Function secrets (`SITE_URL`, `JOBS_SECRET`, `TOKEN_HASH_PEPPER`, `RESEND_API_KEY`/`EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`, `ANALYTICS_TOKEN`/`CLOUDFLARE_ZONE_ID`, `MOYASAR_SECRET_KEY`/`MOYASAR_WEBHOOK_SECRET`/`PAYMENTS_MODE`, `SENTRY_DSN`), and Vault (`pages_deploy_hook`, `functions_url`, `jobs_secret`). `DATABASE_URL` is for migrations only, local/CI. The service-role key is provided to the functions by Supabase and is never set by hand. No secret `NEXT_PUBLIC_` variables. Separate test and live keys and domains.

Backups (D35): Supabase Free has none. The owner runs `pnpm backup` on his own machine: Supabase's documented roles, schema, data and migration-history dumps plus both Storage buckets' objects, in one file encrypted with his passphrase and kept on his machine. `pnpm restore-check` restores a file into a throwaway local stack. On Pro (before live orders, E07) the platform's daily backups add to it. P06 records the footprint and the measured restore. An alert is not a spending cap.

Email retries are bounded, and exhausted work is visible in the admin. Sign-in codes and receipts take precedence over availability announcements. Sentry Free for checkout, webhook and scheduler errors with redaction and no replay; one UptimeRobot Free HTTPS check against the home page. Live orders wait for E07 (Supabase Pro). No paid Images dependency.

## Bonus P12

Owner-only `boards`, `board_columns` and `board_cards` tables under RLS; one custom board screen. Free-form named columns and stable sort keys; cards have title, body, optional due date and an optional link to a post or a room document (D40). @dnd-kit with pointer, touch and keyboard sensors, RTL mapping and an accessible move menu; moves are transactional and version-checked. No implicit workflow, auto-publication, teams or public route.
