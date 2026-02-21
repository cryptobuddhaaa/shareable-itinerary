/**
 * /api/handshake?action=initiate|claim|confirm-tx|mint|pending
 * Consolidated handshake endpoint to stay within Vercel Hobby plan's 12-function limit.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../_lib/auth.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SOLANA_RPC = process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const TREASURY_WALLET = process.env.VITE_TREASURY_WALLET || '';
const MINT_FEE_LAMPORTS = 10_000_000; // 0.01 SOL
const POINTS_PER_HANDSHAKE = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Base58 check for Solana addresses (32-44 chars, no 0/O/I/l)
function isValidWalletAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

// ──────────────────────────────────────────────
// Initiate
// ──────────────────────────────────────────────

async function handleInitiate(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const userId = authUser.id;

    const { contactId, walletAddress } = req.body || {};

    if (!contactId || !walletAddress) {
      return res.status(400).json({ error: 'contactId and walletAddress required' });
    }
    if (!UUID_RE.test(contactId)) {
      return res.status(400).json({ error: 'Invalid contactId format' });
    }
    if (!isValidWalletAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (!TREASURY_WALLET) {
      return res.status(500).json({ error: 'Treasury wallet not configured' });
    }

    const { Connection, PublicKey, Transaction, SystemProgram } = await import('@solana/web3.js');
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, telegram_handle, email, event_id, event_title, date_met')
      .eq('id', contactId)
      .eq('user_id', userId)
      .single();

    if (contactError || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const receiverIdentifier = contact.telegram_handle || contact.email;
    if (!receiverIdentifier) {
      return res.status(400).json({ error: 'Contact must have a Telegram handle or email for handshake' });
    }

    const { data: existing } = await supabase
      .from('handshakes')
      .select('id, status, initiator_tx_signature')
      .eq('initiator_user_id', userId)
      .eq('contact_id', contactId)
      .in('status', ['pending', 'claimed', 'matched', 'minted'])
      .single();

    if (existing) {
      // If pending with no tx signature (user cancelled wallet signing), allow retry
      if (existing.status === 'pending' && !existing.initiator_tx_signature) {
        // Update wallet address in case user switched wallets between attempts
        await supabase
          .from('handshakes')
          .update({ initiator_wallet: walletAddress })
          .eq('id', existing.id);

        // Rebuild the transaction for this existing handshake
        const connection = new Connection(SOLANA_RPC, 'confirmed');
        const payerKey = new PublicKey(walletAddress);
        const treasuryKey = new PublicKey(TREASURY_WALLET!);

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payerKey,
            toPubkey: treasuryKey,
            lamports: MINT_FEE_LAMPORTS,
          })
        );
        transaction.feePayer = payerKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        const serialized = transaction.serialize({ requireAllSignatures: false });
        const base64Tx = Buffer.from(serialized).toString('base64');

        return res.status(200).json({
          handshakeId: existing.id,
          transaction: base64Tx,
          receiverIdentifier,
          contactName: `${contact.first_name} ${contact.last_name}`.trim(),
        });
      }

      return res.status(409).json({
        error: 'Handshake already exists for this contact',
        handshakeId: existing.id,
        status: existing.status,
      });
    }

    // Check reverse direction: is there already a handshake where this user
    // is the receiver and the contact's person was the initiator?
    const { data: receivedHandshakes } = await supabase
      .from('handshakes')
      .select('id, status, initiator_user_id')
      .eq('receiver_user_id', userId)
      .in('status', ['pending', 'claimed', 'matched', 'minted']);

    if (receivedHandshakes && receivedHandshakes.length > 0) {
      for (const rh of receivedHandshakes) {
        const { data: initiatorUser } = await supabase.auth.admin.getUserById(rh.initiator_user_id);
        const initiatorEmail = initiatorUser?.user?.email;
        const { data: initiatorTelegram } = await supabase
          .from('telegram_links')
          .select('telegram_username')
          .eq('user_id', rh.initiator_user_id)
          .single();

        const contactEmail = contact.email?.toLowerCase();
        const contactTelegram = contact.telegram_handle?.replace('@', '').toLowerCase();

        if ((contactEmail && initiatorEmail?.toLowerCase() === contactEmail) ||
            (contactTelegram && initiatorTelegram?.telegram_username?.toLowerCase() === contactTelegram)) {
          return res.status(409).json({
            error: 'A handshake already exists with this person',
            handshakeId: rh.id,
            status: rh.status,
          });
        }
      }
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { data: handshake, error: hsError } = await supabase
      .from('handshakes')
      .insert({
        initiator_user_id: userId,
        receiver_identifier: receiverIdentifier,
        contact_id: contactId,
        event_id: contact.event_id,
        event_title: contact.event_title,
        event_date: contact.date_met,
        initiator_wallet: walletAddress,
        mint_fee_lamports: MINT_FEE_LAMPORTS,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single();

    if (hsError || !handshake) {
      console.error('Error creating handshake:', hsError);
      return res.status(500).json({ error: 'Failed to create handshake' });
    }

    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const payerKey = new PublicKey(walletAddress);
    const treasuryKey = new PublicKey(TREASURY_WALLET);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payerKey,
        toPubkey: treasuryKey,
        lamports: MINT_FEE_LAMPORTS,
      })
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = payerKey;

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return res.status(200).json({
      handshakeId: handshake.id,
      transaction: Buffer.from(serialized).toString('base64'),
      receiverIdentifier,
      contactName: `${contact.first_name} ${contact.last_name}`,
    });
  } catch (error) {
    console.error('Handshake initiation error:', error);
    return res.status(500).json({ error: 'Failed to initiate handshake' });
  }
}

// ──────────────────────────────────────────────
// Claim
// ──────────────────────────────────────────────

async function handleClaim(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const userId = authUser.id;

    const { handshakeId, walletAddress } = req.body || {};

    if (!handshakeId || !walletAddress) {
      return res.status(400).json({ error: 'handshakeId and walletAddress required' });
    }
    if (!UUID_RE.test(handshakeId)) {
      return res.status(400).json({ error: 'Invalid handshakeId format' });
    }
    if (!isValidWalletAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (!TREASURY_WALLET) {
      return res.status(500).json({ error: 'Treasury wallet not configured' });
    }

    const { Connection, PublicKey, Transaction, SystemProgram } = await import('@solana/web3.js');
    const { data: handshake, error: hsError } = await supabase
      .from('handshakes')
      .select('id, status, receiver_user_id, initiator_user_id, expires_at, receiver_identifier')
      .eq('id', handshakeId)
      .single();

    if (hsError || !handshake) {
      return res.status(404).json({ error: 'Handshake not found' });
    }

    // Allow re-claim if receiver backed out before paying (status still 'claimed')
    if (handshake.status === 'claimed' && handshake.receiver_user_id === userId) {
      // Re-claim is fine — just rebuild the transaction below
    } else if (handshake.status !== 'pending') {
      return res.status(409).json({
        error: `Handshake is already ${handshake.status}`,
        status: handshake.status,
      });
    }

    if (handshake.initiator_user_id === userId) {
      return res.status(400).json({ error: 'Cannot claim your own handshake' });
    }

    if (new Date(handshake.expires_at) < new Date()) {
      await supabase
        .from('handshakes')
        .update({ status: 'expired' })
        .eq('id', handshakeId);
      return res.status(410).json({ error: 'Handshake has expired' });
    }

    const { data: telegramLink } = await supabase
      .from('telegram_links')
      .select('telegram_username')
      .eq('user_id', userId)
      .single();

    const { data: claimingUser } = await supabase.auth.admin.getUserById(userId);
    const userEmail = claimingUser?.user?.email;
    const userTelegram = telegramLink?.telegram_username;

    const receiverId = handshake.receiver_identifier;
    const identifierMatch =
      (userTelegram && receiverId.replace('@', '').toLowerCase() === userTelegram.toLowerCase()) ||
      (userEmail && receiverId.toLowerCase() === userEmail.toLowerCase());

    if (!identifierMatch) {
      return res.status(403).json({ error: 'You are not the intended receiver of this handshake' });
    }

    // Atomic claim: only update if status is still 'pending' (or 'claimed' by same user).
    // This prevents TOCTOU races where two users claim simultaneously.
    const statusFilter = handshake.status === 'claimed' ? 'claimed' : 'pending';
    const { data: claimed, error: claimError } = await supabase
      .from('handshakes')
      .update({
        receiver_user_id: userId,
        receiver_wallet: walletAddress,
        status: 'claimed',
      })
      .eq('id', handshakeId)
      .eq('status', statusFilter)
      .select('id')
      .single();

    if (claimError || !claimed) {
      return res.status(409).json({ error: 'Handshake was already claimed by someone else' });
    }

    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const payerKey = new PublicKey(walletAddress);
    const treasuryKey = new PublicKey(TREASURY_WALLET);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payerKey,
        toPubkey: treasuryKey,
        lamports: MINT_FEE_LAMPORTS,
      })
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = payerKey;

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    // Look up the initiator's actual name for display
    const { data: initiatorUser } = await supabase.auth.admin.getUserById(handshake.initiator_user_id);
    const initiatorDisplayName = initiatorUser?.user?.user_metadata?.full_name
      || initiatorUser?.user?.email?.split('@')[0]
      || 'Someone';

    return res.status(200).json({
      handshakeId,
      status: 'claimed',
      transaction: Buffer.from(serialized).toString('base64'),
      initiatorName: `Handshake from ${initiatorDisplayName}`,
    });
  } catch (error) {
    console.error('Handshake claim error:', error);
    return res.status(500).json({ error: 'Failed to claim handshake' });
  }
}

// ──────────────────────────────────────────────
// Confirm Transaction
// ──────────────────────────────────────────────

async function handleConfirmTx(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const { handshakeId, signedTransaction, side } = req.body || {};

    if (!handshakeId || !signedTransaction || !['initiator', 'receiver'].includes(side)) {
      return res.status(400).json({ error: 'handshakeId, signedTransaction, and side (initiator|receiver) required' });
    }
    if (!UUID_RE.test(handshakeId)) {
      return res.status(400).json({ error: 'Invalid handshakeId format' });
    }

    const { Connection, Transaction, SystemProgram } = await import('@solana/web3.js');
    const { data: handshake, error: hsError } = await supabase
      .from('handshakes')
      .select('id, status, initiator_user_id, receiver_user_id, initiator_wallet, receiver_wallet, event_title, event_id, event_date')
      .eq('id', handshakeId)
      .single();

    if (hsError || !handshake) {
      return res.status(404).json({ error: 'Handshake not found' });
    }

    // Verify the authenticated user matches the claimed side
    if (side === 'initiator' && handshake.initiator_user_id !== authUser.id) {
      return res.status(403).json({ error: 'Not authorized for this handshake' });
    }
    if (side === 'receiver' && handshake.receiver_user_id !== authUser.id) {
      return res.status(403).json({ error: 'Not authorized for this handshake' });
    }

    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const txBuffer = Buffer.from(signedTransaction, 'base64');
    const transaction = Transaction.from(txBuffer);

    // Verify transaction content BEFORE broadcasting:
    // Must contain exactly one SystemProgram.transfer to treasury for the correct amount.
    const expectedWallet = side === 'initiator' ? handshake.initiator_wallet : handshake.receiver_wallet;
    if (!expectedWallet) {
      return res.status(400).json({ error: 'No wallet address on record for this side' });
    }

    const instructions = transaction.instructions;
    // Find the SystemProgram transfer instruction.
    // Wallets (e.g. Phantom) may inject ComputeBudget instructions for priority fees,
    // so we allow extra instructions but require exactly one SystemProgram transfer.
    const systemIxs = instructions.filter(ix => ix.programId.equals(SystemProgram.programId));
    if (systemIxs.length !== 1) {
      return res.status(400).json({ error: 'Transaction must contain exactly one SystemProgram instruction' });
    }

    const ix = systemIxs[0];

    // Decode SystemProgram.transfer instruction data (4-byte type prefix + 8-byte LE lamports)
    if (ix.data.length < 12) {
      return res.status(400).json({ error: 'Invalid transfer instruction data' });
    }
    const transferType = ix.data.readUInt32LE(0);
    if (transferType !== 2) {
      return res.status(400).json({ error: 'Instruction is not a transfer' });
    }
    const lamports = Number(ix.data.readBigUInt64LE(4));
    if (lamports !== MINT_FEE_LAMPORTS) {
      return res.status(400).json({ error: `Transfer amount must be ${MINT_FEE_LAMPORTS} lamports (0.01 SOL)` });
    }

    // Verify accounts: key[0]=sender, key[1]=recipient
    const senderKey = ix.keys[0]?.pubkey?.toBase58();
    const recipientKey = ix.keys[1]?.pubkey?.toBase58();
    if (senderKey !== expectedWallet) {
      return res.status(400).json({ error: 'Transaction sender does not match registered wallet' });
    }
    if (recipientKey !== TREASURY_WALLET) {
      return res.status(400).json({ error: 'Transaction recipient must be the treasury wallet' });
    }

    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({
      signature: txSignature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, 'confirmed');

    const now = new Date().toISOString();
    const updateFields: Record<string, unknown> = {};

    if (side === 'initiator') {
      updateFields.initiator_tx_signature = txSignature;
      updateFields.initiator_minted_at = now;
    } else {
      updateFields.receiver_tx_signature = txSignature;
      updateFields.receiver_minted_at = now;
      // Receiver payment confirmed — now upgrade from 'claimed' to 'matched'
      updateFields.status = 'matched';
    }

    const { error: updateError } = await supabase
      .from('handshakes')
      .update(updateFields)
      .eq('id', handshakeId);

    if (updateError) {
      console.error('Failed to save tx confirmation to DB:', updateError);
      return res.status(500).json({
        error: 'Payment confirmed on-chain but failed to save. Please contact support.',
        txSignature,
      });
    }

    // When receiver pays, auto-add the initiator to the receiver's contacts
    if (side === 'receiver' && handshake.receiver_user_id && handshake.initiator_user_id) {
      try {
        const { data: initiatorUser } = await supabase.auth.admin.getUserById(handshake.initiator_user_id);
        const { data: initiatorTelegram } = await supabase
          .from('telegram_links')
          .select('telegram_username')
          .eq('user_id', handshake.initiator_user_id)
          .single();

        const initiatorEmail = initiatorUser?.user?.email || null;
        const initiatorTg = initiatorTelegram?.telegram_username || null;

        // Check if receiver already has this person as a contact (by email or telegram)
        let alreadyExists = false;
        if (initiatorEmail) {
          const { count } = await supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', handshake.receiver_user_id)
            .ilike('email', initiatorEmail);
          if (count && count > 0) alreadyExists = true;
        }
        if (!alreadyExists && initiatorTg) {
          const { count } = await supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', handshake.receiver_user_id)
            .ilike('telegram_handle', initiatorTg);
          if (count && count > 0) alreadyExists = true;
        }

        if (!alreadyExists) {
          const fullName = initiatorUser?.user?.user_metadata?.full_name || '';
          const nameParts = fullName.split(' ');
          const firstName = nameParts[0] || initiatorEmail?.split('@')[0] || 'Unknown';
          const lastName = nameParts.slice(1).join(' ') || '';

          await supabase.from('contacts').insert({
            user_id: handshake.receiver_user_id,
            first_name: firstName,
            last_name: lastName,
            telegram_handle: initiatorTg,
            email: initiatorEmail,
            event_title: handshake.event_title || 'Handshake',
            event_id: handshake.event_id || null,
            itinerary_id: null,
            date_met: handshake.event_date || new Date().toISOString().split('T')[0],
          });
        }
      } catch (contactErr) {
        // Non-critical — don't fail the handshake if contact creation fails
        console.error('Failed to auto-add contact for receiver:', contactErr);
      }
    }

    const { data: updated } = await supabase
      .from('handshakes')
      .select('initiator_tx_signature, receiver_tx_signature, status')
      .eq('id', handshakeId)
      .single();

    const bothPaid = updated?.initiator_tx_signature && updated?.receiver_tx_signature;

    return res.status(200).json({
      txSignature,
      side,
      bothPaid: !!bothPaid,
      status: updated?.status,
    });
  } catch (error) {
    console.error('Confirm tx error:', error);
    return res.status(500).json({ error: 'Failed to confirm transaction' });
  }
}

// ──────────────────────────────────────────────
// Mint
// ──────────────────────────────────────────────

async function handleMint(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const { handshakeId } = req.body || {};
    if (!handshakeId) {
      return res.status(400).json({ error: 'handshakeId required' });
    }
    if (!UUID_RE.test(handshakeId)) {
      return res.status(400).json({ error: 'Invalid handshakeId format' });
    }

    const TREE_KEYPAIR_BASE58 = process.env.HANDSHAKE_TREE_KEYPAIR || '';
    const MERKLE_TREE_ADDRESS = process.env.HANDSHAKE_MERKLE_TREE || '';

    if (!TREE_KEYPAIR_BASE58 || !MERKLE_TREE_ADDRESS) {
      return res.status(500).json({ error: 'Merkle tree not configured' });
    }
    // Dynamic imports to avoid loading heavy deps for non-mint actions
    const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
    const { mintV1, mplBubblegum } = await import('@metaplex-foundation/mpl-bubblegum');
    const { createSignerFromKeypair, publicKey } = await import('@metaplex-foundation/umi');
    const { base58 } = await import('@metaplex-foundation/umi/serializers');

    const { data: handshake, error: hsError } = await supabase
      .from('handshakes')
      .select('id, status, initiator_user_id, receiver_user_id, initiator_nft_address, receiver_nft_address, initiator_tx_signature, receiver_tx_signature, initiator_wallet, receiver_wallet, contact_id, event_title')
      .eq('id', handshakeId)
      .single();

    if (hsError || !handshake) {
      return res.status(404).json({ error: 'Handshake not found' });
    }

    // Verify the authenticated user is a participant
    if (handshake.initiator_user_id !== authUser.id && handshake.receiver_user_id !== authUser.id) {
      return res.status(403).json({ error: 'Not authorized for this handshake' });
    }

    // Allow retry of partially-minted handshakes (one NFT succeeded, other failed).
    // A fully minted handshake with points already awarded is truly done.
    if (handshake.status === 'minted' && handshake.initiator_nft_address && handshake.receiver_nft_address) {
      return res.status(409).json({ error: 'Already minted' });
    }

    if (handshake.status !== 'matched' && handshake.status !== 'minted') {
      return res.status(400).json({ error: 'Handshake must be matched before minting' });
    }

    if (!handshake.initiator_tx_signature || !handshake.receiver_tx_signature) {
      return res.status(400).json({ error: 'Both parties must pay before minting' });
    }

    const umi = createUmi(SOLANA_RPC).use(mplBubblegum());
    const keypairBytes = base58.serialize(TREE_KEYPAIR_BASE58);
    const keypair = umi.eddsa.createKeypairFromSecretKey(keypairBytes);
    const signer = createSignerFromKeypair(umi, keypair);
    umi.identity = signer;
    umi.payer = signer;

    const eventInfo = handshake.event_title || 'Meeting';

    // Look up names for both parties (for points history display)
    const { data: initiatorUserData } = await supabase.auth.admin.getUserById(handshake.initiator_user_id);
    const initiatorName = initiatorUserData?.user?.user_metadata?.full_name
      || initiatorUserData?.user?.email?.split('@')[0]
      || 'Unknown';

    let receiverName = 'Unknown';
    if (handshake.receiver_user_id) {
      const { data: receiverUserData } = await supabase.auth.admin.getUserById(handshake.receiver_user_id);
      receiverName = receiverUserData?.user?.user_metadata?.full_name
        || receiverUserData?.user?.email?.split('@')[0]
        || 'Unknown';
    }

    // Also look up contact name from the initiator's contact record
    let contactName = receiverName;
    if (handshake.contact_id) {
      const { data: contactData } = await supabase
        .from('contacts')
        .select('first_name, last_name')
        .eq('id', handshake.contact_id)
        .single();
      if (contactData) {
        contactName = `${contactData.first_name} ${contactData.last_name}`.trim() || receiverName;
      }
    }

    // Bubblegum cNFTs limit the URI to ~200 chars. Use a short empty placeholder
    // since on-chain metadata (name) already identifies the handshake.
    const metadataUri = '';

    async function mintCNFT(recipient: string) {
      const { signature } = await mintV1(umi, {
        leafOwner: publicKey(recipient),
        merkleTree: publicKey(MERKLE_TREE_ADDRESS),
        metadata: {
          name: `Handshake: ${eventInfo}`,
          uri: metadataUri,
          sellerFeeBasisPoints: 0,
          collection: null,
          creators: [],
        },
      }).sendAndConfirm(umi);
      return base58.deserialize(signature)[0];
    }

    // Idempotent minting: skip NFTs that were already minted in a prior (partial) attempt.
    // Save each NFT to DB immediately after minting to prevent double-mint on retry.
    let initiatorNftSig = handshake.initiator_nft_address as string | null;
    let receiverNftSig = handshake.receiver_nft_address as string | null;

    if (!initiatorNftSig) {
      initiatorNftSig = await mintCNFT(handshake.initiator_wallet);
      const { error: saveErr1 } = await supabase
        .from('handshakes')
        .update({ initiator_nft_address: initiatorNftSig })
        .eq('id', handshakeId);
      if (saveErr1) console.error('Failed to save initiator NFT address:', saveErr1);
    }

    if (!receiverNftSig) {
      receiverNftSig = await mintCNFT(handshake.receiver_wallet);
      const { error: saveErr2 } = await supabase
        .from('handshakes')
        .update({ receiver_nft_address: receiverNftSig })
        .eq('id', handshakeId);
      if (saveErr2) console.error('Failed to save receiver NFT address:', saveErr2);
    }

    // Both minted — finalize status and award points
    await supabase
      .from('handshakes')
      .update({
        status: 'minted',
        points_awarded: POINTS_PER_HANDSHAKE,
      })
      .eq('id', handshakeId);

    // Idempotent points: only insert if not already awarded for this handshake
    const { count: existingPoints } = await supabase
      .from('user_points')
      .select('id', { count: 'exact', head: true })
      .eq('handshake_id', handshakeId);

    if (!existingPoints || existingPoints === 0) {
      await supabase.from('user_points').insert([
        {
          user_id: handshake.initiator_user_id,
          handshake_id: handshakeId,
          points: POINTS_PER_HANDSHAKE,
          reason: `Handshake: ${contactName}`,
        },
        {
          user_id: handshake.receiver_user_id,
          handshake_id: handshakeId,
          points: POINTS_PER_HANDSHAKE,
          reason: `Handshake: ${initiatorName}`,
        },
      ]);
    }

    for (const uid of [handshake.initiator_user_id, handshake.receiver_user_id]) {
      if (uid) {
        const { count } = await supabase
          .from('handshakes')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'minted')
          .or(`initiator_user_id.eq.${uid},receiver_user_id.eq.${uid}`);

        await supabase
          .from('trust_scores')
          .upsert({
            user_id: uid,
            total_handshakes: count || 0,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
      }
    }

    return res.status(200).json({
      status: 'minted',
      initiatorNft: initiatorNftSig,
      receiverNft: receiverNftSig,
      pointsAwarded: POINTS_PER_HANDSHAKE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Mint error:', message, error);
    return res.status(500).json({ error: `Failed to mint handshake NFTs: ${message}` });
  }
}

// ──────────────────────────────────────────────
// Pending
// ──────────────────────────────────────────────

async function handlePending(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const userId = authUser.id;
    const { data: telegramLink } = await supabase
      .from('telegram_links')
      .select('telegram_username')
      .eq('user_id', userId)
      .single();

    const { data: pendingUser } = await supabase.auth.admin.getUserById(userId);
    const userEmail = pendingUser?.user?.email;
    const userTelegram = telegramLink?.telegram_username;

    // Part 1: Unclaimed pending handshakes addressed to this user by identifier
    let pendingRows: Record<string, unknown>[] = [];
    if (userEmail || userTelegram) {
      const identifiers: string[] = [];
      if (userTelegram) {
        identifiers.push(userTelegram.toLowerCase());
        identifiers.push(`@${userTelegram.toLowerCase()}`);
      }
      if (userEmail) {
        identifiers.push(userEmail.toLowerCase());
      }

      const { data, error } = await supabase
        .from('handshakes')
        .select('id, initiator_user_id, receiver_identifier, event_title, event_date, status, created_at, expires_at')
        .eq('status', 'pending')
        .is('receiver_user_id', null)
        .neq('initiator_user_id', userId)
        .in('receiver_identifier', identifiers)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching pending handshakes:', error);
      } else {
        pendingRows = data || [];
      }
    }

    // Part 2: All handshakes where user is already the receiver (claimed/matched/minted)
    // These need initiator info enrichment so the client can match them to contacts.
    const { data: receiverRows, error: receiverError } = await supabase
      .from('handshakes')
      .select('id, initiator_user_id, receiver_user_id, receiver_identifier, contact_id, event_id, event_title, event_date, initiator_wallet, receiver_wallet, initiator_minted_at, receiver_minted_at, status, initiator_nft_address, receiver_nft_address, initiator_tx_signature, receiver_tx_signature, points_awarded, mint_fee_lamports, created_at, expires_at')
      .eq('receiver_user_id', userId)
      .in('status', ['claimed', 'matched', 'minted'])
      .order('created_at', { ascending: false });

    if (receiverError) {
      console.error('Error fetching receiver handshakes:', receiverError);
    }

    // Collect all initiator user IDs for enrichment
    const allRows = [...pendingRows, ...(receiverRows || [])];
    const initiatorIds = [...new Set(allRows.map((h) => h.initiator_user_id as string))];

    const nameMap: Record<string, string> = {};
    const emailMap: Record<string, string> = {};
    for (const uid of initiatorIds) {
      const { data: initiator } = await supabase.auth.admin.getUserById(uid);
      if (initiator?.user) {
        nameMap[uid] =
          initiator.user.user_metadata?.full_name ||
          initiator.user.email?.split('@')[0] ||
          'Someone';
        emailMap[uid] = initiator.user.email || '';
      }
    }

    const enriched = allRows.map((h) => ({
      ...h,
      initiator_name: nameMap[h.initiator_user_id as string] || 'Someone',
      initiator_email: emailMap[h.initiator_user_id as string] || '',
    }));

    return res.status(200).json({ handshakes: enriched });
  } catch (error) {
    console.error('Pending handshakes error:', error);
    return res.status(500).json({ error: 'Failed to fetch pending handshakes' });
  }
}

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const action = req.query.action as string;

    switch (action) {
      case 'initiate':
        return await handleInitiate(req, res);
      case 'claim':
        return await handleClaim(req, res);
      case 'confirm-tx':
        return await handleConfirmTx(req, res);
      case 'mint':
        return await handleMint(req, res);
      case 'pending':
        return await handlePending(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action. Use ?action=initiate|claim|confirm-tx|mint|pending' });
    }
  } catch (error) {
    console.error('Handshake handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
