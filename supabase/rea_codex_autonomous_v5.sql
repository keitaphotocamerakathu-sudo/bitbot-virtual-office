-- Autonomous strategic plans, bounded portfolio events and explicit billing recovery.
begin;
alter table rea.codex_settings add column if not exists last_fingerprint text;
alter table rea.codex_settings add column if not exists provider_blocked text;
create or replace function rea.codex_fingerprint(p_state jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select md5(jsonb_build_object('positions',(select coalesce(jsonb_agg(jsonb_build_object('symbol',p->'symbol','qty',p->'qty','cost',p->'cost','stop',p->'stop','target',p->'target') order by p->>'symbol'),'[]'::jsonb) from jsonb_array_elements(coalesce(p_state->'positions','[]'::jsonb))p),'locked',p_state->'dailyLocked','kill',p_state->'kill','paused',p_state->'buyPaused')::text)
$$;
revoke all on function rea.codex_fingerprint(jsonb) from public,anon,authenticated;
grant execute on function rea.codex_fingerprint(jsonb) to service_role;
-- Preserve the owner-selected automatic mode; label the provider blockage separately.
update rea.codex_settings c set last_fingerprint=rea.codex_fingerprint(a.state) from rea.live_accounts a where a.user_id=c.user_id and c.last_fingerprint is null;
update rea.codex_settings c set provider_blocked=j.error_code from rea.codex_jobs j where j.user_id=c.user_id and j.status='FAILED' and j.error_code~'^CODEX_PROVIDER_(USAGE_LIMIT_EXCEEDED|INSUFFICIENT_QUOTA|CREDIT_BALANCE_EXHAUSTED|ORGANIZATION_SPEND_LIMIT_EXCEEDED|PROJECT_SPEND_LIMIT_EXCEEDED|ORGANIZATION_USAGE_LIMIT_EXCEEDED)$' and j.id=(select id from rea.codex_jobs where user_id=c.user_id order by created_at desc limit 1);
create or replace function public.rea_codex_view(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('configured',s.secret_id is not null,'model',coalesce(s.model,'gpt-6.1-sol'),'enabled',coalesce(s.enabled,false),'consent',coalesce(s.consent,false),'lastStarted',s.last_started,'requested',coalesce(s.requested,false),'latest',s.latest_result,
 'dailyCalls',coalesce((select calls from rea.codex_budget where user_id=p_uid and day=(now() at time zone 'Asia/Bangkok')::date),0),'dailyLimit',8,'intervalMinutes',180,'eventCooldownMinutes',15,'providerBlocked',s.provider_blocked,'automaticState',case when s.provider_blocked is not null then 'BLOCKED' when s.enabled and s.consent then 'ON' else 'OFF' end,
 'canTrade',false,'canChangeLimits',false,'provider','OPENAI_CODEX_MANAGED_AGENT',
 'jobs',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select id,status,session_id,question,result,error_code,usage,created_at,updated_at from rea.codex_jobs where user_id=p_uid order by created_at desc limit 10)x))
 from(select 1)dummy left join rea.codex_settings s on s.user_id=p_uid;
$$;
create or replace function public.rea_codex_request(p_uid uuid,p_question text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$declare s rea.codex_settings%rowtype;begin
 select * into s from rea.codex_settings where user_id=p_uid for update;
 if s.secret_id is null or not coalesce(s.consent,false) then raise exception 'CODEX_KEY_AND_CONSENT_REQUIRED';end if;
 if length(p_question)>800 then raise exception 'CODEX_QUESTION_TOO_LONG';end if;
 if exists(select 1 from rea.codex_jobs where user_id=p_uid and status in('CREATING','RUNNING','UNKNOWN','CANCEL_PENDING')) or s.requested then raise exception 'CODEX_REQUEST_ALREADY_ACTIVE';end if;
 if s.last_started>now()-interval '5 minutes' then raise exception 'CODEX_REQUEST_COOLDOWN';end if;
 if coalesce((select calls from rea.codex_budget where user_id=p_uid and day=(now() at time zone 'Asia/Bangkok')::date),0)>=8 then raise exception 'CODEX_DAILY_LIMIT';end if;
 update rea.codex_settings set requested=true,provider_blocked=null,question=coalesce(p_question,''),updated_at=now() where user_id=p_uid;
 return jsonb_build_object('queued',true);
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
 select * into s from rea.codex_settings c where secret_id is not null and consent and provider_blocked is null and (requested or enabled and (last_started is null or last_started<now()-interval '180 minutes' or last_started<now()-interval '15 minutes' and last_fingerprint is distinct from (select rea.codex_fingerprint(state) from rea.live_accounts where user_id=c.user_id))) and coalesce((select calls from rea.codex_budget where user_id=c.user_id and day=d),0)<8 and exists(select 1 from rea.live_accounts where user_id=c.user_id) and not exists(select 1 from rea.codex_jobs where user_id=c.user_id and status in('CREATING','RUNNING','UNKNOWN','CANCEL_PENDING')) order by last_started nulls first for update skip locked limit 1;
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
 update rea.codex_settings set requested=false,question='',last_fingerprint=rea.codex_fingerprint(ctx->'state'),last_started=now(),updated_at=now() where user_id=s.user_id;
 insert into rea.codex_jobs(user_id,status,question,context,lease,lease_until) values(s.user_id,'CREATING',s.question,ctx,gen_random_uuid(),now()+interval '60 seconds') returning * into j;
 return jsonb_build_object('action','CREATE','job',to_jsonb(j),'model',s.model);
end$$;
create or replace function public.rea_codex_checkpoint(p_job uuid,p_lease uuid,p_status text,p_session text default null,p_result jsonb default null,p_error text default null,p_usage jsonb default null) returns boolean
language plpgsql security invoker set search_path='' as $$declare j rea.codex_jobs%rowtype;begin
 select * into j from rea.codex_jobs where id=p_job for update;
 if not found or j.lease is distinct from p_lease or p_lease is null or j.lease_until is null or j.lease_until<now() then return false;end if;
 if p_status is null or p_status not in('RUNNING','COMPLETED','FAILED','UNKNOWN','CANCEL_PENDING') then raise exception 'INVALID_CODEX_STATE';end if;
 if j.session_id is not null and p_session is distinct from j.session_id then raise exception 'CODEX_SESSION_IMMUTABLE';end if;
 if p_session is not null and p_session!~'^[A-Za-z0-9_-]{6,200}$' then raise exception 'INVALID_CODEX_SESSION';end if;
 if p_status='COMPLETED' and (p_session is null or p_result->>'canTrade' is distinct from 'false' or p_result->>'canChangeLimits' is distinct from 'false' or p_result->>'provider' is distinct from 'OPENAI_CODEX_MANAGED_AGENT' or length(p_result::text)>14000) then raise exception 'INVALID_CODEX_RESULT';end if;
 update rea.codex_jobs set status=p_status,session_id=p_session,result=p_result,error_code=left(p_error,100),usage=p_usage,lease=null,lease_until=null,updated_at=now() where id=p_job;
 if p_status='FAILED' and p_error~'^CODEX_PROVIDER_(USAGE_LIMIT_EXCEEDED|INSUFFICIENT_QUOTA|CREDIT_BALANCE_EXHAUSTED|ORGANIZATION_SPEND_LIMIT_EXCEEDED|PROJECT_SPEND_LIMIT_EXCEEDED|ORGANIZATION_USAGE_LIMIT_EXCEEDED)$' then update rea.codex_settings set provider_blocked=p_error,requested=false,updated_at=now() where user_id=j.user_id;end if;
 if p_status='COMPLETED' then
  update rea.codex_settings set latest_result=p_result,updated_at=now() where user_id=j.user_id;
  insert into rea.audit_logs(user_id,action,payload) values(j.user_id,'CODEX_ANALYSIS_COMPLETED',jsonb_build_object('jobId',j.id,'sessionId',p_session,'canTrade',false));
 end if;return true;
end$$;
commit;
