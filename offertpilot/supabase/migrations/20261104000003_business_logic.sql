-- OffertPilot AI – affärslogik på serversidan
-- All känslig logik (godkännande, summering, kvoter, numrering) körs här eller i edge functions.

-- ---------------------------------------------------------------------------
-- Aktivitetslogg
-- ---------------------------------------------------------------------------
create or replace function public.log_activity(org uuid, act text, etype text, eid uuid, det jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (org, auth.uid(), act, etype, eid, coalesce(det, '{}'::jsonb));
$$;

create or replace function public.require_member(org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_member(org) then
    raise exception 'Behörighet saknas' using errcode = '42501';
  end if;
end $$;

create or replace function public.require_admin(org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_admin(org) then
    raise exception 'Endast administratörer kan utföra detta' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding och team
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  org uuid;
  uemail text;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad' using errcode = '42501';
  end if;
  select email into uemail from auth.users where id = uid and email_confirmed_at is not null;
  if uemail is null then
    raise exception 'Bekräfta din e-postadress innan du skapar ett företag' using errcode = '42501';
  end if;
  if (select count(*) from public.organization_members where user_id = uid and role = 'admin') >= 3 then
    raise exception 'Du kan som mest administrera tre företag' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, org_number, industry, email, phone, website, address,
    postal_code, city, description, pricing_model, communication_style, created_by)
  values (
    trim(p->>'name'), nullif(trim(p->>'org_number'), ''), nullif(p->>'industry', ''),
    coalesce(nullif(p->>'email', ''), uemail), nullif(p->>'phone', ''), nullif(p->>'website', ''),
    nullif(p->>'address', ''), nullif(p->>'postal_code', ''), nullif(p->>'city', ''),
    nullif(p->>'description', ''), nullif(p->>'pricing_model', ''), nullif(p->>'communication_style', ''), uid)
  returning id into org;

  insert into public.organization_members (organization_id, user_id, role, full_name, email)
  values (org, uid, 'admin', nullif(p->>'full_name', ''), uemail);

  insert into public.organization_settings (organization_id, ai_tone, email_from_name, email_reply_to)
  values (org, coalesce(nullif(p->>'communication_style', ''), 'professionell och vänlig'),
          trim(p->>'name'), coalesce(nullif(p->>'email', ''), uemail));

  insert into public.subscriptions (organization_id) values (org);

  perform public.log_activity(org, 'organization.created', 'organization', org);
  return org;
end $$;

create or replace function public.accept_pending_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  uemail text;
  inv record;
  n integer := 0;
begin
  select email into uemail from auth.users where id = uid and email_confirmed_at is not null;
  if uemail is null then return 0; end if;
  for inv in
    select * from public.organization_invitations
    where email = uemail::extensions.citext and accepted_at is null and expires_at > now()
    for update
  loop
    insert into public.organization_members (organization_id, user_id, role, email)
    values (inv.organization_id, uid, inv.role, uemail)
    on conflict (organization_id, user_id) do nothing;
    update public.organization_invitations set accepted_at = now() where id = inv.id;
    perform public.log_activity(inv.organization_id, 'member.joined', 'member', uid, jsonb_build_object('email', uemail));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.seat_usage(org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'members', (select count(*) from public.organization_members where organization_id = org),
    'pending', (select count(*) from public.organization_invitations
                where organization_id = org and accepted_at is null and expires_at > now()),
    'max_users', (select p.max_users from public.subscriptions s join public.plans p on p.id = s.plan_id
                  where s.organization_id = org));
$$;

create or replace function public.invite_member(org uuid, invite_email text, invite_role public.member_role)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  seats jsonb;
  inv public.organization_invitations;
begin
  perform public.require_admin(org);
  if invite_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Ogiltig e-postadress' using errcode = '22023';
  end if;
  if exists (select 1 from public.organization_members where organization_id = org and lower(email) = lower(invite_email)) then
    raise exception 'Personen är redan medlem' using errcode = 'P0001';
  end if;
  seats := public.seat_usage(org);
  if (seats->>'members')::int + (seats->>'pending')::int >= (seats->>'max_users')::int then
    raise exception 'Din plan tillåter max % användare. Uppgradera för att bjuda in fler.', seats->>'max_users'
      using errcode = 'P0001';
  end if;
  delete from public.organization_invitations
    where organization_id = org and email = invite_email::extensions.citext and accepted_at is null;
  insert into public.organization_invitations (organization_id, email, role, invited_by)
  values (org, invite_email, invite_role, auth.uid()) returning * into inv;
  perform public.log_activity(org, 'member.invited', 'invitation', inv.id, jsonb_build_object('email', invite_email, 'role', invite_role));
  return jsonb_build_object('id', inv.id, 'token', inv.token, 'expires_at', inv.expires_at);
end $$;

create or replace function public.set_member_role(org uuid, member_user uuid, new_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin(org);
  if new_role = 'employee' and (select count(*) from public.organization_members
      where organization_id = org and role = 'admin' and user_id <> member_user) = 0 then
    raise exception 'Företaget måste ha minst en administratör' using errcode = 'P0001';
  end if;
  update public.organization_members set role = new_role where organization_id = org and user_id = member_user;
  perform public.log_activity(org, 'member.role_changed', 'member', member_user, jsonb_build_object('role', new_role));
end $$;

create or replace function public.remove_member(org uuid, member_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin(org);
  if (select count(*) from public.organization_members
      where organization_id = org and role = 'admin' and user_id <> member_user) = 0 then
    raise exception 'Företaget måste ha minst en administratör' using errcode = 'P0001';
  end if;
  delete from public.organization_members where organization_id = org and user_id = member_user;
  perform public.log_activity(org, 'member.removed', 'member', member_user);
end $$;

-- ---------------------------------------------------------------------------
-- Offerter: numrering, låsning, summering
-- ---------------------------------------------------------------------------
create or replace function public.quotations_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.organization_settings;
begin
  select * into s from public.organization_settings where organization_id = new.organization_id for update;
  if not found then
    raise exception 'Företagsinställningar saknas' using errcode = 'P0001';
  end if;
  new.number := s.quote_number_prefix || '-' || s.next_quote_number;
  update public.organization_settings set next_quote_number = next_quote_number + 1
    where organization_id = new.organization_id;
  new.status := 'draft';
  new.valid_until := coalesce(new.valid_until, current_date + s.quote_validity_days);
  new.intro := coalesce(new.intro, s.quote_intro);
  new.terms := coalesce(new.terms, s.quote_terms);
  new.created_by := coalesce(new.created_by, auth.uid());
  if new.lead_id is not null and new.customer_id is null then
    select customer_id into new.customer_id from public.leads where id = new.lead_id;
  end if;
  return new;
end $$;
create trigger quotations_before_insert before insert on public.quotations
  for each row execute function public.quotations_before_insert();

-- Räknar om summor från raderna. Samma algoritm finns i supabase/functions/_shared/pricing.ts
-- (förhandsvisning i klienten); databasen är auktoritativ.
create or replace function public.quotations_compute_totals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sub numeric := 0;
  disc numeric := 0;
  ratio numeric := 0;
  vat numeric := 0;
  labor_gross numeric := 0;
  manual boolean := false;
begin
  -- Innehåll får bara ändras i utkast (servern sätter offertpilot.system vid statusbyten)
  if tg_op = 'UPDATE' and old.status <> 'draft'
     and coalesce(current_setting('offertpilot.system', true), '') <> 'on'
     and (new.title, new.intro, new.project_description, new.delivery_timeframe, new.terms,
          new.valid_until, new.discount_type, new.discount_value, new.apply_rot, new.rot_percent)
         is distinct from
         (old.title, old.intro, old.project_description, old.delivery_timeframe, old.terms,
          old.valid_until, old.discount_type, old.discount_value, old.apply_rot, old.rot_percent) then
    raise exception 'Offerten är låst. Återställ den till utkast för att ändra.' using errcode = 'P0001';
  end if;

  select coalesce(sum(line_total), 0), coalesce(bool_or(unit_price is null), false)
    into sub, manual
    from public.quotation_items where quotation_id = new.id;

  if new.discount_type = 'percent' then
    disc := round(sub * new.discount_value / 100, 2);
  elsif new.discount_type = 'amount' then
    disc := least(new.discount_value, sub);
  end if;
  if sub > 0 then ratio := disc / sub; end if;

  select coalesce(sum(line_total * (1 - ratio) * vat_rate / 100), 0),
         coalesce(sum(case when is_labor then line_total * (1 - ratio) * (1 + vat_rate / 100) else 0 end), 0)
    into vat, labor_gross
    from public.quotation_items where quotation_id = new.id;

  new.subtotal := sub;
  new.discount_total := disc;
  new.vat_total := round(vat, 2);
  new.total := sub - disc + round(vat, 2);
  new.rot_deduction := case when new.apply_rot then round(labor_gross * new.rot_percent / 100, 2) else 0 end;
  new.total_to_pay := new.total - new.rot_deduction;
  new.requires_manual_input := manual;
  return new;
end $$;
create trigger quotations_compute_totals before update on public.quotations
  for each row execute function public.quotations_compute_totals();

create or replace function public.quotation_items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  st public.quote_status;
  qid uuid := coalesce(new.quotation_id, old.quotation_id);
begin
  -- Kaskadradering (t.ex. när organisationen raderas) ska alltid tillåtas
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  select status into st from public.quotations where id = qid;
  if st is distinct from 'draft' then
    raise exception 'Offertrader kan bara ändras i utkast' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.quotation_id <> old.quotation_id then
    raise exception 'En rad kan inte flyttas mellan offerter' using errcode = 'P0001';
  end if;
  new.line_total := round(new.quantity * coalesce(new.unit_price, 0) * (1 - new.discount_percent / 100), 2);
  return new;
end $$;
create trigger quotation_items_guard before insert or update or delete on public.quotation_items
  for each row execute function public.quotation_items_guard();

create or replace function public.quotation_items_touch_parent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.quotations set updated_at = now()
    where id = coalesce(new.quotation_id, old.quotation_id);
  return null;
end $$;
create trigger quotation_items_touch_parent after insert or update or delete on public.quotation_items
  for each row execute function public.quotation_items_touch_parent();

create or replace function public.quotation_snapshot(qid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'quotation', to_jsonb(q) - 'public_token',
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort, i.created_at)
                       from public.quotation_items i where i.quotation_id = q.id), '[]'::jsonb))
  from public.quotations q where q.id = qid;
$$;

create or replace function public.add_quotation_version(qid uuid, why text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  select * into q from public.quotations where id = qid;
  insert into public.quotation_versions (organization_id, quotation_id, version, reason, snapshot, created_by)
  values (q.organization_id, q.id, q.version, why, public.quotation_snapshot(qid), auth.uid());
end $$;

create or replace function public.set_quote_status(qid uuid, new_status public.quote_status) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('offertpilot.system', 'on', true);
  update public.quotations set status = new_status where id = qid;
  perform set_config('offertpilot.system', 'off', true);
end $$;

create or replace function public.submit_quotation(qid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  select * into q from public.quotations where id = qid for update;
  if not found then raise exception 'Offerten hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(q.organization_id);
  if q.status <> 'draft' then
    raise exception 'Endast utkast kan skickas för godkännande' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.quotation_items where quotation_id = qid) then
    raise exception 'Offerten saknar rader' using errcode = 'P0001';
  end if;
  perform public.set_quote_status(qid, 'pending_approval');
  perform public.add_quotation_version(qid, 'submitted');
  perform public.log_activity(q.organization_id, 'quotation.submitted', 'quotation', qid, jsonb_build_object('number', q.number));
end $$;

create or replace function public.approve_quotation(qid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  select * into q from public.quotations where id = qid for update;
  if not found then raise exception 'Offerten hittades inte' using errcode = 'P0002'; end if;
  perform public.require_admin(q.organization_id);
  if q.status not in ('draft', 'pending_approval') then
    raise exception 'Offerten kan inte godkännas i nuvarande status' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.quotation_items where quotation_id = qid) then
    raise exception 'Offerten saknar rader' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.quotation_items where quotation_id = qid and unit_price is null) then
    raise exception 'Alla rader måste ha ett pris innan offerten kan godkännas' using errcode = 'P0001';
  end if;
  perform set_config('offertpilot.system', 'on', true);
  update public.quotations set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = qid;
  perform set_config('offertpilot.system', 'off', true);
  perform public.add_quotation_version(qid, 'approved');
  perform public.log_activity(q.organization_id, 'quotation.approved', 'quotation', qid, jsonb_build_object('number', q.number, 'total', q.total));
end $$;

create or replace function public.reopen_quotation(qid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  select * into q from public.quotations where id = qid for update;
  if not found then raise exception 'Offerten hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(q.organization_id);
  if q.status not in ('pending_approval', 'approved', 'sent', 'declined', 'expired') then
    raise exception 'Offerten kan inte återställas till utkast' using errcode = 'P0001';
  end if;
  if q.status in ('approved', 'sent') and not public.is_org_admin(q.organization_id) then
    raise exception 'Endast administratörer kan öppna en godkänd offert' using errcode = '42501';
  end if;
  perform set_config('offertpilot.system', 'on', true);
  update public.quotations
     set status = 'draft', approved_by = null, approved_at = null, version = version + 1
   where id = qid;
  perform set_config('offertpilot.system', 'off', true);
  -- Påminnelser för den gamla versionen gäller inte längre
  update public.follow_up_tasks set status = 'cancelled'
   where quotation_id = qid and status = 'pending';
  perform public.log_activity(q.organization_id, 'quotation.reopened', 'quotation', qid, jsonb_build_object('number', q.number, 'version', q.version + 1));
end $$;

-- Skapar uppföljningsuppgifter enligt företagets regler efter att en offert skickats
create or replace function public.schedule_quote_followups(qid uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotations;
  rules jsonb;
  d jsonb;
  seq integer := 0;
begin
  select * into q from public.quotations where id = qid;
  if q.lead_id is null then return 0; end if;
  if (select opted_out from public.customers where id = q.customer_id) then return 0; end if;
  select follow_up_rules into rules from public.organization_settings where organization_id = q.organization_id;
  for d in select * from jsonb_array_elements(coalesce(rules->'quote_followup_days', '[3,7,14]'::jsonb)) loop
    seq := seq + 1;
    insert into public.follow_up_tasks (organization_id, lead_id, quotation_id, kind, title, due_at, sequence)
    values (q.organization_id, q.lead_id, q.id, 'quote_followup',
            'Följ upp offert ' || q.number || case when seq > 1 then ' (påminnelse ' || seq || ')' else '' end,
            coalesce(q.sent_at, now()) + make_interval(days => greatest(1, least(90, (d #>> '{}')::int))), seq)
    on conflict do nothing;
  end loop;
  return seq;
end $$;

-- Anropas av edge function efter lyckat utskick, eller av användaren efter manuellt utskick (PDF)
create or replace function public.mark_quotation_sent(qid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  select * into q from public.quotations where id = qid for update;
  if not found then raise exception 'Offerten hittades inte' using errcode = 'P0002'; end if;
  if auth.role() <> 'service_role' then
    perform public.require_member(q.organization_id);
  end if;
  if q.status not in ('approved', 'sent') then
    raise exception 'Offerten måste vara godkänd innan den skickas' using errcode = 'P0001';
  end if;
  perform set_config('offertpilot.system', 'on', true);
  update public.quotations
     set status = 'sent', sent_at = now(),
         public_token = coalesce(public_token, encode(extensions.gen_random_bytes(24), 'hex'))
   where id = qid returning * into q;
  perform set_config('offertpilot.system', 'off', true);
  if q.lead_id is not null then
    update public.leads set stage = 'quote_sent', last_contact_at = now()
     where id = q.lead_id and stage in ('new', 'qualification', 'quote_draft');
  end if;
  perform public.add_quotation_version(qid, 'sent');
  perform public.schedule_quote_followups(qid);
  perform public.log_activity(q.organization_id, 'quotation.sent', 'quotation', qid, jsonb_build_object('number', q.number));
  return q.public_token;
end $$;

create or replace function public.apply_quotation_response(q public.quotations, accepted boolean, note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if q.status not in ('sent', 'approved') then
    raise exception 'Offerten kan inte besvaras i nuvarande status' using errcode = 'P0001';
  end if;
  if accepted and q.valid_until is not null and q.valid_until < current_date then
    raise exception 'Offerten har gått ut' using errcode = 'P0001';
  end if;
  perform set_config('offertpilot.system', 'on', true);
  update public.quotations
     set status = case when accepted then 'accepted'::public.quote_status else 'declined'::public.quote_status end,
         responded_at = now(), customer_response_note = left(note, 2000)
   where id = q.id;
  perform set_config('offertpilot.system', 'off', true);
  update public.follow_up_tasks set status = 'cancelled' where quotation_id = q.id and status = 'pending';
  if q.lead_id is not null then
    update public.leads set stage = case when accepted then 'won'::public.lead_stage else 'negotiation'::public.lead_stage end
     where id = q.lead_id and stage not in ('won', 'lost');
  end if;
  perform public.log_activity(q.organization_id,
    case when accepted then 'quotation.accepted' else 'quotation.declined' end, 'quotation', q.id,
    jsonb_build_object('number', q.number, 'note', left(note, 500)));
end $$;

create or replace function public.record_quotation_response(qid uuid, accepted boolean, note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  select * into q from public.quotations where id = qid for update;
  if not found then raise exception 'Offerten hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(q.organization_id);
  perform public.apply_quotation_response(q, accepted, note);
end $$;

-- Publik vy och svar via token (anropas endast av edge function med service role)
create or replace function public.public_quote_view(tok text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'quotation', jsonb_build_object(
      'id', q.id, 'number', q.number, 'title', q.title, 'status', q.status, 'intro', q.intro,
      'project_description', q.project_description, 'delivery_timeframe', q.delivery_timeframe,
      'terms', q.terms, 'valid_until', q.valid_until, 'discount_type', q.discount_type,
      'discount_value', q.discount_value, 'apply_rot', q.apply_rot, 'rot_percent', q.rot_percent,
      'subtotal', q.subtotal, 'discount_total', q.discount_total, 'vat_total', q.vat_total,
      'total', q.total, 'rot_deduction', q.rot_deduction, 'total_to_pay', q.total_to_pay,
      'sent_at', q.sent_at, 'responded_at', q.responded_at),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'description', i.description, 'quantity', i.quantity, 'unit', i.unit, 'unit_price', i.unit_price,
        'discount_percent', i.discount_percent, 'vat_rate', i.vat_rate, 'is_labor', i.is_labor,
        'line_total', i.line_total) order by i.sort, i.created_at)
      from public.quotation_items i where i.quotation_id = q.id), '[]'::jsonb),
    'customer', jsonb_build_object('name', c.name, 'company_name', c.company_name),
    'organization', jsonb_build_object('name', o.name, 'org_number', o.org_number, 'email', o.email,
      'phone', o.phone, 'website', o.website, 'address', o.address, 'postal_code', o.postal_code,
      'city', o.city, 'brand_color', o.brand_color, 'logo_url', o.logo_url),
    'settings', jsonb_build_object('quote_footer', s.quote_footer))
  from public.quotations q
  join public.customers c on c.id = q.customer_id
  join public.organizations o on o.id = q.organization_id
  join public.organization_settings s on s.organization_id = q.organization_id
  where q.public_token = tok and tok is not null and length(tok) >= 32
    and q.status in ('sent', 'accepted', 'declined', 'expired');
$$;

create or replace function public.public_quote_respond(tok text, accepted boolean, note text)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  select * into q from public.quotations where public_token = tok and length(tok) >= 32 for update;
  if not found then raise exception 'Offerten hittades inte' using errcode = 'P0002'; end if;
  if q.status <> 'sent' then
    raise exception 'Offerten har redan besvarats' using errcode = 'P0001';
  end if;
  perform public.apply_quotation_response(q, accepted, note);
end $$;

-- ---------------------------------------------------------------------------
-- Leads: loggning, uppföljningsstopp
-- ---------------------------------------------------------------------------
create or replace function public.leads_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.organization_id, 'lead.created', 'lead', new.id,
      jsonb_build_object('title', new.title, 'source', new.source));
  elsif new.stage is distinct from old.stage then
    perform public.log_activity(new.organization_id, 'lead.stage_changed', 'lead', new.id,
      jsonb_build_object('title', new.title, 'from', old.stage, 'to', new.stage));
    if new.stage in ('won', 'lost') then
      update public.follow_up_tasks set status = 'cancelled' where lead_id = new.id and status = 'pending';
    end if;
  end if;
  return null;
end $$;
create trigger leads_after_change after insert or update of stage on public.leads
  for each row execute function public.leads_after_change();

create or replace function public.customers_after_optout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.opted_out and not old.opted_out then
    update public.follow_up_tasks t set status = 'cancelled'
      from public.leads l
     where t.lead_id = l.id and l.customer_id = new.id and t.status = 'pending';
    perform public.log_activity(new.organization_id, 'customer.opted_out', 'customer', new.id);
  end if;
  return null;
end $$;
create trigger customers_after_optout after update of opted_out on public.customers
  for each row execute function public.customers_after_optout();

-- Skapar påminnelser för obesvarade leads och markerar utgångna offerter.
create or replace function public.refresh_follow_ups(org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  hours integer;
  n integer;
begin
  if auth.role() <> 'service_role' then
    perform public.require_member(org);
  end if;
  select coalesce((follow_up_rules->>'lead_response_hours')::int, 24) into hours
    from public.organization_settings where organization_id = org;

  perform set_config('offertpilot.system', 'on', true);
  update public.quotations set status = 'expired'
   where organization_id = org and status = 'sent' and valid_until < current_date;
  perform set_config('offertpilot.system', 'off', true);

  insert into public.follow_up_tasks (organization_id, lead_id, kind, title, due_at)
  select l.organization_id, l.id, 'lead_response', 'Svara på förfrågan: ' || left(l.title, 150),
         l.created_at + make_interval(hours => hours)
    from public.leads l
    join public.customers c on c.id = l.customer_id
   where l.organization_id = org
     and l.stage in ('new', 'qualification')
     and not c.opted_out
     and not exists (select 1 from public.messages m
                      where m.lead_id = l.id and m.direction = 'outbound' and m.status in ('sent', 'demo_not_sent'))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Publik förfrågan (endast service role via edge function public-inquiry)
-- ---------------------------------------------------------------------------
create or replace function public.create_public_inquiry(form_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  cust uuid;
  ld uuid;
  conv uuid;
begin
  select id into org from public.organizations where public_form_key = form_key;
  if org is null then
    raise exception 'Formuläret hittades inte' using errcode = 'P0002';
  end if;

  select id into cust from public.customers
   where organization_id = org and email = (p->>'email')::extensions.citext and anonymized_at is null
   order by created_at limit 1;
  if cust is null then
    insert into public.customers (organization_id, name, email, phone, city)
    values (org, p->>'name', p->>'email', nullif(p->>'phone', ''), nullif(p->>'city', ''))
    returning id into cust;
  else
    update public.customers set phone = coalesce(phone, nullif(p->>'phone', '')), opted_out = false
     where id = cust;
  end if;

  insert into public.leads (organization_id, customer_id, title, requested_service, message, source)
  values (org, cust,
          left(coalesce(nullif(p->>'service', ''), 'Förfrågan') || ' – ' || (p->>'name'), 200),
          nullif(p->>'service', ''), p->>'message', 'website')
  returning id into ld;

  insert into public.conversations (organization_id, lead_id, channel, subject)
  values (org, ld, 'website', 'Förfrågan via webbformulär') returning id into conv;

  insert into public.messages (organization_id, conversation_id, lead_id, direction, status, subject, body)
  values (org, conv, ld, 'inbound', 'received', nullif(p->>'service', ''), p->>'message');

  return jsonb_build_object('organization_id', org, 'lead_id', ld, 'customer_id', cust);
end $$;

-- ---------------------------------------------------------------------------
-- Planer, kvoter och rate limiting
-- ---------------------------------------------------------------------------
create or replace function public.usage_summary(org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.subscriptions;
  pl public.plans;
  used integer;
begin
  if auth.role() <> 'service_role' then
    perform public.require_member(org);
  end if;
  select * into s from public.subscriptions where organization_id = org;
  select * into pl from public.plans where id = s.plan_id;
  select count(distinct coalesce(lead_id, id)) into used
    from public.usage_records
   where organization_id = org and success and created_at >= date_trunc('month', now());
  return jsonb_build_object(
    'plan_id', pl.id, 'plan_name', pl.name, 'price_sek', pl.price_sek,
    'status', s.status, 'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
    'max_users', pl.max_users, 'max_ai_leads', pl.max_ai_leads_per_month, 'ai_leads_used', used,
    'features', pl.features,
    'active', (s.status = 'active' or (s.status = 'trialing' and coalesce(s.trial_ends_at, now()) > now())));
end $$;

-- Kontrollerar om ett AI-anrop för en lead ryms inom planens månadsgräns.
-- En lead som redan räknats denna månad kostar inget extra.
create or replace function public.check_ai_quota(org uuid, lead uuid, feature text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u jsonb := public.usage_summary(org);
  already boolean := false;
begin
  if not (u->>'active')::boolean then
    return jsonb_build_object('allowed', false, 'reason', 'Prenumerationen är inte aktiv. Uppgradera under Inställningar → Fakturering.');
  end if;
  if feature is not null and not coalesce((u->'features'->>feature)::boolean, false) then
    return jsonb_build_object('allowed', false, 'reason', 'Funktionen ingår inte i din plan. Uppgradera till Professional för att använda den.');
  end if;
  if lead is not null then
    select exists (select 1 from public.usage_records where organization_id = org and lead_id = lead
                    and success and created_at >= date_trunc('month', now())) into already;
  end if;
  if not already and (u->>'ai_leads_used')::int >= (u->>'max_ai_leads')::int then
    return jsonb_build_object('allowed', false,
      'reason', format('Månadsgränsen på %s AI-assisterade leads är nådd.', u->>'max_ai_leads'));
  end if;
  return jsonb_build_object('allowed', true);
end $$;

create or replace function public.hit_rate_limit(rl_key text, max_hits integer, window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  c integer;
begin
  insert into public.rate_limits (key, window_start, count) values (rl_key, ws, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into c;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return c <= max_hits;
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard (riktiga data, RLS-filtrerat via medlemskontroll)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_stats(org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  perform public.require_member(org);
  select jsonb_build_object(
    'total_leads', (select count(*) from public.leads where organization_id = org),
    'new_leads_30d', (select count(*) from public.leads where organization_id = org and created_at >= now() - interval '30 days'),
    'new_leads_prev_30d', (select count(*) from public.leads where organization_id = org
                            and created_at >= now() - interval '60 days' and created_at < now() - interval '30 days'),
    'leads_in_new', (select count(*) from public.leads where organization_id = org and stage = 'new'),
    'active_quotes', (select count(*) from public.quotations where organization_id = org and status in ('draft', 'pending_approval', 'approved', 'sent')),
    'pending_approval', (select count(*) from public.quotations where organization_id = org and status = 'pending_approval'),
    'accepted_quotes', (select count(*) from public.quotations where organization_id = org and status = 'accepted'),
    'accepted_value', (select coalesce(sum(total), 0) from public.quotations where organization_id = org and status = 'accepted'),
    'pipeline_value', (
      select coalesce(sum(coalesce(
        (select q.total from public.quotations q where q.lead_id = l.id and q.status in ('draft','pending_approval','approved','sent')
          order by q.created_at desc limit 1), l.estimated_value, 0)), 0)
      from public.leads l where l.organization_id = org and l.stage not in ('won', 'lost')),
    'won_leads', (select count(*) from public.leads where organization_id = org and stage = 'won'),
    'lost_leads', (select count(*) from public.leads where organization_id = org and stage = 'lost'),
    'pending_followups', (select count(*) from public.follow_up_tasks where organization_id = org and status = 'pending'),
    'overdue_followups', (select count(*) from public.follow_up_tasks where organization_id = org and status = 'pending' and due_at < now()),
    'stages', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from
                (select stage, count(*) n from public.leads where organization_id = org group by stage) x),
    'weekly', (select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'leads', w.leads, 'quoted', w.quoted, 'won_value', w.won_value) order by w.week), '[]'::jsonb)
      from (
        select gs::date as week,
          (select count(*) from public.leads l where l.organization_id = org
             and l.created_at >= gs and l.created_at < gs + interval '7 days') as leads,
          (select coalesce(sum(total), 0) from public.quotations q where q.organization_id = org
             and q.sent_at >= gs and q.sent_at < gs + interval '7 days') as quoted,
          (select coalesce(sum(total), 0) from public.quotations q where q.organization_id = org and q.status = 'accepted'
             and q.responded_at >= gs and q.responded_at < gs + interval '7 days') as won_value
        from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') gs
      ) w),
    'sources', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from
                (select source, count(*) n from public.leads where organization_id = org group by source) x)
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- GDPR: export, anonymisering och radering
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
    'leads', coalesce((select jsonb_agg(to_jsonb(l)) from public.leads l where l.customer_id = cid), '[]'),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.messages m
                           join public.leads l on l.id = m.lead_id where l.customer_id = cid), '[]'),
    'quotations', coalesce((select jsonb_agg(public.quotation_snapshot(q.id)) from public.quotations q where q.customer_id = cid), '[]'));
end $$;

create or replace function public.anonymize_customer(cid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = cid for update;
  if not found then raise exception 'Kunden hittades inte' using errcode = 'P0002'; end if;
  perform public.require_admin(c.organization_id);
  -- Offertbelopp behålls för bokföring; personuppgifter och fritext tas bort.
  update public.customers
     set name = 'Anonymiserad kund', email = null, phone = null, company_name = null, address = null,
         postal_code = null, city = null, notes = null, opted_out = true, anonymized_at = now()
   where id = cid;
  update public.leads
     set title = 'Anonymiserad förfrågan', message = null, ai_summary = null, ai_missing_info = null,
         ai_questions = null, ai_next_action = null
   where customer_id = cid;
  update public.messages m set body = '[Raderat på begäran av den registrerade]', subject = null
    from public.leads l where m.lead_id = l.id and l.customer_id = cid;
  update public.follow_up_tasks t set draft_body = null, draft_subject = null, status = case when t.status = 'pending' then 'cancelled'::public.task_status else t.status end
    from public.leads l where t.lead_id = l.id and l.customer_id = cid;
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
    'leads', coalesce((select jsonb_agg(to_jsonb(x)) from public.leads x where organization_id = org), '[]'),
    'messages', coalesce((select jsonb_agg(to_jsonb(x)) from public.messages x where organization_id = org), '[]'),
    'quotations', coalesce((select jsonb_agg(public.quotation_snapshot(x.id)) from public.quotations x where organization_id = org), '[]'),
    'follow_up_tasks', coalesce((select jsonb_agg(to_jsonb(x)) from public.follow_up_tasks x where organization_id = org), '[]'),
    'activity_logs', coalesce((select jsonb_agg(to_jsonb(x)) from public.activity_logs x where organization_id = org), '[]'));
end $$;

create or replace function public.delete_organization(org uuid, confirm_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin(org);
  if (select name from public.organizations where id = org) is distinct from confirm_name then
    raise exception 'Företagsnamnet stämmer inte' using errcode = '22023';
  end if;
  delete from public.organizations where id = org;
end $$;

-- ---------------------------------------------------------------------------
-- Funktionsrättigheter: inget är körbart för anon; service-funktioner bara för service_role
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_org_member(uuid), public.is_org_admin(uuid),
  public.create_organization(jsonb), public.accept_pending_invitations(),
  public.invite_member(uuid, text, public.member_role), public.set_member_role(uuid, uuid, public.member_role),
  public.remove_member(uuid, uuid),
  public.submit_quotation(uuid), public.approve_quotation(uuid), public.reopen_quotation(uuid),
  public.mark_quotation_sent(uuid), public.record_quotation_response(uuid, boolean, text),
  public.refresh_follow_ups(uuid), public.usage_summary(uuid), public.dashboard_stats(uuid),
  public.export_customer_data(uuid), public.anonymize_customer(uuid),
  public.export_organization_data(uuid), public.delete_organization(uuid, text)
to authenticated;

grant execute on all functions in schema public to service_role;
