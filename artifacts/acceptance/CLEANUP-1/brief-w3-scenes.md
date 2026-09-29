# W3: the scenes as an admin collection, C05 (round file: `w3.md`)

Read `brief-common.md` first. W2 ran before you and may have changed `site-settings.ts`, `content.ts` and `initial-content.json`; build on what is there.

**Why.** `PLANS/COVERAGE.md` C05 asks for "categorized scenes with descriptions and rights", with the proof "scene CRUD/order/category, lightbox and Arabic alt". The plan makes the scenes a collection once their public page exists, and `/scenes` now exists (D39). Today the list is code: `SCENES` in `src/content/scenes.ts`, read by `src/app/(public)/scenes/page.tsx` → `SceneGallery`.

## Build

1. **The collection.** A new collection `scenes` in the generic content store, with one fixed document (`gallery`, the way `site_settings` has `site`).
   - It holds a list `items`: reorderable and `hideable`, like the rooms' lists in `src/admin/collections/rooms.ts`.
   - Item fields:
     - `image`: an image field (a media id, as today's ids are);
     - `category`: one of Anas's five categories, `SCENE_CATEGORIES`: أماكن · مشاريع · منتجات · رحلات · خلف الكواليس;
     - `caption`: text, which is also the tile's accessible name, «تكبير: …».
   - The categories stay fixed in code (they are Anas's own list from his brief), and publish refuses any other value.
   - If the field system has a select or choice type, use it. If not, and adding a minimal one fits the existing pattern cleanly, add it. Otherwise use a text field validated at publish, and say which you chose and why.
2. **The database.** Add a migration named `supabase/migrations/<timestamp later than 20260927180000>_scenes_collection.sql`.
   - It adds `'scenes'` to `public.content_collection`, as `20260927160000_catalog_and_checkout.sql:32` does for `'policies'`.
   - Look for anything else per collection the publish path needs: document ids, RLS, the approval hooks in `20260927170000_policy_approval.sql`. Mirror only what applies.
   - Apply it with `supabase migration up --local`.
3. **Wiring.** Update `src/admin/collections/index.ts`:
   - `Collection`, `collections`;
   - `COLLECTION_LABELS` gets `المَشاهد`;
   - `documentTitle`;
   - the fixed-document id.

   Wire whatever else the admin content screens need so the document appears under `/admin/content` and edits with the existing generic form, including the image picker.
4. **The data.** Move the 19 current items into `content/initial-content.json`, byte for byte (ids, categories, captions, order), and make `scripts/import-content.mjs` import them.
   - Remove `SCENES` from `src/content/scenes.ts`, keeping the categories and types wherever they belong now.
   - Run `pnpm db:import --force` locally.
5. **The public page.** `src/lib/content.ts` loads the published document. `/scenes` builds its `SceneItem[]` from it, keeping today's behaviour:
   - hidden items are skipped;
   - an image whose sources cannot be resolved is skipped;
   - a category with no visible photo is not offered as a filter.

   `SceneGallery` and the D39 design stay exactly as they are. With no published document, the page stays truthful: the grid is empty and says so plainly. Check the existing empty patterns, and never invent copy beyond one plain line.
6. **The admin in the browser.** Add a scene, reorder, hide one, change a category, publish. Take screenshots at 360 and 1440 into `artifacts/acceptance/CLEANUP-1/`.

## Tests

- **Unit:**
  - the schema: the categories are enforced, a hidden item is kept in the data but not rendered;
  - the page mapping keeps today's filter rules.
- **e2e** (`tests/e2e/cms.spec.ts` pattern). The owner:
  - adds a scene with an existing media image;
  - moves it first;
  - hides another;
  - publishes.

  Then the public `/scenes` on the dev server shows the new first tile with its caption, and not the hidden one. Revert at the end.
- **If the repo has DB integration tests for collections** (`tests/integration/`), add the enum and publish case there too.
- **Run:** `tests/e2e/cms.spec.ts` and `tests/e2e/public.spec.ts`, plus `tests/e2e/visual.spec.ts` for `/scenes` only if it can be filtered to it. Restore any DESIGN-B screenshots it rewrites.
