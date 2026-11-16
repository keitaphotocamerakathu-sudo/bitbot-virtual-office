begin;
alter table public.bitbot_v10_orders drop constraint bitbot_v10_orders_notional_check;
alter table public.bitbot_v10_orders add constraint bitbot_v10_orders_notional_check check(notional>=10);
create or replace function public.bitbot_v10_reserve(p_uid uuid,p_lease uuid,p_id uuid,p_order jsonb,p_state jsonb) returns void
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

commit;