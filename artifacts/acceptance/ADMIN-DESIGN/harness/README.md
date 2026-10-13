# Admin screenshot harness (anas.studio)

Every admin screen of the site, drawn in a real Chromium with all of its Supabase calls answered by mock data, so the
admin can be seen, redesigned and compared without a database, a Supabase stack or a login. It is tooling only: it
changes nothing in the product and never touches the repository it was copied from.

Paths below are relative to the folder that holds `harness/` (call it H). Written against commit `66c5744` and used through the D49 redesign (its record is `../README.md`); point it at any copy of the site. Everything here is plain Node (ESM, Node 20 or later, no
dependencies of its own): it borrows Playwright, Chromium's launcher and `sharp` from the `node_modules` of the site
copy it is pointed at.

## Run it again (one command)

```
node harness/shoot.mjs --site <site-copy> --label <label> [--only <screen>[,<screen>|<prefix>*]] [--widths 360,1440]
```

`<site-copy>` is a checkout of the site with its dependencies installed (`pnpm install --frozen-lockfile` in it). Run it
on a copy, never on a working tree you are editing: `next dev` writes `.next/harness/` there and may touch
`next-env.d.ts`/`tsconfig.json`. The command starts `next dev` on port 3210 (own dist folder, so it shares nothing with
`pnpm build`), shoots, writes the report, and stops the server again (the log is `harness/dev-server.log`). A whole run
(62 screens x 2 widths = 124 shots) takes about 3 minutes.

| option | meaning |
|---|---|
| `--site <dir>` | the site copy (default `../site`) |
| `--label <name>` | the run's name: shots go to `../shots/<label>/` (default `run`) |
| `--only a,b,home*` | only these screens (exact ids or a `prefix*`); the report of the label is updated, not replaced |
| `--widths 360,1440` | the viewport widths (heights 800 and 900) |
| `--list` | print the screen ids, roles and paths, and exit |
| `--lenient` | settle on calls + quiet + no «يحمّل...» only: skip the heading and selector checks (use it after a redesign renames headings) |
| `--eval '<js>'` | run an expression in each settled page; the value is printed and kept in the report (`eval`) |
| `--no-slices` | do not cut tall pages into slices |
| `--port 3210` / `--reuse` | another port / use a server that is already running on it |
| `--now <iso>` | the fixed clock (default `2026-10-08T10:30:00+03:00`) |
| `--out <dir>` | where `shots/` and `harness/report.json` go (default: the folder above `harness/`) |
| `--env KEY=VALUE` | one more environment variable for `next dev` (repeatable; `NEXT_PUBLIC_AUTH_GOOGLE=on` shows the Google button) |
| `--ui-lang en-US` | the browser's own language; with `ar` Chromium draws the native date fields' placeholders letter-reversed |
| `--chromium <path>` | a Chromium executable (default: Playwright's own, else `$PLAYWRIGHT_BROWSERS_PATH/chromium`) |
| `--strict` | exit 1 when a shot did not settle |
| `--height <px>` | the viewport height for every width (default 800 below 800 wide, else 900) |
| `--scrollbars` | draw classic scrollbars, as Windows does (headless Chromium hides them) |
| `--delay <ms>` | wait this long after a screen settles, before the eval and the shot (the five dialogs are shot with `--delay 1500`) |

Other tools: `node harness/selftest.mjs --site <dir>` checks the mock layer without a browser;
`node harness/summary.mjs --label <label>` prints the report as a Markdown table;
`node harness/compare.mjs --a before --b after` compares two runs (identical shots are byte-identical: the runs are
deterministic) and writes red-overlay diffs of the changed ones to `shots/diff-<a>-<b>/`.

## What you get

- `shots/<label>/<screen>-360.png` and `-1440.png`: full-page screenshots (deviceScaleFactor 1). Dialogs are shot at the
  viewport (`viewportOnly`), because a modal sits in the viewport.
- `shots/<label>/slices/<screen>-<width>.NN.png`: tall pages cut into 1500px (360) or 1000px (1440) slices, because an
  image viewer shrinks a 360x9000 picture to nothing. Pages taller than 15000px are shot in bands and stitched.
- `shots/<label>/report.json` (also copied to `harness/report.json` as the latest run). Per screen and width: `settled`,
  `problems` (why not), `consoleErrors` (each tagged `app`, `expected`, `unmocked` or `blocked-external`), `pageErrors`,
  `unmocked` (calls the mock could not answer: a 501, logged here), `blockedExternal`, `badResponses` (4xx/5xx from the
  dev server), `overflowPx` (`documentElement.scrollWidth - innerWidth`) with the five widest `offenders`, `pageHeight`,
  `imageWidth` (wider than the viewport when the page overflows sideways), `flags` (error phrases such as «تعذّر» or a role gate showing up unexpectedly: a wrong mock if the screen should be
  healthy), `slices`, `ms`. `summary` lists what needs attention.

A screen is `settled` when every call it must make has been answered, the network has been quiet for 0.5 s, its heading is
visible (`h1` in `lib/screens.mjs`), no «يحمّل...» is left, fonts and pictures have loaded (lazy images are forced eager
for the shot), and any `waitText` / `waitSelector` it declares is there.

## How the mock works

- The session is seeded before any page script (`context.addInitScript`: `localStorage['sb-mock-auth-token']`, an unsigned
  JWT with `aal2`, a verified TOTP factor on the user) and the clock is fixed (`context.clock.setFixedTime`), so the
  shots are deterministic and "3 hours ago" never changes.
- `https://mock.supabase.invalid/**` is routed to the mock (`lib/mock.mjs`): `/auth/v1/*`, `/rest/v1/<table>`,
  `/rest/v1/rpc/<fn>`, `/functions/v1/<fn>`, `/storage/v1/*`. The REST part (`lib/postgrest.mjs`) honours `select` (with
  embeds), `eq/neq/gt/gte/lt/lte/like/ilike/is/in/not/or`, `order`, `limit/offset`, `Prefer: count=exact` with
  `Content-Range` (also for `HEAD`), the single-object `Accept`, and plain inserts/updates/deletes.
  Everything else is answered 501 and logged. `challenges.cloudflare.com` gets an empty script (the sign-in's Turnstile never
  loads, so its send button stays off, as it would offline); every other host is blocked and listed.
- Storage images (`/storage/v1/object/public/media-public/m/<id>/<width>.webp`) are the repository's own photos from
  `public/images/` (the library's 25 rows are Arabic-named; the book cover is the first, so it is the one selected).
- Data (`lib/data.mjs`): the repository's `content/initial-content.json` for the rooms, scenes and site settings; five posts
  (live, unpublished changes, draft, overdue schedule, future schedule); the book «خوص | حكايات شارع 4» with its three
  editions, the moonlight cup (a preorder edition too), twelve orders in mixed states (halalas, Riyadh times, order numbers
  in the app's alphabet), a paid order with a refund, a dispute, a requested return and a log, a paid order that needs
  resolution (open review payment, a chargeback decided in two steps), the reconciliation lists, mail problems, job runs
  (one failed), a failing cron line, stats, settings, four team members (one revoked).
- Roles and scenarios (`lib/world.mjs`): each screen gets its own copy of the data for its role (`owner`, `editor`,
  `operations`). Scenario flags: `ordersEmpty`, `failRpc: {<rpc>: <status>}`, `noFactors`, `mailClean`, `stepUp` (the team
  invitation asks for a code), `failStats`.

Answered: tables `staff`, `content_documents`, `content_versions`, `published_documents`, `media`, `products`,
`product_variants`, `shipping_rates`, `coupons`, `customers`, `notifications`, `audit_events`; RPCs `current_staff_role`,
`orders_list`, `orders_alerts`, `order_detail`, `reconciliation_list`, `disputes_list`, `outbox_attention`, `outbox_due_since`,
`payments_due_since`, `outbox_replay`, `outbox_close`, `job_runs_latest`, `cron_failures_recent`, `commerce_settings_get`,
`staff_directory`, `variant_admin_info`, `media_where_used`, `media_product_usage`, `media_rename_folder`,
`fulfillment_update`, `fulfillment_correct`, `return_decide`, `return_receive`, `order_resolve`, `review_close`,
`publish_version`, `schedule_version`, `cancel_schedule`, `archive_document`; Edge Function `admin` actions `stats`, `status`,
`commerce-settings-save`, `commerce-policies-approve`, `commerce-checkout-set`, `media-ticket`, `media-complete`,
`media-delete`, `paid-file-ticket`, `paid-file-complete`, `payment-recheck`, `refund-create`, `refund-recheck`,
`refund-record-external`, `dispute-record`, `order-link-reissue`; `staff-admin` (`invite`, `set_role`, `set_active`); auth
`user`, `token`, `logout`, `otp`, `verify`, `settings`, MFA `factors` (enrol, challenge, verify, unenroll); signed uploads.
Not mocked (501 and logged if a screen ever makes them): Google sign-in (`/auth/v1/authorize`), Realtime.

## Extend it

- A screen: add an entry to `lib/screens.mjs` (`id`, `path`, `role`, `h1`, `calls`, optional `steps`, `scenario`,
  `viewportOnly`, `allowText`, `expectConsole`). `calls` are `rest:<table>`, `rpc:<fn>`, `function:<fn>:<action>`,
  `auth:<METHOD path>`.
- Data: `lib/data.mjs` (the fixtures; plain JSON, shaped for the strict parsers in `src/lib/admin-orders.ts` and
  `admin-commerce.ts`). Behaviour per role and scenario: `lib/world.mjs`. A new RPC or action is one function there.
- After a redesign, `steps` can break (they click by accessible name and a few class fragments such as `mediaTile`): the
  shot is still taken and `problems` says `step failed`; adjust the step. If headings were renamed, run with `--lenient`.
- A wrong mock shows as a screen that says «تعذّر التحميل», a role gate, or `unmocked` in the report: fix the mock, not the app.

## Caveats

- `next dev` compiles each route on first visit; the first run in a fresh copy is slower.
- Native widgets (date inputs, the file chooser) follow the browser UI language, `en-US` by default: they read
  `mm/dd/yyyy` and «Choose File» in the shots. That is the browser, not the app.
- The Next dev indicator is hidden by CSS for the shot; lazy images are made eager first.
- `settled` says the page stopped changing and showed what it should; it does not judge the design.
- The harness was run with Chromium 141 (`/opt/pw-browsers`), driven by Playwright 1.63 from the site's `node_modules`.

## Findings on the `before` run

Observed with correct data; nothing was fixed (the app was not touched).

1. **360px horizontal overflow on the long content forms**: `content-rooms-edit-built` 79px, `content-site-settings-edit` 64px,
   `content-rooms-edit-book` 45px, `content-scenes-edit` 26px. No other screen overflows at 360 or at 1440. All the
   overflowing elements stick out on the left (x < 0), none on the right. Cause, proved in the page (an injected
   `fieldset { min-inline-size: 0 }`, nothing saved, takes all four to 0px): the nested `fieldset` groups keep their default
   `min-inline-size: min-content`, so they never shrink to the 328px column and each level adds its padding. Chromium
   captures such pages wider than the viewport (386 to 439px; `imageWidth` in the report), and their slices are as wide as the picture.
2. **Everything else settles clean**: no unexpected console error, no page error, no 4xx from the dev server, no external
   request. The only console errors are the two provoked ones (tag `expected`): the 500 of `orders-failed` and the 403 of
   `team-step-up-dialog`.
3. Reads oddly but by design: the owner home lists a failed scheduled publish as «المقالات: <document id>» (no title); an
   order's log prints each summary as raw JSON; the three-row nav at 360 takes about 180px before the heading on every
   screen; the list screens' «جديد» button is stretched over the whole table width.
4. Harness-side, not the app: the Turnstile widget never loads, so `sign-in` shows an empty area and a disabled send button
   (`sign-in-widget` and `sign-in-code` use a placeholder box); the native date inputs read `mm/dd/yyyy`.

## The screens

| screen | role | path | what it shows |
|---|---|---|---|
| `home` | owner | `/admin` | Owner home with every section filled. |
| `home-editor` | editor | `/admin` | Editor role: the nav and the sections differ. |
| `home-operations` | operations | `/admin` | Operations role. |
| `content` | owner | `/admin/content` | The content collections (tiles). |
| `content-rooms` | owner | `/admin/content/rooms` | The five rooms with their states. |
| `content-rooms-edit-built` | owner | `/admin/content/rooms/edit?id=built` | The long room form (unpublished changes). |
| `content-rooms-edit-book` | owner | `/admin/content/rooms/edit?id=book` | A room with a pending schedule. |
| `content-posts` | owner | `/admin/content/posts` | Posts in mixed states: live, unpublished changes, draft, overdue and future schedule. |
| `content-posts-edit` | owner | `/admin/content/posts/edit?id=<uuid>` | A live post: rich text, taxonomies, cover, publish bar, version history. |
| `content-posts-edit-overdue` | owner | `/admin/content/posts/edit?id=<uuid>` | A post whose schedule time has passed. |
| `content-site-settings` | owner | `/admin/content/site_settings` | The one site-settings document, listed. |
| `content-site-settings-edit` | owner | `/admin/content/site_settings/edit?id=site` | The longest form: nav, footer, home, SEO, contact, socials, contact page. |
| `content-taxonomies` | owner | `/admin/content/taxonomies` | Categories and tags, with the new-slug field. |
| `content-taxonomies-edit` | owner | `/admin/content/taxonomies/edit?id=places` | One taxonomy (a category). |
| `content-policies` | owner | `/admin/content/policies` | The four policy documents (one never published). |
| `content-policies-edit` | owner | `/admin/content/policies/edit?id=store` | A policy: title and rich text, with the approval warning. |
| `content-scenes` | owner | `/admin/content/scenes` | The scenes gallery document, listed. |
| `content-scenes-edit` | owner | `/admin/content/scenes/edit?id=gallery` | The gallery: 19 photos as repeating groups. |
| `media` | owner | `/admin/media` | Library grid with the first image selected (details, where-used). |
| `store` | owner | `/admin/store` | The store tiles, with the demo-data line. |
| `store-products` | owner | `/admin/store/products` | Five products (one demo, one draft, one archived). |
| `store-products-edit` | owner | `/admin/store/products/edit?id=<uuid>` | A product with its variants listed below. |
| `store-variants-edit-ebook` | owner | `/admin/store/variants/edit?id=<uuid>&product=<uuid>` | A digital variant with its paid file. |
| `store-variants-edit-preorder` | owner | `/admin/store/variants/edit?id=<uuid>&product=<uuid>` | A preorder variant. |
| `store-shipping-rates` | owner | `/admin/store/shipping-rates` | Nine city rates (one unpriced, one switched off). |
| `store-shipping-rates-edit` | owner | `/admin/store/shipping-rates/edit?id=<uuid>` | A city rate form. |
| `store-coupons` | owner | `/admin/store/coupons` | Three coupons (percent, fixed, expired). |
| `store-coupons-edit` | owner | `/admin/store/coupons/edit?id=<uuid>` | A coupon form with its product scope. |
| `store-customers` | owner | `/admin/store/customers` | Customers with their «طلباته» links. |
| `store-customers-edit` | owner | `/admin/store/customers/edit?id=<uuid>` | A customer: read-only email, editable name and phone. |
| `store-notifications` | owner | `/admin/store/notifications` | Availability sign-ups (a read-only list). |
| `store-editor` | editor | `/admin/store` | Role gate: editors see nothing of the store. |
| `orders` | owner | `/admin/orders` | Twelve orders in mixed states. |
| `orders-operations` | operations | `/admin/orders` | Operations role: no reconciliation link. |
| `orders-empty` | owner | `/admin/orders` | Empty state: orders_list answers no rows. |
| `orders-failed` | owner | `/admin/orders` | Failed state: orders_list answers 500. |
| `orders-view` | owner | `/admin/orders/view?id=<uuid>` | Paid order: items, payment, shipping, files, return, refund, dispute, log. |
| `orders-view-resolution` | owner | `/admin/orders/view?id=<uuid>` | Paid but needs resolution: open review payment, chargeback in two steps. |
| `orders-view-operations` | operations | `/admin/orders/view?id=<uuid>` | Operations role: no money controls, disputes or log. |
| `orders-reconciliation` | owner | `/admin/orders/reconciliation` | Every section with rows. |
| `media-upload-dialog` | owner | `/admin/media` | The upload dialog, open. |
| `media-delete-dialog` | owner | `/admin/media` | The delete confirmation of an image that is used nowhere. |
| `media-picker-dialog` | owner | `/admin/content/posts/edit?id=<uuid>` | The library picker opened from a post cover. |
| `email-replay-dialog` | owner | `/admin/email` | Confirmation before replaying mail that may already have been delivered. |
| `orders-view-refund-confirm` | owner | `/admin/orders/view?id=<uuid>` | The refund form filled in, at its confirmation step. |
| `orders-view-dispute-form` | owner | `/admin/orders/view?id=<uuid>` | The «تسجيل اعتراض» form, open. |
| `team-step-up-dialog` | owner | `/admin/team` | An invitation asks for a fresh authenticator code (the step-up dialog). |
| `content-posts-new` | owner | `/admin/content/posts/edit?id=<uuid>` | A new post: the empty form (no publish bar, no history). |
| `store-products-new` | owner | `/admin/store/products/edit?id=new` | A new product: the empty form. |
| `email` | owner | `/admin/email` | Mail problems listed. |
| `stats` | owner | `/admin/stats` | The store figures for 30 days and the visits. |
| `settings` | owner | `/admin/settings` | Commerce settings, site state, socials. |
| `security` | owner | `/admin/security` | TOTP enrolled. |
| `security-enroll` | editor | `/admin/security` | No authenticator yet: the enrolment step with a placeholder QR. |
| `team` | owner | `/admin/team` | Four members, one revoked. |
| `team-editor` | editor | `/admin/team` | Role gate: owner only. |
| `gate-error` | owner | `/admin` | The shell's gate when the role cannot be read (`current_staff_role` answers 500). |
| `sign-in` | owner | `/admin/sign-in` | Signed out. Turnstile cannot load here, so the send button stays off. |
| `sign-in-widget` | owner | `/admin/sign-in` | Signed out, with a 300x65 placeholder where Cloudflare's widget would be (the real one is never loaded); the send button is on. |
| `sign-in-code` | owner | `/admin/sign-in` | The second step of the sign-in: the 8-digit code. |
| `preview-built` | owner | `/admin/preview?collection=rooms&id=built` | Draft preview of a room, drawn with the public view. |
| `preview-post` | owner | `/admin/preview?collection=posts&id=<uuid>` | Draft preview of a post. |

## The `before` run (61 screens; `gate-error` was added later and shot on its own)

Report: `shots/before/report.json`. Overflow is `scrollWidth - innerWidth`; "expected" console errors are the two provoked ones.

| screen | role | settled 360 | settled 1440 | console errors (app / expected) | page errors | unmocked | overflow 360 | overflow 1440 | height 360 px |
|---|---|---|---|---|---|---|---|---|---|
| home | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1464 |
| home-editor | editor | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| home-operations | operations | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 983 |
| content | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 860 |
| content-rooms | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 888 |
| content-rooms-edit-built | owner | yes | yes | 0 / 0 | 0 | 0 | 79px | 0px | 11274 |
| content-rooms-edit-book | owner | yes | yes | 0 / 0 | 0 | 0 | 45px | 0px | 12961 |
| content-posts | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 938 |
| content-posts-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 2484 |
| content-posts-edit-overdue | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 2081 |
| content-site-settings | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| content-site-settings-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 64px | 0px | 14331 |
| content-taxonomies | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1132 |
| content-taxonomies-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 996 |
| content-policies | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| content-policies-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1550 |
| content-scenes | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| content-scenes-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 26px | 0px | 11467 |
| media | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 4541 |
| store | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 896 |
| store-products | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1280 |
| store-products-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 2278 |
| store-variants-edit-ebook | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1290 |
| store-variants-edit-preorder | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1464 |
| store-shipping-rates | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1956 |
| store-shipping-rates-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| store-coupons | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 936 |
| store-coupons-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1223 |
| store-customers | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 2804 |
| store-customers-edit | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| store-notifications | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1248 |
| store-editor | editor | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| orders | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 4150 |
| orders-operations | operations | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 3994 |
| orders-empty | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| orders-failed | owner | yes | yes | 0 / 2 | 0 | 0 | 0px | 0px | 826 |
| orders-view | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 5856 |
| orders-view-resolution | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 5131 |
| orders-view-operations | operations | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 3786 |
| orders-reconciliation | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 4295 |
| media-upload-dialog | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 3526 |
| media-delete-dialog | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 4497 |
| media-picker-dialog | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 2484 |
| email-replay-dialog | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 2426 |
| orders-view-refund-confirm | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 5376 |
| orders-view-dispute-form | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 6628 |
| team-step-up-dialog | owner | yes | yes | 0 / 2 | 0 | 0 | 0px | 0px | 1748 |
| content-posts-new | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1791 |
| store-products-new | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1555 |
| email | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 2426 |
| stats | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1515 |
| settings | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 2561 |
| security | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| security-enroll | editor | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| team | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1748 |
| team-editor | editor | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| sign-in | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| sign-in-widget | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| sign-in-code | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 800 |
| preview-built | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 6623 |
| preview-post | owner | yes | yes | 0 / 0 | 0 | 0 | 0px | 0px | 1704 |

122/122 shots settled; unmocked calls: none

## Files

`shoot.mjs` (the run), `selftest.mjs`, `summary.mjs`, `compare.mjs`, `lib/screens.mjs`, `lib/data.mjs`, `lib/world.mjs`,
`lib/mock.mjs`, `lib/postgrest.mjs`, `lib/images.mjs`, `lib/util.mjs`, `report.json`, `dev-server.log`.
