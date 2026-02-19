/**
 * POST /api/wallet/verify
 * Verifies wallet ownership by checking a signed message.
 * Updates the user_wallets row with verified_at timestamp.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { requireAuth } from '../_lib/auth';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { walletId, signature, message, walletAddress } = req.body || {};

  if (!walletId || !signature || !message || !walletAddress) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Verify the signature
    const publicKey = new PublicKey(walletAddress);
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

    // Verify the message contains a valid user ID and recent timestamp
    const timestampMatch = message.match(/Timestamp: (\d+)/);
    if (timestampMatch) {
      const timestamp = parseInt(timestampMatch[1], 10);
      const fiveMinutes = 5 * 60 * 1000;
      if (Date.now() - timestamp > fiveMinutes) {
        return res.status(400).json({ error: 'Signature expired', verified: false });
      }
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

    return res.status(200).json({ verified: true });
  } catch (error) {
    console.error('Wallet verification error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
