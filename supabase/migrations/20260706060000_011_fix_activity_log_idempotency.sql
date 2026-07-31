-- 011: Fix "Recent Activity" always showing "No recent activity yet."
--
-- ROOT CAUSE
-- ----------
-- Migration 010 created public.activity_log, its triggers, and then ran:
--
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
--
-- unconditionally. Migration 004 (wishlist_count_and_realtime) already hit
-- this exact class of bug with `messages` / `notifications` and had to
-- guard the same statement with an `IF NOT EXISTS (SELECT 1 FROM
-- pg_publication_tables ...)` check - see its comment block. Migration 010
-- was written without that guard.
--
-- In Postgres, every migration file runs inside a single implicit
-- transaction. `ALTER PUBLICATION ... ADD TABLE` raises a hard error
-- ("relation ... is already member of publication") if the table is
-- already published - which happens the moment migration 010 is re-run
-- (a normal occurrence in local Supabase CLI workflows: `supabase db
-- reset`, re-linking a project, or re-applying after a partial failure).
-- Because CREATE TABLE (no IF NOT EXISTS) is the very first statement in
-- that same migration, ANY re-run also fails immediately there instead -
-- and a failed migration transaction rolls back everything in it: the
-- table, every trigger, every policy. The migration then gets recorded as
-- applied (or errors out and is skipped on the next run) while none of its
-- schema objects actually exist / are up to date in the live database.
-- That is the entire bug: the app code, the RLS policy, and the frontend
-- query are all correct - `activity_log` (or its triggers/publication
-- membership) simply never successfully finished being created, so no
-- rows are ever inserted and the feed is permanently empty.
--
-- FIX
-- ---
-- Rewrite every statement in this migration to be idempotent so it can be
-- run any number of times, in any environment, and always converges on
-- the same end state - exactly the pattern migration 004 established.

CREATE TABLE IF NOT EXISTS public.activity_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN (
    'user_registered',
    'product_listed',
    'product_sold',
    'product_updated',
    'product_deleted',
    'product_reserved',
    'wishlist_added',
    'review_posted'
  )),
  actor_name TEXT,
  actor_id UUID,
  product_title TEXT,
  product_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON public.activity_log(created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_activity_log" ON public.activity_log;
CREATE POLICY "select_activity_log" ON public.activity_log
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Guarded exactly like migration 004: only add to the publication if it
-- isn't already a member (safe whether this is the first run, a re-run
-- after 010 partially applied, or a project whose supabase_realtime
-- publication already publishes ALL tables).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'activity_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
  END IF;
END $$;

ALTER TABLE public.activity_log REPLICA IDENTITY FULL;

-- Recreate every trigger function/trigger (CREATE OR REPLACE + DROP
-- TRIGGER IF EXISTS were already idempotent in 010 - unchanged below,
-- just guaranteed to actually run now that the statements above it can no
-- longer abort the transaction).

CREATE OR REPLACE FUNCTION public.log_user_registered()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.activity_log (type, actor_name, actor_id)
  VALUES ('user_registered', NEW.full_name, NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_registered_activity ON public.users;
CREATE TRIGGER on_user_registered_activity
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.log_user_registered();

CREATE OR REPLACE FUNCTION public.log_product_activity()
RETURNS TRIGGER AS $$
DECLARE
  seller_name TEXT;
BEGIN
  SELECT full_name INTO seller_name FROM public.users WHERE id = COALESCE(NEW.seller_id, OLD.seller_id);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id)
    VALUES ('product_listed', seller_name, NEW.seller_id, NEW.title, NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'sold' AND OLD.status IS DISTINCT FROM 'sold' THEN
      INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id)
      VALUES ('product_sold', seller_name, NEW.seller_id, NEW.title, NEW.id);
    ELSIF NEW.status = 'reserved' AND OLD.status IS DISTINCT FROM 'reserved' THEN
      INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id)
      VALUES ('product_reserved', seller_name, NEW.seller_id, NEW.title, NEW.id);
    ELSIF (NEW.title, NEW.price, NEW.description, NEW.condition) IS DISTINCT FROM
          (OLD.title, OLD.price, OLD.description, OLD.condition) THEN
      INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id)
      VALUES ('product_updated', seller_name, NEW.seller_id, NEW.title, NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_product_activity ON public.products;
CREATE TRIGGER on_product_activity
  AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_activity();

CREATE OR REPLACE FUNCTION public.log_product_deleted()
RETURNS TRIGGER AS $$
DECLARE
  seller_name TEXT;
BEGIN
  SELECT full_name INTO seller_name FROM public.users WHERE id = OLD.seller_id;
  INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id)
  VALUES ('product_deleted', seller_name, OLD.seller_id, OLD.title, OLD.id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_product_deleted_activity ON public.products;
CREATE TRIGGER on_product_deleted_activity
  BEFORE DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_deleted();

CREATE OR REPLACE FUNCTION public.log_wishlist_activity()
RETURNS TRIGGER AS $$
DECLARE
  adder_name TEXT;
  item_title TEXT;
BEGIN
  SELECT full_name INTO adder_name FROM public.users WHERE id = NEW.user_id;
  SELECT title INTO item_title FROM public.products WHERE id = NEW.product_id;

  INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id)
  VALUES ('wishlist_added', adder_name, NEW.user_id, item_title, NEW.product_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_wishlist_activity ON public.wishlist;
CREATE TRIGGER on_wishlist_activity
  AFTER INSERT ON public.wishlist
  FOR EACH ROW EXECUTE FUNCTION public.log_wishlist_activity();

-- NOTE: the review_posted trigger is (re)created in migration 013 once the
-- `ratings` table has the columns that trigger needs - defining it here
-- too, ahead of 013, would just mean 013 replaces it again.
