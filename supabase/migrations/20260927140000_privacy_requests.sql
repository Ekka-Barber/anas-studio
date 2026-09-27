-- P06 round 3, step 4: the two privacy request functions the runbook calls
-- by hand from the SQL editor (I31, docs/privacy-data-map.md), and the
-- contact retention rule D36 settled.
--
-- No API role has any grant on anything here, so nothing in the app can
-- call these: the owner runs them as the migration role (the dashboard's
-- SQL editor or `supabase db query --linked`). A staff erase keeps the Auth
-- user itself, because deleting it would rewrite `audit_events.actor`,
-- which the append-only trigger refuses (I31); the address, phone,
-- metadata, sessions, identities, factors, tokens and the Auth log of their
-- own actions go, and the address leaves the Auth log entries about them and
-- the email outbox, so the surviving id no longer leads to a name or an
-- address. Both erase
-- functions are safe to repeat: a second call removes nothing and audits
-- nothing (the deletion ledger next to the backups records every call).

-- 1. A departed staff member who asked for erasure. Run after the team
--    screen's revoke left `active = false`.
create function public.privacy_erase_staff(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_total integer := 0;
  v_count integer;
  v_was_erased boolean;
  v_placeholder text := 'erased-' || p_user || '@erased.invalid';
  v_old_email text;
begin
  if exists (select 1 from public.staff s where s.user_id = p_user and s.active) then
    raise exception 'Revoke the member in the team screen first.'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'No such Auth user.' using errcode = 'no_data_found';
  end if;
  select lower(btrim(u.email)) into v_old_email from auth.users u where u.id = p_user;
  v_was_erased := v_old_email is not distinct from v_placeholder;

  -- The pending-change columns can hold an address too; Auth reads them as
  -- empty strings, not nulls.
  update auth.users
  set email = v_placeholder,
      phone = null,
      email_change = '',
      phone_change = '',
      raw_user_meta_data = '{}'::jsonb
  where id = p_user;

  -- Every Auth table with a `user_id` column for this user; the Auth log
  -- carries the user as `payload->>'actor_id'` (with the address as
  -- `actor_username`, which the row deletion removes with it).
  delete from auth.flow_state where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('flow_state', v_count);
  v_total := v_total + v_count;

  delete from auth.identities where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('identities', v_count);
  v_total := v_total + v_count;

  delete from auth.mfa_factors where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('mfa_factors', v_count);
  v_total := v_total + v_count;

  delete from auth.oauth_authorizations where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('oauth_authorizations', v_count);
  v_total := v_total + v_count;

  delete from auth.oauth_consents where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('oauth_consents', v_count);
  v_total := v_total + v_count;

  delete from auth.one_time_tokens where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('one_time_tokens', v_count);
  v_total := v_total + v_count;

  -- `refresh_tokens.user_id` is a varchar, not a uuid.
  delete from auth.refresh_tokens where user_id = p_user::text;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('refresh_tokens', v_count);
  v_total := v_total + v_count;

  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('sessions', v_count);
  v_total := v_total + v_count;

  delete from auth.webauthn_challenges where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('webauthn_challenges', v_count);
  v_total := v_total + v_count;

  delete from auth.webauthn_credentials where user_id = p_user;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('webauthn_credentials', v_count);
  v_total := v_total + v_count;

  delete from auth.audit_log_entries where payload->>'actor_id' = p_user::text;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('audit_log_entries', v_count);
  v_total := v_total + v_count;

  -- Entries where someone else acted on them (the owner's invite, a ban)
  -- stay, as that person's actions, but carry the address in
  -- `traits.user_email`: it becomes the placeholder.
  update auth.audit_log_entries
  set payload = jsonb_set(
    jsonb_set(payload::jsonb, '{traits,user_email}', to_jsonb(v_placeholder)),
    '{traits,user_phone}', '""'::jsonb
  )::json
  where payload->'traits'->>'user_id' = p_user::text
    and payload->'traits'->>'user_email' is distinct from v_placeholder;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('audit_log_redacted', v_count);
  v_total := v_total + v_count;

  -- Contact notices addressed to them: an unsent one is dropped (it can no
  -- longer reach anyone); a sent one keeps its delivery history under the
  -- placeholder. Nothing matches on a repeat call.
  delete from finance.email_outbox o
  where o.recipient = v_old_email and v_old_email <> v_placeholder
    and o.status in ('pending', 'uncertain', 'exhausted');
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('outbox_dropped', v_count);
  v_total := v_total + v_count;

  update finance.email_outbox o
  set recipient = v_placeholder, updated_at = now()
  where o.recipient = v_old_email and v_old_email <> v_placeholder;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('outbox_redacted', v_count);
  v_total := v_total + v_count;

  update public.staff set display_name = 'موظف سابق' where user_id = p_user;

  -- The trail keeps their earlier rows untouched; this is the only insert.
  if v_total > 0 or not v_was_erased then
    insert into public.audit_events (actor, action, entity, entity_id, summary)
    values (null, 'privacy.erase_staff', 'staff', p_user::text, '{}'::jsonb);
  end if;

  return v_result;
end
$$;

-- 2. Contact-form visitors: their messages and any notice still waiting to
--    be sent. Sent outbox rows keep only a dangling `contactId` and the
--    staff recipient.
create function public.privacy_erase_contacts(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contacts integer;
begin
  delete from finance.email_outbox o
  where o.status in ('pending', 'uncertain', 'exhausted')
    and o.payload->>'contactId' in (select x::text from unnest(p_ids) x);

  delete from public.contacts c
  where c.id = any (p_ids);
  get diagnostics v_contacts = row_count;

  -- The summary carries the count only, never an id, a name or an address.
  if v_contacts > 0 then
    insert into public.audit_events (actor, action, entity, entity_id, summary)
    values (null, 'privacy.erase_contacts', 'contacts', v_contacts::text,
            jsonb_build_object('count', v_contacts));
  end if;
  return v_contacts;
end
$$;

-- 3. Contact retention (D36): a contact goes 90 days after one of its
--    notices was sent and not reported bounced, complained or failed, once
--    none is still pending or sending; its outbox rows go with it. A
--    message whose notice has reached no one stays until one does. The
--    delivery-event and suppression tables are left alone: they hold
--    hashes, and a suppression must outlive the message.
create function finance.contacts_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_contacts integer;
begin
  select array_agg(c.id) into v_ids
  from public.contacts c
  where exists (
    select 1 from finance.email_outbox o
    where o.payload->>'contactId' = c.id::text
      and o.status = 'sent'
      and (o.delivery is null or o.delivery not in ('bounced', 'complained', 'failed'))
      and o.sent_at < now() - interval '90 days'
  )
  and not exists (
    select 1 from finance.email_outbox o
    where o.payload->>'contactId' = c.id::text
      and o.status in ('pending', 'sending')
  );

  if v_ids is null then
    return 0;
  end if;

  delete from finance.email_outbox o
  where o.payload->>'contactId' in (select x::text from unnest(v_ids) x);

  delete from public.contacts c where c.id = any (v_ids);
  get diagnostics v_contacts = row_count;
  return v_contacts;
end
$$;

select cron.schedule('contacts-purge', '29 3 * * *', 'select finance.contacts_purge()');

-- The period lives in `finance.contacts_purge()` now; the column was never
-- set (nothing in supabase/, src/, scripts/ or tests/ reads it).
alter table public.contacts drop column retain_until;

-- 4. Grants: none. The runbook calls these as the migration role only.
revoke all on function public.privacy_erase_staff(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_erase_contacts(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function finance.contacts_purge()
  from public, anon, authenticated, service_role;
