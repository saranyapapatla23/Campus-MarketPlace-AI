-- 010: Real "Recent Activity" feed, replacing the hardcoded static strings
-- on the Home page.
--
-- Design: a single append-only, denormalized activity_log table rather
-- than trying to derive "recent activity" by querying products/users/
-- wishlist/ratings separately and merging results at read time. Reasons:
--   - One indexed table, one query, one ORDER BY created_at DESC LIMIT N -
--     cheap to read on every Home page load, which is the hot path here.
--   - Denormalized actor_name/product_title snapshots mean history survives
--     a user or product being deleted later (no FK-join breakage, no
--     "Unknown User sold Unknown Product" once the row is gone) - this is
--     also why product_id/actor_id are NOT foreign keys, just plain
--     reference columns for optional linking.
--   - Populated entirely by triggers (SECURITY DEFINER), so no page of
--     application code has to remember to log anything - it happens at
--     the database layer wherever the underlying event actually occurs.

CREATE TABLE public.activity_log (
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

CREATE INDEX idx_activity_log_created_at ON public.activity_log(created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- The feed is meant to be public site activity, visible on the public Home
-- page to guests and signed-in users alike.
CREATE POLICY "select_activity_log" ON public.activity_log
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy is granted to anon/authenticated at all -
-- every row is written exclusively by the SECURITY DEFINER trigger
-- functions below, which run with elevated privilege and bypass RLS.
-- Nothing in the client can write directly to this table.

-- Live updates on Home page
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
ALTER TABLE public.activity_log REPLICA IDENTITY FULL;

-- 1. New user registered
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

-- 2. Product listed / sold / reserved / updated (all via one trigger on
-- products, since they all hinge on distinguishing INSERT vs which field
-- changed on UPDATE)
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
      -- A meaningful field changed outside of a status transition - log it
      -- as a generic update rather than double-logging alongside sold/
      -- reserved above.
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

-- 3. Product deleted - must run BEFORE DELETE so OLD.title is still
-- readable, and must not depend on the row (or its seller) still existing
-- afterwards.
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

-- 4. Wishlist item added
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

-- 5. Review posted
CREATE OR REPLACE FUNCTION public.log_review_activity()
RETURNS TRIGGER AS $$
DECLARE
  rater_name TEXT;
BEGIN
  SELECT full_name INTO rater_name FROM public.users WHERE id = NEW.rater_id;
  INSERT INTO public.activity_log (type, actor_name, actor_id)
  VALUES ('review_posted', rater_name, NEW.rater_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_review_activity ON public.ratings;
CREATE TRIGGER on_review_activity
  AFTER INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.log_review_activity();
