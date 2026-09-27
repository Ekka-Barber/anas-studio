-- P06 round 3: two pg_cron jobs gain a trail on the owner home.
--
-- 1. I34: the Pages deploy hook call is no longer fire-and-forget. The id
--    `net.http_post` returns is kept; the next run reads pg_net's answer
--    (kept about six hours), records the attempt in finance.job_runs as
--    `site_build`, and re-arms a failed call so the build is not lost.
-- 2. I29: media housekeeping. Storage has no lifecycle rules, so parts left
--    under `quarantine/` by an upload that never completed, and old upload
--    tickets, are removed once a day. Storage refuses direct deletes from
--    storage.objects (and one would orphan the stored bytes), so the objects
--    go through the Storage API in the `media_sweep` job of the `outbox`
--    function; SQL only lists them and purges the ticket rows.

-- 1. Rebuild delivery -------------------------------------------------------

alter table finance.site_builds
  add column request_id bigint,
  add column failures integer not null default 0;

-- A failed call is retried at most this many times in a row; after that the
-- owner home shows it as failed and the next publish tries once more. A dead
-- hook is therefore not called every minute forever.
create or replace function public.site_build_trigger()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.site_builds;
  v_hook text;
  v_answered boolean;
  v_status integer;
  v_timed_out boolean;
  v_error text;
  v_ok boolean;
begin
  select * into v_row from finance.site_builds where id = 1 for update;

  -- The last call's outcome, before any new call.
  if v_row.request_id is not null then
    select r.status_code, r.timed_out, r.error_msg into v_status, v_timed_out, v_error
    from net._http_response r where r.id = v_row.request_id;
    v_answered := found;
    -- pg_net answers within seconds (15 s timeout); after ten minutes with no
    -- answer the call is treated as lost.
    if not v_answered and v_row.triggered_at > now() - interval '10 minutes' then
      return false;
    end if;
    v_ok := v_answered and v_status between 200 and 299 and not coalesce(v_timed_out, false);
    insert into finance.job_runs (job, status, detail, started_at)
    values (
      'site_build',
      case when v_ok then 'ok' else 'failed' end,
      jsonb_strip_nulls(jsonb_build_object(
        'httpStatus', v_status,
        'timedOut', case when v_timed_out then true end,
        'error', left(v_error, 200),
        'noAnswer', case when not v_answered then true end,
        'attempt', v_row.failures + 1
      )),
      v_row.triggered_at
    );
    if v_ok then
      update finance.site_builds set request_id = null, failures = 0 where id = 1;
    else
      -- Re-arm: `triggered_at = null` makes the owed build due again.
      update finance.site_builds
      set request_id = null,
          failures = v_row.failures + 1,
          triggered_at = case when v_row.failures + 1 < 5 then null else triggered_at end
      where id = 1;
    end if;
    select * into v_row from finance.site_builds where id = 1;
  end if;

  if v_row.requested_at is null then
    return false;
  end if;
  if v_row.triggered_at is not null
     and (v_row.triggered_at >= v_row.requested_at or v_row.triggered_at > now() - interval '2 minutes') then
    return false;
  end if;
  select decrypted_secret into v_hook from vault.decrypted_secrets where name = 'pages_deploy_hook';
  if v_hook is null then
    return false;
  end if;
  update finance.site_builds
  set request_id = net.http_post(url := v_hook, body := '{}'::jsonb, timeout_milliseconds := 15000),
      triggered_at = now()
  where id = 1;
  return true;
end
$$;

revoke all on function public.site_build_trigger() from public, anon, authenticated;

-- 2. Media housekeeping ---------------------------------------------------

-- Quarantine objects older than a day, oldest first. A completed or failed
-- upload removes its own parts, so what is left belongs to a ticket that
-- expired (five minutes) before completion.
create function public.media_sweep_candidates(p_limit integer)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.name), '{}')
  from (
    select o.name
    from storage.objects o
    where o.bucket_id = 'media-private'
      and o.name like 'quarantine/%'
      and o.created_at < now() - interval '1 day'
    order by o.created_at
    limit least(greatest(coalesce(p_limit, 1), 1), 1000)
  ) s
$$;

-- Ticket rows older than a day. Every ticket expires five minutes after it
-- is created, so none of these can still accept parts or complete, and only
-- open, unexpired tickets count toward the per-actor upload limit.
create function public.media_tickets_purge()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.media_upload_tickets where created_at < now() - interval '1 day' returning 1
  )
  select count(*)::integer from gone
$$;

-- Calls the `outbox` function's media_sweep job once a day. Without the
-- Vault values (the local stack) it does nothing.
create function public.media_sweep_kick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_secret';
  if v_url is null or v_secret is null then
    return false;
  end if;
  perform net.http_post(
    url := v_url || '/outbox',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{"job": "media_sweep"}'::jsonb,
    timeout_milliseconds := 15000
  );
  return true;
end
$$;

select cron.schedule('media-sweep', '41 3 * * *', 'select public.media_sweep_kick()');

revoke all on function public.media_sweep_candidates(integer) from public, anon, authenticated;
revoke all on function public.media_tickets_purge() from public, anon, authenticated;
revoke all on function public.media_sweep_kick() from public, anon, authenticated;
grant execute on function public.media_sweep_candidates(integer) to service_role;
grant execute on function public.media_tickets_purge() to service_role;
