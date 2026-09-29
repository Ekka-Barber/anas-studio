# W1: small cleanup (round file: `w1.md`)

Read `brief-common.md` first.

## 1. Deno type-check of every Edge Function

P07 never ran it (`artifacts/acceptance/P07/commands.txt`, "Not run: deno check"), and CI has no Deno step.
- Reproduce the recipe P06 used (search `artifacts/acceptance/P06/commands.txt` for "deno").
  - Deno comes from npm and is installed in a temporary folder outside the repository, for example `$env:TEMP\anasaq-deno`.
  - Never add Deno to `package.json`.
  - Delete any `deno.lock` the run creates inside the repository.
- Type-check each function entry under `supabase/functions/*/index.ts`, with its `_shared` imports.
- **A real type error:**
  - fix it in `supabase/functions/**` only if the fix is obvious and changes no behaviour;
  - otherwise report it with the exact output.
- Record the exact commands and the per-function results.

## 2. The three admin `<img>` lint warnings

`pnpm lint` reports three `@next/next/no-img-element` warnings in `src/components/admin/` (MediaLibrary.tsx, MfaEnroll.tsx, FieldInput.tsx). Add the same one-line disable with a reason that the public components use (search `eslint-disable-next-line @next/next/no-img-element` under `src/components/`).
- The reason: a static export (D15, D32) has no image optimizer.
- For the MFA QR code, also note that it is a data URL.

`pnpm lint` must then report 0 problems.

## 3. I40: a build check against demo rows

Read `PLANS/ISSUES.md` "I40". The demo catalog seed (`scripts/seed-demo-catalog.mjs`, D37) is loopback-only. It gives products «(تجريبي)» names and policies the text «نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر.». A production build must never ship them.

**The rule.** Extend `scripts/check-export.mjs` so that it fails when both of these hold:
- the export in `out/` was built against a non-loopback Supabase;
- the built HTML carries demo content.

**Where the Supabase target comes from.** Read it from `out/` itself: the inlined `NEXT_PUBLIC_SUPABASE_URL` origin in the built JavaScript or HTML. Do not read the shell environment, which may differ from the build's. Loopback means:
- `localhost`, `127.0.0.1` or `[::1]`;
- or a host ending in `.localhost`.

**On a loopback build** the check passes and prints one line: that demo content is present and allowed only locally.

**Recognising demo content.**
- «تجريبي» in any built HTML page's visible text, or a product built from a row flagged demo, if the build output shows it.
- Check first that no legitimate text in `src/`, `content/` or `DESIGN.md` renders «تجريبي» on a public page. If one does, stop and report it instead of guessing.

**Structure and tests.**
- Put the decision in a small pure function (for example in `scripts/lib/`).
- Unit-test it in `tests/unit/`:
  - loopback with demo passes;
  - a hosted origin with demo fails;
  - a hosted origin without demo passes;
  - an origin that cannot be found fails with a clear message.
- The error message names the pages that carry demo text and points to I40.
- Never print keys: an origin is fine, a key is not.

**Proof.** Run `pnpm check:export` against the current `out/`. It was built locally, so it should pass with the loopback note. Show the output.

## Report

Also record in `w1.md` how `NEXT_PUBLIC_SUPABASE_URL` appears in the build, and where you found it.
