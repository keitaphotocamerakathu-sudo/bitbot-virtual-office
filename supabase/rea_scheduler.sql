-- Starts only the separate REA paper portfolio for existing Bitbot accounts.
begin;
insert into rea.bot_settings(user_id,state,enabled)
select user_id,jsonb_set('{"version":1,"mode":"PAPER_ONLY","initialCapital":10000,"cash":10000,"positions":[],"orders":[],"fills":[],"closed":[],"days":{},"day":"2026-11-17","dayStart":10000,"dayFlows":0,"realized":0,"fees":0,"peak":10000,"maxDrawdown":0,"dailyLocked":false,"buyPaused":false,"kill":"NONE","seen":{},"equity":10000,"dayPnl":0,"lastAt":null,"baselinePending":false}'::jsonb,'{day}',to_jsonb((now() at time zone 'Asia/Bangkok')::date::text)),true
from public.bitbot_v10_bots on conflict(user_id) do nothing;
create or replace function bitbot_private.rea_schedule() returns void
language plpgsql security invoker set search_path='' as $$
declare v text;begin
 if not exists(select 1 from rea.bot_settings where enabled) then return;end if;
 select decrypted_secret into v from vault.decrypted_secrets where name='bitbot-v10-runner';
 if v is null then raise exception 'RUNNER_TOKEN_MISSING';end if;
 perform net.http_post(url:='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitbot-v10?action=rea-run',headers:=jsonb_build_object('Content-Type','application/json','x-bitbot-runner',v),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function bitbot_private.rea_schedule() from public,anon,authenticated;
do $$begin
 if not exists(select 1 from cron.job where jobname='rea-paper-minute') then
 perform cron.schedule('rea-paper-minute','* * * * *','select bitbot_private.rea_schedule()');
 end if;
end$$;
commit;

