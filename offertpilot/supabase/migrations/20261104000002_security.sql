-- OffertPilot AI – behörigheter och Row Level Security
-- Modell: anon har ingen direkt tabellåtkomst (publika flöden går via edge functions).
-- authenticated får explicita rättigheter och filtreras av RLS per organisation.

-- ---------------------------------------------------------------------------
-- Medlemskapshjälpare (SECURITY DEFINER för att undvika rekursiv RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Grundrättigheter
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Läsbart för alla inloggade
grant select on public.plans to authenticated;

-- Organisation: endast uppdatering av profilfält (skapas/raderas via RPC)
grant select on public.organizations to authenticated;
grant update (name, org_number, industry, email, phone, website, address, postal_code, city,
  description, pricing_model, communication_style, brand_color, logo_url)
  on public.organizations to authenticated;

grant select on public.organization_members to authenticated;
grant update (full_name) on public.organization_members to authenticated;

grant select, delete on public.organization_invitations to authenticated;

grant select on public.organization_settings to authenticated;
grant update (ai_tone, ai_custom_instructions, default_vat_rate, quote_validity_days, quote_intro,
  quote_terms, quote_footer, quote_number_prefix, rot_percent, follow_up_rules, notifications,
  email_from_name, email_reply_to, onboarding_completed)
  on public.organization_settings to authenticated;

grant select on public.subscriptions, public.usage_records, public.activity_logs,
  public.quotation_versions to authenticated;

grant select, insert, update, delete on public.services, public.pricing_rules,
  public.knowledge_items, public.message_templates, public.customers, public.leads,
  public.conversations, public.follow_up_tasks to authenticated;

grant select, insert, delete on public.messages to authenticated;
grant update (status, subject, body) on public.messages to authenticated;

-- Offert: status, summor, nummer, token och godkännande styrs enbart av servern
grant select, delete on public.quotations to authenticated;
grant insert (organization_id, lead_id, customer_id, title, intro, project_description,
  delivery_timeframe, terms, valid_until, discount_type, discount_value, apply_rot, rot_percent)
  on public.quotations to authenticated;
grant update (title, intro, project_description, delivery_timeframe, terms, valid_until,
  discount_type, discount_value, apply_rot, rot_percent)
  on public.quotations to authenticated;

grant select, delete on public.quotation_items to authenticated;
grant insert (organization_id, quotation_id, service_id, description, quantity, unit, unit_price,
  discount_percent, vat_rate, is_labor, sort, source, ai_reason)
  on public.quotation_items to authenticated;
grant update (service_id, description, quantity, unit, unit_price, discount_percent, vat_rate,
  is_labor, sort)
  on public.quotation_items to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_records enable row level security;
alter table public.services enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.message_templates enable row level security;
alter table public.customers enable row level security;
alter table public.leads enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.quotation_versions enable row level security;
alter table public.follow_up_tasks enable row level security;
alter table public.activity_logs enable row level security;
alter table public.rate_limits enable row level security; -- inga policies: endast service role

create policy plans_read on public.plans for select to authenticated using (active);

create policy org_read on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy members_read on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));
create policy members_update_self on public.organization_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy invitations_admin_read on public.organization_invitations for select to authenticated
  using (public.is_org_admin(organization_id));
create policy invitations_admin_delete on public.organization_invitations for delete to authenticated
  using (public.is_org_admin(organization_id));

create policy settings_read on public.organization_settings for select to authenticated
  using (public.is_org_member(organization_id));
create policy settings_update on public.organization_settings for update to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy subscriptions_read on public.subscriptions for select to authenticated
  using (public.is_org_member(organization_id));
create policy usage_read on public.usage_records for select to authenticated
  using (public.is_org_member(organization_id));
create policy activity_read on public.activity_logs for select to authenticated
  using (public.is_org_member(organization_id));
create policy versions_read on public.quotation_versions for select to authenticated
  using (public.is_org_member(organization_id));

-- Kunskapsbas: alla medlemmar läser, administratörer ändrar
do $$
declare t text;
begin
  foreach t in array array['services', 'pricing_rules', 'knowledge_items'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated
      using (public.is_org_member(organization_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (public.is_org_admin(organization_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated
      using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated
      using (public.is_org_admin(organization_id))', t);
  end loop;
end $$;

-- Arbetsdata: alla medlemmar läser och skriver, administratörer raderar
do $$
declare t text;
begin
  foreach t in array array['message_templates', 'customers', 'leads', 'conversations',
                           'quotations', 'quotation_items', 'follow_up_tasks'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated
      using (public.is_org_member(organization_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (public.is_org_member(organization_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated
      using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))', t);
  end loop;
end $$;

create policy message_templates_delete on public.message_templates for delete to authenticated
  using (public.is_org_member(organization_id));
create policy conversations_delete on public.conversations for delete to authenticated
  using (public.is_org_admin(organization_id));
-- Användare kan logga inkommande meddelanden, anteckningar och utkast – aldrig "skickat".
-- Skickad status sätts endast av servern efter faktisk leverans.
create policy messages_read on public.messages for select to authenticated
  using (public.is_org_member(organization_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (public.is_org_member(organization_id)
    and ((direction = 'outbound' and status = 'draft')
      or (direction = 'inbound' and status = 'received')
      or (direction = 'internal' and status = 'received')));
create policy messages_update on public.messages for update to authenticated
  using (public.is_org_member(organization_id) and status = 'draft')
  with check (public.is_org_member(organization_id) and status = 'draft');
create policy messages_delete on public.messages for delete to authenticated
  using (public.is_org_member(organization_id) and status = 'draft');
create policy follow_up_tasks_delete on public.follow_up_tasks for delete to authenticated
  using (public.is_org_member(organization_id));
create policy customers_delete on public.customers for delete to authenticated
  using (public.is_org_admin(organization_id));
create policy leads_delete on public.leads for delete to authenticated
  using (public.is_org_admin(organization_id));
-- Offerter kan bara raderas som utkast; utkastrader följer sin offert
create policy quotations_delete on public.quotations for delete to authenticated
  using (public.is_org_member(organization_id) and status = 'draft');
create policy quotation_items_delete on public.quotation_items for delete to authenticated
  using (public.is_org_member(organization_id));
