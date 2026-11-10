-- Affärssystem: prislistor, avtalskunder, order, återkommande order och kundportal.
-- Kör med: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.reset_role() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'agare@packeri.se', now(), 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000002', 'anstalld@packeri.se', now(), 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000001', 'agare@konkurrent.se', now(), 'authenticated', 'authenticated'),
  ('c0000000-0000-0000-0000-000000000001', 'inkop@fiskhandel.se', now(), 'authenticated', 'authenticated'),
  ('c0000000-0000-0000-0000-000000000002', 'inkop@restaurang.se', now(), 'authenticated', 'authenticated');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select public.create_organization('{"name":"Västkust Packeri AB"}');
select pg_temp.act_as('b0000000-0000-0000-0000-000000000001');
select public.create_organization('{"name":"Konkurrent AB"}');
select pg_temp.reset_role();

create temp table ids as select
  (select id from public.organizations where name = 'Västkust Packeri AB') as org_a,
  (select id from public.organizations where name = 'Konkurrent AB') as org_b;
grant select on ids to authenticated;
update public.subscriptions set plan_id = 'professional' where organization_id = (select org_a from ids);
insert into public.organization_members (organization_id, user_id, role, email)
  select org_a, 'a0000000-0000-0000-0000-000000000002', 'employee', 'anstalld@packeri.se' from ids;

-- ---------------------------------------------------------------- avtalskunder
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
insert into public.customers (organization_id, name, email, status, payment_terms_days, discount_percent)
  select org_a, 'Fiskhandeln i Göteborg AB', 'inkop@fiskhandel.se', 'active', 20, 5 from ids;
insert into public.customers (organization_id, name, email, status)
  select org_a, 'Restaurang Hamnen', 'inkop@restaurang.se', 'active' from ids;
select is((select customer_number from public.customers where name = 'Fiskhandeln i Göteborg AB'), 1001, 'kundnummer tilldelas automatiskt');
select is((select customer_number from public.customers where name = 'Restaurang Hamnen'), 1002, 'kundnummer är löpande per företag');

select pg_temp.reset_role();
create temp table c as select
  (select id from public.customers where name = 'Fiskhandeln i Göteborg AB') as fisk,
  (select id from public.customers where name = 'Restaurang Hamnen') as rest;
grant select on c to authenticated;

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
insert into public.customer_contacts (organization_id, customer_id, name, email, is_primary)
  select org_a, fisk, 'Eva Inköp', 'inkop@fiskhandel.se', true from ids, c;
select is((select count(*)::int from public.customer_contacts), 1, 'kontaktperson sparas');

-- ---------------------------------------------------------------- prislistor
insert into public.price_lists (organization_id, name, is_default) select org_a, 'Standard 2026', true from ids;
insert into public.price_list_items (organization_id, price_list_id, sku, name, unit, unit_price, vat_rate)
  select org_a, (select id from public.price_lists where name = 'Standard 2026'), 'RAK-1', 'Packning räkor', 'kg', 42.00, 12 from ids;
insert into public.price_list_items (organization_id, price_list_id, sku, name, unit, unit_price, vat_rate)
  select org_a, (select id from public.price_lists where name = 'Standard 2026'), 'PALL', 'Pallhantering', 'pall', 150.00, 25 from ids;
insert into public.price_list_item_tiers (organization_id, item_id, min_quantity, unit_price)
  select org_a, (select id from public.price_list_items where sku = 'RAK-1'), 500, 38.00 from ids;

select is(public.effective_unit_price((select id from public.price_list_items where sku = 'RAK-1'), 100), 42.00::numeric, 'grundpris under mängdrabatt');
select is(public.effective_unit_price((select id from public.price_list_items where sku = 'RAK-1'), 500), 38.00::numeric, 'mängdrabatt från 500 kg');

-- Kundspecifik lista går före standardlistan för samma artikel
select lives_ok($$ select public.duplicate_price_list((select id from public.price_lists where name = 'Standard 2026'), 'Fiskhandeln avtalspris', (select fisk from c)) $$,
  'duplicera prislista till kundspecifik lista');
update public.price_list_items set unit_price = 40.00
 where sku = 'RAK-1' and price_list_id = (select id from public.price_lists where name = 'Fiskhandeln avtalspris');
select is((select count(*)::int from public.price_list_item_tiers t join public.price_list_items i on i.id = t.item_id
            where i.price_list_id = (select id from public.price_lists where name = 'Fiskhandeln avtalspris')), 1, 'mängdrabatter följer med vid duplicering');
select is((select unit_price from public.customer_price_catalog((select fisk from c)) where sku = 'RAK-1'), 40.00::numeric, 'kundens avtalspris gäller');
select is((select unit_price from public.customer_price_catalog((select rest from c)) where sku = 'RAK-1'), 42.00::numeric, 'andra kunder får standardpris');
select is((select count(*)::int from public.customer_price_catalog((select fisk from c))), 2, 'samma artikel visas bara en gång');

-- Anställd kan läsa men inte ändra prislistor
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
update public.price_list_items set unit_price = 1 where sku = 'PALL';
select is((select unit_price from public.price_list_items where sku = 'PALL' and price_list_id = (select id from public.price_lists where name = 'Standard 2026')),
  150.00::numeric, 'anställd kan inte ändra prislistor');

-- ---------------------------------------------------------------- order
insert into public.orders (organization_id, customer_id) select org_a, fisk from ids, c;
select is((select number from public.orders), 'ORD-1001', 'ordernummer tilldelas av servern');
select is((select payment_terms_days from public.orders), 20, 'betalningsvillkor hämtas från kunden');
select is((select discount_percent from public.orders), 5.00::numeric(5,2), 'kundrabatt hämtas från kunden');
insert into public.order_items (organization_id, order_id, price_list_item_id, description, quantity, unit, unit_price, vat_rate)
  select org_a, (select id from public.orders), (select item_id from public.customer_price_catalog((select fisk from c)) where sku = 'RAK-1'),
         'Packning räkor', 500, 'kg', 38.00, 12 from ids;
insert into public.order_items (organization_id, order_id, description, quantity, unit, unit_price, vat_rate)
  select org_a, (select id from public.orders), 'Specialemballage', 1, 'st', null, 25 from ids;
select is((select subtotal from public.orders), 19000.00::numeric(12,2), 'delsumma');
select is((select discount_total from public.orders), 950.00::numeric(12,2), 'kundrabatt 5 %');
select is((select vat_total from public.orders), 2166.00::numeric(12,2), 'moms 12 % efter rabatt');
select is((select total from public.orders), 20216.00::numeric(12,2), 'totalsumma');
select throws_ok($$ select public.set_order_status((select id from public.orders), 'confirmed') $$, 'P0001',
  'Alla rader måste ha ett pris innan ordern kan bekräftas', 'kan inte bekräfta order med pris som saknas');
update public.order_items set unit_price = 95 where unit_price is null;
select throws_ok($$ update public.orders set status = 'confirmed' $$, '42501', null, 'status kan inte sättas direkt');
select lives_ok($$ select public.set_order_status((select id from public.orders), 'confirmed', 'Bekräftad per telefon') $$, 'anställd bekräftar order');
select throws_ok($$ update public.order_items set quantity = 1 $$, 'P0001', 'Orderrader kan bara ändras innan ordern bekräftas', 'bekräftade rader är låsta');
select throws_ok($$ update public.orders set discount_percent = 50 $$, 'P0001', null, 'bekräftad order är låst');
select lives_ok($$ update public.orders set notes_internal = 'Hämtas kl 7' $$, 'interna anteckningar kan ändras efter bekräftelse');
select is((select count(*)::int from public.order_status_history), 2, 'statushistorik sparas');
select is((select note from public.order_status_history where to_status = 'confirmed'), 'Bekräftad per telefon', 'kommentar sparas i historiken');

-- Prisändring påverkar inte historiska order
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
update public.price_list_item_tiers set unit_price = 36.00;
select is((select unit_price from public.order_items where description = 'Packning räkor'), 38.00::numeric(12,2), 'historiskt orderpris är oförändrat');
select is((select count(*)::int from public.price_list_item_history), 1, 'prisändringar loggas');
select lives_ok($$ select public.duplicate_order((select id from public.orders where number = 'ORD-1001')) $$, 'duplicera order');
select is((select unit_price from public.order_items i join public.orders o on o.id = i.order_id
            where o.number = 'ORD-1002' and i.description = 'Packning räkor'), 36.00::numeric(12,2), 'duplicerad order får dagens avtalade pris');
select is((select status::text from public.orders where number = 'ORD-1002'), 'draft', 'duplicerad order är ett utkast');

-- ---------------------------------------------------------------- isolering
select pg_temp.act_as('b0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.price_lists), 0, 'B ser inga prislistor från A');
select is((select count(*)::int from public.price_list_items), 0, 'B ser inga artiklar från A');
select is((select count(*)::int from public.orders), 0, 'B ser inga order från A');
select is((select count(*)::int from public.order_items), 0, 'B ser inga orderrader från A');
select is((select count(*)::int from public.customer_contacts), 0, 'B ser inga kontakter från A');
select throws_ok($$ select * from public.customer_price_catalog((select fisk from c)) $$, '42501', null, 'B kan inte läsa A:s kundpriser');
select throws_ok($$ select public.duplicate_order((select id from public.orders where number = 'ORD-1001')) $$, 'P0002', null, 'B kan inte duplicera A:s order');
reset role;
create temp table a_order as select id from public.orders where number = 'ORD-1002';
grant select on a_order to authenticated;
select pg_temp.act_as('b0000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.order_items (organization_id, order_id, description, quantity, unit_price)
  select org_b, (select id from a_order), 'Intrång', 1, 1 from ids $$, '23503', null, 'B kan inte lägga rader i A:s order');

-- ---------------------------------------------------------------- återkommande order
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
insert into public.recurring_orders (organization_id, customer_id, title, frequency, weekdays, start_date, lead_days)
  select org_a, fisk, 'Räkor varje måndag', 'weekly', array[1]::smallint[], public.stockholm_today(), 7 from ids, c;
insert into public.recurring_order_items (organization_id, recurring_order_id, price_list_item_id, description, quantity, unit)
  select org_a, (select id from public.recurring_orders), (select item_id from public.customer_price_catalog((select fisk from c)) where sku = 'RAK-1'),
         'Packning räkor', 500, 'kg' from ids;
select is(extract(isodow from (select next_occurrence from public.recurring_orders))::int, 1, 'nästa tillfälle är en måndag');
select is(public.generate_recurring_orders((select org_a from ids)), 1, 'en order förbereds inför nästa måndag');
select is(public.generate_recurring_orders((select org_a from ids)), 0, 'andra körningen skapar ingen dubblett');
select is((select status::text from public.orders where source = 'recurring'), 'pending_approval', 'förberedd order väntar på godkännande');
select is((select unit_price from public.order_items i join public.orders o on o.id = i.order_id where o.source = 'recurring'),
  36.00::numeric(12,2), 'återkommande order får dagens avtalade pris med mängdrabatt');
select is((select count(*)::int from public.follow_up_tasks where kind = 'recurring_order'), 1, 'påminnelse om godkännande skapas');
select ok((select next_occurrence from public.recurring_orders) > (select occurrence_date from public.orders where source = 'recurring'), 'nästa tillfälle flyttas fram');
update public.recurring_orders set status = 'paused';
select is((select next_occurrence from public.recurring_orders), null, 'pausad återkommande order har inget nästa tillfälle');
update public.recurring_orders set status = 'active';
select ok((select next_occurrence from public.recurring_orders) is not null, 'återupptagen order får nytt tillfälle');
select is(public.recurring_next('monthly', 1, null, 31::smallint, '2026-01-31', '2026-02-01', null), '2026-02-28'::date, 'den 31:a blir sista dagen i februari');
select is(public.recurring_next('monthly', 1, null, 31::smallint, '2026-01-31', '2026-03-01', null), '2026-03-31'::date, 'och den 31:a i mars');
select is(public.recurring_next('daily', 3, null, null, '2026-01-01', '2026-01-02', null), '2026-01-04'::date, 'var tredje dag');
select is(public.recurring_next('weekly', 2, array[3]::smallint[], null, '2026-11-02', '2026-11-05', null), '2026-11-18'::date, 'onsdag varannan vecka');

-- ---------------------------------------------------------------- avtal och påminnelser
insert into public.customer_agreements (organization_id, customer_id, title, start_date, end_date, notice_days)
  select org_a, fisk, 'Ramavtal packning', public.stockholm_today() - 300, public.stockholm_today() + 20, 30 from ids, c;
insert into public.customer_agreements (organization_id, customer_id, title, start_date, end_date, auto_renew, renewal_months)
  select org_a, rest, 'Löpande avtal', public.stockholm_today() - 400, public.stockholm_today() - 5, true, 12 from ids, c;
select lives_ok($$ select public.refresh_business((select org_a from ids)) $$, 'påminnelser uppdateras');
select is((select count(*)::int from public.follow_up_tasks where kind = 'agreement_renewal'), 1, 'påminnelse om avtal som löper ut');
select ok((select end_date from public.customer_agreements where title = 'Löpande avtal') >= public.stockholm_today(), 'avtal med automatisk förlängning förlängs');
select lives_ok($$ select public.refresh_business((select org_a from ids)) $$, 'kan köras flera gånger');
select is((select count(*)::int from public.follow_up_tasks where kind = 'agreement_renewal'), 1, 'inga dubbla påminnelser');
select ok((public.business_stats((select org_a from ids)) ->> 'active_customers')::int = 2, 'nyckeltal: aktiva kunder');

-- ---------------------------------------------------------------- kundportal
update public.organization_settings set portal_enabled = true;
insert into public.customer_portal_users (organization_id, customer_id, email) select org_a, fisk, 'inkop@fiskhandel.se' from ids, c;
insert into public.customer_portal_users (organization_id, customer_id, email) select org_a, rest, 'inkop@restaurang.se' from ids, c;

select pg_temp.act_as('c0000000-0000-0000-0000-000000000001');
select is(public.accept_portal_invitations(), 1, 'portalinbjudan accepteras');
select is(jsonb_array_length(public.portal_access()), 1, 'portalkunden ser sin portal');
select is((select count(*)::int from public.orders), 0, 'portalkunden kan inte läsa ordertabellen direkt');
select is((select count(*)::int from public.customers), 0, 'portalkunden kan inte läsa kundregistret');
select is((select count(*)::int from public.price_lists), 0, 'portalkunden kan inte läsa prislistor direkt');
select is((select unit_price from public.portal_catalog((select fisk from c)) where sku = 'RAK-1'), 40.00::numeric, 'portalkunden ser sitt avtalspris');
select throws_ok($$ select * from public.portal_catalog((select rest from c)) $$, '42501', null, 'portalkunden kan inte se andra kunders priser');
select throws_ok($$ select public.portal_orders((select rest from c)) $$, '42501', null, 'portalkunden kan inte se andra kunders order');
select lives_ok($$ select public.portal_create_order((select fisk from c),
  jsonb_build_array(jsonb_build_object('item_id', (select item_id from public.portal_catalog((select fisk from c)) where sku = 'RAK-1'), 'quantity', 600, 'unit_price', 1)),
  null, 'PO-778', 'Leverans före 07') $$, 'portalkunden lägger en beställning');
select is((select (o ->> 'status') from jsonb_array_elements(public.portal_orders((select fisk from c))) o where o ->> 'source' = 'portal'),
  'pending_approval', 'portalorder väntar på godkännande');
select is((select ((o -> 'items' -> 0) ->> 'unit_price')::numeric from jsonb_array_elements(public.portal_orders((select fisk from c))) o
            where o ->> 'source' = 'portal'), 36.00::numeric, 'priset sätts av servern – kundens prisförslag ignoreras');
select ok(not exists (select 1 from jsonb_array_elements(public.portal_orders((select fisk from c))) o where o ? 'notes_internal'),
  'interna anteckningar visas inte i portalen');
select throws_ok($$ select public.portal_create_order((select fisk from c),
  jsonb_build_array(jsonb_build_object('item_id', gen_random_uuid(), 'quantity', 1))) $$, '22023', null, 'okänd artikel avvisas');
select throws_ok($$ select public.portal_order_document((select fisk from c), (select id from a_order)) $$, 'P0002', null,
  'portalkunden kan inte hämta dokument för utkast');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
update public.customer_portal_users set disabled_at = now() where email = 'inkop@fiskhandel.se';
select pg_temp.act_as('c0000000-0000-0000-0000-000000000001');
select is(jsonb_array_length(public.portal_access()), 0, 'avstängd portalåtkomst slutar gälla direkt');
select throws_ok($$ select * from public.portal_catalog((select fisk from c)) $$, '42501', null, 'avstängd användare nekas');

select * from finish();
rollback;
