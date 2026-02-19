-- Fix: Remove wide-open INSERT policy on user_points.
-- Points are only inserted server-side using the service role key (which bypasses RLS).
-- The old policy allowed any authenticated user to insert arbitrary points.
DROP POLICY IF EXISTS "Service can insert points" ON user_points;
