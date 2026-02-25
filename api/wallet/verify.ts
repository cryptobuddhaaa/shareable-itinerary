/**
 * POST /api/wallet/verify
 *
 * Actions:
 *   ?action=verify (default) — Verifies wallet ownership for an authenticated user.
 *   ?action=auth             — Wallet-based login/signup via signed message. No JWT required.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { requireAuth } from '../_lib/auth.js';
import { recomputeFromStored } from '../_lib/trust-recompute.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WALLET_EMAIL_DOMAIN = 'wallet.convenu.app';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Wallet-based authentication: verify signature, find or create user, return token_hash.
 */
async function handleWalletAuth(req: VercelRequest, res: VercelResponse) {
  const { wallet_address, signature, message, tx_message } = req.body || {};

  if (!wallet_address || !signature || !message) {
    return res.status(400).json({ error: 'Missing wallet_address, signature, or message' });
  }

  // 1. Validate wallet address
  let publicKeyBytes: Uint8Array;
  try {
    const { PublicKey } = await import('@solana/web3.js');
    const pk = new PublicKey(wallet_address);
    publicKeyBytes = pk.toBytes();
  } catch {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  // 2. Verify the signature
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = bs58.decode(signature);
  } catch {
    return res.status(400).json({ error: 'Invalid signature encoding' });
  }

  let isValid: boolean;
  if (tx_message) {
    // Transaction-based signing: verify signature against serialized transaction message bytes.
    // Used by Android app with MWA signTransactions (sign_messages is optional in MWA spec
    // and not supported by Seeker/SeedVault).
    let txMessageBytes: Uint8Array;
    try {
      txMessageBytes = bs58.decode(tx_message);
    } catch {
      return res.status(400).json({ error: 'Invalid tx_message encoding' });
    }
    isValid = nacl.sign.detached.verify(txMessageBytes, signatureBytes, publicKeyBytes);
  } else {
    // Direct message signing: verify signature against the UTF-8 message text.
    const messageBytes = new TextEncoder().encode(message);
    isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  }

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 3. Verify message timestamp (5-min window)
  const timestampMatch = message.match(/Timestamp: (\d+)/);
  if (!timestampMatch) {
    return res.status(400).json({ error: 'Message must contain a timestamp' });
  }
  const timestamp = parseInt(timestampMatch[1], 10);
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  if (timestamp > now + 30_000) {
    return res.status(400).json({ error: 'Timestamp is in the future' });
  }
  if (now - timestamp > fiveMinutes) {
    return res.status(400).json({ error: 'Signature expired' });
  }

  try {
    // 4. Check if this wallet is already verified by an existing user
    const { data: existingWallet } = await supabase
      .from('user_wallets')
      .select('user_id, wallet_address')
      .eq('wallet_address', wallet_address)
      .not('verified_at', 'is', null)
      .limit(1)
      .single();

    let userId: string;
    let userEmail: string;
    let isNewAccount = false;

    if (existingWallet?.user_id) {
      // Existing verified wallet — log into that account
      userId = existingWallet.user_id;
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      if (!userData?.user) {
        return res.status(500).json({ error: 'Wallet owner account not found' });
      }
      userEmail = userData.user.email || `wallet_${wallet_address}@${WALLET_EMAIL_DOMAIN}`;
    } else {
      // 5. No verified wallet found — find or create a wallet user
      const syntheticEmail = `wallet_${wallet_address}@${WALLET_EMAIL_DOMAIN}`;

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: {
          wallet_address,
          provider: 'wallet',
        },
      });

      if (createError) {
        // User already exists — look them up
        let existingUser = null;
        let page = 1;
        const perPage = 50;

        while (!existingUser) {
          const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
            page,
            perPage,
          });

          if (listError) {
            return res.status(500).json({ error: 'Failed to find user account' });
          }

          const users = listData?.users || [];
          existingUser = users.find((u: { email?: string }) => u.email === syntheticEmail);

          if (existingUser || users.length < perPage) break;
          page++;
        }

        if (!existingUser) {
          return res.status(500).json({ error: 'Failed to create or find user account' });
        }

        userId = existingUser.id;
        userEmail = syntheticEmail;
      } else if (!newUser?.user) {
        return res.status(500).json({ error: 'Failed to create user account' });
      } else {
        userId = newUser.user.id;
        userEmail = syntheticEmail;
        isNewAccount = true;
      }

      // 6. Create verified wallet entry for the new/existing user
      await supabase.from('user_wallets').upsert(
        {
          user_id: userId,
          wallet_address,
          is_primary: true,
          verified_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,wallet_address' }
      );

      // 7. Initialize trust score with wallet_connected
      await supabase.from('trust_scores').upsert(
        {
          user_id: userId,
          wallet_connected: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

      await recomputeFromStored(userId);
    }

    // 8. Generate magic link token for session
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userEmail,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('Error generating wallet auth link:', linkError);
      return res.status(500).json({ error: 'Failed to generate session' });
    }

    return res.status(200).json({
      token_hash: linkData.properties.hashed_token,
      user_id: userId,
      new_account: isNewAccount,
    });
  } catch (error) {
    console.error('Wallet auth error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = (req.query.action as string) || 'verify';

  if (action === 'auth') {
    return handleWalletAuth(req, res);
  }

  // --- Default action: verify (requires auth) ---
  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const { walletId, signature, message, walletAddress } = req.body || {};

    if (!walletId || !signature || !message || !walletAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify the signature
    const { PublicKey } = await import('@solana/web3.js');
    const publicKey = new PublicKey(walletAddress); // already validated above
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);

    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid signature', verified: false });
    }

    // Verify the message contains a recent timestamp — reject if missing, expired, or in the future
    const timestampMatch = message.match(/Timestamp: (\d+)/);
    if (!timestampMatch) {
      return res.status(400).json({ error: 'Message must contain a timestamp', verified: false });
    }
    const timestamp = parseInt(timestampMatch[1], 10);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (timestamp > now + 30_000) {
      return res.status(400).json({ error: 'Timestamp is in the future', verified: false });
    }
    if (now - timestamp > fiveMinutes) {
      return res.status(400).json({ error: 'Signature expired', verified: false });
    }

    // Validate walletAddress is a valid base58 Solana public key (32 bytes)
    try {
      const { PublicKey: PK } = await import('@solana/web3.js');
      new PK(walletAddress); // throws if invalid
    } catch {
      return res.status(400).json({ error: 'Invalid wallet address', verified: false });
    }

    // Validate walletId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof walletId !== 'string' || !uuidRegex.test(walletId)) {
      return res.status(400).json({ error: 'Invalid wallet ID', verified: false });
    }

    // Check the wallet row exists and matches the address
    const { data: wallet, error: fetchError } = await supabase
      .from('user_wallets')
      .select('id, user_id, wallet_address, verified_at')
      .eq('id', walletId)
      .single();

    if (fetchError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found', verified: false });
    }

    if (wallet.wallet_address !== walletAddress) {
      return res.status(400).json({ error: 'Wallet address mismatch', verified: false });
    }

    // Verify the authenticated user owns this wallet row
    if (wallet.user_id !== authUser.id) {
      return res.status(403).json({ error: 'Not authorized to verify this wallet', verified: false });
    }

    // Already verified
    if (wallet.verified_at) {
      return res.status(200).json({ verified: true });
    }

    // UNIQUENESS CHECK: Ensure this wallet address isn't verified by another user
    const { data: existingOwner } = await supabase
      .from('user_wallets')
      .select('user_id')
      .eq('wallet_address', walletAddress)
      .not('verified_at', 'is', null)
      .neq('user_id', wallet.user_id)
      .limit(1);

    if (existingOwner && existingOwner.length > 0) {
      return res.status(409).json({
        error: 'This wallet is already verified by another account',
        verified: false,
      });
    }

    // UNIQUENESS CHECK: Ensure this user doesn't already have a different verified wallet
    const { data: existingWallet } = await supabase
      .from('user_wallets')
      .select('id, wallet_address')
      .eq('user_id', wallet.user_id)
      .not('verified_at', 'is', null)
      .neq('id', walletId)
      .limit(1);

    if (existingWallet && existingWallet.length > 0) {
      return res.status(409).json({
        error: 'You already have a verified wallet. Unlink it first to verify a different one.',
        verified: false,
      });
    }

    // Update verified_at
    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', walletId);

    if (updateError) {
      console.error('Error updating wallet verification:', updateError);
      return res.status(500).json({ error: 'Failed to update verification' });
    }

    // Update trust_scores: wallet_connected = true (use authenticated user ID, not message)
    await supabase
      .from('trust_scores')
      .upsert({
        user_id: authUser.id,
        wallet_connected: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    // Recompute trust score so it reflects wallet_connected immediately
    await recomputeFromStored(authUser.id);

    return res.status(200).json({ verified: true });
  } catch (error) {
    console.error('Wallet verification error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
