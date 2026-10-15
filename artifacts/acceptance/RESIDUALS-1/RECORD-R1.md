# RESIDUALS-1, round R1: the record

Started on the owner's word (2026-10-15: "Start the residuals round (Next work item 5): one fresh worker, Opus audit,
under the lock."). Orchestrator Claude Opus 5.5 at effort max, in Claude Code on the owner's machine (Windows 11, Node
24.19.0, pnpm 10.34.6, Supabase CLI 2.106.0, Docker Desktop, the development stack ANASAQ.ME running). Committed on
the owner's word (2026-10-15: "Yes: commit R1 on agent/residuals-1 (explicit paths only, not the .claude files), push
the branch for CI, keep the lock, then brief R2."): the code as `e4d3c9b`, these records in the commit after it, by
explicit path; the branch pushed for CI; the lock kept for R2.

## The lock and the branch

`.anasaq-execution.lock`, created with `fs.openSync('.anasaq-execution.lock', 'wx')` at 2026-10-15T09:58:56Z: package
RESIDUALS-1, round R1, base `2937c75` (`main`, in step with `origin/main`), branch `agent/residuals-1` cut from it, the
roles, `dirtyAtStart` (the owner's `.claude/launch.json` and `.claude/settings.json`, never opened, never staged) and 65
allowed paths (`brief-R1.md`, "Write only these paths", plus the orchestrator's plan files and this folder). Added before
each was written, with the reason in the lock: `tests/integration/orders-http.test.ts`,
`supabase/functions/_shared/commerce-settings.ts`, `DESIGN.md`. Every changed path is on the list.

## Scope

Item 5 is about 90 code entries once routed, so it runs as rounds (`SCOPE.md`): R1 (this one), R2 the database and
the functions, R3 the admin's screens, R4 the store, the public site, the reader, the tests and the scripts, then a
round with a browser. R1's 14 items: I44 (1); I45 (3); I50 (3) and (4); I51 (2); I55 (3), (4), (5), (8) FD-A-01 and
FD-A-02, (9); ADMIN-CMS-01; ADMIN-CMS-02; TEST-DB-02; QUALITY-09; STORE-UI-12 (= QUALITY-08).

## 1. The writer

A fresh `sonnet-worker` (Claude Sonnet 5.5, effort max) on `brief-R1.md` (the orchestrator's decided fixes, the Arabic
copy, the exact paths), 88 minutes, 434 tool calls. It built all 14 items, then handed back early, before its battery
ended, with a report of what was built, what ran and what was left (its scripts in the session's scratchpad). What it
built, by item:

1. I44 (1): `commerce_settings_get` returns `publishedPolicies` (document, title, `seq`, publish time, in the order store,
   delivery, refund, privacy); `commerce_policies_approve(uuid, integer, jsonb)` (the two-argument one dropped) refuses
   any map but the published one with `object_not_in_prerequisite_state`, mapped to 409 POLICIES_CHANGED; the store
   settings list the policies above «اعتماد السياسات» as «<title>: نُشرت <time>» and send exactly those revisions.
2. I45 (3): /contact shows «بريد التواصل», when set and valid, as a `mailto:` channel beside WhatsApp.
3. I50 (3): `checkout_create`'s refusal carries `held: true` under `checkout_price`'s rule; the checkout says the held
   sentence.
4. I50 (4): `reconciliation_list` adds `closedReviews` (no order, closed by hand, not refunded in full, the newest 50),
   shown in «دفعات بلا طلب أُغلقت مراجعتها» with «استرداد هذه الدفعة» and «تسجيل استرداد خارجي»; the open card's warning
   says where a closed one goes.
5. I51 (2): a refused line's error carries `productTitle` and `variantTitle`; the cart names the line.
6. I55 (3): the owner alert mail words `policies_reset` and `confirm_mail_braked`, each linking its own page
   (`/admin/settings`, where the approval is; `/admin/email`).
7. I55 (4): `supabase/config.toml`'s comments (comments only).
8. I55 (5): `artifacts/soon/deploy.cjs` takes the two Cloudflare variables from `.env` only (never run).
9. I55 (8): FD-A-01 (a revoke whose ban failed reads the account and keeps the revoke when it is banned); FD-A-02
   (`expectedRefunded` required on `refund-create`, every screen sends it).
10. I55 (9) and QUALITY-09: the security page names every action that asks for a fresh code; the comments; the team
    screen reads its factors through `factorReading`.
11. ADMIN-CMS-01: the editor's local copy is kept per tab (`anasaq:draft:<collection>:<id>:<tab>`).
12. ADMIN-CMS-02: a never-saved post's local copy is listed at the top of its list.
13. TEST-DB-02: the HTTP integration tests refuse an edge runtime older than `supabase/functions`.
14. STORE-UI-12: the cart says when the city list fails and offers «أعد المحاولة».

Its checks before the hand-back: lint, typecheck, `check:copy`, `check:frozen` 0; unit 2,631 passed and 39 skipped;
`test:db` 885 of 886 (`orders-http.test.ts:352`, a body without `expectedRefunded`, outside its paths); the first e2e
batch (cms, cart-checkout, public, no-js) 90 of 92, its two new tests then fixed and passed; nine unit mutations, each
caught. Its second e2e batch ended with two test failures (a locator that matched two «السبب» fields; a count of 4
that the new section made 5) and four crashes of the browser and its worker processes (exit 0xC0000142, a Windows
process-start failure; no test process was left afterwards), 67 tests not run.

## 2. The orchestrator's read

Each function the migration replaces was extracted from its previous latest definition and diffed against the new
copy (`scratchpad/fn-extract.cjs`): `commerce_settings_get` (only `publishedPolicies`), `checkout_create` (only the
`held` line), `finance.checkout_price` (only the titles), `reconciliation_list` (only `closedReviews`);
`commerce_policies_approve` read whole. FD-A-01's branch, FD-A-02's schema and hash, the approval's schema and error
mapping, `deploy.cjs` (never prints a value) and the staleness gate (`execFileSync` with an argument list, no shell)
read line by line. The two test failures fixed (`orders-money.spec.ts:1278`, `.last()` as the open-card tests do;
the count of 5 kept), and `orders-http.test.ts` sends `expectedRefunded: 0`.

## 3. The audits

Two fresh Claude Opus 5.5 auditors at effort max, read-only, one slice each (`audit-brief-R1.md`), while the
orchestrator built the export: build, `check:export` and `check:budgets` green (`checkout.html` 149.75 KiB, 254 bytes
left).

| Finding | Severity | Ruling | What was done |
|---|---|---|---|
| A1 = B2: a refused line of a draft or archived product carried its title through the public quote (RLS hides those rows from anon) | minor (A), major (B) | Accepted | `v_names` only while the product is published; the test expects no titles for a draft's variant; a disabled variant of a published product keeps its name (its product is public) |
| A2: `config.toml` cites readings of 2026-10-15 the evidence does not show | nit | Accepted | cites FABLE-AUDIT's reading of 2026-10-07 (VENDOR-PLAT-02, -03), whose words match |
| A3: the base approval schema's comment says it is the whole body | nit | Accepted | comment corrected (path added to the lock) |
| A4: the brief's "400" for a missing field; the code answers 422 INVALID | nit | Accepted as built | 422 is the functions' code for a schema refusal (400 is BAD_JSON) |
| A5: a test title says the overlapping approval approves the new seq | nit | Accepted | renamed: it is refused, and the fresh list approves |
| A6: a failed account read in FD-A-01 leaves no trace | nit | Accepted | `logCause` on an error result and on a throw |
| B1: «استرجاع» of another tab's copy left that copy, offered again after the save | major | Accepted | the restored copy's own key is removed when it is not this tab's; the e2e adds tab D (restore, save, reload: no offer, no copy left) |
| B3: the security page's sentence leaves out «تسجيل فرق» and «إضافة متابعة» (`dispute-record`) | minor | Accepted | «…وتسجيل اعتراض أو فرق أو متابعة…», and the e2e's exact text |
| B4: a long contact address widens the page at 360 | minor | Accepted | `.channel bdi { overflow-wrap: anywhere; }`; the e2e publishes a 72-character address at 360 and checks no sideways scroll |
| B5: a failed re-read after POLICIES_CHANGED blanked the settings, typed seller fields included | nit | Accepted | the screen stays, sends nothing (stale) and says «تغيّرت السياسات منذ فتحت الصفحة، وتعذّرت قراءتها من جديد. أعد تحميل الصفحة.» |
| B6: the staleness gate misses a deleted or renamed file | nit | Accepted | each folder's own time counts too |
| B7: wrangler could still sign in with another Cloudflare credential from the shell | nit | Accepted | every `CLOUDFLARE_*` and `CF_*` name of the shell is removed before `.env`'s two are set |
| B8: the client cut titles by UTF-16 units | nit | Accepted | the client takes them whole (the SQL bounds them by character); its unit test now pins an astral character |
| B9: the approval test's own cleanup cleared the approval the later screenshots need | nit | Accepted | its `finally` puts the approval and the open switch back |
| B10: the FD-A-02 unit tests pass on the base code | nit | Recorded | the client's requirement is the type: `pnpm typecheck` is its proof, and `refunds-http.test.ts` proves the 422 |
| B11: `next-env.d.ts` and the reconciliation header's "100" | nit | Accepted | `next-env.d.ts` restored after every run; the comment says 50 for the closed reviews |

Rulings on the three known items: (a) the count of 5 is right (five empty lists); (b) a locator, not the product; (c)
`expectedRefunded: 0` is the right total. What no test covers, recorded: FD-A-01's race is narrowed, not closed (owner
A's read can come before owner B's ban lands; a per-member lock would close it; ISSUES I55 (8)); a closed review card
offers no «تسجيل اعتراض» (R3 rules on it); a closed review with a null amount is not listed; a duplicated browser tab
shares its tab id; sessionStorage blocked while localStorage works leaves each restored copy behind.

The orchestrator's own design change after viewing the contact page: the email row read as a bare address among rows
that read label then value; it now reads «البريد» then the address, as the social rows do, its name from its text
(the unit and e2e assertions follow; `DESIGN.md`'s empty-content line names the email tile).

## 4. Proofs

- **SQL mutations** (`scratchpad/mutations-sql-2.json`, the writer's seven and S8 for the published-only titles), each
  applied to the local database, its test file run, and the file put back: all 8 caught (S1 4 tests failed, S2 1, S3
  3, S4 5, S5 1, S6 1, S7 1, S8 1); the real SQL applied again, the three files 159 of 159.
- **The staleness gate, live:** a fresh runtime, `notify-http.test.ts` 8 of 8; after `touch
  supabase/functions/_shared/checkout.ts` it refuses with «the edge runtime is older than supabase/functions: run
  `docker restart supabase_edge_runtime_ANASAQ.ME`»; the SQL-only `policy-approval.test.ts` 14 of 14 at the same
  moment; after the restart, 8 of 8.
- **The owner alerts on the real send path:** not shown. The local outbox keeps the provider's daily allowance (100,
  the last 5 for sign-in codes), and the day's e2e runs had spent it (94 sent, 11,029 waiting), so the two alert rows
  stayed pending and were removed. The rendering is unit-tested, and audit A traced the payload through
  `alert_email_data` and `outbox.ts`. The scratch spec that proves it (`scratchpad/shots/r1-alert.spec.ts`) is to run on
  the fresh stack of the package's acceptance battery.
- **Screenshots** (the one pass at 360 and 1440, viewed): the closed reviews' section at 360, the store settings'
  policy list at 360, the contact channels at 360 and 1440. The crowding of «اعتماد السياسات المنشورة» and the «الشراء» box
  is the local close's settings-email-1 (ISSUES I55 (2)), older than this round, for the browser round.

## 5. Checks on the final tree

- `pnpm lint`, `pnpm typecheck`, `pnpm check:copy` (233 files), `pnpm check:frozen` (50 files): 0.
- `pnpm test`: 71 files, 2,631 passed and 39 skipped.
- `pnpm test:db` (after the audit fixes, a fresh runtime): 31 files, 886 of 886 (874 at the base); after the last
  fixture change `checkout.test.ts` 60 of 60.
- e2e, the eight files the round changed (cms, cart-checkout, public, no-js, store-admin, owner-operations,
  orders-admin, orders-money; 14.9 GB free, 367 staff rows): 244 passed and 1 failed. The failure was the round's own
  test data: R1's integration fixture made product titles of 200 letters with no break, which the admin's products table
  cannot wrap at 1440 (it scrolled 67px). The fixture now uses words, the four leftover archived test products were
  retitled, and `store-admin.spec.ts` ran again: 42 of 42. The contact test after the design change: 1 of 1.
- `pnpm build`, `pnpm check:export` (59 files, no secret), `pnpm check:budgets` (largest 149.7 KiB): `checkout.html`
  149.74 KiB (263 bytes left; 342 before the round), `orders.html` 148.35, `cart.html` 147.13.

## 6. The local database

Test data only, more than before: R1's tests and runs added staff (367 rows), orders, closed review payments (the
closed section shows its cap of 50) and outbox rows (11,029 waiting). The next acceptance battery starts from
`supabase db reset` and the two imports, on the owner's word (D48).

## 7. What R1 leaves

R2 to R4 and the browser round (`SCOPE.md`); FD-A-01's narrowed race; the closed review's dispute control (R3); the
real-path alert proof at the acceptance battery. The lock stays held for R2, on the owner's word.
