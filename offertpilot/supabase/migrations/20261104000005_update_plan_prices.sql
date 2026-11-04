-- Nya abonnemangspriser (SEK/månad exkl. moms). Gränser och funktioner är oförändrade.
-- Visningsdata finns i supabase/functions/_shared/plans.ts (kontrolleras av src/plans.test.ts).
update public.plans set price_sek = 399  where id = 'starter';
update public.plans set price_sek = 899  where id = 'professional';
update public.plans set price_sek = 1799 where id = 'business';
