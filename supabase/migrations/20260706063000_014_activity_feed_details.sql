-- 014: Richer activity feed entries.
--
-- The requested feed copy needs two pieces of data activity_log didn't
-- carry:
--   "Deepak sold "Scientific Calculator" to Priya."   <- needs the buyer's name
--   "Aman reviewed "HP Laptop" ★★★★★"                  <- needs the star rating
--
-- `secondary_name` is intentionally generic (not "buyer_name") so the same
-- column can be reused by any future activity type that needs a second
-- actor, following the same denormalized-snapshot approach as the rest of
-- this table.

ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS secondary_name TEXT;
ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS rating INTEGER;
ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS price DECIMAL(10,2);

-- product_sold is now logged directly by mark_product_sold() (013/012's
-- RPC is the only code path that can sell a product and it already has
-- the buyer on hand), so the generic products trigger must stop logging
-- it itself to avoid double entries.
CREATE OR REPLACE FUNCTION public.log_product_activity()
RETURNS TRIGGER AS $$
DECLARE
  seller_name TEXT;
BEGIN
  SELECT full_name INTO seller_name FROM public.users WHERE id = COALESCE(NEW.seller_id, OLD.seller_id);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id, price)
    VALUES ('product_listed', seller_name, NEW.seller_id, NEW.title, NEW.id, NEW.price);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'sold' AND OLD.status IS DISTINCT FROM 'sold' THEN
      -- Logged by mark_product_sold() instead, which knows the buyer.
      NULL;
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

-- Trigger definition unchanged, just re-affirmed for clarity.
DROP TRIGGER IF EXISTS on_product_activity ON public.products;
CREATE TRIGGER on_product_activity
  AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_activity();

CREATE OR REPLACE FUNCTION public.mark_product_sold(
  p_product_id UUID,
  p_buyer_id UUID DEFAULT NULL,
  p_final_price NUMERIC DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products;
  v_order public.orders;
  v_seller_name TEXT;
  v_buyer_name TEXT;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;

  IF v_product IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_product.seller_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the seller of this product can mark it as sold';
  END IF;

  IF v_product.status = 'sold' THEN
    RAISE EXCEPTION 'Product is already marked as sold';
  END IF;

  IF p_buyer_id IS NOT NULL AND p_buyer_id = v_product.seller_id THEN
    RAISE EXCEPTION 'Buyer cannot be the same user as the seller';
  END IF;

  UPDATE public.products
  SET status = 'sold', updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO public.orders (buyer_id, seller_id, product_id, status, final_price)
  VALUES (
    p_buyer_id,
    v_product.seller_id,
    p_product_id,
    'completed',
    COALESCE(p_final_price, v_product.price)
  )
  RETURNING * INTO v_order;

  SELECT full_name INTO v_seller_name FROM public.users WHERE id = v_product.seller_id;
  IF p_buyer_id IS NOT NULL THEN
    SELECT full_name INTO v_buyer_name FROM public.users WHERE id = p_buyer_id;
  END IF;

  INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id, secondary_name)
  VALUES ('product_sold', v_seller_name, v_product.seller_id, v_product.title, v_product.id, v_buyer_name);

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_product_sold(UUID, UUID, NUMERIC) TO authenticated;

-- Reviews: carry the star rating into the feed entry.
CREATE OR REPLACE FUNCTION public.log_review_activity()
RETURNS TRIGGER AS $$
DECLARE
  rater_name TEXT;
  item_title TEXT;
BEGIN
  SELECT full_name INTO rater_name FROM public.users WHERE id = NEW.rater_id;
  SELECT title INTO item_title FROM public.products WHERE id = NEW.product_id;

  INSERT INTO public.activity_log (type, actor_name, actor_id, product_title, product_id, rating)
  VALUES ('review_posted', rater_name, NEW.rater_id, item_title, NEW.product_id, NEW.rating);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_review_activity ON public.ratings;
CREATE TRIGGER on_review_activity
  AFTER INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.log_review_activity();
