-- Real backend role, synthetic credentials only; no HTTP. Roll back all fixtures.
begin;
insert into auth.users(id,aud,role,email) values('fa333333-3333-4333-8333-333333333333','authenticated','authenticated','rea-codex-role@example.invalid');
insert into rea.bot_settings(user_id,state) select 'fa333333-3333-4333-8333-333333333333',state from rea.bot_settings limit 1;
insert into rea.live_accounts(user_id,state,latest) select 'fa333333-3333-4333-8333-333333333333',state,latest from rea.live_accounts limit 1;
set local role service_role;
do $$declare u uuid='fa333333-3333-4333-8333-333333333333';r jsonb;claim jsonb;j uuid;l uuid;begin
 if not has_schema_privilege('service_role','bitbot_private','USAGE') or has_schema_privilege('authenticated','bitbot_private','USAGE') or has_schema_privilege('anon','bitbot_private','USAGE') then raise exception 'BACKEND_NAMESPACE_ACCESS_BROKEN';end if;
 r=public.rea_codex_configure(u,'sk-TEST_ONLY_BACKEND_ROLE_KEY_12345678901234567890',false,true);
 if r->>'configured'<>'true' or r::text like '%sk-TEST%' then raise exception 'BACKEND_ROLE_SAVE_FAILED';end if;
 perform public.rea_codex_request(u,'ตรวจสิทธิ์ Backend ด้วยข้อมูลทดสอบ');claim=public.rea_codex_claim();j=(claim->'job'->>'id')::uuid;l=(claim->'job'->>'lease')::uuid;
 if claim->>'action'<>'CREATE' or claim->'job'->>'user_id'<>u::text then raise exception 'BACKEND_ROLE_CLAIM_FAILED';end if;
 if public.rea_codex_key(u,j,l)<>'sk-TEST_ONLY_BACKEND_ROLE_KEY_12345678901234567890' then raise exception 'BACKEND_ROLE_LOAD_FAILED';end if;
 if not public.rea_codex_checkpoint(j,l,'FAILED',null,null,'SYNTHETIC_ROLLBACK_TEST') then raise exception 'BACKEND_ROLE_CHECKPOINT_FAILED';end if;
end$$;
reset role;
rollback;
select 'CODEX_REAL_BACKEND_ROLE_SAVE_LOAD_CHECKPOINT_PASSED_ROLLED_BACK' as result;
