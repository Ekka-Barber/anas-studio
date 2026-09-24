-- Local development only. `supabase db reset` runs this file against the
-- local Docker stack; it is never applied to the hosted project (do not use
-- `supabase db push --include-seed`). The hosted app_server password is set
-- by the owner out of band and lives only in the Hyperdrive configuration.
alter role app_server with password 'app_server_local_only';
