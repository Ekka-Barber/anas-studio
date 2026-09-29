-- C05: the scenes become a content collection (drafts, versions, publishing),
-- with one fixed document, `gallery` (src/admin/collections/scenes.ts).
--
-- Nothing else is per collection: the doc id check, the RLS on
-- content_versions and published_documents, the publishing functions, the
-- rebuild request and the media usage checks all take any collection.
-- archive_document refuses it, like the rooms and the site settings: the
-- gallery stays live once published. The policy approval is policies only.
alter type public.content_collection add value if not exists 'scenes';
