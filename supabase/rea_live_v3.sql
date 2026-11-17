-- Actual exchange execution. Separate ledgers; deployment does not activate Live.
begin;
create table rea.live_accounts(
 user_id uuid primary key references rea.bot_settings(user_id),
 mode text not null default 'LIVE_LOCKED' check(mode in('LIVE_LOCKED','LIVE_ENABLED')),
 state jsonb, preflight jsonb not null default '{}', latest jsonb not null default '{}',
 revision bigint not null default 0, lease uuid, lease_until timestamptz,
 next_tick timestamptz not null default now(), updated_at timestamptz not null default now(),
 approval jsonb, last_error text
);
create table rea.live_orders(
 user_id uuid not null references rea.live_accounts,client_order_id uuid not null,
 client_id text not null,exchange_id text,status text not null,payload jsonb not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(user_id,client_order_id),unique(user_id,client_id)
);
create table rea.live_fills(
 user_id uuid not null references rea.live_accounts,txn_id text not null,
 client_order_id uuid not null,payload jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,txn_id),foreign key(user_id,client_order_id) references rea.live_orders
);
create table rea.live_checks(
 user_id uuid not null references rea.live_accounts,check_name text not null,
 spec text not null default 'REA-LIVE-19.0',passed boolean not null default false,
 evidence jsonb not null default '{}',checked_at timestamptz not null default now(),expires_at timestamptz,
 primary key(user_id,check_name)
);
create table rea.live_heartbeats(
 user_id uuid not null references rea.live_accounts,lane text not null check(lane in('strategy','risk')),
 at_ms bigint not null,status text not null,primary key(user_id,lane)
);
create table rea.live_equity(
 user_id uuid not null references rea.live_accounts,at_ms bigint not null,equity numeric not null,
 day text not null,pnl numeric not null,primary key(user_id,at_ms)
);
do $$declare t text;begin foreach t in array array['live_accounts','live_orders','live_fills','live_checks','live_heartbeats','live_equity'] loop
 execute format('alter table rea.%I enable row level security',t);
 execute format('create policy service_only on rea.%I for all to service_role using(true) with check(true)',t);
 execute format('revoke all on rea.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update on rea.%I to service_role',t);
end loop;end$$;
insert into rea.live_accounts(user_id) select user_id from rea.bot_settings;

create function public.rea_live_key_change_allowed(p_uid uuid) returns boolean
language sql security invoker set search_path='' as $$
 select not exists(select 1 from rea.live_accounts where user_id=p_uid and state is not null);
$$;
create function public.rea_live_ready(p_uid uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;e jsonb;c jsonb='[]';n text;x rea.live_checks%rowtype;reviewed boolean;begin
 select * into a from rea.live_accounts where user_id=p_uid;
 if not found then return jsonb_build_object('ready',false,'checks','[]'::jsonb,'reason','LIVE_ACCOUNT_NOT_PREPARED');end if;
 e=public.rea_view(p_uid)->'paperEvidence';
 c=c||jsonb_build_array(jsonb_build_object('name','PAPER_7_DAYS','passed',coalesce((e->>'minimum7DaysElapsed')::boolean,false) and coalesce((e->>'samples')::integer,0)>=9500 and coalesce((e->>'maximumGapMs')::bigint,999999999)<=180000,'evidence',e));
 c=c||jsonb_build_array(jsonb_build_object('name','PRIVATE_API_AND_WALLET','passed',coalesce((a.preflight->>'ok')::boolean,false) and coalesce((a.preflight->>'at')::bigint,0)>extract(epoch from now()-interval '120 seconds')*1000,'reason',a.preflight->>'reason'));
 c=c||jsonb_build_array(jsonb_build_object('name','REAL_THB_AVAILABLE','passed',coalesce((a.preflight->'wallet'->'THB'->>'available')::numeric>=100,false),'evidence',jsonb_build_object('minimum',100,'available',a.preflight->'wallet'->'THB'->'available')));
 c=c||jsonb_build_array(jsonb_build_object('name','LEGACY_EXECUTOR_STOPPED','passed',not exists(select 1 from public.bitbot_v10_bots where user_id=p_uid and running) and not exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled)));
 c=c||jsonb_build_array(jsonb_build_object('name','INDEPENDENT_LIVE_WATCHDOG','passed',exists(select 1 from rea.live_heartbeats where user_id=p_uid and lane='risk' and status in('OK','IDLE') and at_ms>extract(epoch from now()-interval '180 seconds')*1000)));
 foreach n in array array['EXECUTION_TESTS','RECOVERY_TESTS','RECONCILIATION_REVIEW','SECURITY_REVIEW','NO_WITHDRAW_SCOPE','OWNER_ALERT_DELIVERY'] loop
  select * into x from rea.live_checks where user_id=p_uid and check_name=n;
  reviewed=coalesce(x.passed and x.spec='REA-LIVE-19.0' and (x.expires_at is null or x.expires_at>now()),false);
  if n in('NO_WITHDRAW_SCOPE','RECONCILIATION_REVIEW') then reviewed=reviewed and a.preflight ? 'keyFingerprint' and x.evidence->>'keyFingerprint'=a.preflight->>'keyFingerprint';end if;
  c=c||jsonb_build_array(jsonb_build_object('name',n,'passed',coalesce(reviewed,false),'evidence',coalesce(x.evidence,'{}')));
 end loop;
 return jsonb_build_object('ready',not exists(select 1 from jsonb_array_elements(c)v where not coalesce((v->>'passed')::boolean,false)),'checks',c,'spec','REA-LIVE-19.0');
end$$;
create function public.rea_live_view(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('mode',mode,'state',state,'preflight',preflight,'latest',latest,'updatedAt',updated_at,'lastError',last_error,'readiness',public.rea_live_ready(p_uid),
 'orders',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select client_order_id,client_id,exchange_id,status,payload,created_at from rea.live_orders where user_id=p_uid order by created_at desc limit 100)x),
 'fills',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select txn_id,payload,created_at from rea.live_fills where user_id=p_uid order by created_at desc limit 100)x),
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from(select at_ms,equity,day,pnl from rea.live_equity where user_id=p_uid order by at_ms desc limit 1440)x),
 'approval',case when approval is null then null else jsonb_build_object('at',approval->'at','spec',approval->'spec','capital',approval->'capital') end)
 from rea.live_accounts where user_id=p_uid;
$$;
create function public.rea_live_claim(p_lane text,p_uid uuid default null) returns setof rea.live_accounts
language plpgsql security invoker set search_path='' as $$begin
 if p_lane not in('strategy','risk') then raise exception 'INVALID_LIVE_LANE';end if;
 return query update rea.live_accounts a set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds'
 where a.user_id in(select b.user_id from rea.live_accounts b where (p_uid is null or b.user_id=p_uid)
 and (b.lease_until is null or b.lease_until<now())
 and (p_lane='risk' and b.state is not null or p_lane='strategy' and b.next_tick<=now())
 order by b.next_tick for update skip locked limit 2) returning a.*;
end$$;
create function public.rea_live_scan_targets(p_uid uuid default null) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('state',state)),'[]') from rea.live_accounts
 where mode='LIVE_ENABLED' and state is not null and (p_uid is null or user_id=p_uid);
$$;
create function public.rea_live_heartbeat(p_uid uuid,p_lane text,p_status text,p_at bigint) returns boolean
language plpgsql security invoker set search_path='' as $$begin
 if p_lane not in('strategy','risk') or p_status not in('OK','IDLE','SAFE_MODE') or p_at<extract(epoch from now()-interval '30 seconds')*1000 or p_at>extract(epoch from now()+interval '5 seconds')*1000 then raise exception 'INVALID_LIVE_HEARTBEAT';end if;
 insert into rea.live_heartbeats values(p_uid,p_lane,p_at,p_status) on conflict(user_id,lane) do update set at_ms=excluded.at_ms,status=excluded.status where rea.live_heartbeats.at_ms<excluded.at_ms;return true;
end$$;
create function public.rea_live_idle() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a record;n integer=0;begin
 for a in select user_id from rea.live_accounts where state is null loop
  perform public.rea_live_heartbeat(a.user_id,'risk','IDLE',floor(extract(epoch from now())*1000)::bigint);n=n+1;
 end loop;return jsonb_build_object('idle',n);
end$$;
create function public.rea_live_checkpoint(p_uid uuid,p_lease uuid,p_revision bigint,p_state jsonb,p_preflight jsonb,p_latest jsonb,p_fills jsonb,p_lane text,p_error text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;o jsonb;f jsonb;slots integer;begin
 select * into a from rea.live_accounts where user_id=p_uid for update;
 if not found or a.lease is distinct from p_lease or a.lease_until<now() or a.revision<>p_revision then return null;end if;
 if p_state is not null then
  if p_state->>'mode' is distinct from 'LIVE' or p_state->>'accounting' is distinct from 'EXCHANGE_RECEIPTS' or not coalesce((p_state->>'cash')::numeric>=-.02,false) or not coalesce((p_state->>'allocatedCapital')::numeric between 100 and 10000,false) then raise exception 'INVALID_EXCHANGE_LEDGER';end if;
  if p_lane='risk' and exists(select 1 from jsonb_array_elements(p_state->'orders')v where v->>'side'='BUY' and not exists(select 1 from jsonb_array_elements(a.state->'orders')old where old->>'id'=v->>'id')) then raise exception 'LIVE_WATCHDOG_CANNOT_OPEN_BUY';end if;
  select count(distinct symbol) into slots from(
   select value->>'symbol' symbol from jsonb_array_elements(p_state->'positions')
   union select value->>'symbol' from jsonb_array_elements(p_state->'orders') where value->>'side'='BUY' and value->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'))x;
  if slots>2 then raise exception 'LIVE_POSITION_LIMIT';end if;
  if exists(select 1 from jsonb_array_elements(p_state->'orders')v where v->>'status'='RESERVED' and v->>'side'='BUY' and (a.mode<>'LIVE_ENABLED' or a.state->>'kill'<>'NONE' or (a.state->>'dailyLocked')::boolean or (a.state->>'buyPaused')::boolean)) then raise exception 'LIVE_ENTRY_LOCKED';end if;
  for o in select value from jsonb_array_elements(p_state->'orders') loop
   insert into rea.live_orders(user_id,client_order_id,client_id,exchange_id,status,payload,created_at)
   values(p_uid,(o->>'id')::uuid,o->>'clientId',o->>'exchangeId',o->>'status',o,to_timestamp((o->>'createdAt')::double precision/1000))
   on conflict(user_id,client_order_id) do update set status=excluded.status,exchange_id=excluded.exchange_id,payload=excluded.payload,updated_at=now();
  end loop;
  for f in select value from jsonb_array_elements(p_fills) loop
   if f->>'simulation'<>'false' or not(f ? 'exchangeId') then raise exception 'SIMULATED_LIVE_FILL_FORBIDDEN';end if;
   insert into rea.live_fills(user_id,txn_id,client_order_id,payload) values(p_uid,f->>'id',(f->>'orderId')::uuid,f) on conflict do nothing;
  end loop;
  if (p_latest->>'health')='OK' then
   insert into rea.live_equity values(p_uid,(p_latest->>'at')::bigint,(p_state->>'equity')::numeric,p_state->>'day',(p_state->>'dayPnl')::numeric) on conflict do nothing;
  end if;
 end if;
 update rea.live_accounts set state=p_state,preflight=p_preflight,latest=p_latest,revision=revision+1,lease_until=now()+interval '90 seconds',next_tick=case when p_lane='strategy' then now()+interval '45 seconds' else next_tick end,updated_at=now(),last_error=p_error where user_id=p_uid returning * into a;
 perform public.rea_live_heartbeat(p_uid,p_lane,case when p_error is not null then 'SAFE_MODE' when p_state is null then 'IDLE' else p_latest->>'health' end,floor(extract(epoch from now())*1000)::bigint);
 return to_jsonb(a);
end$$;
create function public.rea_live_release(p_uid uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$begin
 update rea.live_accounts set lease=null,lease_until=null where user_id=p_uid and lease=p_lease;return found;
end$$;
create function public.rea_live_control(p_uid uuid,p_action text,p_confirm text default '',p_state jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;r jsonb;begin
 select * into a from rea.live_accounts where user_id=p_uid for update;
 if not found then raise exception 'LIVE_ACCOUNT_NOT_PREPARED';end if;
 if p_action='activate' then
  if p_confirm<>'เปิดซื้อขายจริง Bitkub' then raise exception 'OWNER_CONFIRMATION_REQUIRED';end if;
  r=public.rea_live_ready(p_uid);
  if not (r->>'ready')::boolean then return jsonb_build_object('activated',false,'readiness',r);end if;
  if a.state is not null or p_state is null or p_state->>'mode' is distinct from 'LIVE' or p_state->>'accounting' is distinct from 'EXCHANGE_RECEIPTS' or not coalesce((p_state->>'cash')::numeric between 100 and least(10000,(a.preflight->'wallet'->'THB'->>'available')::numeric),false) or jsonb_array_length(p_state->'positions')<>0 or jsonb_array_length(p_state->'orders')<>0 then raise exception 'INVALID_INITIAL_LIVE_STATE';end if;
  a.state=p_state;a.mode='LIVE_ENABLED';
  a.approval=jsonb_build_object('at',now(),'spec','REA-LIVE-19.0','capital',p_state->'allocatedCapital','keyFingerprint',a.preflight->'keyFingerprint','owner',p_uid);
 elsif p_action='pause' then a.state=jsonb_set(a.state,'{buyPaused}','true');
 elsif p_action='resume' then a.state=jsonb_set(a.state,'{buyPaused}','false');if a.state->>'kill'='ENTRY' then a.state=jsonb_set(a.state,'{kill}','"NONE"');end if;
 elsif p_action='stop-entry' then a.state=jsonb_set(a.state,'{kill}',to_jsonb(case when a.state->>'kill'='ALL' then 'ALL' else 'ENTRY' end));
 elsif p_action='emergency' then a.state=jsonb_set(a.state,'{kill}','"ALL"');
 elsif p_action='clear-emergency' then
  if p_confirm<>'ปลดหยุดฉุกเฉินเงินจริง' then raise exception 'OWNER_CONFIRMATION_REQUIRED';end if;
  a.state=jsonb_set(a.state,'{kill}','"NONE"');
 else raise exception 'UNKNOWN_LIVE_CONTROL';end if;
 update rea.live_accounts set mode=a.mode,state=a.state,approval=a.approval,revision=revision+1,lease=null,lease_until=null,next_tick=now() where user_id=p_uid;
 insert into rea.audit_logs(user_id,action,payload) values(p_uid,'LIVE_CONTROL',jsonb_build_object('action',p_action,'mode',a.mode,'owner',p_uid,'spec','REA-LIVE-19.0'));
 return jsonb_build_object('saved',true,'activated',p_action='activate','mode',a.mode);
end$$;
create function public.rea_live_dispatch(p_uid uuid,p_lease uuid,p_revision bigint,p_order uuid,p_action text,p_body jsonb,p_path text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;o jsonb;expected jsonb;wire_path text;idx integer;r jsonb;exposure numeric;begin
 select * into a from rea.live_accounts where user_id=p_uid for update;
 if not found or a.lease is distinct from p_lease or a.lease_until<now() or a.revision<>p_revision or a.state is null or a.state->>'kill'='ALL' then return jsonb_build_object('allowed',false,'reason','LIVE_EXECUTOR_OR_CONTROL_CHANGED');end if;
 select value,(ordinality-1)::integer into o,idx from jsonb_array_elements(a.state->'orders') with ordinality where value->>'id'=p_order::text;
 if o is null then return jsonb_build_object('allowed',false,'reason','ORDER_NOT_RESERVED');end if;
 if p_action='PLACE' then
  if a.mode<>'LIVE_ENABLED' or a.approval is null or a.approval->>'spec' is distinct from 'REA-LIVE-19.0' or a.approval->>'keyFingerprint' is distinct from a.preflight->>'keyFingerprint' or o->>'status'<>'RESERVED' then return jsonb_build_object('allowed',false,'reason','LIVE_NOT_APPROVED');end if;
  wire_path=case when o->>'side'='BUY' then '/api/v3/market/place-bid' else '/api/v3/market/place-ask' end;
  if p_path is distinct from wire_path then return jsonb_build_object('allowed',false,'reason','ORDER_SIDE_PATH_MISMATCH');end if;
  expected=jsonb_build_object('sym',lower(o->>'symbol'),'amt',o->'amount','rat',o->'limit','typ',o->'type','client_id',o->'clientId');
  if expected is distinct from p_body or not coalesce((o->>'amount')::numeric>0,false) or not coalesce((o->>'quoteAt')::bigint between extract(epoch from now()-interval '25 seconds')*1000 and extract(epoch from now()+interval '5 seconds')*1000,false) or not coalesce((a.preflight->>'at')::bigint between extract(epoch from now()-interval '20 seconds')*1000 and extract(epoch from now()+interval '5 seconds')*1000,false) or not coalesce((a.preflight->>'ok')::boolean,false) then return jsonb_build_object('allowed',false,'reason','STALE_OR_CHANGED_ORDER');end if;
  if o->>'side'='BUY' then
   r=public.rea_live_ready(p_uid);
   if not(r->>'ready')::boolean or a.state->>'kill' is distinct from 'NONE' or coalesce((a.state->>'buyPaused')::boolean,true) or coalesce((a.state->>'dailyLocked')::boolean,true) or coalesce((a.state->>'baselinePending')::boolean,true) or a.latest->>'health' is distinct from 'OK' then return jsonb_build_object('allowed',false,'reason','LIVE_RISK_LOCK');end if;
   if o->>'type' is distinct from 'limit' or not coalesce((o->>'amount')::numeric between 0.01 and 4000,false) or not coalesce((o->>'modeledLoss')::numeric between 0.01 and least(100,(a.state->>'dayStart')::numeric*.01,(a.state->>'equity')::numeric*.01),false) then raise exception 'LIVE_RISK_BUDGET_EXCEEDED';end if;
   select coalesce(sum(v),0) into exposure from(
    select (value->>'cost')::numeric v from jsonb_array_elements(a.state->'positions')
    union all select greatest(0,(value->>'amount')::numeric-coalesce((value->>'executed')::numeric,0)) from jsonb_array_elements(a.state->'orders') where value->>'side'='BUY' and value->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'))q;
   if exposure>8000 then raise exception 'LIVE_EXPOSURE_EXCEEDED';end if;
  elsif o->>'side'='SELL' then
   if not exists(select 1 from jsonb_array_elements(a.state->'positions')p where p->>'symbol'=o->>'symbol' and (p->>'qty')::numeric>=(o->>'amount')::numeric) then raise exception 'LIVE_OVERSELL';end if;
  else raise exception 'INVALID_ORDER_SIDE';end if;
  o=jsonb_set(o,'{status}','"SUBMITTING"');
 elsif p_action='CANCEL' then
  expected=jsonb_build_object('sym',lower(o->>'symbol'),'id',o->>'exchangeId','sd',case when o->>'side'='BUY' then 'buy' else 'sell' end);
  if p_path is distinct from '/api/v3/market/cancel-order' or expected is distinct from p_body or o->>'status' not in('OPEN','PARTIAL') or o->>'exchangeId' is null then return jsonb_build_object('allowed',false,'reason','INVALID_CANCEL');end if;
  o=jsonb_set(o,'{status}','"CANCEL_PENDING"');
 else raise exception 'INVALID_DISPATCH_ACTION';end if;
 update rea.live_accounts set state=jsonb_set(state,array['orders',idx::text],o),revision=revision+1 where user_id=p_uid returning * into a;
 update rea.live_orders set status=o->>'status',payload=o,updated_at=now() where user_id=p_uid and client_order_id=p_order;
 insert into rea.audit_logs(user_id,action,payload) values(p_uid,'LIVE_DISPATCH',jsonb_build_object('order',p_order,'action',p_action,'revision',a.revision));
 return jsonb_build_object('allowed',true,'revision',a.revision);
end$$;
do $$declare p regprocedure;begin
 for p in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'rea_live_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',p);
  execute format('grant execute on function %s to service_role',p);
 end loop;
end$$;
commit;
