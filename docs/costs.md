# Operating costs (P06)

Every figure below was read from the vendor's own page on 2026-09-27; the source is linked on each row. Nothing here is an estimate or a quote. Prices change, so re-read the sources before E07 and before each renewal. Alerts are not spending caps (ARCHITECTURE).

## What the site uses today

The site launches before payments (D34) on free plans. At the current scale the only recurring charge is the domain.

| Service | What it does here | Plan now | Price now | Limits that matter | Source |
|---|---|---|---|---|---|
| Cloudflare Pages | Serves the static site (D32); rebuilt by the deploy hook after a publish | Free | $0 | 500 builds per month, 1 build at a time, 20-minute build timeout, 20,000 files per site, 25 MiB per file, 100 custom domains per project. The site runs no Pages Functions, so no Workers usage is billed. | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Supabase | Database, Auth, Storage, Edge Functions, pg_cron | Free | "from $0/month" | 500 MB database, 5 GB egress (+5 GB cached), 1 GB file storage, 50 MB per file, 50,000 monthly active users, 500,000 Edge Function invocations. "Free projects are paused after 1 week of inactivity. Limit of 2 active projects." Automatic backups: "Not included" (hence D35). | [Supabase pricing](https://supabase.com/pricing) |
| Resend | Sends the contact notices and, once hosted, the sign-in codes (I28) | Free | "$0/mo" | 3,000 emails per month, 100 per day, 3 domains, 30-day data retention. The outbox reserves the last 20 of each day (DAILY_QUOTA and RESERVE in `supabase/functions/_shared/outbox.ts`). | [Resend pricing](https://resend.com/pricing) |
| Cloudflare Email Routing | Forwards `help@anas.studio` to Anas's mailbox (D31) | Included in the Cloudflare plan | $0: Cloudflare lists Email Routing on its Free plan, and "Sends to verified destination addresses are always free" | 200 rules per domain, 200 destination addresses per account, 25 MiB per incoming message. | [Email Routing](https://developers.cloudflare.com/email-routing/), [limits](https://developers.cloudflare.com/email-routing/limits/) |
| Domain `anas.studio` | The canonical domain (D25) | Cloudflare Registrar | At cost: "You only pay what is charged by registries and ICANN", "No markup", and it renews "at the list price set by the registry" | Registered 2026-09-21, expires 2027-09-21, Cloudflare nameservers (RDAP, rdap.identitydigital.services). The `.studio` renewal amount was not on any page that could be fetched; read it in the Cloudflare dashboard (Domain Registration) before the renewal. The plan's ~120 SAR/year stays an estimate, not a quote. | [Cloudflare Registrar](https://developers.cloudflare.com/registrar/) |

## When usage or the business changes

| Trigger | Next step | Price | Source |
|---|---|---|---|
| Live orders (E07; the Free plan pauses an idle project, so no real orders on it) | Supabase Pro | "from $25/month", with "$10/month in compute credits, which covers one Micro instance"; daily backups kept 7 days | [Supabase pricing](https://supabase.com/pricing) |
| Beyond Pro's inclusions | Supabase usage | Disk: 8 GB per project, then $0.125 per GB. Egress: 250 GB, then $0.09 per GB (cached: 250 GB, then $0.03 per GB). Storage: 100 GB, then $0.0213 per GB. MAU: 100,000, then $0.00325 per MAU. Point-in-time recovery: $100 per month per 7 days of retention. | [Supabase pricing](https://supabase.com/pricing) |
| More than 100 emails a day or 3,000 a month | Resend Pro | "$20/mo" for 50,000 emails and no daily limit; $35/mo for 100,000; beyond the included volume, $0.90 per 1,000 | [Resend pricing](https://resend.com/pricing) |
| More than 500 builds a month (each publish is one build, coalesced to at most one per two minutes) | A paid Cloudflare plan | Pro raises builds to 5,000 per month and 5 at a time. The limits page lists no price; read it on Cloudflare's plans page. | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) |

## Not in this sheet

The payment gateway's fees (E02, P08), shipping, and Anas's own fee and phase shares (DECISIONS, E07) are outside it. I32 measures the real Pages build count per month once the site is hosted.
