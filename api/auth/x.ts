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
import { recomputeFromStored } from '../_lib/trust-recompute.js';

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
      scope: 'tweet.read users.read offline.access',
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

      const tokenData = await tokenRes.json() as { access_token: string; refresh_token?: string };
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token || null;

      // Fetch X user info (including premium/verified status)
      // Use verified_type instead of legacy verified field — verified returns true
      // for any blue checkmark (legacy, org, premium), verified_type === 'blue' is X Premium only
      const userRes = await fetch('https://api.x.com/2/users/me?user.fields=verified_type', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userRes.ok) {
        console.error('X user fetch failed:', await userRes.text());
        return res.redirect(302, `${WEBAPP_URL}/profile?x_error=user_fetch`);
      }

      const userData = await userRes.json() as { data?: { id?: string; username?: string; verified_type?: string } };
      const xUserId = userData.data?.id;
      const xUsername = userData.data?.username;
      const xPremium = userData.data?.verified_type === 'blue';

      if (!xUserId) {
        console.error('X user data missing id field');
        return res.redirect(302, `${WEBAPP_URL}/profile?x_error=user_fetch`);
      }

      const userId = payload.userId as string;

      // UNIQUENESS CHECK: Ensure this X account isn't already verified by another user
      // Check 1: by x_user_id (stable numeric ID, post-migration verifications)
      const { data: ownerById, error: idCheckErr } = await supabase
        .from('trust_scores')
        .select('user_id')
        .eq('x_user_id', xUserId)
        .eq('x_verified', true)
        .neq('user_id', userId)
        .limit(1);

      if (!idCheckErr && ownerById && ownerById.length > 0) {
        return res.redirect(302, `${WEBAPP_URL}/profile?x_error=already_linked`);
      }

      // Check 2: by twitter_handle (catches pre-migration users who have x_verified
      // but no x_user_id yet — their handle was stored in user_profiles)
      if (xUsername) {
        const { data: handleOwners } = await supabase
          .from('user_profiles')
          .select('user_id')
          .eq('twitter_handle', `@${xUsername}`)
          .neq('user_id', userId)
          .limit(5);

        if (handleOwners && handleOwners.length > 0) {
          const otherIds = handleOwners.map((o: { user_id: string }) => o.user_id);
          const { data: verifiedOwners } = await supabase
            .from('trust_scores')
            .select('user_id')
            .in('user_id', otherIds)
            .eq('x_verified', true)
            .limit(1);

          if (verifiedOwners && verifiedOwners.length > 0) {
            return res.redirect(302, `${WEBAPP_URL}/profile?x_error=already_linked`);
          }
        }
      }

      // Set x_verified = true, premium status, X user ID, and store refresh token
      await supabase
        .from('trust_scores')
        .upsert(
          {
            user_id: userId,
            x_verified: true,
            x_premium: xPremium,
            x_user_id: xUserId,
            x_refresh_token: refreshToken,
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

      // Recompute trust score so it reflects the new X signals immediately
      await recomputeFromStored(userId);

      return res.redirect(302, `${WEBAPP_URL}/profile?x_verified=true`);
    } catch (err) {
      console.error('X OAuth error:', err);
      return res.redirect(302, `${WEBAPP_URL}/profile?x_error=server`);
    }
  }

  // ---- DELETE: Disconnect X account ----
  if (req.method === 'DELETE') {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    // Revoke the token at X if we have a refresh token
    const { data: trustData } = await supabase
      .from('trust_scores')
      .select('x_refresh_token')
      .eq('user_id', authUser.id)
      .single();

    if (trustData?.x_refresh_token && X_CLIENT_ID && X_CLIENT_SECRET) {
      // Best-effort revocation — don't fail if X is unreachable
      try {
        await fetch('https://api.x.com/2/oauth2/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            token: trustData.x_refresh_token,
            token_type_hint: 'refresh_token',
          }),
        });
      } catch {
        // Non-fatal
      }
    }

    // Clear x_verified, x_premium, x_user_id, and refresh token
    await supabase
      .from('trust_scores')
      .update({
        x_verified: false,
        x_premium: false,
        x_user_id: null,
        x_refresh_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', authUser.id);

    // Clear twitter_handle from profile
    await supabase
      .from('user_profiles')
      .update({
        twitter_handle: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', authUser.id);

    // Recompute trust score so it reflects the removed X signals immediately
    await recomputeFromStored(authUser.id);

    return res.status(200).json({ disconnected: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
