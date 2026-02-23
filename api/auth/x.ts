/**
 * POST /api/auth/x  — Initiate X (Twitter) OAuth 2.0 PKCE flow
 * GET  /api/auth/x  — Handle X OAuth callback
 *
 * Combined into a single serverless function to stay within
 * Vercel Hobby plan's 12-function limit.
 *
 * Flow:
 *  1. Authenticated user calls POST → receives X authorization URL
 *  2. Frontend redirects user to X authorization URL
 *  3. User authorizes on X → X redirects GET to this endpoint
 *  4. Handler exchanges code for token, fetches X user, sets x_verified = true
 *  5. Redirects back to /profile with success/error query param
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { requireAuth } from '../_lib/auth.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const X_CLIENT_ID = process.env.X_CLIENT_ID || '';
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
const X_CALLBACK_URL = process.env.X_CALLBACK_URL || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.convenu.xyz';

/** HMAC key for signing OAuth state tokens */
const STATE_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// Signed state helpers — encodes userId + codeVerifier + timestamp in a
// tamper-proof token so the callback can identify the user without a DB lookup.
// ---------------------------------------------------------------------------

function signState(payload: object): string {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyState(state: string): Record<string, unknown> | null {
  const dotIdx = state.indexOf('.');
  if (dotIdx === -1) return null;

  const data = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  if (!data || !sig) return null;

  const expected = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) {
      return null;
    }
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ---- POST: Initiate X OAuth flow ----
  if (req.method === 'POST') {
    if (!X_CLIENT_ID || !X_CALLBACK_URL) {
      return res.status(501).json({ error: 'X OAuth not configured' });
    }

    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const { verifier, challenge } = generatePKCE();

    const state = signState({
      userId: authUser.id,
      codeVerifier: verifier,
      ts: Date.now(),
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: X_CLIENT_ID,
      redirect_uri: X_CALLBACK_URL,
      scope: 'tweet.read users.read',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;
    return res.status(200).json({ authUrl });
  }

  // ---- GET: Handle X OAuth callback ----
  if (req.method === 'GET') {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code || !state) {
      return res.redirect(302, `${WEBAPP_URL}/profile?x_error=denied`);
    }

    // Verify & decode signed state
    const payload = verifyState(state as string);
    if (!payload || !payload.userId || !payload.codeVerifier) {
      return res.redirect(302, `${WEBAPP_URL}/profile?x_error=invalid_state`);
    }

    // Check state freshness (10 minute expiry)
    if (Date.now() - (payload.ts as number) > 10 * 60 * 1000) {
      return res.redirect(302, `${WEBAPP_URL}/profile?x_error=expired`);
    }

    try {
      // Exchange authorization code for access token
      const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: X_CALLBACK_URL,
          code_verifier: payload.codeVerifier as string,
        }),
      });

      if (!tokenRes.ok) {
        console.error('X token exchange failed:', await tokenRes.text());
        return res.redirect(302, `${WEBAPP_URL}/profile?x_error=token_exchange`);
      }

      const tokenData = await tokenRes.json() as { access_token: string };
      const accessToken = tokenData.access_token;

      // Fetch X user info
      const userRes = await fetch('https://api.x.com/2/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userRes.ok) {
        console.error('X user fetch failed:', await userRes.text());
        return res.redirect(302, `${WEBAPP_URL}/profile?x_error=user_fetch`);
      }

      const userData = await userRes.json() as { data?: { username?: string } };
      const xUsername = userData.data?.username;

      const userId = payload.userId as string;

      // Set x_verified = true in trust_scores
      await supabase
        .from('trust_scores')
        .upsert(
          {
            user_id: userId,
            x_verified: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      // Store X username in user_profiles (if available)
      if (xUsername) {
        await supabase
          .from('user_profiles')
          .upsert(
            {
              user_id: userId,
              twitter_handle: `@${xUsername}`,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
      }

      return res.redirect(302, `${WEBAPP_URL}/profile?x_verified=true`);
    } catch (err) {
      console.error('X OAuth error:', err);
      return res.redirect(302, `${WEBAPP_URL}/profile?x_error=server`);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
