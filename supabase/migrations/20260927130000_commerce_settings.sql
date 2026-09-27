-- P06 round 3, step 3: the seller details the store will need (D34).
--
-- `finance.commerce_settings` is one row holding what checkout will need:
-- who sells (the freelance certificate), which policy revisions were
-- approved, and the currency. Checkout itself stays off until P08 has the
-- verified payment gateway. Owner-only, with a TOTP step-up in the `admin`
-- Edge Function before `commerce_settings_save` runs: the owner reads the
-- row through `commerce_settings_get()` (granted to `authenticated`, role
-- rechecked inside) and writes it through `commerce_settings_save()`
-- (service_role only). No tax field of any kind (D34): prices are what the
-- buyer pays. No API role has any grant on the table.

create table finance.commerce_settings (
  id integer primary key default 1 check (id = 1),
  -- P08 lifts this check together with the default, after the verified
  -- payment gateway; until then no statement can turn checkout on.
  checkout_enabled boolean not null default false check (checkout_enabled = false),
  seller_legal_name text check (
    seller_legal_name is null
    or (char_length(seller_legal_name) between 1 and 200 and seller_legal_name !~ '[[:cntrl:]]')
  ),
  seller_address text check (
    seller_address is null
    or (char_length(seller_address) between 1 and 500 and seller_address !~ '[[:cntrl:]]')
  ),
  seller_registration text check (
    seller_registration is null
    or (char_length(seller_registration) between 1 and 100 and seller_registration !~ '[[:cntrl:]]')
  ),
  -- P07 fills this with the approved policy revision ids, by policy type.
  policy_revisions jsonb not null default '{}'::jsonb check (jsonb_typeof(policy_revisions) = 'object'),
  currency text not null default 'SAR' check (currency = 'SAR'),
  version integer not null default 0,
  configured_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null
);

comment on column finance.commerce_settings.checkout_enabled is
  'P08 lifts this check (and the default) after the verified payment gateway.';

insert into finance.commerce_settings (id) values (1);

-- The browser form's read (owner only): the whole row as one jsonb object.
create function public.commerce_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row finance.commerce_settings;
begin
  if (select public.current_staff_role()) is distinct from 'owner' then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from finance.commerce_settings where id = 1;
  return jsonb_build_object(
    'checkoutEnabled', v_row.checkout_enabled,
    'sellerLegalName', v_row.seller_legal_name,
    'sellerAddress', v_row.seller_address,
    'sellerRegistration', v_row.seller_registration,
    'policyRevisions', v_row.policy_revisions,
    'currency', v_row.currency,
    'version', v_row.version,
    'configuredAt', v_row.configured_at
  );
end
$$;

revoke all on function public.commerce_settings_get() from public, anon;
grant execute on function public.commerce_settings_get() to authenticated;

-- The owner's save, called by the `admin` Edge Function as `service_role`
-- after its own aal2/TOTP step-up check. Optimistic concurrency: the caller
-- passes the version it read; anything else raises 40001 so the browser can
-- offer a reload. The audit summary names the changed fields, never their
-- values.
create function public.commerce_settings_save(
  p_actor uuid,
  p_expected_version integer,
  p_seller_legal_name text,
  p_seller_address text,
  p_seller_registration text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.commerce_settings;
  v_name text := case when p_seller_legal_name is null then null else btrim(p_seller_legal_name) end;
  v_address text := case when p_seller_address is null then null else btrim(p_seller_address) end;
  v_registration text := case when p_seller_registration is null then null else btrim(p_seller_registration) end;
  v_changed text[] := array[]::text[];
begin
  if not exists (
    select 1 from public.staff s
    where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from finance.commerce_settings where id = 1 for update;

  -- `is distinct from`, not `<>`: a null expected version is a conflict too.
  if p_expected_version is distinct from v_row.version then
    raise exception 'Commerce settings changed in another session.'
      using errcode = 'serialization_failure';
  end if;

  if v_row.seller_legal_name is distinct from v_name then
    v_changed := array_append(v_changed, 'seller_legal_name');
  end if;
  if v_row.seller_address is distinct from v_address then
    v_changed := array_append(v_changed, 'seller_address');
  end if;
  if v_row.seller_registration is distinct from v_registration then
    v_changed := array_append(v_changed, 'seller_registration');
  end if;

  update finance.commerce_settings
  set seller_legal_name = v_name,
      seller_address = v_address,
      seller_registration = v_registration,
      version = v_row.version + 1,
      configured_at = now(),
      approved_by = p_actor
  where id = 1;

  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    p_actor,
    'commerce.settings',
    'commerce_settings',
    '1',
    jsonb_build_object('version', v_row.version + 1, 'changed', to_jsonb(v_changed))
  );

  return v_row.version + 1;
end
$$;

revoke all on function public.commerce_settings_save(uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.commerce_settings_save(uuid, integer, text, text, text) to service_role;
