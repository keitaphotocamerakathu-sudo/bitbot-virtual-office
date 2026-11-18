-- Conservative live risk profile. Deploying this file does not enable it for an owner.
begin;
create or replace function public.rea_live_risk_manager(p_state jsonb,p_now bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare base numeric;factor numeric=1;unit numeric;losses integer=0;t jsonb;last_close bigint;pause_until bigint;max_slots integer;begin
 if coalesce(p_state->>'riskProfile','LEGACY')='LEGACY' then return null;end if;
 if p_state->>'riskProfile'<>'CAPITAL_GUARD_28' then raise exception 'INVALID_LIVE_RISK_PROFILE';end if;
 if not coalesce(jsonb_typeof(p_state->'dayStart')='number' and jsonb_typeof(p_state->'equity')='number' and jsonb_typeof(p_state->'allocatedCapital')='number' and jsonb_typeof(p_state->'dayPnl')='number' and jsonb_typeof(p_state->'dayFlows')='number' and (p_state->>'dayStart')::numeric>0 and (p_state->>'equity')::numeric>=0 and (p_state->>'allocatedCapital')::numeric>=10 and abs((p_state->>'dayPnl')::numeric-((p_state->>'equity')::numeric-(p_state->>'dayStart')::numeric-(p_state->>'dayFlows')::numeric))<=.02,false) then raise exception 'INVALID_LIVE_GUARD_STATE';end if;
 base=greatest(0,least(10000,(p_state->>'dayStart')::numeric,(p_state->>'equity')::numeric,(p_state->>'allocatedCapital')::numeric));
 if (p_state->>'dayPnl')::numeric<=-(p_state->>'dayStart')::numeric*.015 then factor=.5;end if;
 unit=floor(least(100,base*.01)*100)/100;unit=floor(unit*factor*100)/100;
 max_slots=coalesce((p_state->>'maxPositions')::integer,2);
 if max_slots not between 1 and 5 then raise exception 'INVALID_LIVE_POSITION_LIMIT';end if;
 for t in select value from jsonb_array_elements(coalesce(p_state->'closed','[]')) where (value->>'closedAt')::bigint<=p_now and (value->>'closedAt')::bigint>p_now-86400000 order by (value->>'closedAt')::bigint desc,(value->>'id') collate "C" desc loop
  if (t->>'pnl')::numeric>=0 then exit;end if;
  if losses=0 then last_close=(t->>'closedAt')::bigint;end if;
  losses=losses+1;
 end loop;
 if losses>=3 then pause_until=last_close+3600000;end if;
 return jsonb_build_object('profile','CAPITAL_GUARD_28','spec','REA-RISK-28.0','capitalBase',floor(base*100)/100,'riskScale',factor,'consecutiveLosses',losses,'cooldownUntil',pause_until,'cooldownActive',coalesce(p_now<pause_until,false),'cashReserveTHB',ceil(base*.3*100)/100,'riskBudget',floor(unit*least(1,2::numeric/max_slots)*100)/100,'maxPosition',least(case when p_state->>'policy'='OWNER_LIMITED_LIVE' then floor((p_state->>'allocatedCapital')::numeric*.4*100)/100 else 4000 end,floor(base*.2*100)/100),'maxExposure',least(case when p_state->>'policy'='OWNER_LIMITED_LIVE' then floor((p_state->>'allocatedCapital')::numeric*.8*100)/100 else 8000 end,floor(base*.7*100)/100));
end$$;
revoke all on function public.rea_live_risk_manager(jsonb,bigint) from public,anon,authenticated;
grant execute on function public.rea_live_risk_manager(jsonb,bigint) to service_role;

CREATE OR REPLACE FUNCTION public.rea_live_position_risk(p_state jsonb, p_max integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare unit numeric;budget numeric;used numeric=0;p jsonb;o jsonb;entry jsonb;original numeric;held numeric;remaining numeric;f numeric;guard jsonb;begin
 if p_max not between 1 and 5 then raise exception 'INVALID_LIVE_POSITION_LIMIT';end if;
 unit=floor(least(100,greatest(0,least(10000,(p_state->>'dayStart')::numeric,(p_state->>'equity')::numeric,case when p_state->>'policy'='OWNER_LIMITED_LIVE' or p_state->>'riskProfile'='CAPITAL_GUARD_28' then (p_state->>'allocatedCapital')::numeric else 10000 end))*.01)*100)/100;
 guard=public.rea_live_risk_manager(p_state,floor(extract(epoch from now())*1000)::bigint);
 if guard is not null then unit=floor(unit*(guard->>'riskScale')::numeric*100)/100;end if;
 budget=unit*least(2,p_max);
 for p in select value from jsonb_array_elements(p_state->'positions') loop
  if not coalesce((p->>'qty')::numeric>0 and (p->>'cost')::numeric>0 and (p->>'stop')::numeric>0,false) then raise exception 'LIVE_RISK_ESTIMATE_MISSING';end if;
  select value into entry from jsonb_array_elements(p_state->'orders') where value->>'side'='BUY' and value->>'id'=p->>'positionId';
  original=case when (entry->>'amount')::numeric>0 then coalesce((entry->>'modeledLoss')::numeric,0)*(p->>'cost')::numeric/(entry->>'amount')::numeric else 0 end;
  held=greatest(original,greatest(0,(p->>'cost')::numeric-(p->>'qty')::numeric*(p->>'stop')::numeric*(1-.0025-.002))+.10);
  used=used+ceil((held-.000000001)*100)/100;
 end loop;
 for o in select value from jsonb_array_elements(p_state->'orders') where value->>'side'='BUY' and value->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN') loop
  remaining=greatest(0,(o->>'amount')::numeric-coalesce((o->>'executed')::numeric,0));
  if remaining=0 then continue;end if;
  f=case when (o->>'riskFraction')::numeric>0 then (o->>'riskFraction')::numeric when (o->>'stop')::numeric>0 and (o->>'limit')::numeric>(o->>'stop')::numeric then 1-(o->>'stop')::numeric/(o->>'limit')::numeric+.007 else null end;
  if f is null then raise exception 'LIVE_RISK_ESTIMATE_MISSING';end if;
  used=used+ceil((remaining*f+.10-.000000001)*100)/100;
 end loop;
 return jsonb_build_object('maxPositions',p_max,'riskBaselinePositions',2,'portfolioRiskBudget',budget,'portfolioRiskUsed',used,'portfolioRiskRemaining',greatest(0,budget-used));
end$function$
;

CREATE OR REPLACE FUNCTION public.rea_live_checkpoint(p_uid uuid, p_lease uuid, p_revision bigint, p_state jsonb, p_preflight jsonb, p_latest jsonb, p_fills jsonb, p_lane text, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a rea.live_accounts%rowtype;o jsonb;f jsonb;slots integer;begin
 select * into a from rea.live_accounts where user_id=p_uid for update;
 if not found or a.lease is distinct from p_lease or a.lease_until<now() or a.revision<>p_revision then return null;end if;
 if p_state is not null then
  if p_state->>'mode' is distinct from 'LIVE' or p_state->>'accounting' is distinct from 'EXCHANGE_RECEIPTS' or not coalesce((p_state->>'cash')::numeric>=-.02,false) or not coalesce((p_state->>'allocatedCapital')::numeric between 10 and 10000,false) then raise exception 'INVALID_EXCHANGE_LEDGER';end if;
  if a.approval is not null and (coalesce(p_state->>'policy','STANDARD') is distinct from coalesce(a.approval->>'policy','STANDARD') or p_state->'allocatedCapital' is distinct from coalesce(a.approval->'capital',a.state->'allocatedCapital')) then raise exception 'LIVE_APPROVED_ALLOCATION_IMMUTABLE';end if;
  if coalesce(p_state->>'riskProfile','LEGACY') is distinct from coalesce(a.approval->'riskPolicy'->>'profile','LEGACY') then raise exception 'LIVE_RISK_PROFILE_MISMATCH';end if;
  if p_state->>'riskProfile'='CAPITAL_GUARD_28' and exists(select 1 from jsonb_array_elements(coalesce(a.state->'closed','[]'))old where not exists(select 1 from jsonb_array_elements(coalesce(p_state->'closed','[]'))v where v->>'id'=old->>'id' and v->'pnl'=old->'pnl' and v->'closedAt'=old->'closedAt')) then raise exception 'LIVE_LOSS_HISTORY_IMMUTABLE';end if;
  if p_lane='risk' and exists(select 1 from jsonb_array_elements(p_state->'orders')v where v->>'side'='BUY' and not exists(select 1 from jsonb_array_elements(a.state->'orders')old where old->>'id'=v->>'id')) then raise exception 'LIVE_WATCHDOG_CANNOT_OPEN_BUY';end if;
  select count(distinct symbol) into slots from(
   select value->>'symbol' symbol from jsonb_array_elements(p_state->'positions')
   union select value->>'symbol' from jsonb_array_elements(p_state->'orders') where value->>'side'='BUY' and value->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'))x;
  if coalesce((p_state->>'maxPositions')::numeric,2)<>a.max_positions then raise exception 'LIVE_POSITION_POLICY_MISMATCH';end if;
  if slots>a.max_positions then raise exception 'LIVE_POSITION_LIMIT';end if;
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
end$function$
;

CREATE OR REPLACE FUNCTION public.rea_live_dispatch(p_uid uuid, p_lease uuid, p_revision bigint, p_order uuid, p_action text, p_body jsonb, p_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a rea.live_accounts%rowtype;o jsonb;expected jsonb;wire_path text;idx integer;r jsonb;exposure numeric;symbol_exposure numeric;limited boolean;cap numeric;position_cap numeric;exposure_cap numeric;risk_cap numeric;slots integer;position_risk jsonb;guard jsonb;buy_reserved numeric;exit_qty numeric;exit_quote numeric;quote_min numeric;qty_scale numeric;begin
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
   if coalesce((a.state->>'maxPositions')::numeric,2)<>a.max_positions then raise exception 'LIVE_POSITION_POLICY_MISMATCH';end if;
   if a.max_positions>2 and (a.approval->'positionPolicy'->>'spec' is distinct from 'REA-POSITIONS-27.0' or a.approval->'positionPolicy'->>'owner' is distinct from p_uid::text or (a.approval->'positionPolicy'->>'maxPositions')::numeric is distinct from a.max_positions::numeric or a.approval->'positionPolicy'->>'riskBaselinePositions' is distinct from '2') then raise exception 'LIVE_POSITION_LIMIT_NOT_APPROVED';end if;
   select count(distinct symbol) into slots from(
    select value->>'symbol' symbol from jsonb_array_elements(a.state->'positions')
    union select value->>'symbol' from jsonb_array_elements(a.state->'orders') where value->>'side'='BUY' and value->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'))x;
   if slots>a.max_positions then raise exception 'LIVE_POSITION_LIMIT';end if;
   if coalesce(a.state->>'riskProfile','LEGACY') is distinct from coalesce(a.approval->'riskPolicy'->>'profile','LEGACY') then raise exception 'LIVE_RISK_PROFILE_MISMATCH';end if;
   guard=public.rea_live_risk_manager(a.state,floor(extract(epoch from now())*1000)::bigint);
   if guard is not null then
    if a.approval->'riskPolicy'->>'spec' is distinct from 'REA-RISK-28.0' or a.approval->'riskPolicy'->>'owner' is distinct from p_uid::text then raise exception 'LIVE_RISK_PROFILE_NOT_APPROVED';end if;
    if (guard->>'cooldownActive')::boolean then return jsonb_build_object('allowed',false,'reason','LOSS_STREAK_COOLDOWN');end if;
    if exists(select 1 from jsonb_array_elements(a.state->'orders')v where v->>'status' in('UNKNOWN','SUBMITTING')) then return jsonb_build_object('allowed',false,'reason','UNKNOWN_ORDER_REQUIRES_RECONCILIATION');end if;
   end if;
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
   if a.max_positions>2 or guard is not null then
    risk_cap=floor(risk_cap*least(1,2::numeric/a.max_positions)*100)/100;
    if guard is not null then
     risk_cap=(guard->>'riskBudget')::numeric;position_cap=(guard->>'maxPosition')::numeric;exposure_cap=(guard->>'maxExposure')::numeric;
     select coalesce(sum(greatest(0,(v->>'amount')::numeric-coalesce((v->>'executed')::numeric,0))),0) into buy_reserved from jsonb_array_elements(a.state->'orders')v where v->>'side'='BUY' and v->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN');
     if least((a.state->>'cash')::numeric,(a.preflight->'wallet'->'THB'->>'available')::numeric)-buy_reserved<(guard->>'cashReserveTHB')::numeric then raise exception 'LIVE_CASH_RESERVE_EXCEEDED';end if;
     if o->'riskEvidence'->>'spec' is distinct from 'REA-RISK-28.0' or o->'riskEvidence'->>'profile' is distinct from 'CAPITAL_GUARD_28' or o->'riskEvidence'->'quoteAt' is distinct from o->'quoteAt' or not coalesce((o->'riskEvidence'->>'minQuote')::numeric>=10,false) or not coalesce((o->>'qtyScale')::integer between 0 and 8,false) then raise exception 'LIVE_EXIT_ESTIMATE_MISSING';end if;
     quote_min=(o->'riskEvidence'->>'minQuote')::numeric;qty_scale=power(10::numeric,(o->>'qtyScale')::integer);
     exit_qty=floor(greatest(0,(o->>'amount')::numeric-ceil((o->>'amount')::numeric*.0025*100)/100-.10)/(o->>'limit')::numeric*qty_scale)/qty_scale;
     exit_quote=floor(exit_qty*(o->>'stop')::numeric*(1-.002)*100)/100;
     if exit_quote<quote_min then raise exception 'STOP_EXIT_BELOW_MINIMUM';end if;
    end if;
    if not coalesce((o->>'riskFraction')::numeric>=greatest(.027,1-(o->>'stop')::numeric/(o->>'limit')::numeric+.007)-.000000001,false) or not coalesce((o->>'stop')::numeric>0,false) or not coalesce((o->>'modeledLoss')::numeric>=ceil(((o->>'amount')::numeric*(o->>'riskFraction')::numeric+.10-.000000001)*100)/100,false) then raise exception 'LIVE_RISK_ESTIMATE_INVALID';end if;
    position_risk=public.rea_live_position_risk(a.state,a.max_positions);
    if (position_risk->>'portfolioRiskUsed')::numeric>(position_risk->>'portfolioRiskBudget')::numeric then raise exception 'LIVE_PORTFOLIO_RISK_EXCEEDED';end if;
   end if;
   if not coalesce(case when limited then (r->'limited'->>'ready')::boolean else (r->>'ready')::boolean end,false) or a.state->>'kill' is distinct from 'NONE' or coalesce((a.state->>'buyPaused')::boolean,true) or coalesce((a.state->>'dailyLocked')::boolean,true) or coalesce((a.state->>'baselinePending')::boolean,true) or a.latest->>'health' is distinct from 'OK' then return jsonb_build_object('allowed',false,'reason','LIVE_RISK_LOCK');end if;
   if o->>'type' is distinct from 'limit' or not coalesce((o->>'amount')::numeric between 0.01 and position_cap,false) or not coalesce((o->>'modeledLoss')::numeric between 0.01 and risk_cap,false) then raise exception 'LIVE_RISK_BUDGET_EXCEEDED';end if;
   select coalesce(sum(v),0) into exposure from(
    select (value->>'cost')::numeric v from jsonb_array_elements(a.state->'positions')
    union all select greatest(0,(value->>'amount')::numeric-coalesce((value->>'executed')::numeric,0)) from jsonb_array_elements(a.state->'orders') where value->>'side'='BUY' and value->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN'))q;
   if exposure>exposure_cap then raise exception 'LIVE_EXPOSURE_EXCEEDED';end if;
   if limited or guard is not null then
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
end$function$
;

CREATE OR REPLACE FUNCTION public.rea_live_control(p_uid uuid, p_action text, p_confirm text DEFAULT ''::text, p_state jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if coalesce((p_state->>'maxPositions')::numeric,2)<>a.max_positions then raise exception 'LIVE_POSITION_POLICY_MISMATCH';end if;
  if coalesce(p_state->>'riskProfile','LEGACY')<>'LEGACY' then raise exception 'LIVE_RISK_PROFILE_NOT_APPROVED';end if;
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
end$function$
;

CREATE OR REPLACE FUNCTION public.rea_live_view(p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object('mode',mode,'maxPositions',max_positions,'state',state,'preflight',preflight,'latest',latest,'updatedAt',updated_at,'lastError',last_error,'readiness',public.rea_live_ready(p_uid),
 'orders',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select client_order_id,client_id,exchange_id,status,payload,created_at from rea.live_orders where user_id=p_uid order by created_at desc limit 100)x),
 'fills',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select txn_id,payload,created_at from rea.live_fills where user_id=p_uid order by created_at desc limit 100)x),
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from(select at_ms,equity,day,pnl from rea.live_equity where user_id=p_uid order by at_ms desc limit 1440)x),
 'tradeLessons',(select coalesce(jsonb_agg(payload order by closed_at_ms desc),'[]') from(select payload,closed_at_ms from rea.trade_lessons where user_id=p_uid order by closed_at_ms desc limit 100)x),
 'approval',case when approval is null then null else jsonb_build_object('at',approval->'at','spec',approval->'spec','capital',approval->'capital','policy',approval->'policy','positionPolicy',approval->'positionPolicy','riskPolicy',approval->'riskPolicy') end)
 from rea.live_accounts where user_id=p_uid;
$function$
;
commit;
