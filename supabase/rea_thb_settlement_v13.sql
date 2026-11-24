-- Administrative, proof-bound maintenance. No HTTP, secrets or order dispatch.
-- Future fills are settled by rea-thb-settlement.mjs. This repairs complete legacy
-- books once, only when every satang is explained by recorded exchange fills and
-- the reconstructed balance exactly matches a fresh Bitkub wallet snapshot.
begin;
create or replace function rea.repair_thb_settlement_v30(p_uid uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a rea.live_accounts%rowtype;s jsonb;f jsonb;o jsonb;v jsonb;k text;c jsonb;
 corrections jsonb='[]';next_fills jsonb='[]';next_closed jsonb='[]';next_positions jsonb='[]';next_days jsonb='{}';
 delta numeric=0;d numeric;gross numeric;legacy numeric;settled numeric;rebuilt numeric;buy_total numeric;sell_total numeric=0;
 prior_delta numeric;day_delta numeric;end_delta numeric;wallet_total numeric;day_key text;t bigint=floor(extract(epoch from now())*1000);n integer=0;curve_rows integer;new_peak numeric;new_drawdown numeric;
begin
 select * into a from rea.live_accounts where user_id=p_uid for update;
 if not found or a.state is null or a.state->>'accounting' is distinct from 'EXCHANGE_RECEIPTS' then raise exception 'LIVE_RECEIPT_LEDGER_REQUIRED';end if;
 if a.state->'thbSettlementRepair'->>'protocol'='BITKUB-THB-SETTLEMENT-30.0' then return jsonb_build_object('status','ALREADY_REPAIRED','repair',a.state->'thbSettlementRepair');end if;
 s=a.state;
 if not coalesce((a.preflight->>'ok')::boolean,false) or jsonb_typeof(a.preflight->'wallet'->'at') is distinct from 'number' or not ((a.preflight->'wallet'->>'at')::bigint between t-20000 and t+5000) then raise exception 'FRESH_EXCHANGE_WALLET_REQUIRED';end if;
 if a.approval->>'keyFingerprint' is distinct from a.preflight->>'keyFingerprint' then raise exception 'APPROVED_KEY_MISMATCH';end if;
 if exists(select 1 from jsonb_array_elements(s->'orders')x where x->>'status' in('RESERVED','SUBMITTING','OPEN','PARTIAL','CANCEL_PENDING','UNKNOWN')) then raise exception 'UNSETTLED_ORDERS_REPAIR_BLOCKED';end if;
 if jsonb_typeof(s->'fills') is distinct from 'array' or jsonb_array_length(s->'fills')=0 or (select count(distinct x->>'id') from jsonb_array_elements(s->'fills')x)<>jsonb_array_length(s->'fills') then raise exception 'COMPLETE_UNIQUE_RECEIPTS_REQUIRED';end if;
 if (select count(*) from rea.live_fills where user_id=p_uid)<>jsonb_array_length(s->'fills') then raise exception 'COMPLETE_ARCHIVED_RECEIPTS_REQUIRED';end if;
 for f in select value from jsonb_array_elements(s->'fills') loop
  select value into o from jsonb_array_elements(s->'orders') where value->>'id'=f->>'orderId';
  if o is null or o->>'symbol' is distinct from f->>'symbol' or o->>'side' is distinct from f->>'side' or f->>'simulation' is distinct from 'false' or not exists(select 1 from rea.live_fills where user_id=p_uid and txn_id=f->>'id' and payload=f) then raise exception 'RECEIPT_ARCHIVE_MISMATCH';end if;
  if not coalesce((f->>'qty')::numeric>0 and (f->>'price')::numeric>0 and (f->>'fee')::numeric>=0,false) then raise exception 'INVALID_SETTLEMENT_RECEIPT';end if;
  if f->>'side'='SELL' then
   gross=(f->>'qty')::numeric*(f->>'price')::numeric-(f->>'fee')::numeric;
   legacy=round(gross,2);settled=floor(gross*100)/100;
   if f->'settlement'->>'protocol'='BITKUB-THB-SETTLEMENT-30.0' then legacy=(f->'settlement'->>'cashDeltaTHB')::numeric;if legacy<>settled then raise exception 'MODERN_SETTLEMENT_MISMATCH';end if;end if;
   d=settled-legacy;if d not in(0,-.01) then raise exception 'UNEXPLAINED_SETTLEMENT_DIFFERENCE';end if;
   if coalesce(o->>'positionId','')='' then raise exception 'SELL_POSITION_BASIS_REQUIRED';end if;
   delta=delta+d;sell_total=sell_total+legacy;n=n+1;
   c=jsonb_build_object('txnId',f->'id','orderId',f->'orderId','positionId',o->'positionId','at',f->'at','day',to_char(to_timestamp((f->>'at')::double precision/1000) at time zone 'Asia/Bangkok','YYYY-MM-DD'),'legacyProceedsTHB',legacy,'settledProceedsTHB',settled,'deltaTHB',d);
   corrections=corrections||jsonb_build_array(c);
   if f->'settlement'->>'protocol' is distinct from 'BITKUB-THB-SETTLEMENT-30.0' then
    f=f||jsonb_build_object('realized',(f->>'realized')::numeric+d,'settlement',jsonb_build_object('protocol','BITKUB-THB-SETTLEMENT-30.0','cashDeltaTHB',settled,'legacyRealized',f->'realized','legacyProceedsTHB',legacy,'source','ARCHIVED_RECEIPT_RECONCILIATION'));
   end if;
  end if;
  next_fills=next_fills||jsonb_build_array(f);
 end loop;
 if n=0 then raise exception 'NO_SELL_RECEIPTS_TO_REPAIR';end if;
 for o in select value from jsonb_array_elements(s->'orders') where coalesce((value->>'executed')::numeric,0)>0 loop
  if o->>'side'='SELL' and abs((o->>'executed')::numeric-(select coalesce(sum((x->>'qty')::numeric),0) from jsonb_array_elements(s->'fills')x where x->>'orderId'=o->>'id'))>.00000001 then raise exception 'SELL_RECEIPTS_INCOMPLETE';end if;
  if o->>'side'='BUY' and abs((o->>'executed')::numeric-(select coalesce(sum((x->>'qty')::numeric*(x->>'price')::numeric+(x->>'fee')::numeric),0) from jsonb_array_elements(s->'fills')x where x->>'orderId'=o->>'id'))>.01 then raise exception 'BUY_RECEIPTS_INCOMPLETE';end if;
 end loop;
 select coalesce(sum((x->>'executed')::numeric),0) into buy_total from jsonb_array_elements(s->'orders')x where x->>'side'='BUY';
 rebuilt=(s->>'allocatedCapital')::numeric-buy_total+sell_total;
 if rebuilt is distinct from (s->>'cash')::numeric then raise exception 'LEGACY_CASH_REPLAY_MISMATCH';end if;
 wallet_total=(a.preflight->'wallet'->'THB'->>'available')::numeric+(a.preflight->'wallet'->'THB'->>'reserved')::numeric;
 if wallet_total is null or wallet_total<0 or rebuilt+delta is distinct from wallet_total then raise exception 'REPAIR_DOES_NOT_EXPLAIN_EXCHANGE_WALLET';end if;
 for v in select value from jsonb_array_elements(s->'positions') loop
  k=replace(v->>'symbol','_THB','');
  if coalesce((a.preflight->'wallet'->k->>'available')::numeric+(a.preflight->'wallet'->k->>'reserved')::numeric,-1)+.00000001<(v->>'qty')::numeric then raise exception 'ASSET_SHORTFALL_REPAIR_BLOCKED';end if;
  select coalesce(sum((x->>'deltaTHB')::numeric),0) into d from jsonb_array_elements(corrections)x where x->>'positionId'=v->>'positionId';
  next_positions=next_positions||jsonb_build_array(v||jsonb_build_object('realized',coalesce((v->>'realized')::numeric,0)+d));
 end loop;
 for v in select value from jsonb_array_elements(s->'closed') loop
  select coalesce(sum((x->>'deltaTHB')::numeric),0) into d from jsonb_array_elements(corrections)x where x->>'positionId'=v->>'id';
  next_closed=next_closed||jsonb_build_array(v||jsonb_build_object('pnl',(v->>'pnl')::numeric+d));
 end loop;
 for k,v in select key,value from jsonb_each(s->'days') loop
  select coalesce(sum((x->>'deltaTHB')::numeric) filter(where x->>'day'<k),0),coalesce(sum((x->>'deltaTHB')::numeric) filter(where x->>'day'=k),0) into prior_delta,day_delta from jsonb_array_elements(corrections)x;
  next_days=next_days||jsonb_build_object(k,v||jsonb_build_object('start',(v->>'start')::numeric+prior_delta,'equity',(v->>'equity')::numeric+prior_delta+day_delta,'pnl',(v->>'pnl')::numeric+day_delta));
 end loop;
 day_key=s->>'day';select coalesce(sum((x->>'deltaTHB')::numeric),0) into prior_delta from jsonb_array_elements(corrections)x where x->>'day'<day_key;
 s=s||jsonb_build_object('cash',rebuilt+delta,'equity',(s->>'equity')::numeric+delta,'realized',(s->>'realized')::numeric+delta,'dayStart',(s->>'dayStart')::numeric+prior_delta,'fills',next_fills,'closed',next_closed,'positions',next_positions,'days',next_days,'thbSettlementRepair',jsonb_build_object('protocol','BITKUB-THB-SETTLEMENT-30.0','at',t,'deltaTHB',delta,'sellReceipts',n,'cashBeforeTHB',a.state->'cash','cashAfterTHB',rebuilt+delta,'walletAt',a.preflight->'wallet'->'at'));
 s=jsonb_set(s,'{dayPnl}',to_jsonb(round((s->>'equity')::numeric-(s->>'dayStart')::numeric-(s->>'dayFlows')::numeric,2)));
 -- The old book and old lesson reports remain recoverable in this private audit.
 insert into rea.audit_logs(user_id,action,payload) values(p_uid,'THB_SETTLEMENT_RECONCILED',jsonb_build_object('protocol','BITKUB-THB-SETTLEMENT-30.0','beforeState',a.state,'beforeLessons',(select coalesce(jsonb_agg(payload),'[]') from rea.trade_lessons where user_id=p_uid),'corrections',corrections,'repair',s->'thbSettlementRepair','source','https://support.bitkub.com/en/solutions/articles?id=151000199019'));
 update rea.live_fills d set payload=x.value from jsonb_array_elements(next_fills)x where d.user_id=p_uid and d.txn_id=x.value->>'id';
 update rea.live_equity e set equity=e.equity+(select coalesce(sum((x->>'deltaTHB')::numeric),0) from jsonb_array_elements(corrections)x where (x->>'at')::bigint<=e.at_ms),pnl=e.pnl+(select coalesce(sum((x->>'deltaTHB')::numeric),0) from jsonb_array_elements(corrections)x where (x->>'at')::bigint<=e.at_ms and x->>'day'=e.day) where e.user_id=p_uid;
 get diagnostics curve_rows=row_count;
 select greatest((s->>'allocatedCapital')::numeric,coalesce(max(equity),0)),coalesce(max(1-equity/peak),0) into new_peak,new_drawdown from(select equity,greatest((s->>'allocatedCapital')::numeric,max(equity) over(order by at_ms)) peak from rea.live_equity where user_id=p_uid)x;
 s=s||jsonb_build_object('peak',greatest(new_peak,(s->>'equity')::numeric),'maxDrawdown',greatest(new_drawdown,1-(s->>'equity')::numeric/greatest(new_peak,(s->>'equity')::numeric)));
 update rea.trade_lessons l set payload=jsonb_set(jsonb_set(l.payload,'{netPnL}',c.value->'pnl'),'{metrics,roundingDifference}',to_jsonb(coalesce((l.payload->'metrics'->>'roundingDifference')::numeric,0)+(c.value->>'pnl')::numeric-(l.payload->>'netPnL')::numeric))||jsonb_build_object('settlementCorrection',s->'thbSettlementRepair') from jsonb_array_elements(next_closed)c where l.user_id=p_uid and l.position_id::text=c.value->>'id';
 -- Invalidating the executor revision prevents any in-flight old snapshot from
 -- overwriting the corrected book. Control flags and real stops remain identical.
 update rea.live_accounts set state=s,latest=(latest-array['summary','learning','capitalAdvice','lossDiagnostics','profitReview'])||jsonb_build_object('health','SAFE_MODE','reason','SETTLEMENT_REPAIR_RECHECK_PENDING'),revision=revision+1,lease=null,lease_until=null,next_tick=now(),updated_at=now() where user_id=p_uid;
 return jsonb_build_object('status','REPAIRED','repair',s->'thbSettlementRepair','curveRows',curve_rows);
end;
$$;
revoke all on function rea.repair_thb_settlement_v30(uuid) from public,anon,authenticated,service_role;
commit;
