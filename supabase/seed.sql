-- Local development only. `supabase db reset` runs this file against the
-- local Docker stack; it is never applied to the hosted project (do not use
-- `supabase db push --include-seed`).
--
-- D32: nothing to seed. The Vault values the hosted project needs
-- (`pages_deploy_hook`, `functions_url`, `jobs_secret`) are set by the owner
-- there. Locally they stay unset on purpose: `next dev` renders live data, so
-- no rebuild is needed, and the e2e specs run the outbox themselves, so a
-- background cron cannot race them.
select 1;
