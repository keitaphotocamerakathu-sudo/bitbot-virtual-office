-- Diagnose existing failed sessions with GETs; keep leased secret access private.
begin;
create or replace function bitbot_private.codex_load_key(p_uid uuid,p_job uuid,p_lease uuid) returns text
language plpgsql security definer set search_path='' as $$declare k text;begin
 if not exists(select 1 from rea.codex_jobs where id=p_job and user_id=p_uid and lease=p_lease and lease_until>now() and status in('CREATING','RUNNING','CANCEL_PENDING','FAILED')) then raise exception 'CODEX_LEASE_REQUIRED';end if;
 select decrypted_secret into k from vault.decrypted_secrets where id=(select secret_id from rea.codex_settings where user_id=p_uid);return k;
end$$;
create or replace function public.rea_codex_claim() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j rea.codex_jobs%rowtype;s rea.codex_settings%rowtype;b integer;d date=(now() at time zone 'Asia/Bangkok')::date;ctx jsonb;begin
 -- Read failure details for existing sessions only; never replay inference.
 select * into j from rea.codex_jobs q where status='FAILED' and error_code='CODEX_TURN_FAILED' and session_id is not null and (lease_until is null or lease_until<now()) and exists(select 1 from rea.codex_settings c where c.user_id=q.user_id and c.consent and c.secret_id is not null) order by created_at for update skip locked limit 1;
 if found then
  update rea.codex_jobs set lease=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=j.id returning * into j;
  return jsonb_build_object('action','DIAGNOSE','job',to_jsonb(j),'model',(select model from rea.codex_settings where user_id=j.user_id),'consent',true);
 end if;
 -- An uncertain create is never retried after an executor restart.
 update rea.codex_jobs set status='UNKNOWN',error_code='CODEX_CREATE_OUTCOME_UNKNOWN',lease=null,lease_until=null,updated_at=now() where status='CREATING' and lease_until<now();
 select * into j from rea.codex_jobs where status in('RUNNING','CANCEL_PENDING') and (lease_until is null or lease_until<now()) order by updated_at for update skip locked limit 1;
 if found then
  update rea.codex_jobs set lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('action','POLL','job',to_jsonb(j),'model',(select model from rea.codex_settings where user_id=j.user_id),'consent',(select consent from rea.codex_settings where user_id=j.user_id));
 end if;
 select * into s from rea.codex_settings c where secret_id is not null and consent and (requested or enabled and (last_started is null or last_started<now()-interval '180 minutes')) and coalesce((select calls from rea.codex_budget where user_id=c.user_id and day=d),0)<8 and exists(select 1 from rea.live_accounts where user_id=c.user_id) and not exists(select 1 from rea.codex_jobs where user_id=c.user_id and status in('CREATING','RUNNING','UNKNOWN','CANCEL_PENDING')) order by last_started nulls first for update skip locked limit 1;
 if not found then return null;end if;
 insert into rea.codex_budget(user_id,day) values(s.user_id,d) on conflict do nothing;
 select calls into b from rea.codex_budget where user_id=s.user_id and day=d for update;
 if b>=8 then return null;end if;
 -- Only bounded account data is supplied; exchange credentials never enter the context.
 select jsonb_build_object('state',jsonb_build_object('allocatedCapital',state->'allocatedCapital','cash',state->'cash','equity',state->'equity','dayPnl',state->'dayPnl','positions',state->'positions','kill',state->'kill','buyPaused',state->'buyPaused','dailyLocked',state->'dailyLocked'),
 'latest',jsonb_build_object('at',latest->'at','health',latest->'health','riskAt',latest->'riskAt','strategyAt',latest->'strategyAt','summary',latest->'summary','decisions',latest->'decisions','quotes',latest->'quotes'),
 'advisory',(select payload from rea.ai_cache where singleton)) into ctx from rea.live_accounts where user_id=s.user_id;
 if ctx is null then return null;end if;
 update rea.codex_budget set calls=calls+1 where user_id=s.user_id and day=d;
 update rea.codex_settings set requested=false,question='',last_started=now(),updated_at=now() where user_id=s.user_id;
 insert into rea.codex_jobs(user_id,status,question,context,lease,lease_until) values(s.user_id,'CREATING',s.question,ctx,gen_random_uuid(),now()+interval '60 seconds') returning * into j;
 return jsonb_build_object('action','CREATE','job',to_jsonb(j),'model',s.model);
end$$;
commit;
