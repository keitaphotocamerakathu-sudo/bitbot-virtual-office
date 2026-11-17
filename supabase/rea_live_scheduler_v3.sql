begin;
create function bitbot_private.rea_live_schedule(p_risk boolean default false) returns void
language plpgsql security invoker set search_path='' as $$declare token text;begin
 if not exists(select 1 from rea.live_accounts) then return;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='bitbot-v10-runner';
 if token is null then raise exception 'RUNNER_TOKEN_MISSING';end if;
 perform net.http_post(
  url:='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitbot-v10?action='||case when p_risk then 'rea-live-risk' else 'rea-live-run' end,
  headers:=jsonb_build_object('Content-Type','application/json','x-bitbot-runner',token),
  body:='{}'::jsonb,timeout_milliseconds:=case when p_risk then 45000 else 60000 end);
end$$;
revoke all on function bitbot_private.rea_live_schedule(boolean) from public,anon,authenticated;
do $$begin
 if not exists(select 1 from cron.job where jobname='rea-live-strategy-minute') then perform cron.schedule('rea-live-strategy-minute','* * * * *','select bitbot_private.rea_live_schedule(false)');end if;
 if not exists(select 1 from cron.job where jobname='rea-live-risk-15s') then perform cron.schedule('rea-live-risk-15s','15 seconds','select bitbot_private.rea_live_schedule(true)');end if;
end$$;
commit;
