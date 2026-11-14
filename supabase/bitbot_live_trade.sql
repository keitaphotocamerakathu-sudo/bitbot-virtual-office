-- Dedicated Bitbot project lrxrigimdaedfemqheug ONLY. No existing RESTART/cooperative tables.
BEGIN;
CREATE TABLE IF NOT EXISTS public.bitbot_live_operators (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bitbot_live_operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bitbot_live_operators FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.bitbot_live_orders (
  request_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('BUY','SELL')),
  symbol text NOT NULL DEFAULT 'BTC_THB' CHECK(symbol='BTC_THB'),
  amount numeric(20,8) NOT NULL CHECK (amount>0),
  limit_price numeric(20,2) NOT NULL CHECK(limit_price>0),
  notional_thb numeric(20,2) NOT NULL CHECK(notional_thb>0),
  status text NOT NULL CHECK(status IN ('RESERVED','OPEN','FILLED','CANCELED','REJECTED','UNKNOWN')),
  exchange_order_id text,
  exchange_status text,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bitbot_live_orders_owner_time ON public.bitbot_live_orders (user_id, created_at DESC);
ALTER TABLE public.bitbot_live_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bitbot_live_orders FROM anon, authenticated;
GRANT SELECT ON public.bitbot_live_orders TO authenticated;
CREATE POLICY bitbot_live_own_read ON public.bitbot_live_orders FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Atomic per-user reservation avoids simultaneous requests exceeding daily caps.
-- EXECUTE is granted exclusively to the service role, never public clients.
CREATE OR REPLACE FUNCTION public.bitbot_reserve_live_order(
  p_request_id uuid, p_user_id uuid, p_side text,
  p_amount numeric, p_limit_price numeric, p_notional_thb numeric,
  p_max_order_thb numeric, p_max_daily_buy_thb numeric, p_max_daily_sell_thb numeric
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_daily numeric; v_cap numeric; v_today date;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.bitbot_live_operators WHERE user_id=p_user_id AND enabled) THEN
   RAISE EXCEPTION 'Operator not authorized';
 END IF;
 IF p_side NOT IN ('BUY','SELL') OR p_amount<=0 OR p_limit_price<=0 OR p_notional_thb<100 OR
   p_max_order_thb<=0 OR p_notional_thb>p_max_order_thb OR p_max_daily_buy_thb<=0 OR p_max_daily_sell_thb<=0 THEN
   RAISE EXCEPTION 'Order breaches risk controls';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bitbot-live-' || p_user_id::text,0));
 IF EXISTS (SELECT 1 FROM public.bitbot_live_orders WHERE user_id=p_user_id AND status IN ('RESERVED','OPEN','UNKNOWN')) THEN
   RAISE EXCEPTION 'Unresolved order exists; reconcile first';
 END IF;
 v_cap := CASE WHEN p_side='BUY' THEN p_max_daily_buy_thb ELSE p_max_daily_sell_thb END;
 v_today := (pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date;
 SELECT COALESCE(sum(notional_thb),0) INTO v_daily FROM public.bitbot_live_orders
  WHERE user_id=p_user_id AND side=p_side AND status IN ('RESERVED','OPEN','UNKNOWN','FILLED')
  AND (created_at AT TIME ZONE 'Asia/Bangkok')::date=v_today;
 IF v_daily + p_notional_thb > v_cap THEN RAISE EXCEPTION 'Daily trading limit reached'; END IF;
 INSERT INTO public.bitbot_live_orders(request_id,user_id,side,amount,limit_price,notional_thb,status)
 VALUES(p_request_id,p_user_id,p_side,p_amount,p_limit_price,p_notional_thb,'RESERVED');
 RETURN 'RESERVED';
END;$$;
REVOKE ALL ON FUNCTION public.bitbot_reserve_live_order(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bitbot_reserve_live_order(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,numeric) TO service_role;
COMMIT;