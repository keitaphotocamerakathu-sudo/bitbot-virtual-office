begin;
create table public.bitbot_v13_shadow(
 user_id uuid primary key references auth.users(id),enabled boolean not null default false,
 capital numeric not null check(capital>0 and capital<=100000),states jsonb not null default '{}'::jsonb,
 started_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 next_tick timestamptz not null default now(),lease uuid,lease_until timestamptz,last_error text
);
create table public.bitbot_v13_shadow_events(
 id bigint generated always as identity primary key,user_id uuid not null references auth.users(id),
 candidate text not null,payload jsonb not null,created_at timestamptz not null default now()
);
create index bitbot_v13_shadow_due on public.bitbot_v13_shadow(next_tick) where enabled;
create index bitbot_v13_shadow_events_user_time on public.bitbot_v13_shadow_events(user_id,created_at desc);
alter table public.bitbot_v13_shadow enable row level security;
alter table public.bitbot_v13_shadow_events enable row level security;
create policy service_only on public.bitbot_v13_shadow for all to service_role using(true) with check(true);
create policy service_only on public.bitbot_v13_shadow_events for all to service_role using(true) with check(true);
revoke all on public.bitbot_v13_shadow,public.bitbot_v13_shadow_events from public,anon,authenticated;
grant all on public.bitbot_v13_shadow,public.bitbot_v13_shadow_events to service_role;
grant usage,select on sequence public.bitbot_v13_shadow_events_id_seq to service_role;
create function public.bitbot_v13_shadow_claim(p_uid uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 with due as(select user_id from public.bitbot_v13_shadow where enabled and next_tick<=now()
 and (p_uid is null or user_id=p_uid) and (lease_until is null or lease_until<now())
 order by next_tick for update skip locked limit 10),claimed as(
 update public.bitbot_v13_shadow s set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds'
 from due where s.user_id=due.user_id returning s.*)
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
 return result;
end;$$;
create function public.bitbot_v13_shadow_finish(p_uid uuid,p_lease uuid,p_states jsonb,p_events jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_shadow public.bitbot_v13_shadow%rowtype;e jsonb;
begin
 select * into v_shadow from public.bitbot_v13_shadow where user_id=p_uid for update;
 if p_lease is null or v_shadow.lease is distinct from p_lease or not v_shadow.enabled then return false;end if;
 if jsonb_typeof(p_states)<>'object' or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>30 then raise exception 'Invalid paper checkpoint';end if;
 update public.bitbot_v13_shadow set states=p_states,lease=null,lease_until=null,next_tick=now()+interval '50 seconds',updated_at=now(),last_error=p_error where user_id=p_uid;
 for e in select value from jsonb_array_elements(p_events) loop
 insert into public.bitbot_v13_shadow_events(user_id,candidate,payload) values(p_uid,e->>'candidate',e->'event');
 end loop;
 return true;
end;$$;
create function public.bitbot_v13_shadow_toggle(p_uid uuid,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;
begin
 update public.bitbot_v13_shadow set enabled=p_enabled,lease=null,lease_until=null,next_tick=now(),updated_at=now() where user_id=p_uid;
 if found then return true;end if;
 if not p_enabled then return true;end if;
 select * into b from public.bitbot_v10_bots where user_id=p_uid;
 if b.user_id is null or coalesce((b.state->>'cash')::numeric,0)<=0 then raise exception 'Set capital before paper research';end if;
 insert into public.bitbot_v13_shadow(user_id,enabled,capital) values(p_uid,p_enabled,least((b.config->>'budget')::numeric,(b.state->>'cash')::numeric))
 on conflict(user_id) do update set enabled=p_enabled,lease=null,lease_until=null,next_tick=now(),updated_at=now();
 return true;
end;$$;
revoke all on function public.bitbot_v13_shadow_claim(uuid),public.bitbot_v13_shadow_finish(uuid,uuid,jsonb,jsonb,text),public.bitbot_v13_shadow_toggle(uuid,boolean) from public,anon,authenticated;
grant execute on function public.bitbot_v13_shadow_claim(uuid),public.bitbot_v13_shadow_finish(uuid,uuid,jsonb,jsonb,text),public.bitbot_v13_shadow_toggle(uuid,boolean) to service_role;
-- Explicitly retain the real-money STOP. Research uses independent simulated accounts.
update public.bitbot_v10_bots set running=false,lease=null,lease_until=null,updated_at=now() where user_id='2eef9088-4116-410d-aa4b-7ab1dc89ad6d';
select public.bitbot_v13_shadow_toggle('2eef9088-4116-410d-aa4b-7ab1dc89ad6d',true);
insert into public.bitbot_v10_events(user_id,kind,payload) values('2eef9088-4116-410d-aa4b-7ab1dc89ad6d','RESEARCH_ONLY','{"version":"13.0.0","realMoneyStopped":true,"paperCandidates":6}');
commit;
