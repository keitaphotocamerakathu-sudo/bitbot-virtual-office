-- Additive paper operations: independent risk checks, backend feed and incident monitor.
begin;
alter table rea.bot_settings add column if not exists operational_lock boolean not null default false;
alter table rea.bot_settings add column if not exists operational_reasons jsonb not null default '[]';
create table rea.service_leases(service text primary key,instance uuid not null,expires_at timestamptz not null);
create table rea.service_heartbeats(service text primary key,instance uuid not null,status text not null,detail jsonb not null default '{}',at timestamptz not null default now());
create table rea.live_market(symbol text primary key,payload jsonb not null,received_at timestamptz not null,instance uuid not null);
create table rea.alerts(id bigint generated always as identity primary key,user_id uuid not null references rea.bot_settings,incident_key text not null,status text not null check(status in('OPEN','RESOLVED')),reason text not null,opened_at timestamptz not null default now(),resolved_at timestamptz);
create unique index rea_one_open_incident on rea.alerts(user_id,incident_key) where status='OPEN';
do $$declare t text;begin foreach t in array array['service_leases','service_heartbeats','live_market','alerts'] loop
 execute format('alter table rea.%I enable row level security',t);
 execute format('create policy service_only on rea.%I for all to service_role using(true) with check(true)',t);
end loop;end$$;
revoke all on rea.service_leases,rea.service_heartbeats,rea.live_market,rea.alerts from public,anon,authenticated;
grant select,insert,update on rea.service_leases,rea.service_heartbeats,rea.live_market,rea.alerts to service_role;
grant usage,select on sequence rea.alerts_id_seq to service_role;

create function public.rea_service_lease(p_service text,p_instance uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v uuid;begin
 if p_service not in('market-collector','strategy-worker','risk-watchdog','health-monitor') then raise exception 'UNKNOWN_SERVICE';end if;
 insert into rea.service_leases values(p_service,p_instance,now()+interval '30 seconds') on conflict(service) do update set instance=excluded.instance,expires_at=excluded.expires_at where rea.service_leases.expires_at<now() or rea.service_leases.instance=p_instance returning instance into v;
 return v is not null;
end$$;
create function public.rea_service_heartbeat(p_service text,p_instance uuid,p_status text,p_detail jsonb default '{}') returns boolean
language plpgsql security invoker set search_path='' as $$begin
 if not exists(select 1 from rea.service_leases where service=p_service and instance=p_instance and expires_at>now()) then return false;end if;
 if p_status not in('OK','IDLE','SAFE_MODE','STARTING') or octet_length(p_detail::text)>10000 then raise exception 'INVALID_HEARTBEAT';end if;
 insert into rea.service_heartbeats values(p_service,p_instance,p_status,p_detail,now()) on conflict(service) do update set instance=excluded.instance,status=excluded.status,detail=excluded.detail,at=excluded.at;
 return true;
end$$;
create function public.rea_publish_market(p_instance uuid,p_quotes jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare q jsonb;t timestamptz;n integer=0;begin
 if not exists(select 1 from rea.service_leases where service='market-collector' and instance=p_instance and expires_at>now()) then raise exception 'COLLECTOR_LEASE_REQUIRED';end if;
 if jsonb_typeof(p_quotes)<>'array' or jsonb_array_length(p_quotes)>32 then raise exception 'INVALID_MARKET_BATCH';end if;
 for q in select value from jsonb_array_elements(p_quotes) loop
  t=to_timestamp((q->>'observedAt')::double precision/1000);
  if q->>'symbol' !~ '^[A-Z0-9]{1,16}_THB$' or q->>'source'<>'BITKUB_PUBLIC_WS' or q->>'timestampSource'<>'LOCAL_RECEIPT' or t<now()-interval '30 seconds' or t>now()+interval '5 seconds' or not ((q->>'bid')::numeric>0 and (q->>'ask')::numeric>=(q->>'bid')::numeric and (q->>'last')::numeric>0) then raise exception 'INVALID_MARKET_QUOTE';end if;
  insert into rea.live_market values(q->>'symbol',q,t,p_instance) on conflict(symbol) do update set payload=excluded.payload,received_at=excluded.received_at,instance=excluded.instance where rea.live_market.received_at<excluded.received_at;
  n=n+1;
 end loop;return n;
end$$;
create function public.rea_market_quotes(p_symbols text[] default null) returns jsonb
language sql security invoker set search_path='' as $$select coalesce(jsonb_agg(payload),'[]') from rea.live_market where received_at>now()-interval '30 seconds' and (p_symbols is null or symbol=any(p_symbols));$$;
create function public.rea_risk_accounts() returns jsonb
language sql security invoker set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'state',state,'latest',latest,'revision',revision,'operational_lock',operational_lock)),'[]') from rea.bot_settings where enabled;$$;
create function public.rea_risk_heartbeat(p_uid uuid,p_at bigint,p_status text) returns boolean
language plpgsql security invoker set search_path='' as $$begin
 if p_at<extract(epoch from now()-interval '30 seconds')*1000 or p_at>extract(epoch from now()+interval '5 seconds')*1000 or p_status not in('OK','IDLE','SAFE_MODE') then raise exception 'INVALID_RISK_HEARTBEAT';end if;
 insert into rea.bot_heartbeats values(p_uid,'risk-watchdog',p_at,p_status) on conflict(user_id,service) do update set at_ms=excluded.at_ms,status=excluded.status where rea.bot_heartbeats.at_ms<excluded.at_ms;return true;
end$$;
create function public.rea_risk_checkpoint(p_uid uuid,p_revision bigint,p_state jsonb,p_latest jsonb,p_events jsonb,p_fills jsonb,p_at bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare b rea.bot_settings%rowtype;v uuid;ok boolean;old_beat rea.bot_heartbeats%rowtype;begin
 select * into b from rea.bot_settings where user_id=p_uid for update;
 if not found or b.revision<>p_revision then return false;end if;
 -- Fast risk may reduce/cancel holdings, never introduce or enlarge a buy.
 if exists(select 1 from jsonb_array_elements(p_state->'orders') as e(value) where e.value->>'side'='BUY' and not exists(select 1 from jsonb_array_elements(b.state->'orders') as old(value) where old.value->>'id'=e.value->>'id' and (e.value->>'remaining')::numeric<=(old.value->>'remaining')::numeric)) then raise exception 'RISK_WATCHDOG_CANNOT_BUY';end if;
 if exists(select 1 from jsonb_array_elements(p_state->'positions') as e(value) where not exists(select 1 from jsonb_array_elements(b.state->'positions') as old(value) where old.value->>'symbol'=e.value->>'symbol' and (e.value->>'qty')::numeric<=(old.value->>'qty')::numeric)) then raise exception 'RISK_WATCHDOG_CANNOT_INCREASE_POSITION';end if;
 select * into old_beat from rea.bot_heartbeats where user_id=p_uid and service='paper-cycle';
 v=gen_random_uuid();update rea.bot_settings set lease=v,lease_until=now()+interval '30 seconds' where user_id=p_uid;
 ok=public.rea_checkpoint(p_uid,v,p_revision,p_state,p_latest,p_events,'[]',p_fills,p_at,null);
 if ok then
  update rea.bot_settings set next_tick=b.next_tick where user_id=p_uid;
  if old_beat.user_id is not null then update rea.bot_heartbeats set at_ms=old_beat.at_ms,status=old_beat.status where user_id=p_uid and service='paper-cycle';end if;
  insert into rea.audit_logs(user_id,action,payload) values(p_uid,'RISK_WATCHDOG',jsonb_build_object('at',p_at,'events',p_events,'mode','PAPER_ONLY'));
 end if;return ok;
end$$;
create function public.rea_monitor() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b record;h rea.bot_heartbeats%rowtype;r jsonb;v text;changed integer=0;begin
 for b in select * from rea.bot_settings where enabled for update loop
  select * into h from rea.bot_heartbeats where user_id=b.user_id and service='paper-cycle';r='[]';
  if h.user_id is null or h.at_ms<extract(epoch from now()-interval '180 seconds')*1000 then r=r||'"BACKEND_HEARTBEAT_STALE"'::jsonb;
  elsif h.status<>'OK' then r=r||'"MARKET_OR_RISK_STATE_UNAVAILABLE"'::jsonb;end if;
  if not exists(select 1 from rea.bot_heartbeats where user_id=b.user_id and service='risk-watchdog' and status in('OK','IDLE') and at_ms>extract(epoch from now()-interval '180 seconds')*1000) then r=r||'"INDEPENDENT_WATCHDOG_STALE"'::jsonb;end if;
  if b.latest->>'runtime'='DOCKER' then
   if not exists(select 1 from rea.service_heartbeats where service='market-collector' and status='OK' and at>now()-interval '30 seconds') then r=r||'"WEBSOCKET_COLLECTOR_STALE"'::jsonb;end if;
   if not(r ? 'INDEPENDENT_WATCHDOG_STALE') and not exists(select 1 from rea.service_heartbeats where service='risk-watchdog' and status in('OK','IDLE') and at>now()-interval '30 seconds') then r=r||'"INDEPENDENT_WATCHDOG_STALE"'::jsonb;end if;
  end if;
  if b.operational_lock is distinct from (jsonb_array_length(r)>0) or b.operational_reasons is distinct from r then
   update rea.bot_settings set operational_lock=jsonb_array_length(r)>0,operational_reasons=r,revision=revision+1,lease=null,lease_until=null,next_tick=now() where user_id=b.user_id;
   insert into rea.audit_logs(user_id,action,payload) values(b.user_id,'OPERATIONAL_SAFETY',jsonb_build_object('locked',jsonb_array_length(r)>0,'reasons',r));changed=changed+1;
  end if;
  for v in select jsonb_array_elements_text(r) loop
   insert into rea.alerts(user_id,incident_key,status,reason) values(b.user_id,v,'OPEN',v) on conflict(user_id,incident_key) where status='OPEN' do nothing;
  end loop;
  update rea.alerts set status='RESOLVED',resolved_at=now() where user_id=b.user_id and status='OPEN' and not(r ? incident_key);
 end loop;return jsonb_build_object('mode','PAPER_ONLY','changed',changed,'checked_at',now());
end$$;
revoke all on function public.rea_service_lease(text,uuid),public.rea_service_heartbeat(text,uuid,text,jsonb),public.rea_publish_market(uuid,jsonb),public.rea_market_quotes(text[]),public.rea_risk_accounts(),public.rea_risk_heartbeat(uuid,bigint,text),public.rea_risk_checkpoint(uuid,bigint,jsonb,jsonb,jsonb,jsonb,bigint),public.rea_monitor() from public,anon,authenticated;
grant execute on function public.rea_service_lease(text,uuid),public.rea_service_heartbeat(text,uuid,text,jsonb),public.rea_publish_market(uuid,jsonb),public.rea_market_quotes(text[]),public.rea_risk_accounts(),public.rea_risk_heartbeat(uuid,bigint,text),public.rea_risk_checkpoint(uuid,bigint,jsonb,jsonb,jsonb,jsonb,bigint),public.rea_monitor() to service_role;
-- Independent database monitor runs even if the HTTP analysis worker cannot start.
do $$begin if not exists(select 1 from cron.job where jobname='rea-health-minute') then perform cron.schedule('rea-health-minute','* * * * *','select public.rea_monitor()');end if;end$$;
commit;
