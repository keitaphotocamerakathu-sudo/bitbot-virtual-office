-- Bitbot 10. Additive migration; previous accounts, encrypted keys and journals remain intact.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table public.bitbot_v10_bots(
 user_id uuid primary key references auth.users(id) on delete cascade,
 running boolean not null default false,
 config jsonb not null, state jsonb not null,
 lease uuid, lease_until timestamptz, next_tick timestamptz not null default now(),
 updated_at timestamptz not null default now(), last_error text
);
create table public.bitbot_v10_events(
 id bigint generated always as identity primary key,user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null,payload jsonb not null,created_at timestamptz not null default now()
);
create index on public.bitbot_v10_events(user_id,id desc);
create table public.bitbot_v10_orders(
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 side text not null check(side in ('BUY','SELL')),amount numeric not null check(amount>0),
 price numeric not null check(price>0),notional numeric not null check(notional>=10),
 status text not null check(status in ('RESERVED','OPEN','UNKNOWN','FILLED','CANCELED','REJECTED')),
 exchange_id text, strategy text,reason text,settled boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index on public.bitbot_v10_orders(user_id,created_at desc);
create table bitbot_private.v10_recovery(user_id uuid primary key references auth.users(id) on delete cascade,code_hash text not null);
create table bitbot_private.v10_rate(bucket text primary key,started timestamptz not null,hits int not null);
alter table public.bitbot_v10_bots enable row level security;
alter table public.bitbot_v10_events enable row level security;
alter table public.bitbot_v10_orders enable row level security;
alter table bitbot_private.v10_recovery enable row level security;
alter table bitbot_private.v10_rate enable row level security;
revoke all on public.bitbot_v10_bots,public.bitbot_v10_events,public.bitbot_v10_orders from public,anon,authenticated;
revoke all on bitbot_private.v10_recovery,bitbot_private.v10_rate from public,anon,authenticated;
grant all on public.bitbot_v10_bots,public.bitbot_v10_events,public.bitbot_v10_orders to service_role;
grant usage,select on sequence public.bitbot_v10_events_id_seq to service_role;
create function public.bitbot_v10_rate(p_bucket text,p_limit int,p_window int) returns boolean
language plpgsql security definer set search_path='' as $$
declare v int;
begin
 insert into bitbot_private.v10_rate values(p_bucket,now(),1)
 on conflict(bucket) do update set
 hits=case when bitbot_private.v10_rate.started<now()-make_interval(secs=>p_window) then 1 else bitbot_private.v10_rate.hits+1 end,
 started=case when bitbot_private.v10_rate.started<now()-make_interval(secs=>p_window) then now() else bitbot_private.v10_rate.started end returning hits into v;
 return v<=p_limit;
end;$$;
create function public.bitbot_v10_recovery(p_uid uuid,p_hash text,p_old text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_old is null then
 insert into bitbot_private.v10_recovery values(p_uid,p_hash) on conflict(user_id) do update set code_hash=excluded.code_hash;return true;
 end if;
 update bitbot_private.v10_recovery set code_hash=p_hash where user_id=p_uid and code_hash=p_old;
 get diagnostics n=row_count;return n=1;
end;$$;
create function public.bitbot_v10_claim(p_uid uuid default null) returns setof public.bitbot_v10_bots
language sql security definer set search_path='' as $$
 update public.bitbot_v10_bots b set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds'
 where user_id in(
 select x.user_id from public.bitbot_v10_bots x where (p_uid is null or x.user_id=p_uid)
 and (x.running or exists(select 1 from public.bitbot_v10_orders o where o.user_id=x.user_id and not o.settled and o.status in ('RESERVED','OPEN','UNKNOWN')))
 and x.next_tick<=now() and (x.lease_until is null or x.lease_until<now())
 order by x.next_tick limit 10 for update skip locked)
 returning b.*;
$$;
create function public.bitbot_v10_control(p_uid uuid,p_action text,p_config jsonb default null,p_state jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('bitbot-v10-'||p_uid::text,0));
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if p_action='save' then
 if b.running or coalesce((b.state->>'qty')::numeric,0)>0 or exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled) then raise exception 'หยุดบอทและจัดการสถานะค้างก่อนเปลี่ยนเงินทุน';end if;
 if (p_config->>'budget')::numeric not between 100 and 100000 or (p_config->>'maxOrder')::numeric not between 100 and 1000 then raise exception 'วงเงินไม่ถูกต้อง';end if;
 insert into public.bitbot_v10_bots(user_id,config,state) values(p_uid,p_config,p_state)
 on conflict(user_id) do update set config=excluded.config,state=excluded.state,updated_at=now(),lease=null,lease_until=null;
 elsif p_action='start' then
 if b.user_id is null then raise exception 'ตั้งค่าวงเงินก่อนเริ่ม';end if;
 if exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled) then raise exception 'มีคำสั่งที่ยังตรวจสอบไม่เสร็จ';end if;
 update public.bitbot_v10_bots set running=true,last_error=null,next_tick=now(),updated_at=now() where user_id=p_uid;
 elsif p_action='stop' then
 update public.bitbot_v10_bots set running=false,lease=null,lease_until=null,next_tick=now(),updated_at=now() where user_id=p_uid;
 elsif p_action in ('pause','resume') then
 update public.bitbot_v10_bots set config=jsonb_set(config,'{buyPaused}',to_jsonb(p_action='pause')),updated_at=now() where user_id=p_uid;
 else raise exception 'Unknown action';end if;
 insert into public.bitbot_v10_events(user_id,kind,payload) values(p_uid,'CONTROL',jsonb_build_object('action',p_action));
 return jsonb_build_object('ok',true);
end;$$;
create function public.bitbot_v10_reserve(p_uid uuid,p_lease uuid,p_id uuid,p_order jsonb,p_state jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;cap numeric;total numeric;v numeric;v_side text;
begin
 perform pg_advisory_xact_lock(hashtextextended('bitbot-v10-'||p_uid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bitbot-live-'||p_uid::text,0));
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if not b.running or b.lease is distinct from p_lease or b.lease_until<=now() then raise exception 'บอทหยุดหรือสิทธิ์รอบหมดอายุ';end if;
 if exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled) then raise exception 'มีคำสั่งค้าง ห้ามส่งซ้ำ';end if;
 v_side=p_order->>'side';v=(p_order->>'notional')::numeric;
 if v_side not in ('BUY','SELL') or v<(case when v_side='BUY' then 100 else 10 end) or v>least((b.config->>'maxOrder')::numeric,1000) then raise exception 'เกินวงเงินคำสั่ง';end if;
 if v_side='BUY' and (b.config->>'buyPaused')::boolean then raise exception 'พักซื้ออยู่';end if;
 cap=case when v_side='BUY' then least((b.config->>'dailyBuy')::numeric,5000) else least((b.config->>'dailySell')::numeric,10000) end;
 select coalesce(sum(notional),0) into total from public.bitbot_v10_orders
 where user_id=p_uid and bitbot_v10_orders.side=v_side and status<>'REJECTED'
 and (created_at at time zone 'Asia/Bangkok')::date=(now() at time zone 'Asia/Bangkok')::date;
 if total+v>cap then raise exception 'ถึงวงเงินรายวัน';end if;
 -- Previous gateway and new bot must never place overlapping exchange orders.
 if exists(select 1 from public.bitbot_live_orders where user_id=p_uid and status in ('RESERVED','OPEN','UNKNOWN')) then raise exception 'มีออร์เดอร์จากระบบเดิมค้าง';end if;
 insert into public.bitbot_v10_orders(id,user_id,side,amount,price,notional,status,strategy,reason)
 values(p_id,p_uid,v_side,(p_order->>'amount')::numeric,(p_order->>'price')::numeric,v,'RESERVED',p_order->>'strategy',p_order->>'reason');
 update public.bitbot_v10_bots set state=p_state where user_id=p_uid;
end;$$;
create function public.bitbot_v10_finish(p_uid uuid,p_lease uuid,p_state jsonb,p_trace jsonb,p_error text default null,p_settle uuid default null,p_status text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;
begin
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if b.lease is distinct from p_lease then return false;end if;
 if p_settle is not null then
 update public.bitbot_v10_orders set settled=true,status=p_status,updated_at=now() where id=p_settle and user_id=p_uid and not settled;
 if not found then return false;end if;
 end if;
 update public.bitbot_v10_bots set state=p_state,lease=null,lease_until=null,next_tick=now()+interval '50 seconds',
 updated_at=now(),last_error=p_error,
 running=case when p_error is not null then false else running end where user_id=p_uid;
 insert into public.bitbot_v10_events(user_id,kind,payload) values(p_uid,case when p_error is null then 'CYCLE' else 'ERROR' end,jsonb_build_object('trace',p_trace,'error',p_error,'settledOrder',p_settle));
 return true;
end;$$;
CREATE OR REPLACE FUNCTION public.bitbot_reserve_live_order(p_request_id uuid, p_user_id uuid, p_side text, p_amount numeric, p_limit_price numeric, p_notional_thb numeric, p_max_order_thb numeric, p_max_daily_buy_thb numeric, p_max_daily_sell_thb numeric)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_daily numeric; v_cap numeric; v_today date;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.bitbot_live_operators WHERE user_id=p_user_id AND enabled) THEN
   RAISE EXCEPTION 'Operator not authorized';
 END IF;
 IF p_side NOT IN ('BUY','SELL') OR p_amount<=0 OR p_limit_price<=0 OR p_notional_thb<100 OR
   p_max_order_thb<=0 OR p_notional_thb>p_max_order_thb OR p_max_daily_buy_thb<=0 OR p_max_daily_sell_thb<=0 THEN
   RAISE EXCEPTION 'Order breaches risk controls';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bitbot-live-' || p_user_id::text,0));
 IF EXISTS (SELECT 1 FROM public.bitbot_live_orders WHERE user_id=p_user_id AND status IN ('RESERVED','OPEN','UNKNOWN')) THEN
   RAISE EXCEPTION 'Unresolved order exists; reconcile first';
 END IF;
 IF EXISTS(SELECT 1 FROM public.bitbot_v10_bots WHERE user_id=p_user_id AND running)
 OR EXISTS(SELECT 1 FROM public.bitbot_v10_orders WHERE user_id=p_user_id AND NOT settled) THEN
 RAISE EXCEPTION 'New Bitbot has active or unresolved orders'; END IF;
 v_cap := CASE WHEN p_side='BUY' THEN p_max_daily_buy_thb ELSE p_max_daily_sell_thb END;
 v_today := (pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date;
 SELECT COALESCE(sum(notional_thb),0) INTO v_daily FROM public.bitbot_live_orders
  WHERE user_id=p_user_id AND side=p_side AND status IN ('RESERVED','OPEN','UNKNOWN','FILLED')
  AND (created_at AT TIME ZONE 'Asia/Bangkok')::date=v_today;
 IF v_daily + p_notional_thb > v_cap THEN RAISE EXCEPTION 'Daily trading limit reached'; END IF;
 INSERT INTO public.bitbot_live_orders(request_id,user_id,side,amount,limit_price,notional_thb,status)
 VALUES(p_request_id,p_user_id,p_side,p_amount,p_limit_price,p_notional_thb,'RESERVED');
 RETURN 'RESERVED';
END;$function$;

-- One protected scheduler credential is stored in Vault. It is never returned to the browser.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'bitbot-v10-runner','Bitbot scheduler') where not exists(select 1 from vault.secrets where name='bitbot-v10-runner');
create function public.bitbot_v10_runner_allowed(p_token text) returns boolean
language sql security definer set search_path='' as $$
 select length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='bitbot-v10-runner' and decrypted_secret=p_token);
$$;
create function bitbot_private.v10_schedule() returns void
language plpgsql security definer set search_path='' as $$
declare v text;
begin
 if not exists(select 1 from public.bitbot_v10_bots where running or exists(select 1 from public.bitbot_v10_orders where not settled)) then return;end if;
 select decrypted_secret into v from vault.decrypted_secrets where name='bitbot-v10-runner';
 perform net.http_post(url:='https://lrxrigimdaedfemqheug.supabase.co/functions/v1/bitbot-v10?action=run',
 headers:=jsonb_build_object('Content-Type','application/json','x-bitbot-runner',v),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;$$;

create function public.bitbot_v10_user(p_email text) returns uuid language sql security definer set search_path='' as $$
 select id from auth.users where email=p_email limit 1;
$$;


create function public.bitbot_v10_reset(p_uid uuid,p_state jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('bitbot-v10-'||p_uid::text,0));
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if b.running or exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled) then raise exception 'มีสถานะค้าง';end if;
 insert into public.bitbot_v10_events(user_id,kind,payload) values(p_uid,'EXTERNAL_SESSION_CLOSE',jsonb_build_object('state',b.state,'note','User closed externally; final external PnL is unknown'));
 update public.bitbot_v10_bots set state=p_state,lease=null,lease_until=null,last_error=null,updated_at=now() where user_id=p_uid;
end;$$;

-- Deny all public calls to every new RPC; the Edge Function verifies the user's JWT.
do $$
declare f record;
begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'bitbot_v10_%'
 loop execute 'revoke all on function '||f.sig||' from public,anon,authenticated';execute 'grant execute on function '||f.sig||' to service_role';end loop;
end;$$;
revoke all on function bitbot_private.v10_schedule() from public,anon,authenticated;
select cron.schedule('bitbot-v10-minute','* * * * *','select bitbot_private.v10_schedule()');
commit;
