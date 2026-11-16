begin;
create policy service_only on public.bitbot_v10_bots for all to service_role using (true) with check (true);
create policy service_only on public.bitbot_v10_orders for all to service_role using (true) with check (true);
create policy service_only on public.bitbot_v10_events for all to service_role using (true) with check (true);
create policy service_only on bitbot_private.v10_rate for all to service_role using (true) with check (true);
create policy service_only on bitbot_private.v10_recovery for all to service_role using (true) with check (true);
commit;