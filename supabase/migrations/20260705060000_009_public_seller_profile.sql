-- 009: Public browsing needs seller name/avatar/college visible to guests,
-- without exposing every user's email/phone/hostel to the entire internet
-- with no login at all.
--
-- The "users" table's existing "select_users" policy already lets any
-- *authenticated* user read every column of every user row - that's
-- pre-existing behavior this migration does not touch or expand.
-- What's added here is scoped narrowly to the "anon" (unauthenticated)
-- role only:
--
--   1. A new RLS policy so anon can see user *rows* at all (previously
--      anon had zero row-level access to "users", so any embedded
--      `seller:users(...)` on a public product listing silently came back
--      null for guests).
--   2. Column-level REVOKE so that even though anon can now see rows, it
--      still cannot read sensitive columns (email, phone, hostel,
--      semester) on those rows - this is enforced at the database level
--      independent of whatever the client happens to query for, so a
--      future `select('*')` from a public page fails loudly instead of
--      silently leaking PII.
--
-- The client-side queries on public pages (Marketplace, Home, Product
-- Detail) are updated in the same change to explicitly select only the
-- safe columns instead of `seller:users(*)` - since Postgres errors on a
-- wildcard `select *` if any column in `*` isn't granted to the querying
-- role, an explicit safe column list is required for those queries to
-- work for anon at all, not just to be tidy.

CREATE POLICY "select_users_public_anon" ON public.users
  FOR SELECT
  TO anon
  USING (true);

REVOKE SELECT (email, phone, hostel, semester) ON public.users FROM anon;
