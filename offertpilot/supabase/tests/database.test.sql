-- Kör med: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Hjälpare för att agera som en viss användare
create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@byggab.se', now(), 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bertil@malarna.se', now(), 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000003', 'cecilia@byggab.se', now(), 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000004', 'okand@exempel.se', null, 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- planer
select results_eq($$ select id, price_sek, max_users, max_ai_leads_per_month from public.plans order by sort $$,
  $$ values ('starter'::text, 399, 1, 30), ('professional'::text, 899, 5, 150), ('business'::text, 1799, 25, 600) $$,
  'planerna har nya priser och oförändrade gränser');

-- ---------------------------------------------------------------- onboarding
select pg_temp.act_as('dddddddd-0000-0000-0000-000000000004');
select throws_ok($$ select public.create_organization('{"name":"Ej verifierad AB"}') $$,
  '42501', null, 'obekräftad e-post kan inte skapa företag');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok($$ select public.create_organization('{"name":"Bygg AB","org_number":"556677-8899","full_name":"Anna"}') $$,
  'användare A skapar företag');
reset role;
create temp table ctx as
  select (select id from public.organizations where name = 'Bygg AB') as org_a;
grant select on ctx to authenticated, anon;

select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select lives_ok($$ select public.create_organization('{"name":"Målarna AB"}') $$, 'användare B skapar företag');

-- ---------------------------------------------------------------- data för A
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select role::text from public.organization_members where user_id = auth.uid()), 'admin', 'skaparen blir admin');
select is((select status::text from public.subscriptions), 'trialing', 'ny organisation får provperiod');

insert into public.services (organization_id, name, unit, unit_price, vat_rate, is_labor)
  select org_a, 'Plattsättning', 'm²', 950, 25, true from ctx;
insert into public.customers (organization_id, name, email) select org_a, 'Kalle Kund', 'kalle@kund.se' from ctx;
insert into public.leads (organization_id, customer_id, title, message, source)
  select org_a, (select id from public.customers limit 1), 'Badrumsrenovering', 'Vill renovera badrum 6 kvm', 'manual' from ctx;
insert into public.quotations (organization_id, lead_id, customer_id, title)
  select org_a, (select id from public.leads limit 1), (select id from public.customers limit 1), 'Offert badrum' from ctx;

select is((select number from public.quotations), 'OFF-1001', 'offertnummer tilldelas av servern');
select is((select status::text from public.quotations), 'draft', 'ny offert är ett utkast');

insert into public.quotation_items (organization_id, quotation_id, service_id, description, quantity, unit, unit_price, vat_rate, is_labor, sort)
  select org_a, (select id from public.quotations limit 1), (select id from public.services limit 1),
         'Plattsättning golv och vägg', 18.5, 'm²', 950, 25, true, 1 from ctx;
insert into public.quotation_items (organization_id, quotation_id, description, quantity, unit, unit_price, vat_rate, sort)
  select org_a, (select id from public.quotations limit 1), 'Kakel (kundens val)', 1, 'st', null, 25, 2 from ctx;

select is((select subtotal from public.quotations), 17575.00::numeric(12,2), 'delsumma räknas från rader');
select is((select vat_total from public.quotations), 4393.75::numeric(12,2), 'moms 25 %');
select is((select requires_manual_input from public.quotations), true, 'rad utan pris kräver manuell inmatning');

update public.quotations set discount_type = 'percent', discount_value = 10, apply_rot = true, rot_percent = 30;
select is((select discount_total from public.quotations), 1757.50::numeric(12,2), 'rabatt 10 %');
select is((select total from public.quotations), 19771.88::numeric(12,2), 'totalsumma efter rabatt inkl. moms');
select is((select rot_deduction from public.quotations), 5931.56::numeric(12,2), 'ROT-avdrag 30 % på arbete inkl. moms');

select throws_ok($$ select public.approve_quotation((select id from public.quotations limit 1)) $$,
  'P0001', 'Alla rader måste ha ett pris innan offerten kan godkännas', 'kan inte godkänna offert med saknade priser');

update public.quotation_items set unit_price = 4000 where unit_price is null;
select is((select requires_manual_input from public.quotations), false, 'manuellt pris ifyllt');

select throws_ok($$ update public.quotations set status = 'approved' $$, '42501', null,
  'status kan inte sättas direkt av klienten');
select throws_ok($$ update public.quotations set total = 1 $$, '42501', null,
  'summor kan inte sättas direkt av klienten');

select lives_ok($$ select public.submit_quotation((select id from public.quotations limit 1)) $$, 'skicka för godkännande');
select throws_ok($$ update public.quotation_items set quantity = 2 $$, 'P0001', 'Offertrader kan bara ändras i utkast',
  'rader låses efter inskick');
select throws_ok($$ update public.quotations set title = 'Ändrad' $$, 'P0001', null, 'offerthuvud låses efter inskick');

-- ---------------------------------------------------------------- isolering: B ser inget av A
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*)::int from public.organizations), 1, 'B ser bara sitt eget företag');
select is((select count(*)::int from public.customers), 0, 'B ser inga kunder från A');
select is((select count(*)::int from public.leads), 0, 'B ser inga leads från A');
select is((select count(*)::int from public.quotations), 0, 'B ser inga offerter från A');
select is((select count(*)::int from public.quotation_items), 0, 'B ser inga offertrader från A');
select is((select count(*)::int from public.services), 0, 'B ser inga tjänster från A');
select is((select count(*)::int from public.activity_logs where organization_id = (select org_a from ctx)), 0, 'B ser ingen aktivitetslogg från A');

select throws_ok($$ insert into public.customers (organization_id, name) select org_a, 'Intrång' from ctx $$,
  '42501', null, 'B kan inte skapa kund i A:s organisation');
select throws_ok($$ select public.approve_quotation((select id from public.quotations q where q.organization_id = (select org_a from ctx))) $$,
  'P0002', null, 'B kan inte godkänna A:s offert (hittas inte via RLS-skyddad vy)');
select throws_ok($$ select public.dashboard_stats((select org_a from ctx)) $$, '42501', null, 'B kan inte läsa A:s dashboard');
select throws_ok($$ select public.export_organization_data((select org_a from ctx)) $$, '42501', null, 'B kan inte exportera A:s data');

-- Sammansatt FK: B kan inte koppla sin lead till A:s kund även om B känner till id:t
reset role;
create temp table a_customer as select id from public.customers where organization_id = (select org_a from ctx);
grant select on a_customer to authenticated;
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.leads (organization_id, customer_id, title)
  select o.id, (select id from a_customer), 'Kapad kund' from public.organizations o $$,
  '23503', null, 'lead kan inte referera kund i annan organisation');

-- ---------------------------------------------------------------- roller
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok($$ select public.invite_member((select org_a from ctx), 'cecilia@byggab.se', 'employee') $$,
  'P0001', null, 'Starter-planen tillåter bara en användare');
reset role;
update public.subscriptions set plan_id = 'professional' where organization_id = (select org_a from ctx);
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok($$ select public.invite_member((select org_a from ctx), 'cecilia@byggab.se', 'employee') $$,
  'Professional tillåter inbjudan');

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select is(public.accept_pending_invitations(), 1, 'inbjudan accepteras vid inloggning');
select is((select count(*)::int from public.quotations), 1, 'anställd ser företagets offerter');
select throws_ok($$ select public.approve_quotation((select id from public.quotations limit 1)) $$,
  '42501', null, 'anställd kan inte godkänna offert');
update public.organization_settings set default_vat_rate = 12;
select is((select default_vat_rate from public.organization_settings), 25.00::numeric(5,2),
  'anställd kan inte ändra inställningar (RLS filtrerar bort raden)');

-- ---------------------------------------------------------------- godkänn, skicka, svar
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok($$ select public.approve_quotation((select id from public.quotations limit 1)) $$, 'admin godkänner');
select lives_ok($$ select public.mark_quotation_sent((select id from public.quotations limit 1)) $$, 'markera som skickad');
select is((select count(*)::int from public.follow_up_tasks where kind = 'quote_followup' and status = 'pending'), 3,
  'tre uppföljningar schemaläggs enligt regler');
select is((select stage::text from public.leads), 'quote_sent', 'lead flyttas till Offert skickad');
select is((select count(*)::int from public.quotation_versions), 3, 'versionshistorik: inskickad, godkänd, skickad');

reset role;
select lives_ok($$ select public.public_quote_respond((select public_token from public.quotations limit 1), true, 'Kör!') $$,
  'kunden accepterar via publik länk');
select is((select stage::text from public.leads), 'won', 'lead markeras som vunnen');
select is((select count(*)::int from public.follow_up_tasks where status = 'pending'), 0, 'uppföljningar stoppas när kunden svarat');

-- ---------------------------------------------------------------- anon
select pg_temp.act_as_anon();
select throws_ok($$ select count(*) from public.customers $$, '42501', null, 'anon har ingen tabellåtkomst');

select * from finish();
rollback;
