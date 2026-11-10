-- Affärssystem del B: återkommande beställningar, påminnelser, nyckeltal och dagligt jobb.
-- Genereringen är idempotent: unik (recurring_order_id, occurrence_date) på orders + radlås.

create table public.recurring_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  contact_id uuid,
  agreement_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  frequency public.recurrence_frequency not null,
  interval_count integer not null default 1 check (interval_count between 1 and 12),
  weekdays smallint[] check (weekdays is null or (weekdays <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(weekdays) between 1 and 7)),
  day_of_month smallint check (day_of_month is null or day_of_month between 1 and 31),
  start_date date not null,
  end_date date,
  lead_days integer not null default 2 check (lead_days between 0 and 30),
  status public.recurring_status not null default 'active',
  next_occurrence date,
  last_occurrence date,
  delivery_address text check (delivery_address is null or char_length(delivery_address) <= 500),
  customer_reference text check (customer_reference is null or char_length(customer_reference) <= 120),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (end_date is null or end_date >= start_date),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (contact_id, organization_id) references public.customer_contacts (id, organization_id) on delete set null (contact_id),
  foreign key (agreement_id, organization_id) references public.customer_agreements (id, organization_id) on delete set null (agreement_id)
);
create index recurring_orders_due_idx on public.recurring_orders (status, next_occurrence);
create index recurring_orders_org_idx on public.recurring_orders (organization_id, status);
create index recurring_orders_customer_idx on public.recurring_orders (customer_id);
create trigger recurring_orders_updated_at before update on public.recurring_orders
  for each row execute function public.set_updated_at();

alter table public.orders
  add constraint orders_recurring_fk foreign key (recurring_order_id, organization_id)
  references public.recurring_orders (id, organization_id) on delete set null (recurring_order_id);

create table public.recurring_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recurring_order_id uuid not null,
  price_list_item_id uuid,
  sku text check (sku is null or char_length(sku) <= 60),
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 1000000),
  unit text not null default 'st' check (char_length(unit) between 1 and 16),
  -- Används bara för rader utan prislisteartikel; annars hämtas avtalat pris när ordern skapas
  unit_price numeric(12,2) check (unit_price is null or unit_price >= 0),
  vat_rate numeric(5,2) not null default 25 check (vat_rate between 0 and 100),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (recurring_order_id, organization_id) references public.recurring_orders (id, organization_id) on delete cascade,
  foreign key (price_list_item_id, organization_id) references public.price_list_items (id, organization_id) on delete set null (price_list_item_id)
);
create index recurring_order_items_parent_idx on public.recurring_order_items (recurring_order_id, sort);

-- ---------------------------------------------------------------------------
-- Schema för tillfällen (samma regler som supabase/functions/_shared/schedule.ts)
-- ---------------------------------------------------------------------------
create or replace function public.recurring_matches(freq public.recurrence_frequency, every integer, days smallint[],
  dom smallint, start date, d date) returns boolean
language sql immutable set search_path = '' as $$
  select d >= start and case freq
    when 'daily' then (d - start) % every = 0
    when 'weekly' then ((date_trunc('week', d)::date - date_trunc('week', start)::date) / 7) % every = 0
      and extract(isodow from d)::smallint = any (coalesce(days, array[extract(isodow from start)::smallint]))
    when 'monthly' then ((extract(year from d) * 12 + extract(month from d)) - (extract(year from start) * 12 + extract(month from start)))::integer % every = 0
      -- dag 31 i en kort månad blir månadens sista dag
      and extract(day from d)::integer = least(coalesce(dom, extract(day from start)::smallint),
            extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::integer)
  end;
$$;

create or replace function public.recurring_next(freq public.recurrence_frequency, every integer, days smallint[],
  dom smallint, start date, from_date date, until date) returns date
language plpgsql immutable set search_path = '' as $$
declare d date := greatest(start, from_date);
begin
  for i in 0..800 loop
    if until is not null and d > until then return null; end if;
    if public.recurring_matches(freq, every, days, dom, start, d) then return d; end if;
    d := d + 1;
  end loop;
  return null;
end $$;

create or replace function public.recurring_orders_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.frequency = 'weekly' and new.weekdays is null then
    new.weekdays := array[extract(isodow from new.start_date)::smallint];
  end if;
  if new.frequency = 'monthly' and new.day_of_month is null then
    new.day_of_month := extract(day from new.start_date)::smallint;
  end if;
  if tg_op = 'INSERT' or (new.frequency, new.interval_count, new.weekdays, new.day_of_month, new.start_date, new.end_date, new.status)
       is distinct from (old.frequency, old.interval_count, old.weekdays, old.day_of_month, old.start_date, old.end_date, old.status) then
    if new.status = 'active' then
      -- Missade tillfällen under en paus hoppas över; nästa tillfälle räknas från i dag
      new.next_occurrence := public.recurring_next(new.frequency, new.interval_count, new.weekdays, new.day_of_month, new.start_date,
        greatest(public.stockholm_today(), coalesce(new.last_occurrence + 1, new.start_date)), new.end_date);
      if new.next_occurrence is null then new.status := 'ended'; end if;
    else
      new.next_occurrence := null;
    end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;
create trigger recurring_orders_schedule before insert or update on public.recurring_orders
  for each row execute function public.recurring_orders_schedule();

-- ---------------------------------------------------------------------------
-- Generering av förberedda order (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.generate_recurring_orders(org uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.recurring_orders;
  occ date;
  nxt date;
  oid uuid;
  onum text;
  created integer := 0;
  guard integer;
  today date := public.stockholm_today();
  remind integer;
  cname text;
begin
  if org is null then
    if not public.is_internal_call() then raise exception 'Behörighet saknas' using errcode = '42501'; end if;
  elsif not public.is_internal_call() then
    perform public.require_member(org);
  end if;

  for r in
    select * from public.recurring_orders ro
     where ro.status = 'active' and ro.next_occurrence is not null
       and (org is null or ro.organization_id = org)
       and ro.next_occurrence - ro.lead_days <= today
       and public.has_feature(ro.organization_id, 'recurring_orders')
     for update skip locked
  loop
    guard := 0;
    select recurring_reminder_days into remind from public.organization_settings where organization_id = r.organization_id;
    select name into cname from public.customers where id = r.customer_id;
    while r.next_occurrence is not null and r.next_occurrence - r.lead_days <= today and guard < 31 loop
      guard := guard + 1;
      occ := r.next_occurrence;
      oid := null;
      if not exists (select 1 from public.orders where recurring_order_id = r.id and occurrence_date = occ) then
        perform set_config('offertpilot.system', 'on', true);
        insert into public.orders (organization_id, customer_id, contact_id, agreement_id, recurring_order_id, occurrence_date,
                                   status, source, requested_delivery_date, delivery_address, customer_reference, notes_customer)
        values (r.organization_id, r.customer_id, r.contact_id, r.agreement_id, r.id, occ,
                'pending_approval', 'recurring', occ, r.delivery_address, r.customer_reference, r.notes)
        on conflict (recurring_order_id, occurrence_date) do nothing
        returning id, number into oid, onum;
        if oid is not null then
          insert into public.order_items (organization_id, order_id, price_list_item_id, sku, description, quantity, unit, unit_price, vat_rate, sort)
          select ri.organization_id, oid,
                 case when p.active then p.id end,
                 coalesce(ri.sku, p.sku), ri.description, ri.quantity, coalesce(p.unit, ri.unit),
                 case when p.active then public.effective_unit_price(p.id, ri.quantity) else ri.unit_price end,
                 case when p.active then p.vat_rate else ri.vat_rate end, ri.sort
            from public.recurring_order_items ri left join public.price_list_items p on p.id = ri.price_list_item_id
           where ri.recurring_order_id = r.id;
          insert into public.follow_up_tasks (organization_id, customer_id, order_id, kind, title, due_at, dedupe_key)
          values (r.organization_id, r.customer_id, oid, 'recurring_order',
                  left('Godkänn order ' || onum || ' – ' || coalesce(cname, 'kund') || ' (' || to_char(occ, 'YYYY-MM-DD') || ')', 200),
                  ((occ - coalesce(remind, 2))::timestamp + time '08:00') at time zone 'Europe/Stockholm',
                  'recurring:' || r.id || ':' || occ)
          on conflict do nothing;
          created := created + 1;
        end if;
        perform set_config('offertpilot.system', 'off', true);
      end if;
      nxt := public.recurring_next(r.frequency, r.interval_count, r.weekdays, r.day_of_month, r.start_date, occ + 1, r.end_date);
      update public.recurring_orders
         set last_occurrence = occ, next_occurrence = nxt, status = case when nxt is null then 'ended'::public.recurring_status else status end
       where id = r.id
      returning * into r;
    end loop;
  end loop;
  return created;
end $$;

-- ---------------------------------------------------------------------------
-- Påminnelser: avtal, inaktiva kunder och återkommande order
-- ---------------------------------------------------------------------------
create or replace function public.refresh_business(org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := public.stockholm_today();
  s public.organization_settings;
  ag record;
  renewed integer := 0; expired integer := 0; reminders integer := 0; inactive integer := 0; generated integer := 0; n integer;
begin
  if not public.is_internal_call() then perform public.require_member(org); end if;
  select * into s from public.organization_settings where organization_id = org;

  -- Avtal som har löpt ut: förläng automatiskt eller markera som utgångna
  for ag in select * from public.customer_agreements where organization_id = org and status = 'active' and end_date < today for update loop
    if ag.auto_renew then
      n := 0;
      loop
        n := n + 1;
        exit when (ag.end_date + make_interval(months => ag.renewal_months * n))::date >= today or n > 100;
      end loop;
      update public.customer_agreements set end_date = (ag.end_date + make_interval(months => ag.renewal_months * n))::date where id = ag.id;
      renewed := renewed + 1;
    else
      update public.customer_agreements set status = 'expired' where id = ag.id;
      expired := expired + 1;
    end if;
  end loop;

  -- Påminnelse inför avtalets slut
  insert into public.follow_up_tasks (organization_id, customer_id, agreement_id, kind, title, due_at, dedupe_key)
  select a.organization_id, a.customer_id, a.id, 'agreement_renewal',
         left('Avtal löper ut ' || to_char(a.end_date, 'YYYY-MM-DD') || ': ' || c.name || ' – ' || a.title, 200),
         ((a.end_date - a.notice_days)::timestamp + time '08:00') at time zone 'Europe/Stockholm',
         'agreement:' || a.id || ':' || a.end_date
    from public.customer_agreements a join public.customers c on c.id = a.customer_id
   where a.organization_id = org and a.status = 'active' and a.end_date is not null
     and a.end_date - a.notice_days <= today and a.end_date >= today
  on conflict do nothing;
  get diagnostics reminders = row_count;

  -- Aktiva kunder som inte beställt på länge (en påminnelse per inaktiv period)
  insert into public.follow_up_tasks (organization_id, customer_id, kind, title, due_at, dedupe_key)
  select c.organization_id, c.id, 'inactive_customer',
         left(c.name || ' har inte beställt sedan ' || to_char(lo.created_at at time zone 'Europe/Stockholm', 'YYYY-MM-DD'), 200),
         now(), 'inactive:' || c.id || ':' || lo.id
    from public.customers c
    join lateral (select o.id, o.created_at from public.orders o
                   where o.customer_id = c.id and o.status <> 'cancelled' order by o.created_at desc limit 1) lo on true
   where c.organization_id = org and c.status = 'active' and not c.opted_out
     and lo.created_at < now() - make_interval(days => s.inactive_customer_days)
  on conflict do nothing;
  get diagnostics inactive = row_count;

  if public.has_feature(org, 'recurring_orders') then
    generated := public.generate_recurring_orders(org);
  end if;

  return jsonb_build_object('renewed', renewed, 'expired', expired, 'agreement_reminders', reminders,
                            'inactive_reminders', inactive, 'generated_orders', generated);
end $$;

-- Ny order avslutar påminnelsen om inaktiv kund
create or replace function public.orders_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (organization_id, order_id, from_status, to_status, changed_by)
    values (new.organization_id, new.id, null, new.status, auth.uid());
    perform public.log_activity(new.organization_id, 'order.created', 'order', new.id,
      jsonb_build_object('number', new.number, 'source', new.source));
    update public.follow_up_tasks set status = 'done', completed_at = now()
     where customer_id = new.customer_id and kind = 'inactive_customer' and status = 'pending';
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (organization_id, order_id, from_status, to_status, changed_by, note)
    values (new.organization_id, new.id, old.status, new.status, auth.uid(), nullif(current_setting('offertpilot.status_note', true), ''));
    perform public.log_activity(new.organization_id, 'order.status_changed', 'order', new.id,
      jsonb_build_object('number', new.number, 'from', old.status, 'to', new.status));
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Nyckeltal för order och avtal (riktiga data)
-- ---------------------------------------------------------------------------
create or replace function public.business_stats(org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb; days integer;
begin
  perform public.require_member(org);
  select inactive_customer_days into days from public.organization_settings where organization_id = org;
  select jsonb_build_object(
    'has_business', exists (select 1 from public.orders where organization_id = org)
                    or exists (select 1 from public.price_lists where organization_id = org)
                    or exists (select 1 from public.customer_agreements where organization_id = org)
                    or exists (select 1 from public.recurring_orders where organization_id = org),
    'active_customers', (select count(*) from public.customers where organization_id = org and status = 'active'),
    'active_agreements', (select count(*) from public.customer_agreements where organization_id = org and status = 'active'),
    'agreements_expiring_30d', (select count(*) from public.customer_agreements where organization_id = org and status = 'active'
                                  and end_date between public.stockholm_today() and public.stockholm_today() + 30),
    'orders_30d', (select count(*) from public.orders where organization_id = org and status <> 'cancelled' and created_at >= now() - interval '30 days'),
    'order_value_30d', (select coalesce(sum(total), 0) from public.orders where organization_id = org
                          and status in ('confirmed', 'in_progress', 'delivered') and created_at >= now() - interval '30 days'),
    'pending_orders', (select count(*) from public.orders where organization_id = org and status in ('draft', 'pending_approval')),
    'upcoming_recurring_7d', (select count(*) from public.recurring_orders where organization_id = org and status = 'active'
                                and next_occurrence <= public.stockholm_today() + 7),
    'upcoming_recurring', (select coalesce(jsonb_agg(x order by x->>'next_occurrence'), '[]'::jsonb) from (
        select jsonb_build_object('id', r.id, 'title', r.title, 'customer', c.name, 'next_occurrence', r.next_occurrence) x
          from public.recurring_orders r join public.customers c on c.id = r.customer_id
         where r.organization_id = org and r.status = 'active' and r.next_occurrence is not null
         order by r.next_occurrence limit 5) t),
    'inactive_customers', (select coalesce(jsonb_agg(x order by (x->>'last_order_at')), '[]'::jsonb) from (
        select jsonb_build_object('id', c.id, 'name', c.name, 'last_order_at', lo.created_at) x
          from public.customers c
          join lateral (select max(o.created_at) created_at from public.orders o where o.customer_id = c.id and o.status <> 'cancelled') lo on lo.created_at is not null
         where c.organization_id = org and c.status = 'active' and lo.created_at < now() - make_interval(days => days)
         order by lo.created_at limit 5) t),
    'inactive_customers_count', (select count(*) from public.customers c
         where c.organization_id = org and c.status = 'active'
           and (select max(o.created_at) from public.orders o where o.customer_id = c.id and o.status <> 'cancelled') < now() - make_interval(days => days))
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- Dagligt jobb (pg_cron): påminnelser och förberedda order för alla företag
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_jobs() returns integer
language plpgsql security definer set search_path = '' as $$
declare o record; n integer := 0;
begin
  if not public.is_internal_call() then raise exception 'Behörighet saknas' using errcode = '42501'; end if;
  for o in select id from public.organizations loop
    begin
      perform public.refresh_follow_ups(o.id);
      perform public.refresh_business(o.id);
      n := n + 1;
    exception when others then
      raise warning 'Dagligt jobb misslyckades för %: %', o.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;

do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron kunde inte aktiveras: %', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('offertfabriken-dagligt', '15 4 * * *', 'select public.run_daily_jobs()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Rättigheter och RLS
-- ---------------------------------------------------------------------------
revoke all on public.recurring_orders, public.recurring_order_items from anon, authenticated;
grant select, delete on public.recurring_orders to authenticated;
grant insert (organization_id, customer_id, contact_id, agreement_id, title, frequency, interval_count, weekdays, day_of_month,
  start_date, end_date, lead_days, status, delivery_address, customer_reference, notes) on public.recurring_orders to authenticated;
grant update (contact_id, agreement_id, title, frequency, interval_count, weekdays, day_of_month, start_date, end_date,
  lead_days, status, delivery_address, customer_reference, notes) on public.recurring_orders to authenticated;
grant select, insert, update, delete on public.recurring_order_items to authenticated;

alter table public.recurring_orders enable row level security;
alter table public.recurring_order_items enable row level security;
create policy recurring_orders_read on public.recurring_orders for select to authenticated using (public.is_org_member(organization_id));
create policy recurring_orders_insert on public.recurring_orders for insert to authenticated
  with check (public.is_org_member(organization_id) and public.has_feature(organization_id, 'recurring_orders'));
create policy recurring_orders_update on public.recurring_orders for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy recurring_orders_delete on public.recurring_orders for delete to authenticated using (public.is_org_member(organization_id));
create policy recurring_order_items_read on public.recurring_order_items for select to authenticated using (public.is_org_member(organization_id));
create policy recurring_order_items_insert on public.recurring_order_items for insert to authenticated with check (public.is_org_member(organization_id));
create policy recurring_order_items_update on public.recurring_order_items for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy recurring_order_items_delete on public.recurring_order_items for delete to authenticated using (public.is_org_member(organization_id));

revoke execute on function public.recurring_matches(public.recurrence_frequency, integer, smallint[], smallint, date, date),
  public.recurring_next(public.recurrence_frequency, integer, smallint[], smallint, date, date, date),
  public.recurring_orders_schedule(), public.generate_recurring_orders(uuid), public.refresh_business(uuid),
  public.orders_after_change(), public.business_stats(uuid), public.run_daily_jobs()
  from public, anon, authenticated;
grant execute on function public.generate_recurring_orders(uuid), public.refresh_business(uuid), public.business_stats(uuid) to authenticated;
grant execute on all functions in schema public to service_role;

-- Rena hjälpfunktioner utan dataåtkomst (används för förhandsvisning av schema)
grant execute on function public.stockholm_today(),
  public.recurring_next(public.recurrence_frequency, integer, smallint[], smallint, date, date, date) to authenticated;
