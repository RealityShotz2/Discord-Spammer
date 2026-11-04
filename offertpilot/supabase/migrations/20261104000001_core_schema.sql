-- Offertfabriken – kärnschema
-- Alla organisationsägda tabeller har organization_id och isoleras via RLS (se 0002).
-- Barntabeller använder sammansatta främmande nycklar (id, organization_id) så att en rad
-- aldrig kan kopplas till en förälder i en annan organisation.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Enum-typer
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'employee');
create type public.lead_stage as enum ('new', 'qualification', 'quote_draft', 'quote_sent', 'negotiation', 'won', 'lost');
create type public.lead_source as enum ('website', 'manual', 'email', 'phone', 'other');
create type public.quote_status as enum ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined', 'expired');
create type public.message_direction as enum ('inbound', 'outbound', 'internal');
create type public.message_status as enum ('received', 'draft', 'sent', 'demo_not_sent', 'failed');
create type public.channel as enum ('website', 'email', 'phone', 'note');
create type public.task_status as enum ('pending', 'done', 'dismissed', 'cancelled');
create type public.task_kind as enum ('lead_response', 'quote_followup', 'custom');
create type public.pricing_rule_kind as enum ('discount_percent', 'surcharge_percent', 'fixed_fee', 'minimum_charge', 'note');
create type public.knowledge_kind as enum ('faq', 'policy', 'working_area', 'instruction');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'incomplete');
create type public.usage_kind as enum ('ai_lead_analysis', 'ai_quote_draft', 'ai_followup', 'ai_reply');

-- ---------------------------------------------------------------------------
-- Gemensamma hjälpare
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Planer (konfigurerbara, inte hårdkodade i koden)
-- ---------------------------------------------------------------------------
create table public.plans (
  id text primary key,
  name text not null,
  price_sek integer not null check (price_sek >= 0),
  max_users integer not null check (max_users > 0),
  max_ai_leads_per_month integer not null check (max_ai_leads_per_month > 0),
  features jsonb not null default '{}'::jsonb,
  stripe_price_id text,
  sort integer not null default 0,
  active boolean not null default true
);

insert into public.plans (id, name, price_sek, max_users, max_ai_leads_per_month, features, sort) values
  ('starter', 'Starter', 999, 1, 30,
    '{"ai_followups": false, "analytics": false, "branding": false, "integrations": false}', 1),
  ('professional', 'Professional', 1999, 5, 150,
    '{"ai_followups": true, "analytics": true, "branding": true, "integrations": false}', 2),
  ('business', 'Business', 3999, 25, 600,
    '{"ai_followups": true, "analytics": true, "branding": true, "integrations": true, "priority_support": true}', 3);

-- ---------------------------------------------------------------------------
-- Organisationer och medlemmar
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  org_number text check (org_number is null or org_number ~ '^\d{6}-?\d{4}$'),
  industry text,
  email text,
  phone text,
  website text,
  address text,
  postal_code text,
  city text,
  description text check (description is null or char_length(description) <= 4000),
  pricing_model text,
  communication_style text,
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  public_form_key text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'employee',
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  role public.member_role not null default 'employee',
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);
create unique index organization_invitations_open_idx
  on public.organization_invitations (organization_id, email) where accepted_at is null;

create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  ai_tone text not null default 'professionell och vänlig',
  ai_custom_instructions text check (ai_custom_instructions is null or char_length(ai_custom_instructions) <= 4000),
  default_vat_rate numeric(5,2) not null default 25 check (default_vat_rate between 0 and 100),
  quote_validity_days integer not null default 30 check (quote_validity_days between 1 and 365),
  quote_intro text,
  quote_terms text,
  quote_footer text,
  quote_number_prefix text not null default 'OFF' check (quote_number_prefix ~ '^[A-Z0-9-]{1,10}$'),
  next_quote_number integer not null default 1001,
  rot_percent numeric(5,2) not null default 30 check (rot_percent between 0 and 100),
  follow_up_rules jsonb not null default
    '{"lead_response_hours": 24, "quote_followup_days": [3, 7, 14], "auto_send": false}'::jsonb,
  notifications jsonb not null default
    '{"new_lead_email": true, "quote_response_email": true, "daily_digest": false}'::jsonb,
  email_from_name text,
  email_reply_to text,
  onboarding_completed boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger organization_settings_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Prenumerationer och användning
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan_id text not null references public.plans (id) default 'starter',
  status public.subscription_status not null default 'trialing',
  trial_ends_at timestamptz default now() + interval '14 days',
  current_period_end timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.usage_kind not null,
  lead_id uuid,
  provider text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  success boolean not null,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index usage_records_org_month_idx on public.usage_records (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Kunskapsbas: tjänster, prisregler och övrig företagskunskap
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  unit text not null default 'st' check (char_length(unit) between 1 and 12),
  -- NULL = pris sätts manuellt per offert (AI får aldrig hitta på ett pris)
  unit_price numeric(12,2) check (unit_price is null or unit_price >= 0),
  vat_rate numeric(5,2) not null default 25 check (vat_rate between 0 and 100),
  is_labor boolean not null default false,
  default_lead_time text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index services_org_idx on public.services (organization_id) where active;
create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  kind public.pricing_rule_kind not null,
  value numeric(12,2) check (value is null or value >= 0),
  condition text check (condition is null or char_length(condition) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (kind = 'note' or value is not null),
  check (kind not in ('discount_percent', 'surcharge_percent') or value <= 100)
);
create index pricing_rules_org_idx on public.pricing_rules (organization_id);
create trigger pricing_rules_updated_at before update on public.pricing_rules
  for each row execute function public.set_updated_at();

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.knowledge_kind not null,
  title text not null check (char_length(title) between 1 and 200),
  content text not null check (char_length(content) <= 4000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_items_org_idx on public.knowledge_items (organization_id, kind);
create trigger knowledge_items_updated_at before update on public.knowledge_items
  for each row execute function public.set_updated_at();

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  subject text,
  body text not null check (char_length(body) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index message_templates_org_idx on public.message_templates (organization_id);
create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Kunder och leads
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  email extensions.citext check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or char_length(phone) <= 40),
  company_name text,
  address text,
  postal_code text,
  city text,
  notes text,
  opted_out boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index customers_org_idx on public.customers (organization_id);
create index customers_org_email_idx on public.customers (organization_id, email);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  requested_service text,
  message text check (message is null or char_length(message) <= 10000),
  source public.lead_source not null default 'manual',
  stage public.lead_stage not null default 'new',
  position double precision not null default extract(epoch from now()),
  estimated_value numeric(12,2) check (estimated_value is null or estimated_value >= 0),
  assigned_to uuid references auth.users (id) on delete set null,
  lost_reason text,
  -- AI-analys (skrivs av edge function, valideras mot schema)
  ai_summary text,
  ai_category text,
  ai_priority text check (ai_priority is null or ai_priority in ('low', 'medium', 'high')),
  ai_missing_info jsonb,
  ai_questions jsonb,
  ai_next_action text,
  ai_matched_service_ids uuid[],
  ai_source text,
  ai_analyzed_at timestamptz,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id)
    references public.customers (id, organization_id) on delete cascade
);
create index leads_org_stage_idx on public.leads (organization_id, stage, position);
create index leads_org_created_idx on public.leads (organization_id, created_at desc);
create index leads_customer_idx on public.leads (customer_id);
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  channel public.channel not null,
  subject text,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (lead_id, channel),
  foreign key (lead_id, organization_id)
    references public.leads (id, organization_id) on delete cascade
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  lead_id uuid not null,
  direction public.message_direction not null,
  status public.message_status not null,
  subject text,
  body text not null check (char_length(body) <= 20000),
  ai_generated boolean not null default false,
  sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, organization_id)
    references public.conversations (id, organization_id) on delete cascade,
  foreign key (lead_id, organization_id)
    references public.leads (id, organization_id) on delete cascade
);
create index messages_lead_idx on public.messages (lead_id, created_at);
create index messages_org_created_idx on public.messages (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Offerter
-- ---------------------------------------------------------------------------
create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid,
  customer_id uuid not null,
  number text not null,
  title text not null check (char_length(title) between 1 and 200),
  status public.quote_status not null default 'draft',
  intro text,
  project_description text,
  delivery_timeframe text,
  terms text,
  valid_until date,
  discount_type text not null default 'none' check (discount_type in ('none', 'percent', 'amount')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  apply_rot boolean not null default false,
  rot_percent numeric(5,2) not null default 30 check (rot_percent between 0 and 100),
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  vat_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  rot_deduction numeric(12,2) not null default 0,
  total_to_pay numeric(12,2) not null default 0,
  requires_manual_input boolean not null default false,
  ai_generated boolean not null default false,
  ai_warnings jsonb,
  version integer not null default 1,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  responded_at timestamptz,
  customer_response_note text,
  public_token text unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, number),
  check (discount_type <> 'percent' or discount_value <= 100),
  foreign key (customer_id, organization_id)
    references public.customers (id, organization_id) on delete cascade,
  foreign key (lead_id, organization_id)
    references public.leads (id, organization_id) on delete set null (lead_id)
);
create index quotations_org_status_idx on public.quotations (organization_id, status);
create index quotations_lead_idx on public.quotations (lead_id);
create trigger quotations_updated_at before update on public.quotations
  for each row execute function public.set_updated_at();

create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quotation_id uuid not null,
  service_id uuid,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit text not null default 'st',
  -- NULL = kräver manuell prissättning, offerten kan inte godkännas
  unit_price numeric(12,2) check (unit_price is null or unit_price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  vat_rate numeric(5,2) not null default 25 check (vat_rate between 0 and 100),
  is_labor boolean not null default false,
  line_total numeric(12,2) not null default 0,
  source text not null default 'manual' check (source in ('manual', 'catalog', 'ai_catalog', 'ai_manual', 'pricing_rule')),
  ai_reason text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (quotation_id, organization_id)
    references public.quotations (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.services (id, organization_id) on delete set null (service_id)
);
create index quotation_items_quote_idx on public.quotation_items (quotation_id, sort);

create table public.quotation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quotation_id uuid not null,
  version integer not null,
  reason text not null,
  snapshot jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (quotation_id, organization_id)
    references public.quotations (id, organization_id) on delete cascade
);
create index quotation_versions_quote_idx on public.quotation_versions (quotation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Uppföljning och aktivitetslogg
-- ---------------------------------------------------------------------------
create table public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  quotation_id uuid,
  kind public.task_kind not null,
  title text not null check (char_length(title) between 1 and 200),
  due_at timestamptz not null,
  status public.task_status not null default 'pending',
  sequence integer not null default 1,
  draft_subject text,
  draft_body text,
  ai_generated boolean not null default false,
  assigned_to uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (lead_id, organization_id)
    references public.leads (id, organization_id) on delete cascade,
  foreign key (quotation_id, organization_id)
    references public.quotations (id, organization_id) on delete cascade
);
create index follow_up_tasks_org_due_idx on public.follow_up_tasks (organization_id, status, due_at);
create unique index follow_up_tasks_dedupe_idx
  on public.follow_up_tasks (lead_id, kind, coalesce(quotation_id, '00000000-0000-0000-0000-000000000000'::uuid), sequence)
  where kind <> 'custom';

create table public.activity_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_org_idx on public.activity_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting (endast service role)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
