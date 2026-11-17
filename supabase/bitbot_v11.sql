begin;
create table public.bitbot_v11_markets(
 symbol text primary key check(symbol ~ '^[A-Z0-9]{1,16}_THB$'),
 name text not null,status text not null,buy_frozen boolean not null,sell_frozen boolean not null,
 min_quote numeric not null check(min_quote>0),price_step numeric not null check(price_step>0),
 price_scale int not null check(price_scale between 0 and 8),qty_scale int not null check(qty_scale between 0 and 8),
 updated_at timestamptz not null default now()
);
create table public.bitbot_v11_cache(key text primary key,payload jsonb not null,expires_at timestamptz not null);
alter table public.bitbot_v11_markets enable row level security;
alter table public.bitbot_v11_cache enable row level security;
create policy service_only on public.bitbot_v11_markets for all to service_role using(true) with check(true);
create policy service_only on public.bitbot_v11_cache for all to service_role using(true) with check(true);
revoke all on public.bitbot_v11_markets,public.bitbot_v11_cache from public,anon,authenticated;
grant all on public.bitbot_v11_markets,public.bitbot_v11_cache to service_role;
alter table public.bitbot_v10_orders add column symbol text not null default 'BTC_THB' check(symbol ~ '^[A-Z0-9]{1,16}_THB$');
alter table public.bitbot_v10_orders add column qty_scale int not null default 8 check(qty_scale between 0 and 8);
create function public.bitbot_v11_cache_put(p_key text,p_payload jsonb,p_expires timestamptz) returns void
language sql security definer set search_path='' as $$
 insert into public.bitbot_v11_cache values(p_key,p_payload,p_expires)
 on conflict(key) do update set payload=excluded.payload,expires_at=excluded.expires_at;
$$;
create function public.bitbot_v11_sync_markets(p_rows jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if jsonb_array_length(p_rows)<2 or jsonb_array_length(p_rows)>2000 then raise exception 'Invalid market list';end if;
 insert into public.bitbot_v11_markets(symbol,name,status,buy_frozen,sell_frozen,min_quote,price_step,price_scale,qty_scale,updated_at)
 select x->>'symbol',x->>'name',x->>'status',(x->>'buyFrozen')::boolean,(x->>'sellFrozen')::boolean,
 (x->'rules'->>'minQuote')::numeric,(x->'rules'->>'priceStep')::numeric,(x->'rules'->>'priceScale')::int,(x->'rules'->>'qtyScale')::int,now()
 from jsonb_array_elements(p_rows) x
 on conflict(symbol) do update set name=excluded.name,status=excluded.status,buy_frozen=excluded.buy_frozen,sell_frozen=excluded.sell_frozen,
 min_quote=excluded.min_quote,price_step=excluded.price_step,price_scale=excluded.price_scale,qty_scale=excluded.qty_scale,updated_at=now();
 update public.bitbot_v11_markets set status='unavailable',buy_frozen=true,sell_frozen=true
 where symbol not in(select x->>'symbol' from jsonb_array_elements(p_rows) x);
end;$$;
create function public.bitbot_v11_fund(p_uid uuid,p_funds numeric) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;
begin
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if b.running then return false;end if;
 if coalesce((b.state->>'trades')::int,0)>0 or coalesce((b.state->>'qty')::numeric,0)>0 then return false;end if;
 if p_funds<10 or p_funds>(b.config->>'budget')::numeric then raise exception 'Funding outside user limit';end if;
 update public.bitbot_v10_bots set state=state||jsonb_build_object('cash',p_funds,'peak',p_funds,'dayStart',p_funds,'startCapital',p_funds),updated_at=now()
 where user_id=p_uid;
 return true;
end;$$;
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
 if v_side='BUY' and (b.config->>'buyPaused')::boolean then raise exception 'พักซื้ออยู่';end if;
 cap=case when v_side='BUY' then least((b.config->>'dailyBuy')::numeric,5000) else least((b.config->>'dailySell')::numeric,10000) end;
 select coalesce(sum(notional),0) into total from public.bitbot_v10_orders
 where user_id=p_uid and bitbot_v10_orders.side=v_side and status<>'REJECTED'
 and (created_at at time zone 'Asia/Bangkok')::date=(now() at time zone 'Asia/Bangkok')::date;
 if total+v>cap then raise exception 'ถึงวงเงินรายวัน';end if;
 -- Previous gateway and new bot must never place overlapping exchange orders.
 if exists(select 1 from public.bitbot_live_orders where user_id=p_uid and status in ('RESERVED','OPEN','UNKNOWN')) then raise exception 'มีออร์เดอร์จากระบบเดิมค้าง';end if;
 insert into public.bitbot_v10_orders(id,user_id,side,amount,price,notional,status,strategy,reason,symbol,qty_scale)
 values(p_id,p_uid,v_side,(p_order->>'amount')::numeric,(p_order->>'price')::numeric,v,'RESERVED',p_order->>'strategy',p_order->>'reason',v_symbol,m.qty_scale);
 update public.bitbot_v10_bots set state=p_state where user_id=p_uid;
end;$$;

revoke all on function public.bitbot_v11_cache_put(text,jsonb,timestamptz),public.bitbot_v11_sync_markets(jsonb),public.bitbot_v11_fund(uuid,numeric) from public,anon,authenticated;
grant execute on function public.bitbot_v11_cache_put(text,jsonb,timestamptz),public.bitbot_v11_sync_markets(jsonb),public.bitbot_v11_fund(uuid,numeric) to service_role;
commit;
