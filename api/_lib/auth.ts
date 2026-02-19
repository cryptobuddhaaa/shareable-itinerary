/**
 * Shared authentication helper for Vercel serverless functions.
 * Verifies the Supabase JWT from the Authorization header.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export interface AuthUser {
  id: string;
  email?: string;
}

/**
 * Extracts and verifies the Supabase JWT from the Authorization header.
 * Returns the authenticated user or null.
 */
export async function getAuthUser(req: VercelRequest): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return { id: user.id, email: user.email };
}

/**
 * Middleware-style helper: verifies auth and returns 401 if not authenticated.
 * Returns the user if authenticated, or null after sending the 401 response.
 */
export async function requireAuth(req: VercelRequest, res: VercelResponse): Promise<AuthUser | null> {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return user;
}
