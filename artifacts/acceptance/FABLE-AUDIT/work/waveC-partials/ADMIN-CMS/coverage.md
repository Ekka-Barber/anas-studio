# ADMIN-CMS coverage (2026-10-07)

Findings ADMIN-CMS-01..17 in findings.jsonl; 28 prior-fix checks; 4 doc/vendor claims; 1 plan gap.

## Read in full
- src/components/admin: AdminShell, AdminHome, CollectionForm, CollectionList, FieldInput, RichTextEditor, PublishBar,
  VersionHistory, RoomPreview, DocumentEditor, MediaLibrary, MediaUpload, MediaPicker, SettingsView, EmailView, TeamView,
  SignIn, MfaEnroll, StepUp. admin.module.css: first 140 lines + grep for :disabled/focus/direction.
- src/admin: fields.ts, richtext.ts, collections/{index,site-settings,posts,policies,taxonomies,scenes,media,rooms}.ts.
- src/lib: admin-publish.ts, content.ts, media-ref.ts, images.ts (+ journal.ts, policies.ts, format.ts, money-input.ts
  date helpers, digits.ts, supabase/browser.ts, supabase/functions.ts).
- src/app/(admin)/** every route file (layout, shell layout, content, edit, media, settings, email, team, security, preview, sign-in).
- SQL (final definitions): content_versions + trigger + policies, published_documents policies, content_documents view,
  publish_version, schedule_version, cancel_schedule, archive_document, content_go_live, publish_due, site_build_request,
  site_build_trigger, media table/grants/policies, media_usage, media_where_used, media_rename_folder, media_product_usage,
  media_delete, media ticket create/claim/complete, outbox_attention, email_outbox kinds, staff_directory.
- Edge: admin.ts mediaDelete; staff-admin refusal codes; media.ts sqlErrorToHttp.
- Libraries (installed source): @supabase/auth-js 2.117.1 signOut/__loadSession/_callRefreshToken; Lexical 0.51 clipboard
  plain-text importer and list DOM import; zod 4.6.5 default messages (reproduced with scratch scripts rt-check*.cjs).
- Public views only where the CMS data lands: Picture, weave/Figure, Story (StoryFigure), PassedRoomView, BookView, HomeView,
  home page loader, media-notes.ts.
- Tests (for claims): cms.spec.ts (helpers, post lifecycle, local-copy, conflict), media.spec.ts (round 2 + paging),
  auth.spec.ts, owner-operations.spec.ts (home counts, backup, settings).
- Prior audits: AUDIT-1 appendix rows for S08/S09/S10 + related; AUDIT-2 report and R03-R06 round files; FOUNDATION-1 report;
  wave B digest/findings (to avoid duplicates: ARCH-01, ARCH-12, ARCH-13, FIX-A1-02, FIX-A1-09, TEST-E2E-03, OPS-PRIVACY-07).

## Sampled / not reached
- CommerceSettingsForm (embedded in SettingsView): read the first 200 lines only; left to the ADMIN-COMMERCE slice.
- admin.module.css beyond line 140 (layout details at 320px) - design slices.
- owner-operations.spec.ts email-replay tests and media.spec.ts API tests: names and setup only.
- Not run: no stack, no build, no e2e (rules). Runtime claims carry proof recipes.

## Would look at next with more time
- Run the proof recipes for 01, 05, 09, 10, 13, 14, 17 on the stack.
- CSS-custom-property injection through the book photo «نقطة التركيز» field into the static HTML (React SSR style
  serialization) - trusted-editor only, not verified.
- Lexical upgrade sensitivity of equalData (stored JSON lacking new keys marks documents changed on click).
- Performance of the scenes document (one datalist of every manifest id per image field, one media fetch per library image).

## Final update
Findings ADMIN-CMS-01..20 (20 = info note on the orchestrator's uncommitted staff-admin edit, read via git diff only).
Also read: CommerceSettingsForm in full (left its money/approval logic to ADMIN-COMMERCE), src/lib/richtext.tsx renderer,
weave/Figure + VideoTile style sinks (React SSR check: ssr-style.cjs), PostView author/excerpt handling, staff-admin set_active.
The working tree is being edited by the orchestrator during this audit (supabase/functions/_shared/*, staff-admin, tests);
no file under src/ changed (git diff --stat src/ empty), so every src/ citation is against today's committed code.
