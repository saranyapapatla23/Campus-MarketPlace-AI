-- 005: Real notification triggers for events that actually exist in this app.
--
-- Note on scope: the original spec also asked for "product approved",
-- "product rejected", "offer received/accepted/declined" notifications.
-- Those don't have anything to hook into yet - there is no admin approval
-- workflow on products (status is only available/sold/reserved/draft, no
-- pending/approved/rejected) and no offers table anywhere in the schema.
-- Faking notifications for events the app can't actually produce would be
-- worse than not having them, so they're intentionally left out here.
-- Building them for real means designing an approval queue and an offers
-- table + negotiation UI, which is a product decision, not a bug fix.

-- 1. Notify a seller when someone wishlists their product
CREATE OR REPLACE FUNCTION public.handle_wishlist_notification()
RETURNS TRIGGER AS $$
DECLARE
  seller UUID;
  buyer_name TEXT;
  product_title TEXT;
BEGIN
  SELECT seller_id, title INTO seller, product_title
  FROM public.products WHERE id = NEW.product_id;

  -- Don't notify yourself if you somehow wishlist your own listing
  IF seller IS NULL OR seller = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO buyer_name FROM public.users WHERE id = NEW.user_id;

  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES (
    seller,
    'wishlist',
    'Someone saved your listing',
    COALESCE(buyer_name, 'A student') || ' added "' || COALESCE(product_title, 'your product') || '" to their wishlist',
    jsonb_build_object('product_id', NEW.product_id, 'user_id', NEW.user_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_wishlist_notify_seller ON public.wishlist;
CREATE TRIGGER on_wishlist_notify_seller
  AFTER INSERT ON public.wishlist
  FOR EACH ROW EXECUTE FUNCTION public.handle_wishlist_notification();

-- 2. Notify a seller when their product is marked sold. This is the real
-- integration point in this codebase - MyListingsPage / AdminPage call
-- `.update({ status: 'sold' })` directly on products; there is no orders
-- row created for a sale anywhere in the app today.
CREATE OR REPLACE FUNCTION public.handle_product_sold_notification()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'sold' AND OLD.status IS DISTINCT FROM 'sold' THEN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      NEW.seller_id,
      'order',
      'Product sold',
      '"' || NEW.title || '" has been marked as sold.',
      jsonb_build_object('product_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_product_sold ON public.products;
CREATE TRIGGER on_product_sold
  AFTER UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.handle_product_sold_notification();
