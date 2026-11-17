begin;
alter table public.bitbot_v10_bots add column evidence_consent jsonb;
create function public.bitbot_v15_start(p_uid uuid,p_expected_config jsonb,p_unvalidated boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;consent jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('bitbot-v10-'||p_uid::text,0));
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if b.user_id is null then raise exception 'ตั้งค่าวงเงินก่อนเริ่ม';end if;
 if b.running then raise exception 'บอททำงานอยู่แล้ว กรุณาอ่านสถานะล่าสุด';end if;
 if b.config is distinct from p_expected_config then raise exception 'การตั้งค่าเปลี่ยน กรุณาตรวจวงเงินและยืนยันใหม่';end if;
 if coalesce((b.state->>'halted')::boolean,false) then raise exception 'พอร์ตล็อกความเสี่ยง กรุณาตรวจสถานะ';end if;
 if exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled) then raise exception 'ตรวจคำสั่งค้างให้เสร็จก่อนเริ่ม';end if;
 if p_unvalidated is true then consent=jsonb_build_object('method','OWNER_START_ACK','allowUnvalidated',true,'at',now(),'config',b.config-'buyPaused');end if;
 update public.bitbot_v10_bots set running=true,evidence_consent=consent,close_positions=false,last_error=null,lease=null,lease_until=null,next_tick=now(),updated_at=now() where user_id=p_uid;
 insert into public.bitbot_v10_events(user_id,kind,payload) values(p_uid,'OWNER_LIVE_START',jsonb_build_object('unvalidatedAccepted',p_unvalidated,'consent',consent,'riskLimitsPreserved',true));
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.bitbot_v15_start(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.bitbot_v15_start(uuid,jsonb,boolean) to service_role;
-- No account is started or approved by this migration.
commit;
