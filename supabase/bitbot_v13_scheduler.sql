create or replace function bitbot_private.v10_schedule() returns void
language plpgsql security definer set search_path='' as $$
declare v text;
begin
 if not exists(select 1 from public.bitbot_v10_bots where running)
 and not exists(select 1 from public.bitbot_v10_orders where not settled)
 and not exists(select 1 from public.bitbot_v13_shadow where enabled) then return;end if;
 select decrypted_secret into v from vault.decrypted_secrets where name='bitbot-v10-runner';
 perform net.http_post(url:='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitbot-v10?action=run',
 headers:=jsonb_build_object('Content-Type','application/json','x-bitbot-runner',v),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;$$;
