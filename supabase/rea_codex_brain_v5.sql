-- Codex managed analysis is isolated from exchange execution and financial controls.
begin;
grant usage on schema bitbot_private to service_role;
create table rea.codex_settings(
 user_id uuid primary key references auth.users(id) on delete cascade,
 model text not null default 'gpt-6.1-sol' check(model='gpt-6.1-sol'),
 enabled boolean not null default false,consent boolean not null default false,
 secret_id uuid,key_verified_at timestamptz,last_started timestamptz,
 requested boolean not null default false,question text not null default '' check(length(question)<=800),
 latest_result jsonb,updated_at timestamptz not null default now()
);
create table rea.codex_budget(user_id uuid references rea.codex_settings(user_id) on delete cascade,day date,calls integer not null default 0 check(calls between 0 and 8),primary key(user_id,day));
create table rea.codex_jobs(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references rea.codex_settings(user_id) on delete cascade,
 status text not null check(status in('CREATING','RUNNING','COMPLETED','FAILED','UNKNOWN','CANCEL_PENDING','ABANDONED')),
 session_id text unique,question text not null default '',context jsonb,result jsonb,error_code text,usage jsonb,
 lease uuid,lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index codex_jobs_account_time on rea.codex_jobs(user_id,created_at desc);
create unique index codex_one_active on rea.codex_jobs(user_id) where status in('CREATING','RUNNING','UNKNOWN','CANCEL_PENDING');
do $$declare t text;begin foreach t in array array['codex_settings','codex_budget','codex_jobs'] loop
 execute format('alter table rea.%I enable row level security',t);
 execute format('create policy service_only on rea.%I for all to service_role using(true) with check(true)',t);
 execute format('revoke all on rea.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update on rea.%I to service_role',t);
end loop;end$$;

create function bitbot_private.codex_store_key(p_uid uuid,p_key text) returns uuid
language plpgsql security definer set search_path='' as $$declare sid uuid;begin
 if not exists(select 1 from rea.codex_settings where user_id=p_uid) or p_key is null or length(p_key) not between 23 and 503 or p_key!~'^sk-[A-Za-z0-9_-]+$' then raise exception 'INVALID_CODEX_KEY';end if;
 select secret_id into sid from rea.codex_settings where user_id=p_uid;
 if sid is null then select vault.create_secret(p_key,'rea-codex-'||p_uid::text,'REA owner-scoped OpenAI key') into sid;
 else perform vault.update_secret(sid,p_key);end if;
 return sid;
end$$;
create function bitbot_private.codex_load_key(p_uid uuid,p_job uuid,p_lease uuid) returns text
language plpgsql security definer set search_path='' as $$declare k text;begin
 if not exists(select 1 from rea.codex_jobs where id=p_job and user_id=p_uid and lease=p_lease and lease_until>now() and status in('CREATING','RUNNING','CANCEL_PENDING','FAILED')) then raise exception 'CODEX_LEASE_REQUIRED';end if;
 select decrypted_secret into k from vault.decrypted_secrets where id=(select secret_id from rea.codex_settings where user_id=p_uid);return k;
end$$;
revoke all on function bitbot_private.codex_store_key(uuid,text),bitbot_private.codex_load_key(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function bitbot_private.codex_store_key(uuid,text),bitbot_private.codex_load_key(uuid,uuid,uuid) to service_role;

create function public.rea_codex_view(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('configured',s.secret_id is not null,'model',coalesce(s.model,'gpt-6.1-sol'),'enabled',coalesce(s.enabled,false),'consent',coalesce(s.consent,false),'lastStarted',s.last_started,'requested',coalesce(s.requested,false),'latest',s.latest_result,
 'dailyCalls',coalesce((select calls from rea.codex_budget where user_id=p_uid and day=(now() at time zone 'Asia/Bangkok')::date),0),'dailyLimit',8,'intervalMinutes',180,
 'canTrade',false,'canChangeLimits',false,'provider','OPENAI_CODEX_MANAGED_AGENT',
 'jobs',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select id,status,session_id,question,result,error_code,usage,created_at,updated_at from rea.codex_jobs where user_id=p_uid order by created_at desc limit 10)x))
 from(select 1)dummy left join rea.codex_settings s on s.user_id=p_uid;
$$;
create function public.rea_codex_configure(p_uid uuid,p_key text default null,p_enabled boolean default false,p_consent boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$declare sid uuid;begin
 insert into rea.codex_settings(user_id) values(p_uid) on conflict do nothing;
 perform 1 from rea.codex_settings where user_id=p_uid for update;
 if p_enabled and not p_consent then raise exception 'CODEX_COST_AND_DATA_CONSENT_REQUIRED';end if;
 if p_key is not null then
  if exists(select 1 from rea.codex_jobs where user_id=p_uid and status in('CREATING','RUNNING','UNKNOWN','CANCEL_PENDING')) then raise exception 'CODEX_ACTIVE_REQUEST_REQUIRES_RESOLUTION';end if;
  sid=bitbot_private.codex_store_key(p_uid,p_key);
  update rea.codex_settings set secret_id=sid,key_verified_at=now() where user_id=p_uid;
 end if;
 if p_enabled and not exists(select 1 from rea.codex_settings where user_id=p_uid and secret_id is not null) then raise exception 'CODEX_KEY_REQUIRED';end if;
 update rea.codex_settings set enabled=p_enabled,consent=p_consent,requested=case when p_consent then requested else false end,updated_at=now() where user_id=p_uid;
 insert into rea.audit_logs(user_id,action,payload) values(p_uid,'CODEX_CONFIGURATION',jsonb_build_object('enabled',p_enabled,'consent',p_consent,'keyUpdated',p_key is not null,'model','gpt-6.1-sol'));
 return public.rea_codex_view(p_uid);
end$$;
create function public.rea_codex_request(p_uid uuid,p_question text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$declare s rea.codex_settings%rowtype;begin
 select * into s from rea.codex_settings where user_id=p_uid for update;
 if s.secret_id is null or not coalesce(s.consent,false) then raise exception 'CODEX_KEY_AND_CONSENT_REQUIRED';end if;
 if length(p_question)>800 then raise exception 'CODEX_QUESTION_TOO_LONG';end if;
 if exists(select 1 from rea.codex_jobs where user_id=p_uid and status in('CREATING','RUNNING','UNKNOWN','CANCEL_PENDING')) or s.requested then raise exception 'CODEX_REQUEST_ALREADY_ACTIVE';end if;
 if s.last_started>now()-interval '5 minutes' then raise exception 'CODEX_REQUEST_COOLDOWN';end if;
 if coalesce((select calls from rea.codex_budget where user_id=p_uid and day=(now() at time zone 'Asia/Bangkok')::date),0)>=8 then raise exception 'CODEX_DAILY_LIMIT';end if;
 update rea.codex_settings set requested=true,question=coalesce(p_question,''),updated_at=now() where user_id=p_uid;
 return jsonb_build_object('queued',true);
end$$;
create function public.rea_codex_resolve_unknown(p_uid uuid,p_confirm text) returns boolean
language plpgsql security invoker set search_path='' as $$begin
 if p_confirm is distinct from 'ตรวจคำขอ Codex ที่ไม่ทราบผลแล้ว' then raise exception 'CODEX_RESOLUTION_CONFIRMATION_REQUIRED';end if;
 update rea.codex_jobs set status='ABANDONED',updated_at=now() where user_id=p_uid and status='UNKNOWN';
 update rea.codex_settings set enabled=false,requested=false,updated_at=now() where user_id=p_uid;
 insert into rea.audit_logs(user_id,action,payload) values(p_uid,'CODEX_UNKNOWN_RESOLVED','{"automaticAnalysisDisabled":true}');return true;
end$$;
create function public.rea_codex_claim() returns jsonb
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
create function public.rea_codex_key(p_uid uuid,p_job uuid,p_lease uuid) returns text
language sql security invoker set search_path='' as $$select bitbot_private.codex_load_key(p_uid,p_job,p_lease)$$;
create function public.rea_codex_checkpoint(p_job uuid,p_lease uuid,p_status text,p_session text default null,p_result jsonb default null,p_error text default null,p_usage jsonb default null) returns boolean
language plpgsql security invoker set search_path='' as $$declare j rea.codex_jobs%rowtype;begin
 select * into j from rea.codex_jobs where id=p_job for update;
 if not found or j.lease is distinct from p_lease or p_lease is null or j.lease_until is null or j.lease_until<now() then return false;end if;
 if p_status is null or p_status not in('RUNNING','COMPLETED','FAILED','UNKNOWN','CANCEL_PENDING') then raise exception 'INVALID_CODEX_STATE';end if;
 if j.session_id is not null and p_session is distinct from j.session_id then raise exception 'CODEX_SESSION_IMMUTABLE';end if;
 if p_session is not null and p_session!~'^[A-Za-z0-9_-]{6,200}$' then raise exception 'INVALID_CODEX_SESSION';end if;
 if p_status='COMPLETED' and (p_session is null or p_result->>'canTrade' is distinct from 'false' or p_result->>'canChangeLimits' is distinct from 'false' or p_result->>'provider' is distinct from 'OPENAI_CODEX_MANAGED_AGENT' or length(p_result::text)>14000) then raise exception 'INVALID_CODEX_RESULT';end if;
 update rea.codex_jobs set status=p_status,session_id=p_session,result=p_result,error_code=left(p_error,100),usage=p_usage,lease=null,lease_until=null,updated_at=now() where id=p_job;
 if p_status='COMPLETED' then
  update rea.codex_settings set latest_result=p_result,updated_at=now() where user_id=j.user_id;
  insert into rea.audit_logs(user_id,action,payload) values(j.user_id,'CODEX_ANALYSIS_COMPLETED',jsonb_build_object('jobId',j.id,'sessionId',p_session,'canTrade',false));
 end if;return true;
end$$;
-- Public-schema RPCs remain callable only by the authenticated backend service.
do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'rea_codex_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);
end loop;end$$;
create function bitbot_private.rea_codex_schedule() returns void
language plpgsql security invoker set search_path='' as $$declare token text;begin
 if not exists(select 1 from rea.codex_settings where secret_id is not null and consent) then return;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='bitbot-v10-runner';
 if token is null then return;end if;
 perform net.http_post(url:='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitbot-v10?action=rea-codex-run',headers:=jsonb_build_object('Content-Type','application/json','x-bitbot-runner',token),body:='{}'::jsonb,timeout_milliseconds:=45000);
end$$;
revoke all on function bitbot_private.rea_codex_schedule() from public,anon,authenticated;
do $$begin if not exists(select 1 from cron.job where jobname='rea-codex-brain-minute') then perform cron.schedule('rea-codex-brain-minute','* * * * *','select bitbot_private.rea_codex_schedule()');end if;end$$;
commit;
