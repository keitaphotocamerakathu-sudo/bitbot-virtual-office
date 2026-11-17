-- Nonpersistent integrity checks on the dedicated REA schema. Rolls back all test data.
begin;
do $$declare b rea.bot_settings%rowtype;v boolean;begin
 update rea.bot_settings set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds' where user_id=(select user_id from rea.bot_settings limit 1) returning * into b;
 if b.user_id is null then raise exception 'INITIALIZE_PAPER_ACCOUNT_FIRST';end if;
 v=public.rea_checkpoint(b.user_id,b.lease,b.revision,b.state,'{"quotes":[],"health":"TEST"}','[]','[]','[]',extract(epoch from now())::bigint*1000,null);
 if not v then raise exception 'CHECKPOINT_NOT_SAVED';end if;
 if public.rea_checkpoint(b.user_id,b.lease,b.revision,b.state,'{"quotes":[]}','[]','[]','[]',extract(epoch from now())::bigint*1000,null) then raise exception 'DUPLICATE_CHECKPOINT';end if;
 if has_function_privilege('anon','public.rea_control(uuid,text)','EXECUTE') then raise exception 'ANON_CONTROL';end if;
 if has_function_privilege('authenticated','public.rea_claim(uuid)','EXECUTE') then raise exception 'USER_CLAIM';end if;
 if has_schema_privilege('authenticated','rea','USAGE') then raise exception 'SCHEMA_EXPOSED';end if;
 update rea.bot_settings set next_tick=now(),lease=null,lease_until=null where user_id=b.user_id;
 select * into b from public.rea_claim(b.user_id);
 if b.lease is null then raise exception 'CLAIM_FAILED';end if;
 if (select count(*) from public.rea_claim(b.user_id))<>0 then raise exception 'DUPLICATE_EXECUTOR';end if;
 perform public.rea_control(b.user_id,'pause');
 if public.rea_checkpoint(b.user_id,b.lease,b.revision,b.state,'{"quotes":[]}','[]','[]','[]',extract(epoch from now())::bigint*1000,null) then raise exception 'CONTROL_OVERWRITTEN';end if;
 perform public.rea_control(b.user_id,'emergency');perform public.rea_control(b.user_id,'resume');
 if (select state->>'kill' from rea.bot_settings where user_id=b.user_id)<>'ALL' then raise exception 'RESUME_CLEARED_EMERGENCY';end if;
 perform public.rea_control(b.user_id,'stop-entry');
 if (select state->>'kill' from rea.bot_settings where user_id=b.user_id)<>'ALL' then raise exception 'ENTRY_STOP_CLEARED_EMERGENCY';end if;
 perform public.rea_control(b.user_id,'clear-emergency');perform public.rea_control(b.user_id,'stop-entry');perform public.rea_control(b.user_id,'resume');
 if (select state->>'kill' from rea.bot_settings where user_id=b.user_id)<>'NONE' then raise exception 'ENTRY_STOP_NOT_RESUMED';end if;
end$$;
rollback;
