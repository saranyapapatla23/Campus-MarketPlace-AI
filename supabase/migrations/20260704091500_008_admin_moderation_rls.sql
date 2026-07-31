-- 008: Admin moderation actions were silently failing.
--
-- AdminPage.tsx calls two mutations:
--   1. UPDATE reports SET status = ... (resolve/dismiss a report)
--   2. UPDATE products SET status = ... (force-approve/reject/remove any
--      listing, not just the admin's own)
--
-- Neither had an RLS policy that would ever allow them for an admin acting
-- on someone else's data:
--   - "reports" had a SELECT policy but no UPDATE policy at all - RLS
--     defaults to deny, so resolve/dismiss always failed for every user,
--     admin included.
--   - "products" only had "update_own_products" (auth.uid() = seller_id),
--     so an admin trying to moderate another user's listing was blocked
--     the same as any random authenticated user would be.
--
-- These are added as additional permissive policies (Postgres OR's
-- multiple policies for the same command together), so normal sellers
-- keep exactly the same ability to edit their own listings - this only
-- adds an admin override on top, it doesn't change anyone else's access.

CREATE POLICY "admin_update_reports" ON public.reports
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = TRUE));

CREATE POLICY "admin_update_products" ON public.products
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = TRUE));
