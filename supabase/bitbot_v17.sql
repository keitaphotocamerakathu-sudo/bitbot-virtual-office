begin;
-- Only an explicit owner request can change the data used by a running real account.
-- Installation changes no bot settings, balances, holdings, pause flags or orders.
create or replace function public.bitbot_v17_data_upgrade(p_uid uuid,p_expected_config jsonb,p_ack boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bitbot_v10_bots%rowtype;c jsonb;consent jsonb;
begin
 if p_ack is not true then raise exception 'กรุณายืนยันการใช้ระบบข้อมูลใหม่';end if;
 perform pg_advisory_xact_lock(hashtextextended('bitbot-v10-'||p_uid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bitbot-live-'||p_uid::text,0));
 select * into b from public.bitbot_v10_bots where user_id=p_uid for update;
 if b.user_id is null then raise exception 'ตั้งค่าบัญชีก่อนอัปเดต';end if;
 if b.config is distinct from p_expected_config then raise exception 'การตั้งค่าเปลี่ยน กรุณาอ่านสถานะล่าสุดและยืนยันใหม่';end if;
 if coalesce((b.state->>'qty')::numeric,0)>0 or coalesce((b.state->>'halted')::boolean,false) then raise exception 'ยังมีสถานะหรือล็อกความเสี่ยง กรุณาตรวจสถานะ';end if;
 if exists(select 1 from public.bitbot_v10_orders where user_id=p_uid and not settled)
 or exists(select 1 from public.bitbot_live_orders where user_id=p_uid and status in('RESERVED','OPEN','UNKNOWN')) then raise exception 'มีคำสั่งที่ยังตรวจผลไม่เสร็จ';end if;
 if b.config->>'marketDataPolicy'='verified-v17' then raise exception 'ใช้ระบบข้อมูลใหม่อยู่แล้ว';end if;
 c=b.config||jsonb_build_object('marketDataPolicy','verified-v17');
 if b.running then consent=jsonb_build_object('method','OWNER_START_ACK','allowUnvalidated',true,'at',now(),'config',c-'buyPaused');end if;
 update public.bitbot_v10_bots set config=c,evidence_consent=consent,lease=null,lease_until=null,next_tick=now(),updated_at=now() where user_id=p_uid;
 insert into public.bitbot_v10_events(user_id,kind,payload) values(p_uid,'DATA_PIPELINE_UPGRADED',jsonb_build_object('policy','verified-v17','ownerConfirmed',true,'running',b.running,'riskLimitsPreserved',true));
 return jsonb_build_object('updated',true,'running',b.running);
end;$$;
revoke all on function public.bitbot_v17_data_upgrade(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.bitbot_v17_data_upgrade(uuid,jsonb,boolean) to service_role;
commit;
