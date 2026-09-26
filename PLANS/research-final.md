# Implementation research

Revised 2026-09-24 for D29. The original research cutoff was 2026-09-21; Payload-specific findings were removed with Payload and remain in Git history. Exact installed versions live in `package.json` and `pnpm-lock.yaml`, not here.

## Supabase plan limits (live docs, read 2026-09-24)

| Item | Free | Pro ($25/month) | Source |
|---|---|---|---|
| Pausing | Paused after low activity over 7 days; warning email first; restorable for up to 1 year | Never paused | [pricing](https://supabase.com/pricing), [pausing](https://supabase.com/docs/guides/platform/free-project-pausing) |
| Active projects | 2 (paused projects do not count) | No cap; each project pays its own compute | [pricing](https://supabase.com/pricing) |
| Compute | Nano: up to 0.5 GB RAM, shared CPU, 60 direct connections, 200 pooler clients | $10/month credit covers one Micro (1 GB RAM, same connection limits) | [compute](https://supabase.com/docs/guides/platform/compute-and-disk) |
| Database size | 500 MB; above it the project goes read-only | 8 GB disk included, $0.125/GB; auto-grows at 90% | [pricing](https://supabase.com/pricing), [database size](https://supabase.com/docs/guides/platform/database-size) |
| Egress | 5 GB (+5 GB cached) | 250 GB (+250 GB cached), then $0.09/GB | [pricing](https://supabase.com/pricing) |
| Auth MAU | 50,000 | 100,000, then $0.00325/MAU | [pricing](https://supabase.com/pricing) |
| Auth email | Built-in sender: 2 emails per hour per project; custom SMTP lifts it | same | [rate limits](https://supabase.com/docs/guides/auth/rate-limits) |
| Storage | 1 GB, 50 MB max file | 100 GB, 500 GB max file | [pricing](https://supabase.com/pricing), [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits) |
| Edge Functions | 500,000 invocations; 2 s CPU per request, 150 s wall clock, 256 MB | 2 M invocations, 400 s wall clock | [pricing](https://supabase.com/pricing), [limits](https://supabase.com/docs/guides/functions/limits) |
| Backups | None; export with `supabase db dump` and keep off-site copies | Daily, last 7 days; PITR extra (~$100/month per 7 days, needs Small compute) | [backups](https://supabase.com/docs/guides/platform/backups) |

MFA: TOTP is enforced in RLS through the JWT `aal` claim; `amr` lists methods with timestamps, newest first; the challenge/verify limit is fixed at 15 per minute per IP ([MFA](https://supabase.com/docs/guides/auth/auth-mfa), [rate limits](https://supabase.com/docs/guides/auth/rate-limits)). The MFA page does not state plan availability; P03 confirms it. pg_cron schedules from every second to once a year, with at most 8 concurrent jobs recommended ([cron](https://supabase.com/docs/guides/cron)).

Consequences: staff are the only Auth users (about 3 MAU). Media stays in R2, so Supabase Storage limits do not apply. The real Free risks are pausing and the absence of backups; neither matters locally, and both are covered by E07 (Pro before live orders) and P06 (own off-site backup). Hosted staff mail needs Resend SMTP.

## Platform choices

| Area | Choice | Reason |
|---|---|---|
| Runtime | Next 16 with OpenNext for Cloudflare on Workers | Proven in P00 for the public route, ISR cache and revalidate gate. |
| Staff auth | Supabase Auth, passwordless (email code, Google) | Hashing runs on Supabase, not the Worker (I17). Sign-up disabled. |
| Data API | `@supabase/supabase-js` with RLS | Per-person authorization in the database, EKKa pattern; the admin costs almost no Worker CPU. |
| Server writes | `pg` through Hyperdrive as `app_server` | EXECUTE-only least privilege; pooler behaviour proven in P00. |
| Rich text | Lexical packages directly | Keeps the planned JSON format and D14 allowlist renderer; no Tiptap. |
| Email/abuse | Resend over HTTP with durable outbox; Turnstile plus bounded DB throttles | Free development quotas; sender domain is external (E01). |
| Tests | Vitest, Playwright, axe, LHCI | Real DB, real JWT and Worker checks. |

## Media without Sharp or Images

Baseline is upload-time browser processing, not on-request optimization. `react-easy-crop` provides the crop UI; native `createImageBitmap` plus canvas `toBlob('image/webp')` generates the bounded widths without upscaling. Generate automatically before upload, fail with an actionable message when the browser cannot encode, and never publish the raw original as a fallback. Preserve crop coordinates for deliberate regeneration.

The server does not trust browser claims. `image-size` checks the type from magic bytes and the bounded dimensions before promotion (P05 dropped `file-type`: its single entry imports `strtok3` for file reading, which the Worker bundle cannot resolve); enforce an authenticated short-lived upload ticket, byte and pixel limits, allowed exact widths/aspect ratios, server-generated keys and ownership. Reject SVG, HTML, archives and mismatched declared MIME. Canvas output normally removes source metadata, but header/type checks do not fully decode or sterilize a hostile image. Keep originals private, serve derivatives from an isolated origin with `nosniff`, and require alt text and rights.

Do not add Sharp, Cloudflare Images, a WASM codec or an image proxy to the baseline. Sharp is unsupported on Workers. A WASM encoder adds large code and CPU risk against Free's 10 ms budget. Cloudflare Images remains a separately cost-approved post-launch choice.

## Owner statistics

Orders, revenue and customers come from the database. Traffic comes from Cloudflare's GraphQL Analytics API with a server-only least-privilege token. The documented selected-dataset example uses `httpRequestsAdaptiveGroups.sum.visits`; use it only after P06 introspects the account's schema and entitlement. A second bounded query may group `dimensions.clientRequestPath` by request count, filtered to `requestSource: "eyeball"`, the production hostname and an explicit UTC range. P06 must first prove a response content-type/status filter in that account, then include HTML success responses and exclude admin, API, asset and health paths. Label the result "most requested public pages". If fields or filters are absent, data is delayed or unauthorized, or any `avg.sampleInterval > 1`, the exact KPI is unavailable. Never present sampled figures as exact or turn missing into zero.

## UI, reader, commerce and booking choices

| Keep | Why | Not selected |
|---|---|---|
| Custom admin on the main tokens, Radix for dialogs, React Aria only for gaps | Smallest surface matching the site. React Aria is Apache-2.0; preserve notices. | Dashboard templates, Tailwind, Base UI. |
| Patched `pdfjs-dist` plus direct `page-flip` | Maintained PDF.js; direct page-flip gives physical RTL ordering. Lazy-load both with an accessible static fallback. | `react-pageflip` (stale wrapper), Three.js. |
| Moyasar hosted invoice + server fetch verification | Official evidence covers invoice creation, webhook token, status, fetch, refunds, test/live separation and Apple Pay registration. Card data never touches the app. | Stream (changing gateway reopens payment proof), Medusa/Saleor (second commerce service). |
| Booking tables/functions plus `ics` | One Riyadh calendar, DB exclusion, holds, exceptions and a private one-way feed need little code. | Cal.com, `ical.js` unless import becomes approved scope. |
| `@dnd-kit` for the P12 board | Pointer, touch and keyboard sensors; RTL mapping and a move menu are ours to add. | Hand-built drag engine. |

## Operations and security

Sentry Free for checkout, webhook and scheduler failures, replay disabled, `beforeSend` scrubbing tokens, bodies, payment payloads, emails and addresses. One UptimeRobot Free HTTPS check against a read-only health endpoint; it is neither an SLA nor proof of payment correctness.

Development runs on the local Supabase stack, Workers Free, R2 Free, Resend Free and Turnstile Free. Free allocations are test envelopes, not launch economics. Workers Free allows 10 ms CPU per invocation. Live orders wait for explicit recurring-cost approval, a non-pausable database with backups, and measured Worker headroom (E07).

Exact-version advisory checks do not cover every transitive package or future disclosure. Commit the lockfile, run dependency, secret and SAST checks, and review Next/Supabase advisories at each release.

Provider evidence captured during planning is under `evidence/` (Moyasar, Cloudflare, Supabase, Resend, Turnstile, PDF.js, page-flip, iCalendar).
