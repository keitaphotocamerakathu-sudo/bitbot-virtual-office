begin;
create index if not exists master_journal_fill_position on rea.master_journal(user_id,(payload->>'positionId')) where event_type='FILL';
create or replace function public.rea_master_checkpoint(p_uid uuid,p_lease uuid,p_revision bigint,p_state jsonb,p_latest jsonb,p_events jsonb,p_signals jsonb,p_fills jsonb,p_at bigint,p_error text,p_experiments jsonb,p_master jsonb,p_config_revision bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare master_at bigint;a rea.master_books%rowtype;s jsonb;c jsonb;j jsonb;o jsonb;p jsonb;old jsonb;parent rea.bot_settings%rowtype;saved boolean;slots integer;base numeric;exposure numeric;risk numeric;reserved numeric;new_buys boolean;streak integer;all_losses boolean;last_loss bigint;scale numeric;estimated_qty numeric;stop_gross numeric;target_gross numeric;model_risk numeric;model_reward numeric;basis_qty numeric;basis_gross numeric;basis_fees numeric;gross_pnl numeric;begin
 select * into parent from rea.bot_settings where user_id=p_uid for update;
 if not found or parent.lease is distinct from p_lease or parent.revision<>p_revision or parent.lease_until<now() then return false;end if;
 select * into a from rea.master_books where user_id=p_uid for update;if not found or a.config_revision<>p_config_revision then return false;end if;
 s=p_master->'book';c=a.config;old=a.state;master_at=(s->>'lastAt')::bigint;
 if master_at<p_at or master_at-p_at>90000 then raise exception 'MASTER_PARENT_CLOCK_MISMATCH';end if;
 if not rea.valid_master_config(c) or p_master->'latest'->>'mode' is distinct from 'PAPER_ONLY' or p_master->'latest'->>'canTrade' is distinct from 'false' or p_master->'latest'->>'canActivateLive' is distinct from 'false' or s->>'mode' is distinct from 'PAPER_ONLY' or s->>'protocol' is distinct from 'REA-MASTER-31.0.0' or s->>'initialCapital' is distinct from '10000' or s->>'lastAt' is distinct from master_at::text or p_master->'latest'->>'at' is distinct from master_at::text then raise exception 'MASTER_PAPER_PROTOCOL_REQUIRED';end if;
 if master_at>extract(epoch from now()+interval '5 seconds')*1000 or a.last_at is not null and master_at<=a.last_at then return false;end if;
 if jsonb_typeof(s->'cash') is distinct from 'number' or jsonb_typeof(s->'equity') is distinct from 'number' or (s->>'cash')::numeric<0 or (s->>'equity')::numeric<0 or abs((s->>'dayPnl')::numeric-((s->>'equity')::numeric-(s->>'dayStart')::numeric-(s->>'dayFlows')::numeric))>.02 then raise exception 'INVALID_MASTER_EQUITY';end if;
 if old is not null and (s->'startedAt' is distinct from old->'startedAt' or (s->'stats'->>'closedTrades')::bigint<(old->'stats'->>'closedTrades')::bigint or (s->>'fees')::numeric<(old->>'fees')::numeric or (s->>'validMinutes')::bigint<(old->>'validMinutes')::bigint) then raise exception 'MASTER_HISTORY_RESET_FORBIDDEN';end if;
 for p in select value from jsonb_array_elements(s->'positions') loop
  if jsonb_typeof(p->'qty') is distinct from 'number' or (p->>'qty')::numeric<=0 or (p->>'cost')::numeric<=0 or (p->>'stop')::numeric<=0 or (p->>'target')::numeric<=(p->>'stop')::numeric or not exists(select 1 from rea.master_strategy_versions where strategy_id=p->>'strategyId' and version=p->>'strategyVersion' and payload->>'horizon'=p->>'horizon') then raise exception 'INVALID_MASTER_POSITION';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(old->'positions','[]'))v where v->>'positionId'=p->>'positionId' and (v->'horizon' is distinct from p->'horizon' or v->'strategyVersion' is distinct from p->'strategyVersion' or (p->>'stop')::numeric<(v->>'stop')::numeric)) then raise exception 'MASTER_POSITION_POLICY_IMMUTABLE';end if;
 end loop;
 if (select count(distinct v->>'id') from jsonb_array_elements(s->'orders')v)<>jsonb_array_length(s->'orders') or (select count(distinct v->>'symbol') from jsonb_array_elements(s->'positions')v)<>jsonb_array_length(s->'positions') then raise exception 'DUPLICATE_MASTER_ORDER_OR_POSITION';end if;
 select count(distinct symbol),coalesce(sum(value),0) into slots,exposure from(select v->>'symbol' symbol,(v->>'cost')::numeric value from jsonb_array_elements(s->'positions')v union all select v->>'symbol',(v->>'remaining')::numeric from jsonb_array_elements(s->'orders')v where v->>'side'='BUY' and v->>'status' in('OPEN','PARTIAL','RESERVED','SUBMITTING','UNKNOWN','CANCEL_PENDING'))q;
 if slots>5 then raise exception 'MASTER_ABSOLUTE_POSITION_LIMIT';end if;
 new_buys=exists(select 1 from jsonb_array_elements(s->'orders')v where v->>'side'='BUY' and v->>'status' in('OPEN','PARTIAL') and not exists(select 1 from jsonb_array_elements(coalesce(old->'orders','[]'))x where x->>'id'=v->>'id'));
 if new_buys then
  if parent.operational_lock or parent.state->>'kill'='ALL' or c->>'enabled'<>'true' or c->>'buyPaused'<>'false' or c->>'kill'<>'NONE' or s->>'dailyLocked'<>'false' or s->>'baselinePending'<>'false' or slots>(c->>'maxPositions')::integer then raise exception 'MASTER_ENTRY_LOCKED';end if;
  base=least(10000,(s->>'equity')::numeric,(s->>'dayStart')::numeric);
  select coalesce(sum((v->>'remaining')::numeric),0) into reserved from jsonb_array_elements(s->'orders')v where v->>'side'='BUY' and v->>'status' in('OPEN','PARTIAL');
  select coalesce(sum(v),0) into risk from(
   select ceil(greatest((x->>'initialRiskTHB')::numeric*(x->>'cost')::numeric/(x->>'initialCost')::numeric,greatest(0,(x->>'cost')::numeric-(x->>'qty')::numeric*(x->>'stop')::numeric*(1-(c->>'fee')::numeric-(c->>'slippage')::numeric))+.10)*100)/100 v from jsonb_array_elements(s->'positions')x
   union all select ceil((x->>'riskTHB')::numeric*(x->>'remaining')::numeric/(x->>'amount')::numeric*100)/100 from jsonb_array_elements(s->'orders')x where x->>'side'='BUY' and x->>'status' in('OPEN','PARTIAL','RESERVED','SUBMITTING','UNKNOWN','CANCEL_PENDING'))q;
  select count(*),bool_and((x->>'pnl')::numeric<0),max((x->>'closedAt')::bigint) into streak,all_losses,last_loss from(select x from jsonb_array_elements(s->'closed')x where (x->>'closedAt')::bigint between master_at-86400000 and master_at order by (x->>'closedAt')::bigint desc limit 3)q;
  if streak=3 and all_losses and last_loss+3600000>master_at then raise exception 'MASTER_LOSS_STREAK_COOLDOWN';end if;
  if (s->>'maxDrawdown')::numeric>=(c->>'maxDrawdown')::numeric or (s->>'dayPnl')::numeric<=-floor((s->>'dayStart')::numeric*(c->>'dailyLossLimit')::numeric*100)/100 or risk>floor((s->>'dayStart')::numeric*(c->>'dailyLossLimit')::numeric*100)/100+(s->>'dayPnl')::numeric then raise exception 'MASTER_DRAWDOWN_OR_DAILY_LOCK';end if;
  if exposure>floor(base*(c->>'maxExposureFraction')::numeric*100)/100 or (s->>'cash')::numeric-reserved<ceil(base*(c->>'cashReserve')::numeric*100)/100 or risk>floor(base*(c->>'portfolioRiskCap')::numeric*100)/100 then raise exception 'MASTER_PORTFOLIO_RISK_LIMIT';end if;
  scale=case when (s->>'dayPnl')::numeric<=-(s->>'dayStart')::numeric*.015 then .5 else 1 end;
  for o in select value from jsonb_array_elements(s->'orders') where value->>'side'='BUY' and value->>'status' in('OPEN','PARTIAL') loop
   if not coalesce((o->>'qtyScale')::integer between 0 and 8,false) or not coalesce((o->>'minQuote')::numeric>=10,false) or not coalesce((o->>'amount')::numeric>=(o->>'minQuote')::numeric,false) or not coalesce((o->>'limit')::numeric>(o->>'stop')::numeric and (o->>'stop')::numeric>0 and (o->>'target')::numeric>(o->>'limit')::numeric,false) then raise exception 'MASTER_ORDER_STRUCTURE_INVALID';end if;
   estimated_qty=floor(((o->>'amount')::numeric-ceil((o->>'amount')::numeric*(c->>'fee')::numeric*100)/100)/(o->>'limit')::numeric*power(10::numeric,(o->>'qtyScale')::integer))/power(10::numeric,(o->>'qtyScale')::integer);
   stop_gross=estimated_qty*(o->>'stop')::numeric*(1-(c->>'slippage')::numeric);target_gross=estimated_qty*(o->>'target')::numeric*(1-(c->>'slippage')::numeric);
   model_risk=ceil(((o->>'amount')::numeric-floor((stop_gross-ceil(stop_gross*(c->>'fee')::numeric*100)/100)*100)/100+.10)*100)/100;
   model_reward=floor((floor((target_gross-ceil(target_gross*(c->>'fee')::numeric*100)/100)*100)/100-(o->>'amount')::numeric-.10)*100)/100;
   if floor(stop_gross*100)/100<(o->>'minQuote')::numeric or not coalesce((o->>'riskTHB')::numeric>=model_risk,false) or model_reward<=0 or model_reward/model_risk<(c->>'minNetRewardRisk')::numeric then raise exception 'MASTER_COST_OR_RISK_PROOF_FAILED';end if;
   if not coalesce((o->>'quoteAt')::bigint between master_at-30000 and master_at+5000,false) or not coalesce((o->>'bookAt')::bigint between master_at-30000 and master_at,false) then raise exception 'MASTER_ORDER_EVIDENCE_STALE';end if;
   if (o->>'amount')::numeric>floor(base*(c->>'maxPositionFraction')::numeric*100)/100 or (o->>'riskTHB')::numeric>floor(least(100,base*(c->>'riskPerTrade')::numeric)*scale*100)/100 then raise exception 'MASTER_TRADE_RISK_LIMIT';end if;
  end loop;
 end if;
 if p_experiments is null then saved=public.rea_checkpoint(p_uid,p_lease,p_revision,p_state,p_latest,p_events,p_signals,p_fills,p_at,p_error);else saved=public.rea_experiment_checkpoint(p_uid,p_lease,p_revision,p_state,p_latest,p_events,p_signals,p_fills,p_at,p_experiments,p_error);end if;
 if not saved then return false;end if;
 for j in select value from jsonb_array_elements(p_master->'journal') loop
  if j->>'type' not in('DECISION','FILL','CLOSED','RISK','VALIDATION') or j->>'type'='FILL' and j->'payload'->>'simulation' is distinct from 'true' then raise exception 'INVALID_MASTER_JOURNAL';end if;
  if j->>'type'='FILL' and j->'payload'->>'side'='SELL' then
   select sum((payload->>'qty')::numeric),sum((payload->>'qty')::numeric*(payload->>'price')::numeric),sum((payload->>'fee')::numeric) into basis_qty,basis_gross,basis_fees from rea.master_journal where user_id=p_uid and event_type='FILL' and payload->>'side'='BUY' and payload->>'positionId'=j->'payload'->>'positionId';
   if basis_qty>0 then
    gross_pnl=(j->'payload'->>'qty')::numeric*((j->'payload'->>'price')::numeric-basis_gross/basis_qty);
    j=jsonb_set(j,'{payload}',j->'payload'||jsonb_build_object('grossPnlTHB',gross_pnl,'netPnlTHB',(j->'payload'->>'realized')::numeric,'allocatedEntryFeeTHB',basis_fees*(j->'payload'->>'qty')::numeric/basis_qty,'exitFeeTHB',(j->'payload'->>'fee')::numeric,'grossPnlEvidence','PERSISTED_MATCHED_UNIT_COST_BEFORE_FEES','settlementAndRoundingResidualTHB',gross_pnl-(j->'payload'->>'realized')::numeric-basis_fees*(j->'payload'->>'qty')::numeric/basis_qty-(j->'payload'->>'fee')::numeric));
   end if;
  end if;
  insert into rea.master_journal(user_id,event_id,at_ms,event_type,payload) values(p_uid,j->>'id',(j->>'at')::bigint,j->>'type',j->'payload') on conflict do nothing;
 end loop;
 if p_master->'latest'->>'health'='OK' then insert into rea.master_equity values(p_uid,master_at,(s->>'equity')::numeric,s->>'day',(s->>'dayPnl')::numeric) on conflict do nothing;end if;
 update rea.master_books set state=s,latest=p_master->'latest',last_at=master_at,updated_at=now() where user_id=p_uid;
 return true;
end;$$;
create or replace function public.rea_master_view(p_uid uuid) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('protocol','REA-MASTER-31.0.0','mode','PAPER_ONLY','config',config,'configRevision',config_revision,'latest',latest,'updatedAt',updated_at,'canActivateLive',false,
 'journal',(select coalesce(jsonb_agg(x order by at_ms desc),'[]') from(select at_ms,event_type,payload from rea.master_journal where user_id=p_uid order by at_ms desc limit 100)x),
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from(select at_ms,equity,day,pnl from rea.master_equity where user_id=p_uid order by at_ms desc limit 1440)x),
 'strategies',(select jsonb_agg(payload order by strategy_id) from rea.master_strategy_versions where version='REA-MASTER-31.0.0'),
 'performance',(select coalesce(jsonb_agg(x order by x.net_pnl desc),'[]') from(
  select g.*,coalesce(f.fees,0) fees from(
   select payload->>'strategyId' strategy_id,payload->>'horizon' horizon,count(*) closed_trades,sum((payload->>'pnl')::numeric) net_pnl,avg((payload->>'pnl')::numeric) expectancy,sum(greatest((payload->>'pnl')::numeric,0))/nullif(sum(greatest(-(payload->>'pnl')::numeric,0)),0) profit_factor,count(*) filter(where (payload->>'pnl')::numeric>0)::numeric/nullif(count(*),0) win_rate
   from rea.master_journal where user_id=p_uid and event_type='CLOSED' group by 1,2
  )g left join(select payload->>'strategyId' strategy_id,sum((payload->>'fee')::numeric) fees from rea.master_journal where user_id=p_uid and event_type='FILL' group by 1)f using(strategy_id)
 )x))
 from rea.master_books where user_id=p_uid;
$$;
notify pgrst,'reload schema';
commit;
