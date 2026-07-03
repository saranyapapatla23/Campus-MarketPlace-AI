-- 004: wishlist_count on products + Realtime enablement for messaging
--
-- Context: products had no way to show "N people saved this" without an
-- expensive COUNT(*) query per card. We maintain a denormalized counter
-- kept in sync by triggers on the wishlist table (cheap to read, correct
-- on every insert/delete, and self-healing via the backfill below).
--
-- Separately: NONE of this project's tables were ever added to the
-- `supabase_realtime` publication. Supabase only broadcasts postgres_changes
-- for tables explicitly added to that publication - every `.channel(...)
-- .on('postgres_changes', ...)` subscription in the app (messages,
-- notifications) has been silently receiving nothing. This is why
-- "realtime messaging" appeared broken even though the client code was
-- listening correctly.

-- 1. Denormalized wishlist counter on products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wishlist_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.handle_wishlist_count_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.products
    SET wishlist_count = wishlist_count + 1
    WHERE id = NEW.product_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.products
    SET wishlist_count = GREATEST(wishlist_count - 1, 0)
    WHERE id = OLD.product_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_wishlist_insert ON public.wishlist;
CREATE TRIGGER on_wishlist_insert
  AFTER INSERT ON public.wishlist
  FOR EACH ROW EXECUTE FUNCTION public.handle_wishlist_count_change();

DROP TRIGGER IF EXISTS on_wishlist_delete ON public.wishlist;
CREATE TRIGGER on_wishlist_delete
  AFTER DELETE ON public.wishlist
  FOR EACH ROW EXECUTE FUNCTION public.handle_wishlist_count_change();

-- Backfill for any wishlist rows that already exist
UPDATE public.products p
SET wishlist_count = (
  SELECT COUNT(*) FROM public.wishlist w WHERE w.product_id = p.id
);

-- 2. Enable Realtime for the tables the UI actually subscribes to
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- Full row data on UPDATE/DELETE events (needed so read-status and other
-- partial updates broadcast complete "old" row data to subscribers).
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- 3. Auto-create a notification whenever someone receives a new message
CREATE OR REPLACE FUNCTION public.handle_new_message_notification()
RETURNS TRIGGER AS $$
DECLARE
  sender_name TEXT;
BEGIN
  SELECT full_name INTO sender_name FROM public.users WHERE id = NEW.sender_id;

  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES (
    NEW.receiver_id,
    'new_message',
    'New message',
    COALESCE(sender_name, 'Someone') || ' sent you a message',
    jsonb_build_object('sender_id', NEW.sender_id, 'message_id', NEW.id, 'product_id', NEW.product_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_new_message ON public.messages;
CREATE TRIGGER on_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_message_notification();
