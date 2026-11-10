-- Affärssystem del C: kundportal för företagens egna kunder, AI-användning per kund och utökad GDPR.
-- Portalkunder är INTE medlemmar i företaget: alla befintliga RLS-regler nekar dem automatiskt.
-- De når bara data via portal_*-funktionerna nedan, som alltid filtrerar på deras egen kund.

create table public.customer_portal_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  contact_id uuid,
  email extensions.citext not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid references auth.users (id) on delete set null,
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  disabled_at timestamptz,
  last_seen_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, customer_id, email),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (contact_id, organization_id) references public.customer_contacts (id, organization_id) on delete set null (contact_id)
);
create index customer_portal_users_user_idx on public.customer_portal_users (user_id) where user_id is not null;
create index customer_portal_users_email_idx on public.customer_portal_users (email);

revoke all on public.customer_portal_users from anon, authenticated;
grant select, delete on public.customer_portal_users to authenticated;
grant insert (organization_id, customer_id, contact_id, email) on public.customer_portal_users to authenticated;
grant update (contact_id, disabled_at) on public.customer_portal_users to authenticated;
alter table public.customer_portal_users enable row level security;
create policy customer_portal_users_read on public.customer_portal_users for select to authenticated
  using (public.is_org_member(organization_id));
create policy customer_portal_users_insert on public.customer_portal_users for insert to authenticated
  with check (public.is_org_member(organization_id) and public.has_feature(organization_id, 'customer_portal'));
create policy customer_portal_users_update on public.customer_portal_users for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy customer_portal_users_delete on public.customer_portal_users for delete to authenticated
  using (public.is_org_member(organization_id));

create or replace function public.customer_portal_users_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.organization_id, 'portal.invited', 'customer', new.customer_id, jsonb_build_object('email', new.email));
  elsif new.disabled_at is distinct from old.disabled_at then
    perform public.log_activity(new.organization_id, case when new.disabled_at is null then 'portal.enabled' else 'portal.disabled' end,
      'customer', new.customer_id, jsonb_build_object('email', new.email));
  end if;
  return null;
end $$;
create trigger customer_portal_users_log after insert or update on public.customer_portal_users
  for each row execute function public.customer_portal_users_log();

-- ---------------------------------------------------------------------------
-- Inloggning och behörighet i portalen
-- ---------------------------------------------------------------------------
-- Kopplar väntande portalinbjudningar till kontot (kräver bekräftad e-postadress)
create or replace function public.accept_portal_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare uemail text; n integer;
begin
  select email into uemail from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if uemail is null then return 0; end if;
  update public.customer_portal_users
     set user_id = auth.uid(), accepted_at = coalesce(accepted_at, now()), last_seen_at = now()
   where email = uemail::extensions.citext and disabled_at is null and (user_id is null or user_id = auth.uid());
  get diagnostics n = row_count;
  return n;
end $$;

-- Alla portaler inloggad användare har tillgång till
create or replace function public.portal_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id', c.id, 'customer_name', c.name, 'customer_number', c.customer_number, 'customer_status', c.status,
    'organization_id', o.id, 'organization_name', o.name, 'brand_color', o.brand_color, 'logo_url', o.logo_url,
    'organization_email', o.email, 'organization_phone', o.phone,
    'can_order', c.status not in ('paused', 'ended')) order by o.name), '[]'::jsonb)
  from public.customer_portal_users pu
  join public.customers c on c.id = pu.customer_id
  join public.organizations o on o.id = pu.organization_id
  join public.organization_settings s on s.organization_id = pu.organization_id
  where pu.user_id = auth.uid() and pu.accepted_at is not null and pu.disabled_at is null
    and s.portal_enabled and public.has_feature(pu.organization_id, 'customer_portal');
$$;

-- Säkerställer att inloggad användare får agera för kunden; returnerar företags-id
create or replace function public.portal_guard(cust uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare org uuid;
begin
  select pu.organization_id into org
    from public.customer_portal_users pu
    join public.organization_settings s on s.organization_id = pu.organization_id
   where pu.user_id = auth.uid() and pu.customer_id = cust and pu.accepted_at is not null and pu.disabled_at is null
     and s.portal_enabled and public.has_feature(pu.organization_id, 'customer_portal');
  if org is null then raise exception 'Behörighet saknas' using errcode = '42501'; end if;
  return org;
end $$;

create or replace function public.portal_catalog(cust uuid)
returns table (item_id uuid, sku text, name text, description text, unit text, unit_price numeric, vat_rate numeric, tiers jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_guard(cust);
  return query select p.item_id, p.sku, p.name, p.description, p.unit, p.unit_price, p.vat_rate, p.tiers from public.price_catalog_for(cust) p;
end $$;

create or replace function public.portal_orders(cust uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_guard(cust);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'number', o.number, 'status', o.status, 'source', o.source, 'created_at', o.created_at,
      'requested_delivery_date', o.requested_delivery_date, 'delivery_date', o.delivery_date,
      'customer_reference', o.customer_reference, 'notes_customer', o.notes_customer,
      'subtotal', o.subtotal, 'discount_total', o.discount_total, 'vat_total', o.vat_total, 'total', o.total,
      'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'sku', i.sku, 'quantity', i.quantity,
          'unit', i.unit, 'unit_price', i.unit_price, 'vat_rate', i.vat_rate, 'line_total', i.line_total,
          'price_list_item_id', i.price_list_item_id) order by i.sort, i.created_at)
        from public.order_items i where i.order_id = o.id), '[]'::jsonb)) order by o.created_at desc)
    from public.orders o
   where o.customer_id = cust and o.status <> 'draft'), '[]'::jsonb);
end $$;

-- Ny beställning från portalen: priserna sätts alltid på servern från kundens prisbild.
create or replace function public.portal_create_order(cust uuid, items jsonb, requested_delivery_date date default null,
  customer_reference text default null, notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  org uuid := public.portal_guard(cust);
  c public.customers;
  oid uuid; onum text;
  line jsonb; qty numeric; item uuid; n integer := 0;
begin
  select * into c from public.customers where id = cust;
  if c.status in ('paused', 'ended') then
    raise exception 'Beställningar är inte möjliga för det här kontot just nu. Kontakta %.', (select name from public.organizations where id = org)
      using errcode = 'P0001';
  end if;
  if not public.hit_rate_limit('portal-order:' || auth.uid(), 20, 3600) then
    raise exception 'För många beställningar på kort tid. Försök igen senare.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) not between 1 and 100 then
    raise exception 'Beställningen måste innehålla mellan 1 och 100 rader' using errcode = '22023';
  end if;
  if requested_delivery_date is not null and requested_delivery_date < public.stockholm_today() then
    raise exception 'Önskat leveransdatum kan inte ligga bakåt i tiden' using errcode = '22023';
  end if;

  perform set_config('offertpilot.system', 'on', true);
  insert into public.orders (organization_id, customer_id, status, source, requested_delivery_date, customer_reference, notes_customer, created_by)
  values (org, cust, 'pending_approval', 'portal', requested_delivery_date, left(nullif(trim(customer_reference), ''), 120),
          left(nullif(trim(notes), ''), 4000), auth.uid())
  returning id, number into oid, onum;

  for line in select * from jsonb_array_elements(items) loop
    begin
      item := (line ->> 'item_id')::uuid;
      qty := (line ->> 'quantity')::numeric;
    exception when others then
      raise exception 'Ogiltig orderrad' using errcode = '22023';
    end;
    if qty is null or qty <= 0 or qty > 1000000 then raise exception 'Ogiltig mängd' using errcode = '22023'; end if;
    insert into public.order_items (organization_id, order_id, price_list_item_id, sku, description, quantity, unit, unit_price, vat_rate, sort)
    select org, oid, p.item_id, p.sku, p.name, round(qty, 3), p.unit, public.effective_unit_price(p.item_id, round(qty, 3)), p.vat_rate, n
      from public.price_catalog_for(cust) p where p.item_id = item;
    if not found then raise exception 'En artikel finns inte i din prislista' using errcode = '22023'; end if;
    n := n + 1;
  end loop;
  perform set_config('offertpilot.system', 'off', true);

  insert into public.follow_up_tasks (organization_id, customer_id, order_id, kind, title, due_at, dedupe_key)
  values (org, cust, oid, 'order_approval', left('Ny beställning ' || onum || ' från ' || c.name || ' via kundportalen', 200), now(),
          'portal-order:' || oid);
  return jsonb_build_object('id', oid, 'number', onum);
end $$;

-- Återbeställning: samma artiklar och mängder, dagens avtalade priser
create or replace function public.portal_reorder(cust uuid, source_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lines jsonb; skipped integer; res jsonb;
begin
  perform public.portal_guard(cust);
  if not exists (select 1 from public.orders where id = source_order and customer_id = cust and status <> 'draft') then
    raise exception 'Ordern hittades inte' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.price_list_item_id, 'quantity', i.quantity)), '[]'::jsonb)
    into lines
    from public.order_items i
   where i.order_id = source_order and i.price_list_item_id in (select p.item_id from public.price_catalog_for(cust) p);
  select count(*) into skipped from public.order_items i
   where i.order_id = source_order and (i.price_list_item_id is null or i.price_list_item_id not in (select p.item_id from public.price_catalog_for(cust) p));
  if jsonb_array_length(lines) = 0 then
    raise exception 'Inga av artiklarna i ordern finns i din prislista längre' using errcode = 'P0001';
  end if;
  res := public.portal_create_order(cust, lines, null, null, null);
  return res || jsonb_build_object('skipped', skipped);
end $$;

-- Underlag för orderbekräftelse (PDF) i portalen
create or replace function public.portal_order_document(cust uuid, oid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare org uuid := public.portal_guard(cust);
begin
  if not exists (select 1 from public.orders where id = oid and customer_id = cust and status <> 'draft') then
    raise exception 'Ordern hittades inte' using errcode = 'P0002';
  end if;
  return (select jsonb_build_object(
    'order', jsonb_build_object('number', o.number, 'status', o.status, 'created_at', o.created_at,
      'requested_delivery_date', o.requested_delivery_date, 'delivery_date', o.delivery_date, 'customer_reference', o.customer_reference,
      'notes_customer', o.notes_customer, 'payment_terms_days', o.payment_terms_days, 'discount_percent', o.discount_percent,
      'subtotal', o.subtotal, 'discount_total', o.discount_total, 'vat_total', o.vat_total, 'total', o.total, 'delivery_address', o.delivery_address),
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'unit', i.unit,
        'unit_price', i.unit_price, 'discount_percent', i.discount_percent, 'vat_rate', i.vat_rate, 'line_total', i.line_total) order by i.sort, i.created_at)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'organization', jsonb_build_object('name', g.name, 'org_number', g.org_number, 'email', g.email, 'phone', g.phone, 'website', g.website,
      'address', g.address, 'postal_code', g.postal_code, 'city', g.city, 'brand_color', g.brand_color),
    'customer', jsonb_build_object('name', c.name, 'company_name', c.company_name, 'email', c.email, 'address', c.address,
      'postal_code', c.postal_code, 'city', c.city))
    from public.orders o join public.customers c on c.id = o.customer_id join public.organizations g on g.id = o.organization_id
   where o.id = oid and o.organization_id = org);
end $$;

-- ---------------------------------------------------------------------------
-- AI-användning per kund (AI-orderassistenten räknas per kund och månad)
-- ---------------------------------------------------------------------------
alter table public.usage_records add column customer_id uuid;

create or replace function public.usage_summary(org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.subscriptions; pl public.plans; used integer;
begin
  if auth.role() <> 'service_role' then
    perform public.require_member(org);
  end if;
  select * into s from public.subscriptions where organization_id = org;
  select * into pl from public.plans where id = s.plan_id;
  select count(distinct coalesce(lead_id, customer_id, id)) into used
    from public.usage_records
   where organization_id = org and success and created_at >= date_trunc('month', now());
  return jsonb_build_object(
    'plan_id', pl.id, 'plan_name', pl.name, 'price_sek', pl.price_sek,
    'status', s.status, 'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
    'max_users', pl.max_users, 'max_ai_leads', pl.max_ai_leads_per_month, 'ai_leads_used', used,
    'features', pl.features,
    'active', (s.status = 'active' or (s.status = 'trialing' and coalesce(s.trial_ends_at, now()) > now())));
end $$;

drop function public.check_ai_quota(uuid, uuid, text);
create or replace function public.check_ai_quota(org uuid, lead uuid, feature text default null, cust uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u jsonb := public.usage_summary(org); already boolean := false;
begin
  if not (u->>'active')::boolean then
    return jsonb_build_object('allowed', false, 'reason', 'Prenumerationen är inte aktiv. Uppgradera under Inställningar → Fakturering.');
  end if;
  if feature is not null and not coalesce((u->'features'->>feature)::boolean, false) then
    return jsonb_build_object('allowed', false, 'reason', 'Funktionen ingår inte i din plan. Uppgradera till Professional för att använda den.');
  end if;
  if lead is not null or cust is not null then
    select exists (select 1 from public.usage_records where organization_id = org and success and created_at >= date_trunc('month', now())
                    and ((lead is not null and lead_id = lead) or (cust is not null and lead is null and customer_id = cust))) into already;
  end if;
  if not already and (u->>'ai_leads_used')::int >= (u->>'max_ai_leads')::int then
    return jsonb_build_object('allowed', false,
      'reason', format('Månadsgränsen på %s AI-assisterade leads är nådd.', u->>'max_ai_leads'));
  end if;
  return jsonb_build_object('allowed', true);
end $$;

-- ---------------------------------------------------------------------------
-- GDPR: export och anonymisering omfattar nu även kontakter, avtal, order och portalkonton
-- ---------------------------------------------------------------------------
create or replace function public.export_customer_data(cid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = cid;
  if not found then raise exception 'Kunden hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(c.organization_id);
  return jsonb_build_object(
    'exported_at', now(),
    'customer', to_jsonb(c),
    'contacts', coalesce((select jsonb_agg(to_jsonb(x)) from public.customer_contacts x where x.customer_id = cid), '[]'),
    'agreements', coalesce((select jsonb_agg(to_jsonb(x)) from public.customer_agreements x where x.customer_id = cid), '[]'),
    'portal_users', coalesce((select jsonb_agg(jsonb_build_object('email', x.email, 'invited_at', x.invited_at, 'accepted_at', x.accepted_at,
                       'disabled_at', x.disabled_at)) from public.customer_portal_users x where x.customer_id = cid), '[]'),
    'leads', coalesce((select jsonb_agg(to_jsonb(l)) from public.leads l where l.customer_id = cid), '[]'),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.messages m
                           join public.leads l on l.id = m.lead_id where l.customer_id = cid), '[]'),
    'quotations', coalesce((select jsonb_agg(public.quotation_snapshot(q.id)) from public.quotations q where q.customer_id = cid), '[]'),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('items',
                 coalesce((select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id = o.id), '[]'::jsonb)))
               from public.orders o where o.customer_id = cid), '[]'),
    'recurring_orders', coalesce((select jsonb_agg(to_jsonb(r)) from public.recurring_orders r where r.customer_id = cid), '[]'));
end $$;

create or replace function public.anonymize_customer(cid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = cid for update;
  if not found then raise exception 'Kunden hittades inte' using errcode = 'P0002'; end if;
  perform public.require_admin(c.organization_id);
  -- Offert- och orderbelopp behålls för bokföring; personuppgifter och fritext tas bort.
  update public.customers
     set name = 'Anonymiserad kund', email = null, phone = null, company_name = null, address = null,
         postal_code = null, city = null, notes = null, org_number = null, invoice_email = null,
         delivery_address = null, delivery_postal_code = null, delivery_city = null,
         opted_out = true, status = 'ended', anonymized_at = now()
   where id = cid;
  update public.leads
     set title = 'Anonymiserad förfrågan', message = null, ai_summary = null, ai_missing_info = null,
         ai_questions = null, ai_next_action = null
   where customer_id = cid;
  update public.messages m set body = '[Raderat på begäran av den registrerade]', subject = null
    from public.leads l where m.lead_id = l.id and l.customer_id = cid;
  update public.follow_up_tasks t set draft_body = null, draft_subject = null,
         status = case when t.status = 'pending' then 'cancelled'::public.task_status else t.status end
    from public.leads l where t.lead_id = l.id and l.customer_id = cid;
  update public.follow_up_tasks set draft_body = null, draft_subject = null,
         status = case when status = 'pending' then 'cancelled'::public.task_status else status end
   where customer_id = cid;
  delete from public.customer_contacts where customer_id = cid;
  delete from public.customer_portal_users where customer_id = cid;
  perform set_config('offertpilot.system', 'on', true);
  update public.orders set delivery_address = null, customer_reference = null, notes_customer = null, notes_internal = null
   where customer_id = cid;
  perform set_config('offertpilot.system', 'off', true);
  update public.recurring_orders set status = 'ended', delivery_address = null, customer_reference = null, notes = null
   where customer_id = cid;
  perform public.log_activity(c.organization_id, 'customer.anonymized', 'customer', cid);
end $$;

create or replace function public.export_organization_data(org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin(org);
  return jsonb_build_object(
    'exported_at', now(),
    'organization', (select to_jsonb(o) from public.organizations o where id = org),
    'settings', (select to_jsonb(s) from public.organization_settings s where organization_id = org),
    'members', coalesce((select jsonb_agg(to_jsonb(m)) from public.organization_members m where organization_id = org), '[]'),
    'services', coalesce((select jsonb_agg(to_jsonb(x)) from public.services x where organization_id = org), '[]'),
    'pricing_rules', coalesce((select jsonb_agg(to_jsonb(x)) from public.pricing_rules x where organization_id = org), '[]'),
    'knowledge_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.knowledge_items x where organization_id = org), '[]'),
    'customers', coalesce((select jsonb_agg(to_jsonb(x)) from public.customers x where organization_id = org), '[]'),
    'customer_contacts', coalesce((select jsonb_agg(to_jsonb(x)) from public.customer_contacts x where organization_id = org), '[]'),
    'customer_agreements', coalesce((select jsonb_agg(to_jsonb(x)) from public.customer_agreements x where organization_id = org), '[]'),
    'price_lists', coalesce((select jsonb_agg(to_jsonb(x)) from public.price_lists x where organization_id = org), '[]'),
    'price_list_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.price_list_items x where organization_id = org), '[]'),
    'price_list_item_tiers', coalesce((select jsonb_agg(to_jsonb(x)) from public.price_list_item_tiers x where organization_id = org), '[]'),
    'leads', coalesce((select jsonb_agg(to_jsonb(x)) from public.leads x where organization_id = org), '[]'),
    'messages', coalesce((select jsonb_agg(to_jsonb(x)) from public.messages x where organization_id = org), '[]'),
    'quotations', coalesce((select jsonb_agg(public.quotation_snapshot(x.id)) from public.quotations x where organization_id = org), '[]'),
    'orders', coalesce((select jsonb_agg(to_jsonb(x)) from public.orders x where organization_id = org), '[]'),
    'order_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.order_items x where organization_id = org), '[]'),
    'recurring_orders', coalesce((select jsonb_agg(to_jsonb(x)) from public.recurring_orders x where organization_id = org), '[]'),
    'recurring_order_items', coalesce((select jsonb_agg(to_jsonb(x)) from public.recurring_order_items x where organization_id = org), '[]'),
    'follow_up_tasks', coalesce((select jsonb_agg(to_jsonb(x)) from public.follow_up_tasks x where organization_id = org), '[]'),
    'activity_logs', coalesce((select jsonb_agg(to_jsonb(x)) from public.activity_logs x where organization_id = org), '[]'));
end $$;

-- ---------------------------------------------------------------------------
-- Funktionsrättigheter
-- ---------------------------------------------------------------------------
revoke execute on function public.customer_portal_users_log(), public.accept_portal_invitations(), public.portal_access(),
  public.portal_guard(uuid), public.portal_catalog(uuid), public.portal_orders(uuid),
  public.portal_create_order(uuid, jsonb, date, text, text), public.portal_reorder(uuid, uuid), public.portal_order_document(uuid, uuid),
  public.usage_summary(uuid), public.check_ai_quota(uuid, uuid, text, uuid), public.export_customer_data(uuid),
  public.anonymize_customer(uuid), public.export_organization_data(uuid)
  from public, anon, authenticated;
grant execute on function public.accept_portal_invitations(), public.portal_access(), public.portal_catalog(uuid),
  public.portal_orders(uuid), public.portal_create_order(uuid, jsonb, date, text, text), public.portal_reorder(uuid, uuid),
  public.portal_order_document(uuid, uuid), public.usage_summary(uuid), public.export_customer_data(uuid),
  public.anonymize_customer(uuid), public.export_organization_data(uuid)
  to authenticated;
grant execute on all functions in schema public to service_role;
