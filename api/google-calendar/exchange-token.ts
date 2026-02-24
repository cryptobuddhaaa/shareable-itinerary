/**
 * Vercel Serverless Function: Exchange Google OAuth code for access token
 * POST /api/google-calendar/exchange-token
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).json({
        error: 'Google Calendar integration is not configured. Please contact support.',
      });
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Token exchange failed:', error);
      return res.status(500).json({ error: 'Failed to exchange authorization code' });
    }

    const tokens = await tokenResponse.json() as { access_token: string; expires_in: number };

    // Only return the short-lived access token — never expose the refresh token to the client.
    return res.status(200).json({
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
    });
  } catch (error) {
    console.error('Error in exchange-token:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
