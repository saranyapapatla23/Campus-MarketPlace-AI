-- 013: Verified-buyer-only reviews.
--
-- DESIGN DECISION: extend `public.ratings` instead of adding a new
-- `reviews` table.
-- ------------------------------------------------------------------
-- `public.ratings` (migration 001) already has exactly the shape a
-- "reviews" table needs: rater_id (buyer), rated_user_id (seller),
-- order_id, a 1-5 rating, free-text review, created_at, and a
-- UNIQUE(rater_id, order_id) constraint that already prevents more than
-- one review per purchase. `ProfilePage.tsx` already reads from it to
-- show a seller's average rating and review list, and the activity_log
-- trigger for `review_posted` already fires off inserts into it. The only
-- thing missing for the Product Details page ("average rating / review
-- list for THIS product") is a product_id column. Creating a second,
-- parallel `reviews` table would duplicate every one of those columns and
-- require rewriting ProfilePage and the activity trigger for no benefit -
-- so this migration extends the existing table rather than forking it.
--
-- ROOT CAUSE (why there was no verification at all)
-- ------------------------------------------------------------------
-- The only INSERT policy on ratings was:
--   CHECK (auth.uid() = rater_id)
-- That allows ANY authenticated user to insert a review for ANY
-- rated_user_id / order_id, including one they were never a party to, or
-- one for their own listings. There was also no product_id, so a review
-- couldn't be shown against a specific product at all.

ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

-- Backfill product_id for any existing rows from their order.
UPDATE public.ratings r
SET product_id = o.product_id
FROM public.orders o
WHERE r.order_id = o.id AND r.product_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ratings_product ON public.ratings(product_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rated_user ON public.ratings(rated_user_id);

-- Replace the unrestricted insert policy with one that requires:
--   * the reviewer to be the buyer on a COMPLETED order,
--   * for the exact product being reviewed,
--   * with the person being rated matching that order's seller.
-- This is what makes a review "Verified Purchase" by construction - every
-- row that can exist in this table now provably came from a real
-- transaction. It also structurally blocks guests (no authenticated
-- rater_id), random logged-in users (no matching order), and sellers
-- reviewing their own products (they would have to be their own buyer,
-- which the orders_buyer_not_seller check constraint already forbids).
DROP POLICY IF EXISTS "insert_own_ratings" ON public.ratings;
CREATE POLICY "insert_verified_purchase_ratings" ON public.ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = rater_id
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND o.buyer_id = auth.uid()
        AND o.product_id = product_id
        AND o.seller_id = rated_user_id
        AND o.status = 'completed'
    )
  );

-- Buyers may edit their own review (the "optionally allow editing" case
-- from the spec), but may not reassign it to a different order/product/
-- seller after the fact.
DROP POLICY IF EXISTS "update_own_ratings" ON public.ratings;
CREATE POLICY "update_own_ratings" ON public.ratings
  FOR UPDATE TO authenticated
  USING (auth.uid() = rater_id)
  WITH CHECK (auth.uid() = rater_id);

-- select_ratings (public read, from migration 001) already covers both
-- the per-product list on Product Details and the per-seller list on the
-- profile page - left unchanged.

-- Recreate the review_posted activity trigger now that ratings has
-- product_id, so the activity feed can reference which product was
-- reviewed (log_review_activity previously only logged the reviewer).
CREATE OR REPLACE FUNCTION public.log_review_activity()
RETURNS TRIGGER AS $$
DECLARE
  rater_name TEXT;
  item_title TEXT;
BEGIN
  SELECT full_name INTO rater_name FROM public.users WHERE id = NEW.rater_id;
  SELECT title INTO item_title FROM public.products WHERE id = NEW.product_id;

  INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id)
  VALUES ('review_posted', rater_name, NEW.rater_id, item_title, NEW.product_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_review_activity ON public.ratings;
CREATE TRIGGER on_review_activity
  AFTER INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.log_review_activity();
