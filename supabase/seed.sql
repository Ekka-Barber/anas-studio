-- Local development only. `supabase db reset` runs this file against the
-- local Docker stack; it is never applied to the hosted project (do not use
-- `supabase db push --include-seed`). The hosted app_server password is set
-- by the owner out of band and lives only in the Hyperdrive configuration.
alter role app_server with password 'app_server_local_only';

-- Scheduled publishing (P04): where publish_due() posts revalidation requests.
-- Local values only; `next dev` on the host is reached from the database
-- container through host.docker.internal. The hosted project gets its own
-- values from the owner (I28), never these.
select vault.create_secret('http://host.docker.internal:3000', 'site_url');
select vault.create_secret('local-revalidate-secret-not-for-production', 'revalidate_secret');
