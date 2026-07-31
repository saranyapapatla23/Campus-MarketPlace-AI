-- 007: Allow public (unauthenticated) browsing of the marketplace.
--
-- Root cause of "Marketplace still has issues" / inconsistent empty state:
-- the "select_products" and "select_categories" RLS policies were scoped
-- TO authenticated only. Any visitor who isn't signed in (or whose session
-- hasn't finished loading yet) gets zero rows back - not because the
-- database is empty, but because RLS silently filtered everything out.
-- The client then can't tell the difference and renders the "no products
-- found" empty state, which is misleading.
--
-- Note: we deliberately do NOT extend the "users" table's SELECT policy to
-- anonymous visitors here. It already allows any authenticated user to
-- read every column of every user row (including email) - widening that
-- further to unauthenticated requests would make every user's email
-- publicly scrapeable with no login at all, which is a real privacy
-- regression, not a bug fix. The practical effect: signed-out visitors can
-- browse products, but embedded seller name/avatar on product cards will
-- come back empty until they sign in (PostgREST just returns a null
-- relation when the nested embed is blocked by RLS, not an error).
-- Tightening the users policy to expose only safe public columns to
-- everyone is a good follow-up but is a separate, deliberate schema
-- decision (would need a public-safe view or column-level policy), not
-- something to bundle silently into this fix.

DROP POLICY IF EXISTS "select_products" ON public.products;
CREATE POLICY "select_products" ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "select_categories" ON public.categories;
CREATE POLICY "select_categories" ON public.categories
  FOR SELECT
  TO anon, authenticated
  USING (true);
