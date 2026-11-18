-- Real backend role, synthetic credentials only; no HTTP. Roll back all fixtures.
begin;
insert into auth.users(id,aud,role,email) values('fa333333-3333-4333-8333-333333333333','authenticated','authenticated','rea-codex-role@example.invalid');
insert into rea.bot_settings(user_id,state) select 'fa333333-3333-4333-8333-333333333333',state from rea.bot_settings limit 1;
insert into rea.live_accounts(user_id,state,latest) select 'fa333333-3333-4333-8333-333333333333',state,latest from rea.live_accounts limit 1;
set local role service_role;
do $$declare u uuid='fa333333-3333-4333-8333-333333333333';r jsonb;claim jsonb;j uuid;l uuid;begin
 if not has_schema_privilege('service_role','bitbot_private','USAGE') or has_schema_privilege('authenticated','bitbot_private','USAGE') or has_schema_privilege('anon','bitbot_private','USAGE') then raise exception 'BACKEND_NAMESPACE_ACCESS_BROKEN';end if;
 r=public.rea_codex_configure(u,'sk-TEST_ONLY_BACKEND_ROLE_KEY_12345678901234567890',true,true);
 if r->>'configured'<>'true' or r::text like '%sk-TEST%' then raise exception 'BACKEND_ROLE_SAVE_FAILED';end if;
 claim=public.rea_codex_claim();j=(claim->'job'->>'id')::uuid;l=(claim->'job'->>'lease')::uuid;
 if claim->>'action'<>'CREATE' or claim->'job'->>'user_id'<>u::text then raise exception 'BACKEND_ROLE_CLAIM_FAILED';end if;
 if public.rea_codex_key(u,j,l)<>'sk-TEST_ONLY_BACKEND_ROLE_KEY_12345678901234567890' then raise exception 'BACKEND_ROLE_LOAD_FAILED';end if;
 if claim->'job'->>'question'<>'' then raise exception 'AUTOMATIC_REQUEST_REQUIRED_QUESTION';end if;
 if not public.rea_codex_checkpoint(j,l,'FAILED',null,null,'CODEX_PROVIDER_USAGE_LIMIT_EXCEEDED','{"providerError":{"code":"USAGE_LIMIT_EXCEEDED","message":"Synthetic billing error"}}') then raise exception 'BACKEND_ROLE_CHECKPOINT_FAILED';end if;
 if public.rea_codex_view(u)->>'providerBlocked'<>'CODEX_PROVIDER_USAGE_LIMIT_EXCEEDED' then raise exception 'BILLING_NOT_LATCHED';end if;
 update rea.codex_settings set last_started=now()-interval '4 hours' where user_id=u;
 if public.rea_codex_claim() is not null then raise exception 'BLOCKED_PROVIDER_AUTOMATICALLY_RETRIED';end if;
 perform public.rea_codex_request(u,'');claim=public.rea_codex_claim();j=(claim->'job'->>'id')::uuid;l=(claim->'job'->>'lease')::uuid;
 if claim->>'action'<>'CREATE' or public.rea_codex_view(u)->>'providerBlocked' is not null then raise exception 'EXPLICIT_BILLING_RECOVERY_FAILED';end if;
 perform public.rea_codex_checkpoint(j,l,'COMPLETED','sess_SQL_TEST_ONLY','{"provider":"OPENAI_CODEX_MANAGED_AGENT","canTrade":false,"canChangeLimits":false}');
 if public.rea_codex_claim() is not null then raise exception 'STABLE_PORTFOLIO_RETRIED';end if;
 update rea.codex_settings set last_started=now()-interval '16 minutes' where user_id=u;
 update rea.live_accounts set state=jsonb_set(state,'{buyPaused}','true') where user_id=u;
 claim=public.rea_codex_claim();j=(claim->'job'->>'id')::uuid;l=(claim->'job'->>'lease')::uuid;
 if claim->>'action'<>'CREATE' or claim->'job'->>'question'<>'' then raise exception 'PORTFOLIO_EVENT_NOT_AUTOMATIC';end if;
 perform public.rea_codex_checkpoint(j,l,'FAILED','sess_SQL_DIAG_ONLY',null,'CODEX_TURN_FAILED');
 claim=public.rea_codex_claim();l=(claim->'job'->>'lease')::uuid;
 if claim->>'action'<>'DIAGNOSE' then raise exception 'FAILED_SESSION_DIAGNOSIS_MISSING';end if;
 if public.rea_codex_key(u,j,l) is null then raise exception 'DIAGNOSIS_KEY_NOT_LEASED';end if;
 perform public.rea_codex_checkpoint(j,l,'FAILED','sess_SQL_DIAG_ONLY',null,'CODEX_PROVIDER_USAGE_LIMIT_EXCEEDED');
 if (public.rea_codex_view(u)->>'dailyCalls')::integer<>3 then raise exception 'DIAGNOSIS_SPENT_AN_INFERENCE';end if;

end$$;
reset role;
rollback;
select 'CODEX_REAL_BACKEND_ROLE_SAVE_LOAD_CHECKPOINT_PASSED_ROLLED_BACK' as result;
