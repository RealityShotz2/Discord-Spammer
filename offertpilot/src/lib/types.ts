// Radtyper som speglar databasschemat (supabase/migrations).
export type Role = "admin" | "employee";
export type LeadStage = "new" | "qualification" | "quote_draft" | "quote_sent" | "negotiation" | "won" | "lost";
export type LeadSource = "website" | "manual" | "email" | "phone" | "other";
export type QuoteStatus = "draft" | "pending_approval" | "approved" | "sent" | "accepted" | "declined" | "expired";
export type TaskStatus = "pending" | "done" | "dismissed" | "cancelled";

export interface Organization {
  id: string; name: string; org_number: string | null; industry: string | null; email: string | null; phone: string | null;
  website: string | null; address: string | null; postal_code: string | null; city: string | null; description: string | null;
  pricing_model: string | null; communication_style: string | null; brand_color: string | null; logo_url: string | null;
  public_form_key: string; created_at: string;
}
export interface Membership { organization_id: string; role: Role; full_name: string | null; email: string | null; user_id: string; organizations: Organization }
export interface OrgSettings {
  organization_id: string; ai_tone: string; ai_custom_instructions: string | null; default_vat_rate: number; quote_validity_days: number;
  quote_intro: string | null; quote_terms: string | null; quote_footer: string | null; quote_number_prefix: string; rot_percent: number;
  follow_up_rules: { lead_response_hours: number; quote_followup_days: number[]; auto_send: boolean };
  notifications: { new_lead_email: boolean; quote_response_email: boolean; daily_digest: boolean };
  email_from_name: string | null; email_reply_to: string | null; onboarding_completed: boolean;
  order_number_prefix: string; inactive_customer_days: number; recurring_reminder_days: number; portal_enabled: boolean;
}
export interface Usage {
  plan_id: string; plan_name: string; price_sek: number; status: string; trial_ends_at: string | null; current_period_end: string | null;
  max_users: number; max_ai_leads: number; ai_leads_used: number; active: boolean;
  features: { ai_followups?: boolean; analytics?: boolean; branding?: boolean; integrations?: boolean; priority_support?: boolean;
    price_lists?: boolean; orders?: boolean; recurring_orders?: boolean; customer_portal?: boolean; ai_orders?: boolean };
}
export interface Customer {
  id: string; organization_id: string; name: string; email: string | null; phone: string | null; company_name: string | null;
  address: string | null; postal_code: string | null; city: string | null; notes: string | null; opted_out: boolean; anonymized_at: string | null; created_at: string;
}
export interface Lead {
  id: string; organization_id: string; customer_id: string; title: string; requested_service: string | null; message: string | null;
  source: LeadSource; stage: LeadStage; position: number; estimated_value: number | null; assigned_to: string | null; lost_reason: string | null;
  ai_summary: string | null; ai_category: string | null; ai_priority: "low" | "medium" | "high" | null; ai_missing_info: string[] | null;
  ai_questions: string[] | null; ai_next_action: string | null; ai_matched_service_ids: string[] | null; ai_source: string | null;
  ai_analyzed_at: string | null; last_contact_at: string | null; created_at: string; updated_at: string;
  customers?: Pick<Customer, "id" | "name" | "email" | "phone" | "company_name" | "city" | "opted_out"> | null;
}
export interface Service {
  id: string; organization_id: string; name: string; description: string | null; unit: string; unit_price: number | null;
  vat_rate: number; is_labor: boolean; default_lead_time: string | null; active: boolean; sort: number;
}
export interface PricingRule { id: string; organization_id: string; name: string; kind: "discount_percent" | "surcharge_percent" | "fixed_fee" | "minimum_charge" | "note"; value: number | null; condition: string | null; active: boolean }
export interface KnowledgeItem { id: string; organization_id: string; kind: "faq" | "policy" | "working_area" | "instruction"; title: string; content: string; active: boolean }
export interface Quotation {
  id: string; organization_id: string; lead_id: string | null; customer_id: string; number: string; title: string; status: QuoteStatus;
  intro: string | null; project_description: string | null; delivery_timeframe: string | null; terms: string | null; valid_until: string | null;
  discount_type: "none" | "percent" | "amount"; discount_value: number; apply_rot: boolean; rot_percent: number;
  subtotal: number; discount_total: number; vat_total: number; total: number; rot_deduction: number; total_to_pay: number;
  requires_manual_input: boolean; ai_generated: boolean; ai_warnings: string[] | null; version: number;
  approved_by: string | null; approved_at: string | null; sent_at: string | null; responded_at: string | null;
  customer_response_note: string | null; public_token: string | null; created_at: string; updated_at: string;
  customers?: Pick<Customer, "id" | "name" | "email" | "company_name"> | null;
}
export interface QuotationItem {
  id: string; quotation_id: string; organization_id: string; service_id: string | null; description: string; quantity: number; unit: string;
  unit_price: number | null; discount_percent: number; vat_rate: number; is_labor: boolean; line_total: number; source: string; ai_reason: string | null; sort: number;
}
export interface Message {
  id: string; conversation_id: string; lead_id: string; direction: "inbound" | "outbound" | "internal";
  status: "received" | "draft" | "sent" | "demo_not_sent" | "failed"; subject: string | null; body: string; ai_generated: boolean; sent_at: string | null; created_at: string;
}
export interface FollowUpTask {
  id: string; organization_id: string; lead_id: string | null; quotation_id: string | null; customer_id: string | null; agreement_id: string | null; order_id: string | null;
  kind: "lead_response" | "quote_followup" | "custom" | "agreement_renewal" | "recurring_order" | "inactive_customer" | "order_approval";
  title: string; due_at: string; status: TaskStatus; sequence: number; draft_subject: string | null; draft_body: string | null; ai_generated: boolean;
  completed_at: string | null; created_at: string;
  leads?: { id: string; title: string; stage: LeadStage; customers: { name: string; email: string | null; opted_out: boolean } | null } | null;
  quotations?: { number: string; total: number } | null;
  customers?: { id: string; name: string; email: string | null; opted_out: boolean } | null;
  orders?: { id: string; number: string } | null;
}
export interface Activity { id: number; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string; actor_id: string | null }

// ----------------------------------------------------------------------------- affärssystem
export type CustomerStatus = "prospect" | "active" | "paused" | "ended";
export type OrderStatus = "draft" | "pending_approval" | "confirmed" | "in_progress" | "delivered" | "cancelled";
export type OrderSource = "manual" | "recurring" | "portal" | "ai" | "quote";
export type AgreementStatus = "draft" | "active" | "expired" | "terminated";
export type Frequency = "daily" | "weekly" | "monthly";

export interface BusinessCustomer extends Customer {
  customer_number: number | null; customer_type: "company" | "private"; org_number: string | null; status: CustomerStatus;
  payment_terms_days: number; discount_percent: number; invoice_email: string | null;
  delivery_address: string | null; delivery_postal_code: string | null; delivery_city: string | null; updated_at: string;
}
export interface Contact { id: string; organization_id: string; customer_id: string; name: string; role: string | null; email: string | null; phone: string | null; is_primary: boolean; notes: string | null }
export interface Agreement {
  id: string; organization_id: string; customer_id: string; title: string; start_date: string; end_date: string | null; notice_days: number;
  auto_renew: boolean; renewal_months: number; price_list_id: string | null; terms: string | null; status: AgreementStatus; created_at: string;
}
export interface PriceList { id: string; organization_id: string; name: string; description: string | null; customer_id: string | null; is_default: boolean; valid_from: string | null; valid_to: string | null; active: boolean; created_at: string; updated_at: string }
export interface PriceListItem { id: string; organization_id: string; price_list_id: string; service_id: string | null; sku: string | null; name: string; description: string | null; unit: string; unit_price: number; vat_rate: number; active: boolean; sort: number; price_list_item_tiers?: { id: string; min_quantity: number; unit_price: number }[] }
export interface Order {
  id: string; organization_id: string; number: string; customer_id: string; contact_id: string | null; agreement_id: string | null; price_list_id: string | null;
  quotation_id: string | null; recurring_order_id: string | null; occurrence_date: string | null; status: OrderStatus; source: OrderSource;
  requested_delivery_date: string | null; delivery_date: string | null; delivery_address: string | null; customer_reference: string | null;
  notes_internal: string | null; notes_customer: string | null; payment_terms_days: number; discount_percent: number;
  subtotal: number; discount_total: number; vat_total: number; total: number; requires_manual_input: boolean; ai_generated: boolean; ai_warnings: string[] | null;
  confirmed_at: string | null; created_at: string; updated_at: string;
  customers?: { id: string; name: string; customer_number: number | null; email: string | null } | null;
}
export interface OrderItem { id: string; order_id: string; organization_id: string; price_list_item_id: string | null; sku: string | null; description: string; quantity: number; unit: string; unit_price: number | null; discount_percent: number; vat_rate: number; line_total: number; sort: number }
export interface RecurringOrder {
  id: string; organization_id: string; customer_id: string; contact_id: string | null; agreement_id: string | null; title: string; frequency: Frequency;
  interval_count: number; weekdays: number[] | null; day_of_month: number | null; start_date: string; end_date: string | null; lead_days: number;
  status: "active" | "paused" | "ended"; next_occurrence: string | null; last_occurrence: string | null; delivery_address: string | null;
  customer_reference: string | null; notes: string | null; created_at: string;
  customers?: { id: string; name: string } | null;
}
export interface RecurringItem { id: string; recurring_order_id: string; organization_id: string; price_list_item_id: string | null; sku: string | null; description: string; quantity: number; unit: string; unit_price: number | null; vat_rate: number; sort: number }
export interface PortalUser { id: string; customer_id: string; email: string; contact_id: string | null; invited_at: string; accepted_at: string | null; disabled_at: string | null }
