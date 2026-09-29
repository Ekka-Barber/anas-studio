# W2: social links editable in the admin, C09 (round file: `w2.md`)

Read `brief-common.md` first.

**Why.** `PLANS/COVERAGE.md` C09 asks for the menu, the footer and the social links to be editable (P06; proof: "publish nav/order/footer/HTTPS channel changes without code"). Since D39, `SOCIAL` lives in code (`src/content/site.ts`). It feeds:
- the footer (`src/components/site/Footer.tsx`, which shows the first entry's handle);
- the contact page (`src/app/(public)/contact/page.tsx`, which shows every channel as a coloured tile).

## Build

1. **The field.** In `src/admin/collections/site-settings.ts`, add an optional list `social` (`required: false`), mirroring how the optional `seo` and `contact` groups keep the already-published document valid.
   - Items: `network` (text, the network's Arabic name), `handle` (text), `href` (text).
   - Arabic labels: `روابط التواصل`, `الشبكة`, `المعرّف`, `الرابط`.
2. **Validation.**
   - At publish (the strict schema, as the contact rules do):
     - `href` must be an absolute `https:` URL, so `http:`, `javascript:`, `data:` and relative links are refused;
     - `network` and `handle` must not be empty.
   - Give an Arabic error message per rule, and export them if the admin view mirrors them, as it does for `WHATSAPP_ERROR`.
   - The stored (lenient) schema must never make a public page fail. At render time, keep only entries whose `href` is `https:`.
3. **The data.** Move the four entries from `SOCIAL` into `content/initial-content.json`, under the site settings document the import writes, byte for byte. Then:
   - remove `SOCIAL` from `src/content/site.ts` (keep `ROOM_ORDER`);
   - update that file's comment.

   Check that `scripts/import-content.mjs` imports and validates the new field, and run `pnpm db:import --force` locally.
4. **The loader.** In `src/lib/content.ts`, read the list through the existing site-settings loader (for example `getSocial()` beside `getFooter()`). The footer and the contact page use it.
   - An empty list is truthful: the footer shows no handle, and the contact page shows no channels block.
   - No fallback to hard-coded values.
   - The footer keeps showing the first entry, as now.
5. **The admin.** The generic settings form (`src/components/admin/`) must render the list (add, remove, reorder) through the existing list renderer. Verify it in the browser at 360 and 1440, with one screenshot each, saved in `artifacts/acceptance/CLEANUP-1/`.
6. **No visual change** to the footer or the contact page.

## Tests

- **Unit:**
  - the old published document without `social` still validates;
  - `http:`, `javascript:` and relative `href`s are refused at publish;
  - the four real entries pass;
  - the render filter drops a non-https entry.
- **e2e,** following the existing `tests/e2e/cms.spec.ts` pattern for editing and publishing site settings. The owner:
  - changes one channel's handle and link;
  - adds a fifth channel and reorders them;
  - publishes.

  Then, on the dev server, the public contact page and the footer show the change, with no code change. Revert the data at the end of the test, as the existing CMS tests do.
- **Run:** `tests/e2e/cms.spec.ts` and `tests/e2e/public.spec.ts`.
