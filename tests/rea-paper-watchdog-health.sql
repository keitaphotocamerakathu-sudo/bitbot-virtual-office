-- Read-only regression checks. They never call a scheduler or change an account.
do $$
declare r record; actual jsonb; payload jsonb;
begin
 for r in select * from (values
  (null::bigint,'OK','[]'::jsonb,'["STALE"]'::jsonb),
  (819999,'OK','[]','["STALE"]'),(1005001,'IDLE','[]','["STALE"]'),
  (820000,'OK','[]','[]'),(1005000,'IDLE','[]','[]'),(999000,'OK','[]','[]'),
  (999000,'SAFE_MODE','["MIDNIGHT_BASELINE_UNVERIFIED"]','["MIDNIGHT_BASELINE_UNVERIFIED"]'),
  (999000,'SAFE_MODE','[]','["DEGRADED"]'),(999000,null,'[]','["DEGRADED"]'),
  (700000,'SAFE_MODE','["MIDNIGHT_BASELINE_UNVERIFIED"]','["STALE"]')
 ) cases(at_ms,status,causes,expected) loop
  actual=rea.paper_heartbeat_reasons(1000000,r.at_ms,180000,r.status,array['OK','IDLE'],'STALE','DEGRADED',r.causes);
  if actual is distinct from r.expected then raise exception 'HEARTBEAT_CASE_FAILED %',r;end if;
 end loop;
 payload='[{"symbol":"ETH_THB","highest_bid":"99","lowest_ask":"101","last":"100"},
   {"symbol":"BAD_THB","highest_bid":"102","lowest_ask":"100","last":"101"},
   {"symbol":"DUP_THB","highest_bid":"1","lowest_ask":"2","last":"1"},
   {"symbol":"DUP_THB","highest_bid":"1","lowest_ask":"2","last":"1"},
   {"symbol":"NAN_THB","highest_bid":"NaN","lowest_ask":"2","last":"1"},
   {"symbol":"OTHER_THB","highest_bid":"1","lowest_ask":"2","last":"1"}]';
 if rea.paper_boundary_quotes(payload,array['ETH_THB','BAD_THB','DUP_THB','NAN_THB'])<>'{"ETH_THB":{"bid":99,"ask":101,"last":100}}'::jsonb
   or rea.paper_boundary_quotes('{}',array['ETH_THB'])<>'{}'::jsonb then raise exception 'BOUNDARY_QUOTES_FAILED';end if;
 if has_function_privilege('authenticated','public.rea_risk_observation(uuid,bigint,text,jsonb)','EXECUTE')
   or has_function_privilege('service_role','rea.paper_request_boundary()','EXECUTE')
   or has_table_privilege('anon','rea.paper_boundary_inventories','SELECT')
   or has_table_privilege('service_role','rea.paper_boundary_requests','UPDATE')
   then raise exception 'PAPER_MONITOR_PRIVILEGES'; end if;
end $$;
