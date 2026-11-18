-- Internal Vault helpers need schema USAGE as well as function EXECUTE.
-- Only the authenticated backend role can resolve this private namespace.
begin;
grant usage on schema bitbot_private to service_role;
commit;
