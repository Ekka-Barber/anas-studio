-- I35 (2026-09-27): one predicate now decides whether the outbox job has
-- work. `finance.outbox_due_since()` is the earliest moment a row the job can
-- act on became due (null when nothing waits): a claimable `pending` row or an
-- `uncertain` row inside the 23-hour idempotency window is due since its
-- `next_at`, and a `sending` row whose lease expired is due since its
-- `lease_until` (the claim's expiry step must still flip it). An `uncertain`
-- row past 23 hours waits for a person's replay on البريد and no longer wakes
-- the function, so one stuck row cannot record a run every minute; the owner
-- home reads the same answer through the public wrapper and warns only when
-- mail has actually been waiting.

-- 1. The predicate, private (`finance` is not exposed) and invoker-owned.
create function finance.outbox_due_since()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(
    (select min(o.next_at) from finance.email_outbox o
      where o.status = 'pending' and o.next_at <= now() and o.attempts < o.max_attempts),
    (select min(o.next_at) from finance.email_outbox o
      where o.status = 'uncertain' and o.next_at <= now() and o.attempts < o.max_attempts
        and o.first_attempt_at > now() - interval '23 hours'),
    (select min(o.lease_until) from finance.email_outbox o
      where o.status = 'sending' and o.lease_until < now())
  )
$$;
revoke all on function finance.outbox_due_since() from public, anon, authenticated, service_role;

-- 2. The same answer for the owner home, behind the staff-role check that
--    `outbox_attention` uses.
create function public.outbox_due_since()
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can see the outbox.' using errcode = 'insufficient_privilege';
  end if;
  return finance.outbox_due_since();
end
$$;

revoke all on function public.outbox_due_since() from public, anon;
grant execute on function public.outbox_due_since() to authenticated;

-- 3. The kick shares the predicate with `outbox_claim` (I35). Same signature
--    and attributes as in 20260927090000_static_site_and_functions.sql; the
--    cron schedule there is untouched, and `create or replace` keeps its
--    grants. Without the Vault values it still does nothing.
create or replace function public.outbox_kick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if finance.outbox_due_since() is null then
    return false;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_secret';
  if v_url is null or v_secret is null then
    return false;
  end if;
  -- 15 s: a cold function start can exceed pg_net's 5 s default.
  perform net.http_post(
    url := v_url || '/outbox',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  return true;
end
$$;
