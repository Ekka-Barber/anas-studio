# W3 finish: verify and complete the scenes collection (round file: `w3.md`)

Read `brief-common.md`, then `brief-w3-scenes.md`: that is the contract. A previous worker built W3 and was cut off before its report. Its work is in the tree, uncommitted. You do not redo finished work: you check it against the brief, fill only real gaps, run every check the brief names, and write `w3.md`.

## What the earlier worker claims (verify each; none is a fact yet)

1. Migration `supabase/migrations/20260929120000_scenes_collection.sql` applied locally. (The orchestrator confirmed: it is in `supabase_migrations.schema_migrations`, and `public.content_collection` includes `scenes`.)
2. `pnpm db:import --force` ran; the published `scenes/gallery` document deep-equals `content/initial-content.json`.
3. `pnpm -s typecheck` and eslint clean.
4. Unit 427/427; integration 20/20.
5. `tests/e2e/cms.spec.ts` + `tests/e2e/public.spec.ts` 31/31; visual `/scenes` 5/5.
6. A mutation check on `tests/unit/collections.test.ts` failed as expected and was restored.

W3's files as the tree has them: `src/admin/collections/scenes.ts` (new), `src/lib/scenes.ts` (new), the migration (new), and changes in `src/admin/collections/index.ts`, `src/content/scenes.ts`, `src/app/(public)/scenes/page.tsx`, `src/lib/content.ts`, `content/initial-content.json`, `scripts/import-content.mjs`, `tests/unit/collections.test.ts`, `tests/unit/content.test.ts`, `tests/integration/content.test.ts`, `tests/integration/publish.test.ts`, `tests/e2e/cms.spec.ts`, and the screenshots `w3-*.png` in this folder. W1 and W2 changed some of the same files (`index.ts`, `site-settings.ts`, `content.ts`, `initial-content.json`, `import-content.mjs`, the tests): their parts are accepted; leave them alone.

## What to check against the brief, item by item

- The 19 items moved byte for byte: compare `git show 0f2d87a:src/content/scenes.ts` (`SCENES`) against `content/initial-content.json` (ids, categories, captions, order) with a script, not by eye.
- The categories enforced at publish (and the choice between a select type and a validated text field, with the reason, stated in `w3.md`).
- Hidden items kept in data, skipped on the page; unresolvable images skipped; empty categories not offered as filters; the truthful empty state with no published document (one plain line, existing pattern).
- `SceneGallery` and the D39 design unchanged: diff `src/components/public/scenes/**` against `0f2d87a` (expected: no change), and compare the rendered `/scenes` with the published document against today's.
- The admin: the document appears under `/admin/content`, edits with the generic form and the image picker. Exercise add, reorder, hide, change category, publish in a browser at 360 and 1440; keep or replace `w3-admin-scenes-*.png` and `w3-scenes-empty-*.png` so they show what `w3.md` says they show.
- Unit, integration (enum + publish case) and e2e tests as the brief lists them. Each test must fail if its behaviour breaks: prove it for at least the category rule and the hidden-item rule with a quick mutation, then restore.

## Environment now (the orchestrator set this up)

- Local Supabase is up. The edge runtime container had exited and was restarted; functions answer (`contact` OPTIONS 204, `admin` POST without auth 401). If a function call fails with 502/503, stop and report; do not restart the stack.
- Nothing listens on `:3000`. Playwright starts its own dev server (`NEXT_DIST_DIR=.next/e2e pnpm run dev`) and stops it. If you start one yourself for curl or screenshots, stop it when done. Either way, `next-env.d.ts` gets rewritten: restore it with `git checkout -- next-env.d.ts` at the end.
- Another session may use ports 4010, 4020 and 4021 and `BOOK_ASSETS/`. Do not touch them or `.claude/launch.json`.
- `playwright.config.ts` was changed by the orchestrator (it now accepts `ACCEPTANCE_PACKAGE=CLEANUP-1`). Do not edit it, and do not set `ACCEPTANCE_PACKAGE`: routine runs report to the git-ignored `test-results/`.

## Rules for this round

- Write only W3's paths listed above, plus `tests/e2e/public.spec.ts`, `tests/e2e/helpers.ts`, `src/components/admin/**` (only if the admin wiring truly needs it) and `artifacts/acceptance/CLEANUP-1/w3*`. Not `DESIGN.md`, not `PLANS/`, not `playwright.config.ts`, not `tests/e2e/visual.spec.ts` or `owner-operations.spec.ts`. List stale doc lines you notice (for example `DESIGN.md` §7 "Not in the CMS yet") in `w3.md` for the orchestrator.
- The migration is applied and cannot be re-applied (`supabase db reset` is forbidden). If it truly needs a change, stop and report instead of editing it.
- No `pnpm build`. No `supabase db reset`, `supabase stop` or `docker` restarts.
- Free RAM check before each e2e run; under 6 GB, stop and report.
- If `visual.spec.ts` rewrites any tracked screenshot under `artifacts/acceptance/<another package>/`, restore it with `git checkout -- <path>`.
- Leave the local content as you found it: after the e2e runs, the live `scenes/gallery` document must again deep-equal `content/initial-content.json`, and `site_settings/site` must still have its 4 `social` entries. Prove both with a query in `w3.md`.

## Report

Write `artifacts/acceptance/CLEANUP-1/w3.md` in the shape of `w2.md`: files changed; each claim above marked verified or not, with the command and its result; each command with its exit code and counts; gaps found and what you changed for each; screenshots written; not done and why; risks; product decisions needed and not taken. Return the same report as your final message, under 80 lines.
