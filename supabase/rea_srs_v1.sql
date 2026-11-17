-- Additive REA paper deployment. Run on Bitbot project lrxrigimdaedfemqheug only.
-- No credentials, live grants, destructive resets or changes to the existing fill ledger.
begin;
create schema if not exists rea;
revoke all on schema rea from public,anon,authenticated;
grant usage on schema rea to service_role;
create table rea.bot_settings(
 user_id uuid primary key references auth.users(id), mode text not null default 'PAPER_ONLY' check(mode='PAPER_ONLY'),
 enabled boolean not null default false, state jsonb not null, latest jsonb not null default '{}',
 revision bigint not null default 0, lease uuid, lease_until timestamptz, next_tick timestamptz not null default now(),
 updated_at timestamptz not null default now(), last_error text,
 operational_lock boolean not null default false,operational_reasons jsonb not null default '[]',
 check(state->>'mode'='PAPER_ONLY'),check((state->>'cash')::numeric>=0),check((state->>'initialCapital')::numeric=10000)
);
create table rea.market_snapshots(user_id uuid not null references rea.bot_settings,at_ms bigint not null,payload jsonb not null,primary key(user_id,at_ms));
create table rea.trade_signals(user_id uuid not null references rea.bot_settings,signal_id text not null,payload jsonb not null,primary key(user_id,signal_id));
create table rea.trading_orders(user_id uuid not null references rea.bot_settings,client_order_id text not null,status text not null check(status in('OPEN','PARTIAL','FILLED','CANCELED')),payload jsonb not null,primary key(user_id,client_order_id));
create table rea.trade_fills(user_id uuid not null references rea.bot_settings,fill_id text not null,client_order_id text not null,payload jsonb not null,primary key(user_id,fill_id),foreign key(user_id,client_order_id) references rea.trading_orders);
create table rea.positions(user_id uuid not null references rea.bot_settings,position_id text not null,symbol text not null,status text not null check(status in('OPEN','CLOSED')),payload jsonb not null,primary key(user_id,position_id));
create unique index rea_one_position_symbol on rea.positions(user_id,symbol) where status='OPEN';
create table rea.equity_snapshots(user_id uuid not null references rea.bot_settings,at_ms bigint not null,equity numeric not null,primary key(user_id,at_ms));
create table rea.daily_pnl(user_id uuid not null references rea.bot_settings,day date not null,payload jsonb not null,primary key(user_id,day));
create table rea.agent_decisions(user_id uuid not null references rea.bot_settings,at_ms bigint not null,payload jsonb not null,primary key(user_id,at_ms));
create table rea.risk_events(id bigint generated always as identity primary key,user_id uuid not null references rea.bot_settings,payload jsonb not null,created_at timestamptz not null default now());
create table rea.bot_heartbeats(user_id uuid not null references rea.bot_settings,service text not null,at_ms bigint not null,status text not null,primary key(user_id,service));
create table rea.audit_logs(id bigint generated always as identity primary key,user_id uuid not null references rea.bot_settings,action text not null,payload jsonb not null,created_at timestamptz not null default now());
do $$declare t text;begin
 foreach t in array array['bot_settings','market_snapshots','trade_signals','trading_orders','trade_fills','positions','equity_snapshots','daily_pnl','agent_decisions','risk_events','bot_heartbeats','audit_logs'] loop
  execute format('alter table rea.%I enable row level security',t);
  execute format('create policy service_only on rea.%I for all to service_role using(true) with check(true)',t);
 end loop;
end$$;
revoke all on all tables in schema rea from public,anon,authenticated;
grant select,insert,update on all tables in schema rea to service_role;
grant usage,select on all sequences in schema rea to service_role;

create function public.rea_claim(p_uid uuid default null) returns setof rea.bot_settings
language sql security invoker set search_path='' as $$
 update rea.bot_settings set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds'
 where user_id in(select user_id from rea.bot_settings where enabled and next_tick<=now()
 and (p_uid is null or user_id=p_uid) and (lease_until is null or lease_until<now())
 order by next_tick for update skip locked limit 3) returning *;
$$;
create function public.rea_view(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('mode',mode,'enabled',enabled,'state',state,'latest',latest,'updatedAt',updated_at,'lastError',last_error,'revision',revision,
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from (select at_ms,equity from rea.equity_snapshots where user_id=p_uid order by at_ms desc limit 1440)x),
 'daily',(select coalesce(jsonb_agg(x order by day),'[]') from (select day,payload from rea.daily_pnl where user_id=p_uid order by day desc limit 366)x),
 'audit',(select coalesce(jsonb_agg(x order by id desc),'[]') from (select id,action,payload,created_at from rea.audit_logs where user_id=p_uid order by id desc limit 50)x))
 from rea.bot_settings where user_id=p_uid;
$$;
create function public.rea_control(p_uid uuid,p_action text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare s jsonb;v_enabled boolean;begin
 select state,enabled into s,v_enabled from rea.bot_settings where user_id=p_uid for update;
 if s is null then raise exception 'REA_ACCOUNT_NOT_INITIALIZED';end if;
 if p_action='pause' then s=jsonb_set(s,'{buyPaused}','true');
 elsif p_action='resume' then s=jsonb_set(s,'{buyPaused}','false');v_enabled=true;if s->>'kill'='ENTRY' then s=jsonb_set(s,'{kill}','"NONE"');end if;
 elsif p_action='stop-entry' then if s->>'kill'<>'ALL' then s=jsonb_set(s,'{kill}','"ENTRY"');end if;
 elsif p_action='emergency' then s=jsonb_set(s,'{kill}','"ALL"');
 elsif p_action='clear-emergency' then s=jsonb_set(s,'{kill}','"NONE"');
 else raise exception 'INVALID_CONTROL';end if;
 -- Controls invalidate in-flight leases so a late cycle cannot overwrite a pause/kill.
 update rea.bot_settings set state=s,enabled=v_enabled,revision=revision+1,lease=null,lease_until=null,next_tick=now(),updated_at=now() where user_id=p_uid;
 insert into rea.audit_logs(user_id,action,payload) values(p_uid,p_action,jsonb_build_object('mode','PAPER_ONLY','dailyLockPreserved',s->'dailyLocked'));
 return true;
end$$;
create function public.rea_checkpoint(p_uid uuid,p_lease uuid,p_revision bigint,p_state jsonb,p_latest jsonb,p_events jsonb,p_signals jsonb,p_fills jsonb,p_at bigint,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare x jsonb;d record;previous_state jsonb;locked boolean;begin
 perform 1 from rea.bot_settings where user_id=p_uid and lease=p_lease and revision=p_revision and lease_until>now() for update;
 if not found then return false;end if;
 select state,operational_lock into previous_state,locked from rea.bot_settings where user_id=p_uid;
 if locked and exists(select 1 from jsonb_array_elements(p_state->'orders') as e(value) where e.value->>'side'='BUY' and e.value->>'status' in('OPEN','PARTIAL') and not exists(select 1 from jsonb_array_elements(previous_state->'orders') as old(value) where old.value->>'id'=e.value->>'id')) then raise exception 'OPERATIONAL_SAFE_MODE';end if;
 if p_state->>'mode'<>'PAPER_ONLY' or (p_state->>'cash')::numeric<0 or (p_state->>'initialCapital')::numeric<>10000 then raise exception 'INVALID_PAPER_STATE';end if;
 if (select count(distinct symbol) from(select e.value->>'symbol' symbol from jsonb_array_elements(p_state->'positions') as e(value) union all select e.value->>'symbol' from jsonb_array_elements(p_state->'orders') as e(value) where e.value->>'side'='BUY' and e.value->>'status' in('OPEN','PARTIAL'))q)>2 then raise exception 'MAX_POSITIONS';end if;
 for x in select value from jsonb_array_elements(p_state->'orders') loop
  insert into rea.trading_orders values(p_uid,x->>'id',x->>'status',x) on conflict(user_id,client_order_id) do update set status=excluded.status,payload=excluded.payload;
 end loop;
 for x in select value from jsonb_array_elements(p_fills) loop
  insert into rea.trade_fills values(p_uid,x->>'id',x->>'orderId',x) on conflict do nothing;
 end loop;
 update rea.positions set status='CLOSED' where user_id=p_uid and status='OPEN' and position_id not in(select e.value->>'positionId' from jsonb_array_elements(p_state->'positions') as e(value));
 for x in select value from jsonb_array_elements(p_state->'positions') loop
  insert into rea.positions values(p_uid,x->>'positionId',x->>'symbol','OPEN',x) on conflict(user_id,position_id) do update set payload=excluded.payload,status='OPEN';
 end loop;
 for x in select value from jsonb_array_elements(p_signals) loop
  insert into rea.trade_signals values(p_uid,x->>'signalId',x) on conflict(user_id,signal_id) do nothing;
 end loop;
 for x in select value from jsonb_array_elements(p_events) loop
  insert into rea.risk_events(user_id,payload) values(p_uid,x);
 end loop;
 for d in select * from jsonb_each(p_state->'days') loop
  insert into rea.daily_pnl values(p_uid,d.key::date,d.value) on conflict(user_id,day) do update set payload=excluded.payload;
 end loop;
 insert into rea.daily_pnl values(p_uid,(p_state->>'day')::date,jsonb_build_object('start',p_state->'dayStart','flows',p_state->'dayFlows','equity',p_state->'equity','pnl',p_state->'dayPnl','locked',p_state->'dailyLocked')) on conflict(user_id,day) do update set payload=excluded.payload;
 insert into rea.equity_snapshots values(p_uid,p_at,(p_state->>'equity')::numeric) on conflict do nothing;
 insert into rea.market_snapshots values(p_uid,p_at,p_latest->'quotes') on conflict do nothing;
 insert into rea.agent_decisions values(p_uid,p_at,p_latest) on conflict do nothing;
 insert into rea.bot_heartbeats values(p_uid,'paper-cycle',p_at,coalesce(p_latest->>'health','SAFE_MODE')) on conflict(user_id,service) do update set at_ms=excluded.at_ms,status=excluded.status;
 update rea.bot_settings set state=p_state,latest=p_latest,revision=revision+1,lease=null,lease_until=null,next_tick=now()+interval '45 seconds',updated_at=now(),last_error=p_error where user_id=p_uid;
 return true;
end$$;
revoke all on function public.rea_claim(uuid),public.rea_view(uuid),public.rea_control(uuid,text),public.rea_checkpoint(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.rea_claim(uuid),public.rea_view(uuid),public.rea_control(uuid,text),public.rea_checkpoint(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,text) to service_role;
commit;
