-- New validation engine only. Existing Live/Paper ledgers and dispatch RPCs are untouched.
begin;
create table rea.master_books(
 user_id uuid primary key references rea.bot_settings(user_id),
 mode text not null default 'PAPER_ONLY' check(mode='PAPER_ONLY'),
 config jsonb not null default '{"mode":"PAPER_ONLY","enabled":true,"riskPerTrade":0.01,"maxPositions":5,"dailyLossLimit":0.03,"portfolioRiskCap":0.03,"maxPositionFraction":0.4,"maxExposureFraction":0.7,"cashReserve":0.3,"maxDrawdown":0.1,"correlationThreshold":0.8,"minVolumeTHB":1000000,"maxSpread":0.003,"minNetRewardRisk":1.5,"slippage":0.002,"fee":0.0025,"strategies":["TREND_SHORT","BREAKOUT_SHORT","PULLBACK_MEDIUM","MEAN_REVERSION_SHORT","MOMENTUM_SHORT","SWING_MEDIUM","POSITION_LONG"],"frames":[1,5,15,60,240,1440,10080],"horizons":["SHORT","MEDIUM","LONG"],"notifications":{"inApp":true},"exitPolicy":"BALANCED_VALIDATION","buyPaused":false,"kill":"NONE"}'::jsonb,
 config_revision bigint not null default 0,
 state jsonb,latest jsonb not null default '{}',last_at bigint,
 updated_at timestamptz not null default now(),
 check(state is null or (state->>'mode'='PAPER_ONLY' and state->>'protocol'='REA-MASTER-31.0.0' and octet_length(state::text)<=1000000)),
 check(octet_length(latest::text)<=1000000)
);
create table rea.master_journal(
 user_id uuid not null references rea.master_books(user_id),event_id text not null check(length(event_id)<=1500),
 at_ms bigint not null,event_type text not null check(event_type in('DECISION','FILL','CLOSED','RISK','CONFIG','VALIDATION')),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=32768),
 primary key(user_id,event_id)
);
create index master_journal_owner_type_time on rea.master_journal(user_id,event_type,at_ms desc);
create table rea.master_equity(user_id uuid not null references rea.master_books(user_id),at_ms bigint not null,equity numeric not null check(equity>=0),day text not null,pnl numeric not null,primary key(user_id,at_ms));
create table rea.master_strategy_versions(strategy_id text not null,version text not null,payload jsonb not null,primary key(strategy_id,version));
insert into rea.master_strategy_versions select value->>'id',value->>'version',value from jsonb_array_elements('[{"id":"TREND_SHORT","name":"Trend Following","horizon":"SHORT","frame":5,"confirm":15,"stopATR":2,"targetR":2.5,"maxHoldMs":86400000,"version":"REA-MASTER-31.0.0","mode":"VALIDATION_ONLY","canActivateLive":false},{"id":"BREAKOUT_SHORT","name":"Breakout","horizon":"SHORT","frame":5,"confirm":15,"stopATR":2,"targetR":3,"maxHoldMs":86400000,"version":"REA-MASTER-31.0.0","mode":"VALIDATION_ONLY","canActivateLive":false},{"id":"PULLBACK_MEDIUM","name":"Pullback","horizon":"MEDIUM","frame":60,"confirm":240,"stopATR":2,"targetR":3,"maxHoldMs":1209600000,"version":"REA-MASTER-31.0.0","mode":"VALIDATION_ONLY","canActivateLive":false},{"id":"MEAN_REVERSION_SHORT","name":"Mean Reversion","horizon":"SHORT","frame":5,"confirm":15,"stopATR":1.5,"targetR":2,"maxHoldMs":21600000,"riskScale":0.5,"version":"REA-MASTER-31.0.0","mode":"VALIDATION_ONLY","canActivateLive":false},{"id":"MOMENTUM_SHORT","name":"Momentum","horizon":"SHORT","frame":5,"confirm":60,"stopATR":2,"targetR":3,"maxHoldMs":43200000,"version":"REA-MASTER-31.0.0","mode":"VALIDATION_ONLY","canActivateLive":false},{"id":"SWING_MEDIUM","name":"Swing","horizon":"MEDIUM","frame":240,"confirm":1440,"stopATR":2.5,"targetR":3,"maxHoldMs":2419200000,"version":"REA-MASTER-31.0.0","mode":"VALIDATION_ONLY","canActivateLive":false},{"id":"POSITION_LONG","name":"Position","horizon":"LONG","frame":1440,"confirm":10080,"stopATR":2.5,"targetR":3,"maxHoldMs":15552000000,"version":"REA-MASTER-31.0.0","mode":"VALIDATION_ONLY","canActivateLive":false}]'::jsonb);
do $$declare t text;begin foreach t in array array['master_books','master_journal','master_equity','master_strategy_versions'] loop
 execute format('alter table rea.%I enable row level security',t);
 execute format('create policy service_select on rea.%I for select to service_role using(true)',t);
 execute format('revoke all on rea.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on rea.%I to service_role',t);
 if t<>'master_strategy_versions' then
  execute format('create policy service_insert on rea.%I for insert to service_role with check(true)',t);
  execute format('grant insert on rea.%I to service_role',t);
 end if;
end loop;
create policy service_update on rea.master_books for update to service_role using(true) with check(true);
grant update on rea.master_books to service_role;
end;$$;
create function rea.valid_master_config(c jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare k text;v jsonb;lo numeric;hi numeric;expected text[];actual text[];begin
 expected=array['buyPaused','cashReserve','correlationThreshold','dailyLossLimit','enabled','exitPolicy','fee','frames','horizons','kill','maxDrawdown','maxExposureFraction','maxPositionFraction','maxPositions','maxSpread','minNetRewardRisk','minVolumeTHB','mode','notifications','portfolioRiskCap','riskPerTrade','slippage','strategies'];
 if jsonb_typeof(c) is distinct from 'object' then return false;end if;select array_agg(key order by key) into actual from jsonb_object_keys(c)k(key);if actual is distinct from expected then return false;end if;
 if c->>'mode' is distinct from 'PAPER_ONLY' or c->>'fee' is distinct from '0.0025' or jsonb_typeof(c->'fee') is distinct from 'number' or jsonb_typeof(c->'enabled') is distinct from 'boolean' or jsonb_typeof(c->'buyPaused') is distinct from 'boolean' or coalesce(c->>'kill','') not in('NONE','ENTRY','ALL') or coalesce(c->>'exitPolicy','') not in('BALANCED_VALIDATION','FIXED_BASELINE') then return false;end if;
 for k,lo,hi in select * from(values('riskPerTrade',.001,.01),('maxPositions',1,5),('dailyLossLimit',.005,.03),('portfolioRiskCap',.005,.03),('maxPositionFraction',.05,.4),('maxExposureFraction',.1,.8),('cashReserve',.2,.9),('maxDrawdown',.02,.2),('correlationThreshold',.5,.95),('minVolumeTHB',250000,10000000000),('maxSpread',.0001,.006),('minNetRewardRisk',1,5),('slippage',.001,.01))b(k,lo,hi) loop
  if jsonb_typeof(c->k) is distinct from 'number' or not((c->>k)::numeric between lo and hi) then return false;end if;
 end loop;
 if (c->>'maxPositions')::numeric<>floor((c->>'maxPositions')::numeric) or (c->>'cashReserve')::numeric+(c->>'maxExposureFraction')::numeric>1.0000001 then return false;end if;
 foreach k in array array['strategies','frames','horizons'] loop
  if jsonb_typeof(c->k) is distinct from 'array' or jsonb_array_length(c->k)<1 or (select count(distinct x) from jsonb_array_elements(c->k)x)<>jsonb_array_length(c->k) then return false;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(c->'strategies')x where jsonb_typeof(x)<>'string' or not exists(select 1 from rea.master_strategy_versions where strategy_id=x#>>'{}' and version='REA-MASTER-31.0.0')) or exists(select 1 from jsonb_array_elements(c->'frames')x where jsonb_typeof(x)<>'number' or not x=any(array['1','5','15','60','240','1440','10080']::jsonb[])) or exists(select 1 from jsonb_array_elements(c->'horizons')x where not x=any(array['"SHORT"','"MEDIUM"','"LONG"']::jsonb[])) then return false;end if;
 if c->'notifications' is distinct from jsonb_build_object('inApp',coalesce((c->'notifications'->>'inApp')::boolean,false)) or jsonb_typeof(c->'notifications'->'inApp') is distinct from 'boolean' then return false;end if;
 return true;
exception when others then return false;
end;$$;
create function public.rea_master_state(p_uid uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a rea.master_books%rowtype;begin
 insert into rea.master_books(user_id) values(p_uid) on conflict do nothing;
 select * into a from rea.master_books where user_id=p_uid;
 return jsonb_build_object('protocol','REA-MASTER-31.0.0','mode','PAPER_ONLY','config',a.config,'configRevision',a.config_revision,'state',a.state,'latest',a.latest,'canActivateLive',false);
end;$$;
create function public.rea_master_configure(p_uid uuid,p_expected_revision bigint,p_config jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a rea.master_books%rowtype;t bigint=floor(extract(epoch from now())*1000);begin
 perform 1 from rea.bot_settings where user_id=p_uid for update;
 select * into a from rea.master_books where user_id=p_uid for update;
 if not found then raise exception 'MASTER_ACCOUNT_NOT_INITIALIZED';end if;
 if a.config_revision<>p_expected_revision then raise exception 'MASTER_CONFIG_REVISION_CHANGED';end if;
 if not rea.valid_master_config(p_config) then raise exception 'INVALID_MASTER_PAPER_CONFIG';end if;
 update rea.master_books set config=p_config,config_revision=config_revision+1,updated_at=now() where user_id=p_uid;
 update rea.bot_settings set revision=revision+1,lease=null,lease_until=null,next_tick=now() where user_id=p_uid;
 insert into rea.audit_logs(user_id,action,payload) values(p_uid,'MASTER_PAPER_CONFIG_CHANGED',jsonb_build_object('before',a.config,'after',p_config,'revision',a.config_revision+1,'livePolicyChanged',false));
 insert into rea.master_journal values(p_uid,'config:'||(a.config_revision+1),t,'CONFIG',jsonb_build_object('before',a.config,'after',p_config,'revision',a.config_revision+1));
 return jsonb_build_object('saved',true,'configRevision',a.config_revision+1,'mode','PAPER_ONLY','livePolicyChanged',false);
end;$$;
create function public.rea_master_checkpoint(p_uid uuid,p_lease uuid,p_revision bigint,p_state jsonb,p_latest jsonb,p_events jsonb,p_signals jsonb,p_fills jsonb,p_at bigint,p_error text,p_experiments jsonb,p_master jsonb,p_config_revision bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare master_at bigint;a rea.master_books%rowtype;s jsonb;c jsonb;j jsonb;o jsonb;p jsonb;old jsonb;parent rea.bot_settings%rowtype;saved boolean;slots integer;base numeric;exposure numeric;risk numeric;reserved numeric;new_buys boolean;streak integer;all_losses boolean;last_loss bigint;scale numeric;estimated_qty numeric;stop_gross numeric;target_gross numeric;model_risk numeric;model_reward numeric;begin
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
  insert into rea.master_journal(user_id,event_id,at_ms,event_type,payload) values(p_uid,j->>'id',(j->>'at')::bigint,j->>'type',j->'payload') on conflict do nothing;
 end loop;
 if p_master->'latest'->>'health'='OK' then insert into rea.master_equity values(p_uid,master_at,(s->>'equity')::numeric,s->>'day',(s->>'dayPnl')::numeric) on conflict do nothing;end if;
 update rea.master_books set state=s,latest=p_master->'latest',last_at=master_at,updated_at=now() where user_id=p_uid;
 return true;
end;$$;
create function public.rea_master_view(p_uid uuid) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('protocol','REA-MASTER-31.0.0','mode','PAPER_ONLY','config',config,'configRevision',config_revision,'latest',latest,'updatedAt',updated_at,'canActivateLive',false,
 'journal',(select coalesce(jsonb_agg(x order by at_ms desc),'[]') from(select at_ms,event_type,payload from rea.master_journal where user_id=p_uid order by at_ms desc limit 100)x),
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from(select at_ms,equity,day,pnl from rea.master_equity where user_id=p_uid order by at_ms desc limit 1440)x),
 'strategies',(select jsonb_agg(payload order by strategy_id) from rea.master_strategy_versions where version='REA-MASTER-31.0.0'),
 'performance',(select coalesce(jsonb_agg(x),'[]') from(select payload->>'strategyId' strategy_id,payload->>'horizon' horizon,count(*) closed_trades,sum((payload->>'pnl')::numeric) net_pnl,avg((payload->>'pnl')::numeric) expectancy,count(*) filter(where (payload->>'pnl')::numeric>0)::numeric/nullif(count(*),0) win_rate from rea.master_journal where user_id=p_uid and event_type='CLOSED' group by 1,2)x))
 from rea.master_books where user_id=p_uid;
$$;
revoke all on function rea.valid_master_config(jsonb),public.rea_master_state(uuid),public.rea_master_view(uuid),public.rea_master_configure(uuid,bigint,jsonb),public.rea_master_checkpoint(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,text,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function rea.valid_master_config(jsonb),public.rea_master_state(uuid),public.rea_master_view(uuid),public.rea_master_configure(uuid,bigint,jsonb),public.rea_master_checkpoint(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,text,jsonb,jsonb,bigint) to service_role;
notify pgrst,'reload schema';
commit;
