begin;
alter table public.bitbot_v10_bots add column close_positions boolean not null default false;
create table public.bitbot_v14_company_jobs(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),slot bigint not null,
 mode text not null check(mode in('PAPER','LIVE','OBSERVE')),status text not null default 'READY' check(status in('READY','RUNNING','DONE','DEGRADED')),
 attempts int not null default 0,lease uuid,lease_until timestamptz,started_at timestamptz,finished_at timestamptz,
 result_gzip text,error text,created_at timestamptz not null default now(),unique(user_id,slot,mode)
);
create index bitbot_v14_jobs_user_time on public.bitbot_v14_company_jobs(user_id,created_at desc);
create index bitbot_v14_jobs_pending on public.bitbot_v14_company_jobs(status,lease_until) where status in('READY','RUNNING');
create table public.bitbot_v14_agents(
 user_id uuid not null references auth.users(id),worker_id text not null,role text not null,status text not null,
 last_seen_at timestamptz not null,completed bigint not null default 0,failed bigint not null default 0,tools jsonb not null,
 primary key(user_id,worker_id)
);
alter table public.bitbot_v14_company_jobs enable row level security;
alter table public.bitbot_v14_agents enable row level security;
create policy service_only on public.bitbot_v14_company_jobs for all to service_role using(true) with check(true);
create policy service_only on public.bitbot_v14_agents for all to service_role using(true) with check(true);
revoke all on public.bitbot_v14_company_jobs,public.bitbot_v14_agents from public,anon,authenticated;
grant all on public.bitbot_v14_company_jobs,public.bitbot_v14_agents to service_role;
create function public.bitbot_v14_company_claim(p_uid uuid,p_mode text,p_slot bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.bitbot_v14_company_jobs%rowtype;
begin
 if p_mode not in('PAPER','LIVE','OBSERVE') or p_slot<0 then raise exception 'Invalid company job';end if;
 if (select coalesce(sum(octet_length(result_gzip)),0) from public.bitbot_v14_company_jobs where user_id=p_uid)>200000000 then raise exception 'AUDIT_STORAGE_BUDGET';end if;
 insert into public.bitbot_v14_company_jobs(user_id,slot,mode) values(p_uid,p_slot,p_mode) on conflict(user_id,slot,mode) do nothing;
 select * into job from public.bitbot_v14_company_jobs where user_id=p_uid and slot=p_slot and mode=p_mode for update;
 if job.status in('DONE','DEGRADED') or job.attempts>=3 or job.lease_until>now() then return null;end if;
 update public.bitbot_v14_company_jobs set status='RUNNING',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '90 seconds',started_at=now()
 where id=job.id returning * into job;
 return to_jsonb(job);
end;$$;
create function public.bitbot_v14_company_finish(p_uid uuid,p_id uuid,p_lease uuid,p_archive text,p_workers jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare job public.bitbot_v14_company_jobs%rowtype;w jsonb;
begin
 select * into job from public.bitbot_v14_company_jobs where id=p_id and user_id=p_uid for update;
 if p_lease is null or job.lease is distinct from p_lease or job.status<>'RUNNING' then return false;end if;
 if jsonb_typeof(p_workers)<>'array' or jsonb_array_length(p_workers)>32 or length(p_archive)>1000000 then raise exception 'Company resource cap exceeded';end if;
 update public.bitbot_v14_company_jobs set status=case when p_error is null then 'DONE' else 'DEGRADED' end,result_gzip=p_archive,error=p_error,lease=null,lease_until=null,finished_at=now() where id=p_id;
 for w in select value from jsonb_array_elements(p_workers) loop
 insert into public.bitbot_v14_agents(user_id,worker_id,role,status,last_seen_at,completed,failed,tools)
 values(p_uid,w->>'id',w->>'role',w->>'status',to_timestamp((w->>'lastSeenAt')::numeric/1000),coalesce((w->>'completed')::bigint,0),coalesce((w->>'failed')::bigint,0),w->'tools')
 on conflict(user_id,worker_id) do update set role=excluded.role,status=excluded.status,last_seen_at=excluded.last_seen_at,
 completed=bitbot_v14_agents.completed+excluded.completed,failed=bitbot_v14_agents.failed+excluded.failed,tools=excluded.tools;
 end loop;
 return true;
end;$$;
revoke all on function public.bitbot_v14_company_claim(uuid,text,bigint),public.bitbot_v14_company_finish(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.bitbot_v14_company_claim(uuid,text,bigint),public.bitbot_v14_company_finish(uuid,uuid,uuid,text,jsonb,text) to service_role;
alter table public.bitbot_v13_shadow add column base_config jsonb;
alter table public.bitbot_v13_shadow add column buy_paused boolean not null default false;
create function public.bitbot_v14_paper_config(p_uid uuid,p_config jsonb,p_capital numeric) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.bitbot_v13_shadow%rowtype;
begin
 select * into r from public.bitbot_v13_shadow where user_id=p_uid for update;
 if r.enabled or exists(select 1 from jsonb_each(coalesce(r.states,'{}'::jsonb)) x where coalesce((x.value->'state'->>'qty')::numeric,0)>0) then raise exception 'Stop paper and close paper positions before changing capital';end if;
 if p_capital<=0 or p_capital>(p_config->>'budget')::numeric or p_capital>10000000 then raise exception 'Invalid paper capital';end if;
 if r.user_id is not null then insert into public.bitbot_v13_shadow_events(user_id,candidate,payload) values(p_uid,'SESSION',jsonb_build_object('kind','ARCHIVED_SESSION','capital',r.capital,'states',r.states,'config',r.base_config));end if;
 insert into public.bitbot_v13_shadow(user_id,enabled,capital,base_config) values(p_uid,false,p_capital,p_config)
 on conflict(user_id) do update set capital=excluded.capital,base_config=excluded.base_config,states='{}'::jsonb,started_at=now(),updated_at=now(),lease=null,lease_until=null;
 return true;
end;$$;
-- The paper-only capital ceiling is independent from the live account's hard limits.
alter table public.bitbot_v13_shadow drop constraint bitbot_v13_shadow_capital_check;
alter table public.bitbot_v13_shadow add constraint bitbot_v13_shadow_capital_check check(capital>0 and capital<=10000000);
revoke all on function public.bitbot_v14_paper_config(uuid,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.bitbot_v14_paper_config(uuid,jsonb,numeric) to service_role;
create function public.bitbot_v14_close_request(p_uid uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;
begin
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if b.user_id is null or coalesce((b.state->>'qty')::numeric,0)<=0 then raise exception 'No bot-owned position to close';end if;
 if exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled and status='UNKNOWN') then raise exception 'Resolve unknown order before closing';end if;
 update public.bitbot_v10_bots set close_positions=true,running=true,config=jsonb_set(config,'{buyPaused}','true'::jsonb),next_tick=now(),updated_at=now() where user_id=p_uid;
 insert into public.bitbot_v10_events(user_id,kind,payload) values(p_uid,'OWNER_CLOSE_REQUEST',jsonb_build_object('symbol',b.state->>'symbol','qty',b.state->'qty'));
 return true;
end;$$;
revoke all on function public.bitbot_v14_close_request(uuid) from public,anon,authenticated;
grant execute on function public.bitbot_v14_close_request(uuid) to service_role;
commit;
