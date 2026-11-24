-- Separate a missing heartbeat from an observed risk failure. Account locks remain fail-closed.
alter table rea.bot_heartbeats add column if not exists reasons jsonb not null default '[]'::jsonb;

create table rea.paper_unverified_days (
 user_id uuid not null references rea.bot_settings(user_id),trading_day date not null,
 first_observed_at timestamptz not null default now(),primary key(user_id,trading_day)
);
alter table rea.paper_unverified_days enable row level security;
revoke all on rea.paper_unverified_days from public,anon,authenticated,service_role;
grant select,insert on rea.paper_unverified_days to service_role;
create policy service_read on rea.paper_unverified_days for select to service_role using(true);
create policy service_record on rea.paper_unverified_days for insert to service_role with check(true);

create or replace function public.rea_risk_observation(p_uid uuid,p_at bigint,p_status text,p_reasons jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_at is null or p_at not between extract(epoch from now()-interval '30 seconds')*1000 and extract(epoch from now()+interval '5 seconds')*1000
    or p_status is null or p_status not in ('OK','IDLE','SAFE_MODE')
    or jsonb_typeof(p_reasons) is distinct from 'array' then raise exception 'INVALID_RISK_OBSERVATION'; end if;
 if jsonb_array_length(p_reasons)>6 or (p_status in ('OK','IDLE') and p_reasons<>'[]'::jsonb)
    or exists(select 1 from jsonb_array_elements_text(p_reasons) code where code is null or code not in
      ('MIDNIGHT_BASELINE_UNVERIFIED','WATCHDOG_MARKET_DATA_UNAVAILABLE','WATCHDOG_DEPTH_UNAVAILABLE',
       'WATCHDOG_RISK_STATE_UNAVAILABLE','WATCHDOG_CHECKPOINT_UNCONFIRMED')) then raise exception 'INVALID_RISK_REASON'; end if;
 insert into rea.bot_heartbeats(user_id,service,at_ms,status,reasons) values(p_uid,'risk-watchdog',p_at,p_status,p_reasons)
 on conflict(user_id,service) do update set at_ms=excluded.at_ms,status=excluded.status,reasons=excluded.reasons
 where rea.bot_heartbeats.at_ms<excluded.at_ms;
 return found;
end $$;

-- Older runners clear previous detailed evidence when recording their own new observation.
create or replace function public.rea_risk_heartbeat(p_uid uuid,p_at bigint,p_status text)
returns boolean language sql security invoker set search_path='' as $$
 select public.rea_risk_observation(p_uid,p_at,p_status,'[]'::jsonb);
$$;

create or replace function rea.paper_heartbeat_reasons(p_now bigint,p_at bigint,p_age integer,p_status text,
 p_healthy text[],p_stale text,p_degraded text,p_causes jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select case when p_at is null or p_at<p_now-p_age or p_at>p_now+5000 then jsonb_build_array(p_stale)
  when p_status=any(p_healthy) then '[]'::jsonb
  when jsonb_typeof(p_causes)='array' and p_causes<>'[]'::jsonb then p_causes
  else jsonb_build_array(p_degraded) end;
$$;

create or replace function public.rea_monitor() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 b record; paper rea.bot_heartbeats%rowtype; risk rea.bot_heartbeats%rowtype; svc rea.service_heartbeats%rowtype;
 stamp bigint=floor(extract(epoch from now())*1000); reasons jsonb; causes jsonb; code text; changed integer=0;
begin
 for b in select user_id,state->'baselinePending' as pending,state->>'day' as trading_date,latest->>'runtime' as runtime,latest->>'error' as error,
     latest->'events' as events,operational_lock,operational_reasons from rea.bot_settings where enabled for update loop
  select * into paper from rea.bot_heartbeats where user_id=b.user_id and service='paper-cycle';
  select * into risk from rea.bot_heartbeats where user_id=b.user_id and service='risk-watchdog';
  reasons=case when b.pending='true'::jsonb then '["MIDNIGHT_BASELINE_UNVERIFIED"]'::jsonb else '[]'::jsonb end;
  if b.pending='true'::jsonb and b.trading_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   insert into rea.paper_unverified_days(user_id,trading_day) values(b.user_id,b.trading_date::date) on conflict do nothing;
  end if;
  causes=reasons;
  if b.error is not null then causes=causes||jsonb_build_array('MARKET_OR_RISK_STATE_UNAVAILABLE'); end if;
  if b.events @> '[{"kind":"SAFE_MODE","reason":"MARKET_DATA_UNAVAILABLE"}]'::jsonb or
     b.events @> '[{"kind":"SAFE_MODE","reason":"STALE_POSITION_MARK"}]'::jsonb then
   causes=causes||jsonb_build_array('MARKET_DATA_UNAVAILABLE');
  end if;
  reasons=reasons||rea.paper_heartbeat_reasons(stamp,paper.at_ms,180000,paper.status,array['OK'],
    'BACKEND_HEARTBEAT_STALE','MARKET_OR_RISK_STATE_UNAVAILABLE',causes);
  reasons=reasons||rea.paper_heartbeat_reasons(stamp,risk.at_ms,180000,risk.status,array['OK','IDLE'],
    'INDEPENDENT_WATCHDOG_STALE','INDEPENDENT_WATCHDOG_DEGRADED',risk.reasons);
  if b.runtime='DOCKER' then
   select * into svc from rea.service_heartbeats where service='market-collector';
   reasons=reasons||rea.paper_heartbeat_reasons(stamp,floor(extract(epoch from svc.at)*1000)::bigint,30000,svc.status,array['OK'],
      'WEBSOCKET_COLLECTOR_STALE','WEBSOCKET_COLLECTOR_DEGRADED','[]');
   select * into svc from rea.service_heartbeats where service='risk-watchdog';
   reasons=reasons||rea.paper_heartbeat_reasons(stamp,floor(extract(epoch from svc.at)*1000)::bigint,30000,svc.status,array['OK','IDLE'],
      'INDEPENDENT_WATCHDOG_STALE','DOCKER_WATCHDOG_DEGRADED','[]');
  end if;
  select coalesce(jsonb_agg(v order by n),'[]'::jsonb) into reasons from
    (select v,min(n) as n from jsonb_array_elements_text(reasons) with ordinality as vals(v,n) group by v) distinct_causes;
  if b.operational_lock is distinct from (reasons<>'[]'::jsonb) or b.operational_reasons is distinct from reasons then
   update rea.bot_settings set operational_lock=reasons<>'[]'::jsonb,operational_reasons=reasons,revision=revision+1,
     lease=null,lease_until=null,next_tick=now() where user_id=b.user_id;
   insert into rea.audit_logs(user_id,action,payload) values(b.user_id,'OPERATIONAL_SAFETY',jsonb_build_object('locked',reasons<>'[]'::jsonb,'reasons',reasons));
   changed=changed+1;
  end if;
  for code in select jsonb_array_elements_text(reasons) loop
   insert into rea.alerts(user_id,incident_key,status,reason) values(b.user_id,code,'OPEN',code)
   on conflict(user_id,incident_key) where status='OPEN' do nothing;
  end loop;
  update rea.alerts set status='RESOLVED',resolved_at=now() where user_id=b.user_id and status='OPEN' and not(reasons ? incident_key);
 end loop;
 return jsonb_build_object('mode','PAPER_ONLY','changed',changed,'checked_at',now());
end $$;

revoke all on function public.rea_risk_observation(uuid,bigint,text,jsonb),
 rea.paper_heartbeat_reasons(bigint,bigint,integer,text,text[],text,text,jsonb) from public,anon,authenticated;
grant execute on function public.rea_risk_observation(uuid,bigint,text,jsonb),
 rea.paper_heartbeat_reasons(bigint,bigint,integer,text,text[],text,text,jsonb) to service_role;

create or replace function public.rea_view(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('mode',mode,'enabled',enabled,'state',state,'latest',latest,'updatedAt',updated_at,'lastError',last_error,'revision',revision,
 'operations',jsonb_build_object('locked',operational_lock,'reasons',operational_reasons,
 'services',(select coalesce(jsonb_agg(jsonb_build_object('service',service,'status',status,'at',at,'detail',detail)),'[]') from rea.service_heartbeats),
 'riskAt',(select at_ms from rea.bot_heartbeats where user_id=p_uid and service='risk-watchdog'),
 'riskStatus',(select status from rea.bot_heartbeats where user_id=p_uid and service='risk-watchdog'),
 'boundaryEvidence',(select jsonb_build_object('day',q.trading_day,'status',q.status,'requestedAt',q.requested_at,'receivedAt',q.received_at)
   from rea.paper_boundary_inventories i join rea.paper_boundary_requests q using(trading_day)
   where i.user_id=p_uid and i.book='PARENT' order by i.trading_day desc limit 1),
 'alerts',(select coalesce(jsonb_agg(x order by id desc),'[]') from(select id,reason,status,opened_at,resolved_at from rea.alerts where user_id=p_uid order by id desc limit 30)x)),
 'paperEvidence',(select jsonb_build_object('samples',count(*),'firstAt',min(at_ms),'lastAt',max(at_ms),'daysObserved',round((max(at_ms)-min(at_ms))::numeric/86400000,3),'maximumGapMs',max(gap),'minimum7DaysElapsed',coalesce(max(at_ms)-min(at_ms)>=604800000,false),'liveActivationAllowed',false) from(select at_ms,at_ms-lag(at_ms) over(order by at_ms) as gap from rea.equity_snapshots where user_id=p_uid)x),
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from (select at_ms,equity from rea.equity_snapshots where user_id=p_uid order by at_ms desc limit 1440)x),
 'daily',(select coalesce(jsonb_agg(x order by day),'[]') from (select d.day,
   case when g.trading_day is not null then d.payload||'{"baselinePending":true}'::jsonb else d.payload end as payload
   from rea.daily_pnl d left join rea.paper_unverified_days g on g.user_id=d.user_id and g.trading_day=d.day
   where d.user_id=p_uid order by d.day desc limit 366)x),
 'audit',(select coalesce(jsonb_agg(x order by id desc),'[]') from (select id,action,payload,created_at from rea.audit_logs where user_id=p_uid order by id desc limit 50)x))
 from rea.bot_settings where user_id=p_uid;
$$;
