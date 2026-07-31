-- 012: Fix the Orders flow.
--
-- ROOT CAUSE
-- ----------
-- `MyListingsPage.updateStatus()` runs exactly one query when you click
-- "Mark Sold":
--
--   supabase.from('products').update({ status }).eq('id', id)
--
-- That's it. Nothing in the client, and nothing in the database (no
-- trigger on `products`), ever inserts a row into `public.orders`. The
-- `orders` table, its RLS policies, and the `Order` type were all created
-- up front (migration 001) and a "Orders" link already exists in the
-- account dropdown (MainLayout.tsx) - but the page it points to
-- (`/orders`) was never built, and nothing ever populates the table it
-- would read from. So: product flips to `sold`, no order ever exists, the
-- (nonexistent) Orders page has nothing to show.
--
-- A second, structural problem: `orders.buyer_id` is NOT NULL, but a
-- seller marking something sold from their own listings page often has no
-- platform account to attach as "buyer" (cash sale to someone who
-- messaged off-platform, a friend who isn't signed up, etc). The schema
-- can't represent "sold, no tracked buyer" at all as written.
--
-- FIX
-- ---
-- 1. Make `orders.buyer_id` nullable, so a sale can be recorded without a
--    buyer account (and add a check that a buyer can never be the seller).
-- 2. Add a single SECURITY DEFINER RPC, `mark_product_sold`, that performs
--    the status update AND the order insert together, atomically, as the
--    one and only place "a product was sold" is ever recorded. This is
--    the fix for "why doesn't the sold item appear" - there was simply no
--    code path that ever created the order row. Doing it as one DB
--    function (rather than two sequential client-side calls) also means a
--    dropped connection between step 1 and step 2 can't ever leave a
--    product marked `sold` with no matching order.
-- 3. Widen the `orders` INSERT/SELECT policies so a seller-initiated sale
--    (buyer didn't perform the insert themselves) is representable even
--    outside the RPC, and so both sides of a trade can always see it.

ALTER TABLE public.orders ALTER COLUMN buyer_id DROP NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_buyer_not_seller;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_buyer_not_seller CHECK (buyer_id IS NULL OR buyer_id <> seller_id);

-- Re-state the orders policies explicitly (idempotent) rather than
-- layering more policies on top of migration 001's.
DROP POLICY IF EXISTS "select_own_orders" ON public.orders;
CREATE POLICY "select_own_orders" ON public.orders
  FOR SELECT TO authenticated
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

DROP POLICY IF EXISTS "insert_orders" ON public.orders;
CREATE POLICY "insert_orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = buyer_id OR auth.uid() = seller_id);

DROP POLICY IF EXISTS "update_orders" ON public.orders;
CREATE POLICY "update_orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id)
  WITH CHECK (auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON public.orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON public.orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_product ON public.orders(product_id);

-- Live updates on the Orders page.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;
ALTER TABLE public.orders REPLICA IDENTITY FULL;

-- The single place a sale is recorded. SECURITY DEFINER so it can insert
-- the order row on the buyer's behalf (the buyer, if any, did not
-- initiate this call - the seller did) while still enforcing, inside the
-- function body, that only the actual seller of the product can call it.
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

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_product_sold(UUID, UUID, NUMERIC) TO authenticated;
