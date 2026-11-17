begin;
alter table public.bitbot_v10_orders add column if not exists entry_policy jsonb;
create table public.bitbot_v12_fills(
 order_id uuid not null references public.bitbot_v10_orders(id),
 fill_index int not null check(fill_index>=0),
 user_id uuid not null references auth.users(id),
 symbol text not null,side text not null check(side in('BUY','SELL')),
 qty numeric not null check(qty>0),price numeric not null check(price>0),
 fee numeric not null check(fee>=0),credit numeric not null check(credit>=0),
 gross_fee numeric not null check(gross_fee>=0),realized numeric not null,
 filled_at timestamptz not null,time_source text not null,exchange_ref text,
 primary key(order_id,fill_index)
);
create index bitbot_v12_fills_user_time on public.bitbot_v12_fills(user_id,filled_at desc);
alter table public.bitbot_v12_fills enable row level security;
create policy service_only on public.bitbot_v12_fills for all to service_role using(true) with check(true);
revoke all on public.bitbot_v12_fills from public,anon,authenticated;
grant all on public.bitbot_v12_fills to service_role;
create function public.bitbot_v12_finish(p_uid uuid,p_lease uuid,p_state jsonb,p_trace jsonb,p_error text default null,p_settle uuid default null,p_status text default null,p_fills jsonb default '[]'::jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;done boolean;f jsonb;
begin
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if b.user_id is null or p_lease is null or b.lease is distinct from p_lease then return false;end if;
 if jsonb_typeof(p_fills)<>'array' or jsonb_array_length(p_fills)>10000 then raise exception 'Invalid fill ledger';end if;
 if jsonb_array_length(p_fills)>0 and p_settle is null then raise exception 'Fill ledger needs settlement';end if;
 done=public.bitbot_v10_finish(p_uid,p_lease,p_state,p_trace,p_error,p_settle,p_status);
 if not done then return false;end if;
 for f in select value from jsonb_array_elements(p_fills) loop
 insert into public.bitbot_v12_fills(order_id,fill_index,user_id,symbol,side,qty,price,fee,credit,gross_fee,realized,filled_at,time_source,exchange_ref)
 values(p_settle,(f->>'index')::int,p_uid,f->>'symbol',f->>'side',(f->>'qty')::numeric,(f->>'price')::numeric,
 (f->>'fee')::numeric,(f->>'credit')::numeric,(f->>'grossFee')::numeric,(f->>'realized')::numeric,(f->>'at')::timestamptz,f->>'timeSource',f->>'source');
 end loop;
 return true;
end;$$;
revoke all on function public.bitbot_v12_finish(uuid,uuid,jsonb,jsonb,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.bitbot_v12_finish(uuid,uuid,jsonb,jsonb,text,uuid,text,jsonb) to service_role;
create or replace function public.bitbot_v10_reserve(p_uid uuid,p_lease uuid,p_id uuid,p_order jsonb,p_state jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;cap numeric;total numeric;v numeric;v_side text;m public.bitbot_v11_markets%rowtype;v_symbol text;
begin
 perform pg_advisory_xact_lock(hashtextextended('bitbot-v10-'||p_uid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bitbot-live-'||p_uid::text,0));
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if not b.running or b.lease is distinct from p_lease or b.lease_until<=now() then raise exception 'บอทหยุดหรือสิทธิ์รอบหมดอายุ';end if;
 if exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled) then raise exception 'มีคำสั่งค้าง ห้ามส่งซ้ำ';end if;
 v_symbol=p_order->>'symbol';
 select * into m from public.bitbot_v11_markets where symbol=v_symbol;
 if m.symbol is null or m.status<>'active' or m.updated_at<now()-interval '30 minutes' then raise exception 'Market metadata unavailable';end if;
 v_side=p_order->>'side';
 if (v_side='BUY' and m.buy_frozen) or (v_side='SELL' and m.sell_frozen) then raise exception 'Market side frozen';end if;
 if coalesce((b.state->>'qty')::numeric,0)>0 and coalesce(b.state->>'symbol','BTC_THB')<>v_symbol then raise exception 'Position symbol mismatch';end if;v=(p_order->>'notional')::numeric;
 if v_side not in ('BUY','SELL') or v<m.min_quote or v>least((b.config->>'maxOrder')::numeric,1000) then raise exception 'เกินวงเงินคำสั่ง';end if;
 if v_side='BUY' then
 if coalesce((b.config->>'buyPaused')::boolean,false) then raise exception 'พักซื้ออยู่';end if;
 if v_symbol in('USDT_THB','USDC_THB','DAI_THB','USDS_THB','TUSD_THB','FDUSD_THB','PYUSD_THB','USDE_THB') and coalesce((b.config->>'intraday')::boolean,true) then raise exception 'Stablecoin excluded from intraday entries';end if;
 if coalesce((p_state->>'entriesToday')::int,0)>=coalesce((b.config->>'maxEntries')::int,3) then raise exception 'Daily entry limit reached';end if;
 if coalesce((p_state->>'cooldownUntil')::numeric,0)>extract(epoch from now())*1000 then raise exception 'Loss cooldown active';end if;
 if coalesce((b.config->>'dailyProfitTarget')::numeric,.01)>0 and coalesce((p_state->>'dayPnl')::numeric,0)>=coalesce((p_state->>'dayStart')::numeric,0)*coalesce((b.config->>'dailyProfitTarget')::numeric,.01) then raise exception 'Daily net profit target reached';end if;
 end if;
 cap=case when v_side='BUY' then least((b.config->>'dailyBuy')::numeric,5000) else least((b.config->>'dailySell')::numeric,10000) end;
 select coalesce(sum(notional),0) into total from public.bitbot_v10_orders
 where user_id=p_uid and bitbot_v10_orders.side=v_side and status<>'REJECTED'
 and (created_at at time zone 'Asia/Bangkok')::date=(now() at time zone 'Asia/Bangkok')::date;
 if total+v>cap then raise exception 'ถึงวงเงินรายวัน';end if;
 -- Previous gateway and new bot must never place overlapping exchange orders.
 if exists(select 1 from public.bitbot_live_orders where user_id=p_uid and status in ('RESERVED','OPEN','UNKNOWN')) then raise exception 'มีออร์เดอร์จากระบบเดิมค้าง';end if;
 insert into public.bitbot_v10_orders(id,user_id,side,amount,price,notional,status,strategy,reason,symbol,qty_scale,entry_policy)
 values(p_id,p_uid,v_side,(p_order->>'amount')::numeric,(p_order->>'price')::numeric,v,'RESERVED',p_order->>'strategy',p_order->>'reason',v_symbol,m.qty_scale,p_order->'entryPolicy');
 update public.bitbot_v10_bots set state=p_state where user_id=p_uid;
end;$$;
-- Upgrade only the requested account. A held legacy position keeps its original exit policy.
update public.bitbot_v10_bots set
 config=config||'{"intraday":true,"maxHoldMinutes":60,"dailyProfitTarget":0.01,"maxEntries":3,"lossStreakLimit":2,"cooldownMinutes":60,"minNetRR":1.2,"minNetProfit":0.003,"slippage":0.0005,"maxDepthImpact":0.0015,"minRangeCostRatio":1.5}'::jsonb,
 state=state||jsonb_build_object('trackingSince',now(),'daily',coalesce(state->'daily','{}'::jsonb),
 'entryPolicy',case when (state->>'qty')::numeric>0 then coalesce(nullif(state->'entryPolicy','null'::jsonb),jsonb_build_object('stopLoss',(config->>'stopLoss')::numeric,'takeProfit',(config->>'takeProfit')::numeric,'maxHoldMinutes',0,'legacy',true)) else null end),
 running=false,lease=null,lease_until=null,updated_at=now()
 where user_id='2eef9088-4116-410d-aa4b-7ab1dc89ad6d';
insert into public.bitbot_v10_events(user_id,kind,payload) values('2eef9088-4116-410d-aa4b-7ab1dc89ad6d','UPGRADE_STOPPED','{"version":"12.0.0","positionPreserved":true,"dailyDetails":"from upgrade onward"}');
commit;
