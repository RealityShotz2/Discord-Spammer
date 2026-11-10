-- Affärssystem del A: avtalskunder, fasta prislistor och orderhantering.
-- Allt är ett TILLÄGG: tjänstekatalogen (services), prisregler och offertflödet är oförändrade.
-- Samma säkerhetsmönster som resten av databasen: organization_id + RLS + sammansatta FK:er,
-- explicita kolumnrättigheter och statusbyten endast via serverfunktioner.

-- ---------------------------------------------------------------------------
-- Hjälpare
-- ---------------------------------------------------------------------------
-- Anrop från pg_cron eller service role (ingen inloggad användare och ingen anon/authenticated-roll)
create or replace function public.is_internal_call() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon');
$$;

create or replace function public.has_feature(org uuid, feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((p.features ->> feature)::boolean, false)
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.organization_id = org;
$$;

create or replace function public.stockholm_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Stockholm')::date; $$;

-- Nya funktioner ingår i alla nuvarande planer (priser och gränser oförändrade).
-- Flaggorna kontrolleras på servern så att de kan begränsas per plan i framtiden.
update public.plans set features = features
  || '{"price_lists": true, "orders": true, "recurring_orders": true, "customer_portal": true, "ai_orders": true}'::jsonb;

-- ---------------------------------------------------------------------------
-- Företagsinställningar för order och kundportal
-- ---------------------------------------------------------------------------
alter table public.organization_settings
  add column next_customer_number integer not null default 1001,
  add column next_order_number integer not null default 1001,
  add column order_number_prefix text not null default 'ORD' check (order_number_prefix ~ '^[A-Z0-9-]{1,10}$'),
  add column inactive_customer_days integer not null default 30 check (inactive_customer_days between 7 and 365),
  add column recurring_reminder_days integer not null default 2 check (recurring_reminder_days between 0 and 30),
  add column portal_enabled boolean not null default false;

grant update (order_number_prefix, inactive_customer_days, recurring_reminder_days, portal_enabled)
  on public.organization_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Avtalskunder (utökning av befintligt kundregister)
-- ---------------------------------------------------------------------------
alter table public.customers
  add column customer_number integer,
  add column customer_type public.customer_type not null default 'company',
  add column org_number text check (org_number is null or org_number ~ '^\d{6}-?\d{4}$'),
  add column status public.customer_status not null default 'prospect',
  add column payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365),
  add column discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  add column invoice_email extensions.citext check (invoice_email is null or invoice_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column delivery_address text,
  add column delivery_postal_code text,
  add column delivery_city text;

create unique index customers_org_number_idx on public.customers (organization_id, customer_number);
create index customers_org_status_idx on public.customers (organization_id, status);

-- Befintliga kunder får kundnummer i den ordning de skapades
with numbered as (
  select id, organization_id, 1000 + row_number() over (partition by organization_id order by created_at) as n
    from public.customers
)
update public.customers c set customer_number = numbered.n from numbered where numbered.id = c.id;
update public.organization_settings s
   set next_customer_number = greatest(s.next_customer_number,
     coalesce((select max(customer_number) + 1 from public.customers c where c.organization_id = s.organization_id), 1001));

create or replace function public.customers_assign_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_number is null then
    update public.organization_settings set next_customer_number = next_customer_number + 1
     where organization_id = new.organization_id
    returning next_customer_number - 1 into new.customer_number;
  end if;
  return new;
end $$;
create trigger customers_assign_number before insert on public.customers
  for each row execute function public.customers_assign_number();

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  role text check (role is null or char_length(role) <= 120),
  email extensions.citext check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or char_length(phone) <= 40),
  is_primary boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index customer_contacts_customer_idx on public.customer_contacts (customer_id);
create trigger customer_contacts_updated_at before update on public.customer_contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Fasta prislistor (tillägg – påverkar inte tjänstekatalogen)
-- ---------------------------------------------------------------------------
create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  customer_id uuid,
  is_default boolean not null default false,
  valid_from date,
  valid_to date,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (not (is_default and customer_id is not null)),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create unique index price_lists_one_default_idx on public.price_lists (organization_id) where is_default;
create index price_lists_org_idx on public.price_lists (organization_id, active);
create index price_lists_customer_idx on public.price_lists (customer_id);
create trigger price_lists_updated_at before update on public.price_lists
  for each row execute function public.set_updated_at();

create table public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  price_list_id uuid not null,
  service_id uuid,
  sku text check (sku is null or char_length(sku) <= 60),
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 1000),
  unit text not null default 'st' check (char_length(unit) between 1 and 16),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  vat_rate numeric(5,2) not null default 25 check (vat_rate between 0 and 100),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (price_list_id, organization_id) references public.price_lists (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id) references public.services (id, organization_id) on delete set null (service_id)
);
create index price_list_items_list_idx on public.price_list_items (price_list_id, sort);
create trigger price_list_items_updated_at before update on public.price_list_items
  for each row execute function public.set_updated_at();

-- Mängdrabatter: fast pris per enhet från en viss mängd
create table public.price_list_item_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null,
  min_quantity numeric(12,3) not null check (min_quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now(),
  unique (item_id, min_quantity),
  foreign key (item_id, organization_id) references public.price_list_items (id, organization_id) on delete cascade
);

-- Prishistorik: varje ändring loggas automatiskt (order påverkas aldrig – de har egna kopior)
create table public.price_list_item_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null,
  old_unit_price numeric(12,2),
  new_unit_price numeric(12,2),
  old_vat_rate numeric(5,2),
  new_vat_rate numeric(5,2),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  foreign key (item_id, organization_id) references public.price_list_items (id, organization_id) on delete cascade
);
create index price_list_item_history_item_idx on public.price_list_item_history (item_id, changed_at desc);

create or replace function public.price_list_items_log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.unit_price, new.vat_rate) is distinct from (old.unit_price, old.vat_rate) then
    insert into public.price_list_item_history (organization_id, item_id, old_unit_price, new_unit_price, old_vat_rate, new_vat_rate, changed_by)
    values (new.organization_id, new.id, old.unit_price, new.unit_price, old.vat_rate, new.vat_rate, auth.uid());
  end if;
  return null;
end $$;
create trigger price_list_items_log_change after update on public.price_list_items
  for each row execute function public.price_list_items_log_change();

-- ---------------------------------------------------------------------------
-- Avtal
-- ---------------------------------------------------------------------------
create table public.customer_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  start_date date not null,
  end_date date,
  notice_days integer not null default 30 check (notice_days between 0 and 365),
  auto_renew boolean not null default false,
  renewal_months integer not null default 12 check (renewal_months between 1 and 60),
  price_list_id uuid,
  terms text check (terms is null or char_length(terms) <= 8000),
  status public.agreement_status not null default 'active',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (end_date is null or end_date >= start_date),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (price_list_id, organization_id) references public.price_lists (id, organization_id) on delete set null (price_list_id)
);
create index customer_agreements_customer_idx on public.customer_agreements (customer_id);
create index customer_agreements_end_idx on public.customer_agreements (organization_id, status, end_date);
create trigger customer_agreements_updated_at before update on public.customer_agreements
  for each row execute function public.set_updated_at();

create or replace function public.customer_agreements_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.organization_id, 'agreement.created', 'customer', new.customer_id,
      jsonb_build_object('title', new.title, 'start', new.start_date, 'end', new.end_date));
  elsif (new.status, new.end_date, new.start_date) is distinct from (old.status, old.end_date, old.start_date) then
    perform public.log_activity(new.organization_id, 'agreement.updated', 'customer', new.customer_id,
      jsonb_build_object('title', new.title, 'status', new.status, 'end', new.end_date, 'previous_end', old.end_date));
  end if;
  return null;
end $$;
create trigger customer_agreements_log after insert or update on public.customer_agreements
  for each row execute function public.customer_agreements_log();

-- ---------------------------------------------------------------------------
-- Order
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  customer_id uuid not null,
  contact_id uuid,
  agreement_id uuid,
  price_list_id uuid,
  quotation_id uuid,
  recurring_order_id uuid,
  occurrence_date date,
  status public.order_status not null default 'draft',
  source public.order_source not null default 'manual',
  requested_delivery_date date,
  delivery_date date,
  delivery_address text check (delivery_address is null or char_length(delivery_address) <= 500),
  customer_reference text check (customer_reference is null or char_length(customer_reference) <= 120),
  notes_internal text check (notes_internal is null or char_length(notes_internal) <= 4000),
  notes_customer text check (notes_customer is null or char_length(notes_customer) <= 4000),
  payment_terms_days integer not null check (payment_terms_days between 0 and 365),
  discount_percent numeric(5,2) not null check (discount_percent between 0 and 100),
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  vat_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  requires_manual_input boolean not null default false,
  ai_generated boolean not null default false,
  ai_warnings jsonb,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (recurring_order_id, occurrence_date),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  foreign key (contact_id, organization_id) references public.customer_contacts (id, organization_id) on delete set null (contact_id),
  foreign key (agreement_id, organization_id) references public.customer_agreements (id, organization_id) on delete set null (agreement_id),
  foreign key (price_list_id, organization_id) references public.price_lists (id, organization_id) on delete set null (price_list_id),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id) on delete set null (quotation_id)
);
create index orders_org_status_idx on public.orders (organization_id, status, created_at desc);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null,
  -- Referens till prislistan, men pris/moms/beskrivning är KOPIOR så historiken aldrig ändras
  price_list_item_id uuid,
  sku text check (sku is null or char_length(sku) <= 60),
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 1000000),
  unit text not null default 'st' check (char_length(unit) between 1 and 16),
  unit_price numeric(12,2) check (unit_price is null or unit_price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  vat_rate numeric(5,2) not null default 25 check (vat_rate between 0 and 100),
  line_total numeric(12,2) not null default 0,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (order_id, organization_id) references public.orders (id, organization_id) on delete cascade,
  foreign key (price_list_item_id, organization_id) references public.price_list_items (id, organization_id) on delete set null (price_list_item_id)
);
create index order_items_order_idx on public.order_items (order_id, sort);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null,
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (order_id, organization_id) references public.orders (id, organization_id) on delete cascade
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

-- Uppföljningsuppgifter kan nu gälla kund, avtal och order – inte bara leads
alter table public.follow_up_tasks
  alter column lead_id drop not null,
  add column customer_id uuid,
  add column agreement_id uuid,
  add column order_id uuid,
  add column dedupe_key text,
  add constraint follow_up_tasks_customer_fk foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade,
  add constraint follow_up_tasks_agreement_fk foreign key (agreement_id, organization_id) references public.customer_agreements (id, organization_id) on delete cascade,
  add constraint follow_up_tasks_order_fk foreign key (order_id, organization_id) references public.orders (id, organization_id) on delete cascade,
  add constraint follow_up_tasks_target check (lead_id is not null or customer_id is not null);
create unique index follow_up_tasks_dedupe_key_idx on public.follow_up_tasks (organization_id, dedupe_key) where dedupe_key is not null;
create index follow_up_tasks_customer_idx on public.follow_up_tasks (customer_id) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- Prisuppslag
-- ---------------------------------------------------------------------------
-- Pris per enhet med mängdrabatt: högsta trappsteg som mängden når, annars grundpriset
-- SECURITY INVOKER: vid direkta anrop gäller RLS (bara egna artiklar); inuti serverfunktioner körs den som ägaren.
create or replace function public.effective_unit_price(item uuid, qty numeric) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(
    (select t.unit_price from public.price_list_item_tiers t
      where t.item_id = i.id and t.min_quantity <= qty order by t.min_quantity desc limit 1),
    i.unit_price)
  from public.price_list_items i where i.id = item;
$$;

-- Kundens gällande prisbild: kundspecifika listor går före avtalets lista, som går före standardlistan.
-- Samma artikel (artikelnummer, annars namn) visas bara en gång med det mest specifika priset.
create or replace function public.price_catalog_for(cust uuid)
returns table (item_id uuid, price_list_id uuid, price_list_name text, customer_specific boolean, sku text, name text,
  description text, unit text, unit_price numeric, vat_rate numeric, tiers jsonb)
language sql stable security definer set search_path = '' as $$
  with c as (select id, organization_id from public.customers where id = cust),
  agreement_lists as (
    select a.price_list_id from public.customer_agreements a
     where a.customer_id = cust and a.status = 'active' and a.price_list_id is not null
       and a.start_date <= public.stockholm_today() and (a.end_date is null or a.end_date >= public.stockholm_today())
  ),
  lists as (
    select pl.id, pl.name, pl.customer_id is not null as specific,
           case when pl.customer_id is not null then 0 when pl.id in (select price_list_id from agreement_lists) then 1 else 2 end as prio
      from public.price_lists pl join c on c.organization_id = pl.organization_id
     where pl.active
       and (pl.valid_from is null or pl.valid_from <= public.stockholm_today())
       and (pl.valid_to is null or pl.valid_to >= public.stockholm_today())
       and (pl.customer_id = cust or pl.is_default or pl.id in (select price_list_id from agreement_lists))
  ),
  items as (
    select i.*, l.name as list_name, l.specific, l.prio,
           coalesce(nullif(lower(trim(i.sku)), ''), lower(trim(i.name))) as match_key
      from public.price_list_items i join lists l on l.id = i.price_list_id
     where i.active
  ),
  ranked as (select *, row_number() over (partition by match_key order by prio, sort, created_at) as rn from items)
  select r.id, r.price_list_id, r.list_name, r.specific, r.sku, r.name, r.description, r.unit, r.unit_price, r.vat_rate,
         coalesce((select jsonb_agg(jsonb_build_object('min_quantity', t.min_quantity, 'unit_price', t.unit_price) order by t.min_quantity)
                     from public.price_list_item_tiers t where t.item_id = r.id), '[]'::jsonb)
    from ranked r where r.rn = 1
   order by r.sort, r.name;
$$;

create or replace function public.customer_price_catalog(cust uuid)
returns table (item_id uuid, price_list_id uuid, price_list_name text, customer_specific boolean, sku text, name text,
  description text, unit text, unit_price numeric, vat_rate numeric, tiers jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare org uuid;
begin
  select organization_id into org from public.customers where id = cust;
  if org is null then raise exception 'Kunden hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(org);
  return query select * from public.price_catalog_for(cust);
end $$;

-- ---------------------------------------------------------------------------
-- Ordernummer, standardvärden, låsning och summering (samma algoritm som offerter, utan ROT)
-- ---------------------------------------------------------------------------
create or replace function public.orders_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.organization_settings; c public.customers;
begin
  select * into s from public.organization_settings where organization_id = new.organization_id for update;
  if not found then raise exception 'Företagsinställningar saknas' using errcode = 'P0001'; end if;
  select * into c from public.customers where id = new.customer_id and organization_id = new.organization_id;
  if not found then raise exception 'Kunden hittades inte' using errcode = 'P0002'; end if;
  new.number := s.order_number_prefix || '-' || s.next_order_number;
  update public.organization_settings set next_order_number = next_order_number + 1 where organization_id = new.organization_id;
  if coalesce(current_setting('offertpilot.system', true), '') <> 'on' then
    new.status := 'draft';
    new.source := case when new.quotation_id is not null then 'quote'::public.order_source else 'manual'::public.order_source end;
    new.recurring_order_id := null;
    new.occurrence_date := null;
  end if;
  new.payment_terms_days := coalesce(new.payment_terms_days, c.payment_terms_days);
  new.discount_percent := coalesce(new.discount_percent, c.discount_percent);
  new.delivery_address := coalesce(new.delivery_address,
    nullif(concat_ws(', ', c.delivery_address, nullif(concat_ws(' ', c.delivery_postal_code, c.delivery_city), '')), ''));
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger orders_before_insert before insert on public.orders
  for each row execute function public.orders_before_insert();

create or replace function public.orders_compute_totals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sub numeric := 0; disc numeric := 0; ratio numeric := 0; vat numeric := 0; manual boolean := false;
begin
  if tg_op = 'UPDATE' and old.status not in ('draft', 'pending_approval')
     and coalesce(current_setting('offertpilot.system', true), '') <> 'on'
     and (new.customer_id, new.contact_id, new.agreement_id, new.price_list_id, new.requested_delivery_date, new.delivery_address,
          new.customer_reference, new.notes_customer, new.payment_terms_days, new.discount_percent)
         is distinct from
         (old.customer_id, old.contact_id, old.agreement_id, old.price_list_id, old.requested_delivery_date, old.delivery_address,
          old.customer_reference, old.notes_customer, old.payment_terms_days, old.discount_percent) then
    raise exception 'Ordern är bekräftad och låst. Endast leveransdatum och interna anteckningar kan ändras.' using errcode = 'P0001';
  end if;
  select coalesce(sum(line_total), 0), coalesce(bool_or(unit_price is null), false) into sub, manual
    from public.order_items where order_id = new.id;
  disc := round(sub * new.discount_percent / 100, 2);
  if sub > 0 then ratio := disc / sub; end if;
  select coalesce(sum(line_total * (1 - ratio) * vat_rate / 100), 0) into vat from public.order_items where order_id = new.id;
  new.subtotal := sub;
  new.discount_total := disc;
  new.vat_total := round(vat, 2);
  new.total := sub - disc + round(vat, 2);
  new.requires_manual_input := manual;
  return new;
end $$;
create trigger orders_compute_totals before update on public.orders
  for each row execute function public.orders_compute_totals();

create or replace function public.order_items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st public.order_status; oid uuid := coalesce(new.order_id, old.order_id);
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select status into st from public.orders where id = oid;
  if st not in ('draft', 'pending_approval') and coalesce(current_setting('offertpilot.system', true), '') <> 'on' then
    raise exception 'Orderrader kan bara ändras innan ordern bekräftas' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.order_id <> old.order_id then
    raise exception 'En rad kan inte flyttas mellan order' using errcode = 'P0001';
  end if;
  new.line_total := round(new.quantity * coalesce(new.unit_price, 0) * (1 - new.discount_percent / 100), 2);
  return new;
end $$;
create trigger order_items_guard before insert or update or delete on public.order_items
  for each row execute function public.order_items_guard();

create or replace function public.order_items_touch_parent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return null; end if;
  update public.orders set updated_at = now() where id = coalesce(new.order_id, old.order_id);
  return null;
end $$;
create trigger order_items_touch_parent after insert or update or delete on public.order_items
  for each row execute function public.order_items_touch_parent();

-- Statushistorik och aktivitetslogg skrivs automatiskt
create or replace function public.orders_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (organization_id, order_id, from_status, to_status, changed_by)
    values (new.organization_id, new.id, null, new.status, auth.uid());
    perform public.log_activity(new.organization_id, 'order.created', 'order', new.id,
      jsonb_build_object('number', new.number, 'source', new.source));
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (organization_id, order_id, from_status, to_status, changed_by, note)
    values (new.organization_id, new.id, old.status, new.status, auth.uid(), nullif(current_setting('offertpilot.status_note', true), ''));
    perform public.log_activity(new.organization_id, 'order.status_changed', 'order', new.id,
      jsonb_build_object('number', new.number, 'from', old.status, 'to', new.status));
  end if;
  return null;
end $$;
create trigger orders_after_change after insert or update of status on public.orders
  for each row execute function public.orders_after_change();

-- ---------------------------------------------------------------------------
-- Orderfunktioner
-- ---------------------------------------------------------------------------
create or replace function public.set_order_status(oid uuid, new_status public.order_status, note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = oid for update;
  if not found then raise exception 'Ordern hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(o.organization_id);
  if not (
    (o.status = 'draft' and new_status in ('pending_approval', 'confirmed', 'cancelled')) or
    (o.status = 'pending_approval' and new_status in ('draft', 'confirmed', 'cancelled')) or
    (o.status = 'confirmed' and new_status in ('in_progress', 'delivered', 'cancelled')) or
    (o.status = 'in_progress' and new_status in ('delivered', 'cancelled'))
  ) then
    raise exception 'Ordern kan inte gå från denna status till den valda' using errcode = 'P0001';
  end if;
  if new_status = 'confirmed' then
    if not exists (select 1 from public.order_items where order_id = oid) then
      raise exception 'Ordern saknar rader' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.order_items where order_id = oid and unit_price is null) then
      raise exception 'Alla rader måste ha ett pris innan ordern kan bekräftas' using errcode = 'P0001';
    end if;
  end if;
  perform set_config('offertpilot.system', 'on', true);
  perform set_config('offertpilot.status_note', coalesce(left(note, 1000), ''), true);
  update public.orders set status = new_status,
         confirmed_at = case when new_status = 'confirmed' then now() else confirmed_at end,
         confirmed_by = case when new_status = 'confirmed' then auth.uid() else confirmed_by end,
         delivery_date = case when new_status = 'delivered' then coalesce(delivery_date, public.stockholm_today()) else delivery_date end
   where id = oid;
  perform set_config('offertpilot.system', 'off', true);
  perform set_config('offertpilot.status_note', '', true);
  if new_status in ('confirmed', 'cancelled') then
    update public.follow_up_tasks set status = 'done', completed_at = now(), completed_by = auth.uid()
     where order_id = oid and kind in ('order_approval', 'recurring_order') and status = 'pending';
  end if;
end $$;

-- Kopierar en order som nytt utkast. Rader kopplade till en aktiv prislisteartikel får dagens pris.
create or replace function public.duplicate_order(oid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.orders; nid uuid;
begin
  select * into o from public.orders where id = oid;
  if not found then raise exception 'Ordern hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(o.organization_id);
  insert into public.orders (organization_id, customer_id, contact_id, agreement_id, price_list_id, delivery_address,
                             notes_customer, payment_terms_days, discount_percent)
  values (o.organization_id, o.customer_id, o.contact_id, o.agreement_id, o.price_list_id, o.delivery_address,
          o.notes_customer, (select payment_terms_days from public.customers where id = o.customer_id),
          (select discount_percent from public.customers where id = o.customer_id))
  returning id into nid;
  insert into public.order_items (organization_id, order_id, price_list_item_id, sku, description, quantity, unit, unit_price, discount_percent, vat_rate, sort)
  select i.organization_id, nid, case when p.active then i.price_list_item_id end, i.sku, i.description, i.quantity, i.unit,
         case when p.active then public.effective_unit_price(p.id, i.quantity) else i.unit_price end,
         i.discount_percent, case when p.active then p.vat_rate else i.vat_rate end, i.sort
    from public.order_items i left join public.price_list_items p on p.id = i.price_list_item_id
   where i.order_id = oid;
  perform public.log_activity(o.organization_id, 'order.duplicated', 'order', nid, jsonb_build_object('from', o.number));
  return nid;
end $$;

-- Skapar en order från en accepterad offert (offertens priser följer med oförändrade)
create or replace function public.order_from_quotation(qid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare q public.quotations; nid uuid; pct numeric := 0;
begin
  select * into q from public.quotations where id = qid;
  if not found then raise exception 'Offerten hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(q.organization_id);
  if q.status <> 'accepted' then raise exception 'Endast accepterade offerter kan bli order' using errcode = 'P0001'; end if;
  if q.discount_type = 'percent' then pct := q.discount_value; end if;
  insert into public.orders (organization_id, customer_id, quotation_id, discount_percent, notes_customer)
  values (q.organization_id, q.customer_id, q.id, pct, q.project_description) returning id into nid;
  insert into public.order_items (organization_id, order_id, description, quantity, unit, unit_price, discount_percent, vat_rate, sort)
  select organization_id, nid, description, quantity, unit, unit_price, discount_percent, vat_rate, sort
    from public.quotation_items where quotation_id = qid;
  if q.discount_type = 'amount' and q.discount_value > 0 then
    update public.orders set ai_warnings = '["Offertens rabatt i kronor har inte förts över – lägg till den manuellt vid behov."]'::jsonb where id = nid;
  end if;
  return nid;
end $$;

create or replace function public.duplicate_price_list(pl uuid, new_name text, for_customer uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare src public.price_lists; nid uuid;
begin
  select * into src from public.price_lists where id = pl;
  if not found then raise exception 'Prislistan hittades inte' using errcode = 'P0002'; end if;
  perform public.require_admin(src.organization_id);
  if not public.has_feature(src.organization_id, 'price_lists') then
    raise exception 'Prislistor ingår inte i din plan' using errcode = '42501';
  end if;
  if for_customer is not null and not exists (select 1 from public.customers where id = for_customer and organization_id = src.organization_id) then
    raise exception 'Kunden hittades inte' using errcode = 'P0002';
  end if;
  insert into public.price_lists (organization_id, name, description, customer_id, valid_from, valid_to, active, created_by)
  values (src.organization_id, left(coalesce(nullif(trim(new_name), ''), src.name || ' (kopia)'), 160), src.description, for_customer,
          src.valid_from, src.valid_to, true, auth.uid())
  returning id into nid;
  with copied as (
    insert into public.price_list_items (organization_id, price_list_id, service_id, sku, name, description, unit, unit_price, vat_rate, active, sort)
    select organization_id, nid, service_id, sku, name, description, unit, unit_price, vat_rate, active, sort
      from public.price_list_items where price_list_id = pl
    returning id, coalesce(sku, '') || '|' || name || '|' || sort as k
  ), src_items as (
    select id, coalesce(sku, '') || '|' || name || '|' || sort as k from public.price_list_items where price_list_id = pl
  )
  insert into public.price_list_item_tiers (organization_id, item_id, min_quantity, unit_price)
  select src.organization_id, c.id, t.min_quantity, t.unit_price
    from public.price_list_item_tiers t join src_items s on s.id = t.item_id join copied c on c.k = s.k
  on conflict (item_id, min_quantity) do nothing;
  return nid;
end $$;

-- ---------------------------------------------------------------------------
-- Rättigheter och RLS för nya tabeller
-- ---------------------------------------------------------------------------
revoke all on public.customer_contacts, public.price_lists, public.price_list_items, public.price_list_item_tiers,
  public.price_list_item_history, public.customer_agreements, public.orders, public.order_items, public.order_status_history
  from anon, authenticated;

grant select, insert, update, delete on public.customer_contacts, public.price_lists, public.price_list_items,
  public.price_list_item_tiers, public.customer_agreements to authenticated;
grant select on public.price_list_item_history, public.order_status_history to authenticated;

grant select, delete on public.orders to authenticated;
grant insert (organization_id, customer_id, contact_id, agreement_id, price_list_id, quotation_id, requested_delivery_date,
  delivery_date, delivery_address, customer_reference, notes_internal, notes_customer, payment_terms_days, discount_percent)
  on public.orders to authenticated;
grant update (contact_id, agreement_id, price_list_id, requested_delivery_date, delivery_date, delivery_address,
  customer_reference, notes_internal, notes_customer, payment_terms_days, discount_percent)
  on public.orders to authenticated;

grant select, delete on public.order_items to authenticated;
grant insert (organization_id, order_id, price_list_item_id, sku, description, quantity, unit, unit_price, discount_percent, vat_rate, sort)
  on public.order_items to authenticated;
grant update (price_list_item_id, sku, description, quantity, unit, unit_price, discount_percent, vat_rate, sort)
  on public.order_items to authenticated;

alter table public.customer_contacts enable row level security;
alter table public.price_lists enable row level security;
alter table public.price_list_items enable row level security;
alter table public.price_list_item_tiers enable row level security;
alter table public.price_list_item_history enable row level security;
alter table public.customer_agreements enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

-- Läsning: alla medlemmar
do $$
declare t text;
begin
  foreach t in array array['customer_contacts', 'price_lists', 'price_list_items', 'price_list_item_tiers',
                           'price_list_item_history', 'customer_agreements', 'orders', 'order_items', 'order_status_history'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.is_org_member(organization_id))', t);
  end loop;
end $$;

-- Prislistor och avtal: administratörer ändrar (prislistor kräver att funktionen ingår i planen)
do $$
declare t text;
begin
  foreach t in array array['price_lists', 'price_list_items', 'price_list_item_tiers'] loop
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (public.is_org_admin(organization_id) and public.has_feature(organization_id, ''price_lists''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated
      using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id) and public.has_feature(organization_id, ''price_lists''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_org_admin(organization_id))', t);
  end loop;
end $$;
create policy customer_agreements_insert on public.customer_agreements for insert to authenticated with check (public.is_org_admin(organization_id));
create policy customer_agreements_update on public.customer_agreements for update to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy customer_agreements_delete on public.customer_agreements for delete to authenticated using (public.is_org_admin(organization_id));

-- Kontakter och order: alla medlemmar skapar och ändrar
create policy customer_contacts_insert on public.customer_contacts for insert to authenticated with check (public.is_org_member(organization_id));
create policy customer_contacts_update on public.customer_contacts for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy customer_contacts_delete on public.customer_contacts for delete to authenticated using (public.is_org_member(organization_id));

create policy orders_insert on public.orders for insert to authenticated
  with check (public.is_org_member(organization_id) and public.has_feature(organization_id, 'orders'));
create policy orders_update on public.orders for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy orders_delete on public.orders for delete to authenticated
  using (public.is_org_member(organization_id) and status = 'draft');
create policy order_items_insert on public.order_items for insert to authenticated with check (public.is_org_member(organization_id));
create policy order_items_update on public.order_items for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy order_items_delete on public.order_items for delete to authenticated using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Funktionsrättigheter
-- ---------------------------------------------------------------------------
revoke execute on function public.is_internal_call(), public.has_feature(uuid, text), public.stockholm_today(),
  public.customers_assign_number(), public.price_list_items_log_change(), public.customer_agreements_log(),
  public.effective_unit_price(uuid, numeric), public.price_catalog_for(uuid), public.customer_price_catalog(uuid),
  public.orders_before_insert(), public.orders_compute_totals(), public.order_items_guard(), public.order_items_touch_parent(),
  public.orders_after_change(), public.set_order_status(uuid, public.order_status, text), public.duplicate_order(uuid),
  public.order_from_quotation(uuid), public.duplicate_price_list(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.customer_price_catalog(uuid), public.set_order_status(uuid, public.order_status, text),
  public.effective_unit_price(uuid, numeric),
  public.duplicate_order(uuid), public.order_from_quotation(uuid), public.duplicate_price_list(uuid, text, uuid),
  public.has_feature(uuid, text)
  to authenticated;
grant execute on all functions in schema public to service_role;
