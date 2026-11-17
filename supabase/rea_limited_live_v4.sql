-- Small live allocations require an explicit authenticated owner acknowledgement.
-- Full acceptance evidence remains unchanged. No activation is performed by this migration.
begin;
create or replace function public.rea_live_ready(p_uid uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;e jsonb;c jsonb='[]';n text;x rea.live_checks%rowtype;reviewed boolean;lc jsonb;begin
 select * into a from rea.live_accounts where user_id=p_uid;
 if not found then return jsonb_build_object('ready',false,'checks','[]'::jsonb,'reason','LIVE_ACCOUNT_NOT_PREPARED');end if;
 e=public.rea_view(p_uid)->'paperEvidence';
 c=c||jsonb_build_array(jsonb_build_object('name','PAPER_7_DAYS','passed',coalesce((e->>'minimum7DaysElapsed')::boolean,false) and coalesce((e->>'samples')::integer,0)>=9500 and coalesce((e->>'maximumGapMs')::bigint,999999999)<=180000,'evidence',e));
 c=c||jsonb_build_array(jsonb_build_object('name','PRIVATE_API_AND_WALLET','passed',coalesce((a.preflight->>'ok')::boolean,false) and coalesce((a.preflight->>'at')::bigint,0)>extract(epoch from now()-interval '120 seconds')*1000,'reason',a.preflight->>'reason'));
 c=c||jsonb_build_array(jsonb_build_object('name','REAL_THB_AVAILABLE','passed',coalesce((a.preflight->'wallet'->'THB'->>'available')::numeric>=10,false),'evidence',jsonb_build_object('minimum',10,'available',a.preflight->'wallet'->'THB'->'available')));
 c=c||jsonb_build_array(jsonb_build_object('name','LEGACY_EXECUTOR_STOPPED','passed',not exists(select 1 from public.bitbot_v10_bots where user_id=p_uid and running) and not exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled)));
 c=c||jsonb_build_array(jsonb_build_object('name','INDEPENDENT_LIVE_WATCHDOG','passed',exists(select 1 from rea.live_heartbeats where user_id=p_uid and lane='risk' and status in('OK','IDLE') and at_ms>extract(epoch from now()-interval '180 seconds')*1000)));
 foreach n in array array['EXECUTION_TESTS','RECOVERY_TESTS','RECONCILIATION_REVIEW','SECURITY_REVIEW','NO_WITHDRAW_SCOPE','OWNER_ALERT_DELIVERY'] loop
  select * into x from rea.live_checks where user_id=p_uid and check_name=n;
  reviewed=coalesce(x.passed and x.spec='REA-LIVE-19.0' and (x.expires_at is null or x.expires_at>now()),false);
  if n in('NO_WITHDRAW_SCOPE','RECONCILIATION_REVIEW') then reviewed=reviewed and a.preflight ? 'keyFingerprint' and x.evidence->>'keyFingerprint'=a.preflight->>'keyFingerprint';end if;
  c=c||jsonb_build_array(jsonb_build_object('name',n,'passed',coalesce(reviewed,false),'evidence',coalesce(x.evidence,'{}')));
 end loop;
 select coalesce(jsonb_agg(v),'[]') into lc from jsonb_array_elements(c)v where v->>'name' in('PRIVATE_API_AND_WALLET','REAL_THB_AVAILABLE','LEGACY_EXECUTOR_STOPPED','INDEPENDENT_LIVE_WATCHDOG','EXECUTION_TESTS','RECOVERY_TESTS');
 select * into x from rea.live_checks where user_id=p_uid and check_name='LIMITED_CAPITAL_TESTS';
 lc=lc||jsonb_build_array(jsonb_build_object('name','LIMITED_CAPITAL_TESTS','passed',coalesce(x.passed and x.spec='REA-LIMITED-19.1' and (x.expires_at is null or x.expires_at>now()),false),'evidence',coalesce(x.evidence,'{}')));
 return jsonb_build_object('ready',not exists(select 1 from jsonb_array_elements(c)v where not coalesce((v->>'passed')::boolean,false)),'checks',c,'spec','REA-LIVE-19.0',
 'limited',jsonb_build_object('ready',not exists(select 1 from jsonb_array_elements(lc)v where not coalesce((v->>'passed')::boolean,false)),'checks',lc,'spec','REA-LIMITED-19.1','policy','OWNER_LIMITED_LIVE','maxCapital',100,'minimumCapital',10,'requiresOwnerAcknowledgement',true));
end$$;

create or replace function public.rea_live_view(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('mode',mode,'state',state,'preflight',preflight,'latest',latest,'updatedAt',updated_at,'lastError',last_error,'readiness',public.rea_live_ready(p_uid),
 'orders',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select client_order_id,client_id,exchange_id,status,payload,created_at from rea.live_orders where user_id=p_uid order by created_at desc limit 100)x),
 'fills',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select txn_id,payload,created_at from rea.live_fills where user_id=p_uid order by created_at desc limit 100)x),
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from(select at_ms,equity,day,pnl from rea.live_equity where user_id=p_uid order by at_ms desc limit 1440)x),
 'approval',case when approval is null then null else jsonb_build_object('at',approval->'at','spec',approval->'spec','capital',approval->'capital','policy',approval->'policy') end)
 from rea.live_accounts where user_id=p_uid;
$$;

create or replace function public.rea_live_checkpoint(p_uid uuid,p_lease uuid,p_revision bigint,p_state jsonb,p_preflight jsonb,p_latest jsonb,p_fills jsonb,p_lane text,p_error text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;o jsonb;f jsonb;slots integer;begin
 select * into a from rea.live_accounts where user_id=p_uid for update;
 if not found or a.lease is distinct from p_lease or a.lease_until<now() or a.revision<>p_revision then return null;end if;
 if p_state is not null then
  if p_state->>'mode' is distinct from 'LIVE' or p_state->>'accounting' is distinct from 'EXCHANGE_RECEIPTS' or not coalesce((p_state->>'cash')::numeric>=-.02,false) or not coalesce((p_state->>'allocatedCapital')::numeric between 10 and 10000,false) then raise exception 'INVALID_EXCHANGE_LEDGER';end if;
  if a.approval is not null and (coalesce(p_state->>'policy','STANDARD') is distinct from coalesce(a.approval->>'policy','STANDARD') or p_state->'allocatedCapital' is distinct from coalesce(a.approval->'capital',a.state->'allocatedCapital')) then raise exception 'LIVE_APPROVED_ALLOCATION_IMMUTABLE';end if;
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
 update rea.live_accounts set state=p_state,preflight=p_preflight,latest=p_latest,revision=revision+1,lease_until=now()+interval '90 seconds',cooldown_until=case when p_error like '%429%' then now()+interval '31 seconds' else cooldown_until end,next_tick=case when p_lane='strategy' then now()+interval '45 seconds' else next_tick end,updated_at=now(),last_error=p_error where user_id=p_uid returning * into a;
 perform public.rea_live_heartbeat(p_uid,p_lane,case when p_error is not null then 'SAFE_MODE' when p_state is null then 'IDLE' else p_latest->>'health' end,floor(extract(epoch from now())*1000)::bigint);
 return to_jsonb(a);
end$$;

create or replace function public.rea_live_control(p_uid uuid,p_action text,p_confirm text default '',p_state jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;r jsonb;limited boolean;cap numeric;begin
 select * into a from rea.live_accounts where user_id=p_uid for update;
 if not found then raise exception 'LIVE_ACCOUNT_NOT_PREPARED';end if;
 if p_action='activate' then
  if p_confirm<>'เปิดซื้อขายจริง Bitkub' then raise exception 'OWNER_CONFIRMATION_REQUIRED';end if;
  r=public.rea_live_ready(p_uid);
  limited=coalesce(p_state->>'policy','STANDARD')='OWNER_LIMITED_LIVE';
  if coalesce(p_state->>'policy','STANDARD') not in('STANDARD','OWNER_LIMITED_LIVE') then raise exception 'INVALID_LIVE_POLICY';end if;
  if not coalesce(case when limited then (r->'limited'->>'ready')::boolean else (r->>'ready')::boolean end,false) then return jsonb_build_object('activated',false,'readiness',r);end if;
  cap=case when limited then 100 else 10000 end;
  if limited and (p_state->'ownerAcknowledgement'->>'acceptIncomplete' is distinct from 'true' or p_state->'ownerAcknowledgement'->>'noWithdraw' is distinct from 'true' or p_state->'ownerAcknowledgement'->>'acceptRisk' is distinct from 'true') then raise exception 'LIMITED_OWNER_ACKNOWLEDGEMENT_REQUIRED';end if;
  if a.state is not null or p_state is null or p_state->>'mode' is distinct from 'LIVE' or p_state->>'accounting' is distinct from 'EXCHANGE_RECEIPTS' or not coalesce((p_state->>'cash')::numeric between 10 and least(cap,(a.preflight->'wallet'->'THB'->>'available')::numeric),false) or p_state->'allocatedCapital' is distinct from p_state->'cash' or jsonb_array_length(p_state->'positions')<>0 or jsonb_array_length(p_state->'orders')<>0 then raise exception 'INVALID_INITIAL_LIVE_STATE';end if;
  a.state=p_state;a.mode='LIVE_ENABLED';
  a.approval=jsonb_build_object('at',now(),'spec','REA-LIVE-19.0','capital',p_state->'allocatedCapital','policy',coalesce(p_state->>'policy','STANDARD'),'launchSpec',case when limited then 'REA-LIMITED-19.1' else 'REA-LIVE-19.0' end,'ownerAcknowledgement',p_state->'ownerAcknowledgement','keyFingerprint',a.preflight->'keyFingerprint','owner',p_uid);
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

create or replace function public.rea_live_dispatch(p_uid uuid,p_lease uuid,p_revision bigint,p_order uuid,p_action text,p_body jsonb,p_path text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;o jsonb;expected jsonb;wire_path text;idx integer;r jsonb;exposure numeric;symbol_exposure numeric;limited boolean;cap numeric;position_cap numeric;exposure_cap numeric;risk_cap numeric;begin
 select * into a from rea.live_accounts where user_id=p_uid for update;
 if not found or a.lease is distinct from p_lease or a.lease_until<now() or a.revision<>p_revision or a.state is null or a.state->>'kill'='ALL' then return jsonb_build_object('allowed',false,'reason','LIVE_EXECUTOR_OR_CONTROL_CHANGED');end if;
 if a.cooldown_until>now() then return jsonb_build_object('allowed',false,'reason','EXCHANGE_RATE_LIMIT_COOLDOWN');end if;
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
   limited=coalesce(a.approval->>'policy','STANDARD')='OWNER_LIMITED_LIVE';
   if coalesce(a.state->>'policy','STANDARD') is distinct from coalesce(a.approval->>'policy','STANDARD') then raise exception 'LIVE_POLICY_MISMATCH';end if;
   if limited and (a.approval->>'launchSpec' is distinct from 'REA-LIMITED-19.1' or a.approval->'ownerAcknowledgement'->>'acceptIncomplete' is distinct from 'true') then raise exception 'LIMITED_LIVE_NOT_APPROVED';end if;
   cap=(a.state->>'allocatedCapital')::numeric;
   if a.approval ? 'capital' and a.state->'allocatedCapital' is distinct from a.approval->'capital' then raise exception 'LIVE_APPROVED_ALLOCATION_IMMUTABLE';end if;
   if limited and not(cap between 10 and 100) then raise exception 'LIMITED_LIVE_CAP_EXCEEDED';end if;
   position_cap=case when limited then floor(cap*.4*100)/100 else 4000 end;
   exposure_cap=case when limited then floor(cap*.8*100)/100 else 8000 end;
   risk_cap=floor(least(100,(a.state->>'dayStart')::numeric*.01,(a.state->>'equity')::numeric*.01,case when limited then cap*.01 else 100 end)*100)/100;
   if not coalesce(case when limited then (r->'limited'->>'ready')::boolean else (r->>'ready')::boolean end,false) or a.state->>'kill' is distinct from 'NONE' or coalesce((a.state->>'buyPaused')::boolean,true) or coalesce((a.state->>'dailyLocked')::boolean,true) or coalesce((a.state->>'baselinePending')::boolean,true) or a.latest->>'health' is distinct from 'OK' then return jsonb_build_object('allowed',false,'reason','LIVE_RISK_LOCK');end if;
   if o->>'type' is distinct from 'limit' or not coalesce((o->>'amount')::numeric between 0.01 and position_cap,false) or not coalesce((o->>'modeledLoss')::numeric between 0.01 and risk_cap,false) then raise exception 'LIVE_RISK_BUDGET_EXCEEDED';end if;
   select coalesce(sum(v),0) into exposure from(
    select (value->>'cost')::numeric v from jsonb_array_elements(a.state->'positions')
    union all select greatest(0,(value->>'amount')::numeric-coalesce((value->>'executed')::numeric,0)) from jsonb_array_elements(a.state->'orders') where value->>'side'='BUY' and value->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'))q;
   if exposure>exposure_cap then raise exception 'LIVE_EXPOSURE_EXCEEDED';end if;
   if limited then
    select coalesce(sum(v),0) into symbol_exposure from(
     select (value->>'cost')::numeric v from jsonb_array_elements(a.state->'positions') where value->>'symbol'=o->>'symbol'
     union all select greatest(0,(value->>'amount')::numeric-coalesce((value->>'executed')::numeric,0)) from jsonb_array_elements(a.state->'orders') where value->>'symbol'=o->>'symbol' and value->>'side'='BUY' and value->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'))q;
    if symbol_exposure>position_cap then raise exception 'LIMITED_POSITION_CAP_EXCEEDED';end if;
   end if;
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
commit;
