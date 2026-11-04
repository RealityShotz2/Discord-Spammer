-- Skapar (vid behov) den publika länktoken som skickas till kunden. Kräver godkänd offert.
create or replace function public.prepare_quotation_token(qid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  select * into q from public.quotations where id = qid for update;
  if not found then raise exception 'Offerten hittades inte' using errcode = 'P0002'; end if;
  perform public.require_member(q.organization_id);
  if q.status not in ('approved', 'sent') then
    raise exception 'Offerten måste vara godkänd innan den skickas' using errcode = 'P0001';
  end if;
  if q.public_token is null then
    perform set_config('offertpilot.system', 'on', true);
    update public.quotations set public_token = encode(extensions.gen_random_bytes(24), 'hex')
     where id = qid returning * into q;
    perform set_config('offertpilot.system', 'off', true);
  end if;
  return q.public_token;
end $$;

revoke execute on function public.prepare_quotation_token(uuid) from public, anon;
grant execute on function public.prepare_quotation_token(uuid) to authenticated, service_role;
