-- Deploy ONLY into a NEW dedicated Bitbot Supabase project, not into RESTART or Cooperative.
-- Private per-user PAPER memory. Never includes Bitkub API keys or live orders.
-- Require Supabase Auth; anon has no privileges. RLS must not be disabled.
BEGIN;
CREATE TABLE IF NOT EXISTS public.bitbot_paper_runs (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_id text NOT NULL CHECK (char_length(local_id) BETWEEN 1 AND 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND payload->>'id'=local_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,local_id)
);
CREATE TABLE IF NOT EXISTS public.bitbot_paper_journal (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_id text NOT NULL CHECK (char_length(local_id) BETWEEN 1 AND 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND payload->>'id'=local_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,local_id)
);
CREATE TABLE IF NOT EXISTS public.bitbot_paper_lessons (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_id text NOT NULL CHECK (char_length(local_id) BETWEEN 1 AND 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND payload->>'id'=local_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,local_id)
);
ALTER TABLE public.bitbot_paper_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitbot_paper_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitbot_paper_lessons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bitbot_paper_runs,public.bitbot_paper_journal,public.bitbot_paper_lessons FROM anon;
GRANT SELECT,INSERT,UPDATE ON TABLE public.bitbot_paper_runs,public.bitbot_paper_journal,public.bitbot_paper_lessons TO authenticated;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['bitbot_paper_runs','bitbot_paper_journal','bitbot_paper_lessons'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS bitbot_owner_select ON public.%I',tab);
    EXECUTE format('DROP POLICY IF EXISTS bitbot_owner_insert ON public.%I',tab);
    EXECUTE format('DROP POLICY IF EXISTS bitbot_owner_update ON public.%I',tab);
    EXECUTE format('CREATE POLICY bitbot_owner_select ON public.%I FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id)',tab);
    EXECUTE format('CREATE POLICY bitbot_owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id)',tab);
    EXECUTE format('CREATE POLICY bitbot_owner_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id)',tab);
  END LOOP;
END $$;
COMMIT;
-- RLS test checklist: anon SELECT/INSERT denied; authenticated A can only select/upsert A,
-- can neither read nor UPDATE B, user_id cannot be reassigned. Test on dedicated project.