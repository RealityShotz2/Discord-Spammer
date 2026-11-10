-- Affärssystem: nya uppgiftstyper och AI-användning (egen migrering: nya enum-värden
-- kan inte användas i samma transaktion som de skapas i).
alter type public.task_kind add value if not exists 'agreement_renewal';
alter type public.task_kind add value if not exists 'recurring_order';
alter type public.task_kind add value if not exists 'inactive_customer';
alter type public.task_kind add value if not exists 'order_approval';
alter type public.usage_kind add value if not exists 'ai_order_draft';

create type public.customer_status as enum ('prospect', 'active', 'paused', 'ended');
create type public.customer_type as enum ('company', 'private');
create type public.agreement_status as enum ('draft', 'active', 'expired', 'terminated');
create type public.order_status as enum ('draft', 'pending_approval', 'confirmed', 'in_progress', 'delivered', 'cancelled');
create type public.order_source as enum ('manual', 'recurring', 'portal', 'ai', 'quote');
create type public.recurrence_frequency as enum ('daily', 'weekly', 'monthly');
create type public.recurring_status as enum ('active', 'paused', 'ended');
