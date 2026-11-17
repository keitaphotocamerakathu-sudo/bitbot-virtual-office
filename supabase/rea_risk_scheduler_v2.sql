begin;
create or replace function bitbot_private.rea_risk_schedule() returns void
language plpgsql security invoker set search_path='' as $$declare token text;begin
 if not exists(select 1 from rea.bot_settings where enabled) then return;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='bitbot-v10-runner';
 if token is null then raise exception 'RUNNER_TOKEN_MISSING';end if;
 perform net.http_post(url:='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitbot-v10?action=rea-risk',headers:=jsonb_build_object('Content-Type','application/json','x-bitbot-runner',token),body:='{}'::jsonb,timeout_milliseconds:=30000);
end$$;
revoke all on function bitbot_private.rea_risk_schedule() from public,anon,authenticated;
do $$begin if not exists(select 1 from cron.job where jobname='rea-risk-minute') then perform cron.schedule('rea-risk-minute','* * * * *','select bitbot_private.rea_risk_schedule()');end if;end$$;
commit;
