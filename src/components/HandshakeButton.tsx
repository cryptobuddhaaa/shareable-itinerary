/**
 * HandshakeButton — appears on each contact card.
 * Initiates a Proof of Handshake flow: creates a pending handshake,
 * builds a 0.01 SOL transaction, and has the user sign it.
 */

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { useHandshakes } from '../hooks/useHandshakes';
import { useUserWallet } from '../hooks/useUserWallet';
import { HANDSHAKE_FEE_SOL, POINTS_PER_HANDSHAKE } from '../lib/constants';
import { toast } from './Toast';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';
import { isTelegramWebApp as checkTelegramWebApp } from '../lib/telegram';
import { authFetch } from '../lib/authFetch';
import type { Contact, Handshake } from '../models/types';

interface HandshakeButtonProps {
  contact: Contact;
  userId: string;
}

export function HandshakeButton({ contact, userId }: HandshakeButtonProps) {
  const { signTransaction } = useWallet();
  const { getPrimaryWallet } = useUserWallet();
  const { initiate, confirmTx, mint, getByContactId, getByIdentifier, getByInitiatorName, getByInitiatorEmail } = useHandshakes();
  const [loading, setLoading] = useState(false);
  const [tgGenerating, setTgGenerating] = useState(false);
  const { confirm, dialogProps } = useConfirmDialog();

  const isTelegramWebApp = checkTelegramWebApp();

  const contactFullName = `${contact.firstName} ${contact.lastName}`;
  const existingHandshake = getByContactId(contact.id)
    || getByIdentifier(contact.telegramHandle || '')
    || getByIdentifier(contact.email || '')
    || getByInitiatorName(contactFullName)
    || getByInitiatorEmail(contact.email || '');
  const wallet = getPrimaryWallet();

  // Don't show if contact has no telegram/email (can't claim)
  if (!contact.telegramHandle && !contact.email) return null;

  const getStatusInfo = (hs: Handshake) => {
    switch (hs.status) {
      case 'pending':
        return { label: 'Pending', color: 'text-yellow-400', bgColor: 'bg-yellow-900/30 border-yellow-700/50' };
      case 'claimed':
        return { label: 'Claimed', color: 'text-orange-400', bgColor: 'bg-orange-900/30 border-orange-700/50' };
      case 'matched':
        return { label: 'Matched', color: 'text-blue-400', bgColor: 'bg-blue-900/30 border-blue-700/50' };
      case 'minted':
        return { label: 'Minted Handshake', color: 'text-green-400', bgColor: 'bg-green-900/30 border-green-700/50' };
      default:
        return { label: hs.status, color: 'text-slate-400', bgColor: 'bg-slate-800 border-slate-700' };
    }
  };

  // Check if this is a stuck pending handshake (user cancelled wallet signing)
  const isStuckPending = existingHandshake
    && existingHandshake.status === 'pending'
    && existingHandshake.initiatorUserId === userId
    && !existingHandshake.initiatorTxSignature;

  if (existingHandshake && !isStuckPending) {
    const info = getStatusInfo(existingHandshake);
    const nftSig = existingHandshake.status === 'minted'
      ? (existingHandshake.initiatorUserId === userId
          ? existingHandshake.initiatorNftAddress
          : existingHandshake.receiverNftAddress)
      : null;
    const cluster = (import.meta.env.VITE_SOLANA_NETWORK as string) || 'devnet';
    const explorerUrl = nftSig
      ? `https://explorer.solana.com/tx/${nftSig}${cluster !== 'mainnet-beta' ? `?cluster=${cluster}` : ''}`
      : null;

    const canMint = existingHandshake.status === 'matched';

    const handleMint = async () => {
      setLoading(true);
      try {
        toast.info('Minting NFTs...');
        await mint(existingHandshake.id);
        toast.success('Proof of Handshake NFTs minted!');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        toast.error(`Minting failed: ${msg}`);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border ${info.bgColor}`}>
        <svg className={`w-3.5 h-3.5 ${info.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-400 hover:text-green-300 hover:underline flex items-center gap-1"
            title="View NFT on Solana Explorer"
          >
            Minted Handshake
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ) : canMint ? (
          <button
            onClick={handleMint}
            disabled={loading}
            className="text-blue-400 hover:text-blue-300 underline"
          >
            {loading ? 'Minting...' : 'Mint Handshake NFTs'}
          </button>
        ) : (
          <span className={info.color}>{info.label}</span>
        )}
        {existingHandshake.pointsAwarded > 0 && (
          <span className="text-green-400 ml-1">+{existingHandshake.pointsAwarded}pts</span>
        )}
      </div>
    );
  }

  // In Telegram webview, prompt user to open in wallet browser instead
  const handleTelegramConnect = async () => {
    if (tgGenerating) return;
    setTgGenerating(true);
    try {
      const response = await authFetch('/api/auth/wallet-login', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to generate login link');
      const { url } = await response.json();

      const ok = await confirm({
        title: 'Connect wallet',
        message:
          'To send a handshake, you need to open this app in your wallet browser (Phantom).\n\n' +
          'Tap OK to copy a one-time login link, then paste it into your wallet browser.',
        confirmLabel: 'OK',
      });
      if (!ok) return;

      let didCopy = false;
      try {
        await navigator.clipboard.writeText(url);
        didCopy = true;
      } catch { /* not available */ }
      if (!didCopy) {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = url;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          textarea.style.top = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          didCopy = document.execCommand('copy');
          document.body.removeChild(textarea);
        } catch { /* fallback failed */ }
      }

      if (didCopy) {
        toast.success('Link copied! Paste it in your wallet browser.');
      } else {
        toast.error('Could not copy link. Please use the Connect wallet button in the header.');
      }
    } catch {
      toast.error('Failed to generate login link. Please try again.');
    } finally {
      setTgGenerating(false);
    }
  };

  const handleInitiate = async () => {
    if (!wallet) {
      if (isTelegramWebApp) {
        await handleTelegramConnect();
        return;
      }
      toast.error('Connect and verify your wallet first');
      return;
    }

    if (!signTransaction) {
      toast.error('Wallet does not support transaction signing');
      return;
    }

    // Show confirmation dialog (skip for retry — user already confirmed before)
    if (!isStuckPending) {
      const confirmed = await confirm({
        title: 'Send Proof of Handshake?',
        message: `This will send a handshake request to ${contact.firstName} ${contact.lastName}. You'll pay ${HANDSHAKE_FEE_SOL} SOL to confirm your connection. When they accept and pay ${HANDSHAKE_FEE_SOL} SOL, you'll both receive a soulbound NFT as proof and earn ${POINTS_PER_HANDSHAKE} points.`,
        confirmLabel: 'Send Handshake',
        variant: 'default',
      });

      if (!confirmed) return;
    }

    setLoading(true);
    try {
      const result = await initiate(userId, contact.id, wallet.walletAddress);
      if (!result) {
        toast.error('Failed to create handshake');
        return;
      }

      // Decode and sign the transaction
      const txBytes = Uint8Array.from(atob(result.transaction), (c) => c.charCodeAt(0));
      const transaction = Transaction.from(txBytes);
      const signedTx = await signTransaction(transaction);

      // Submit the signed transaction
      const serialized = signedTx.serialize();
      const base64Tx = btoa(String.fromCharCode(...serialized));
      const confirmResult = await confirmTx(
        result.handshakeId,
        base64Tx,
        'initiator'
      );

      if (confirmResult?.txSignature) {
        toast.success(
          `Handshake sent to ${result.contactName}! Tx: ${confirmResult.txSignature.slice(0, 8)}...`
        );

        // Auto-mint if both parties have paid
        if (confirmResult.bothPaid) {
          toast.info('Both parties paid! Minting NFTs...');
          const minted = await mint(result.handshakeId);
          if (minted) {
            toast.success('Proof of Handshake NFTs minted!');
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('already exists')) {
        toast.info('A handshake already exists with this person');
      } else if (message.includes('User rejected')) {
        toast.info('Transaction cancelled. Click "Retry" to try again.');
      } else {
        toast.error(message || 'Failed to initiate handshake');
      }
    } finally {
      setLoading(false);
    }
  };

  const isDisabledNoWallet = !wallet && !isTelegramWebApp;

  return (
    <>
      <div className="relative group">
        <button
          onClick={handleInitiate}
          disabled={loading || tgGenerating || isDisabledNoWallet}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors ${
            wallet || isTelegramWebApp
              ? 'bg-purple-900/30 border-purple-700/50 text-purple-300 hover:bg-purple-900/50 hover:text-purple-200'
              : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
          }`}
          title={wallet ? `Send handshake to ${contact.firstName} (${HANDSHAKE_FEE_SOL} SOL)` : isTelegramWebApp ? 'Open in wallet browser to send handshake' : undefined}
          aria-label={`Send handshake to ${contact.firstName} ${contact.lastName}`}
        >
          {loading || tgGenerating ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0 0v2.5m0-2.5h2.5M7 14H4.5m11-3.5V14m0 0v2.5m0-2.5h2.5M15.5 14H13" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" />
            </svg>
          )}
          <span>{loading ? 'Signing...' : tgGenerating ? 'Generating...' : isStuckPending ? 'Retry' : 'Handshake'}</span>
        </button>
        {isDisabledNoWallet && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 pointer-events-none">
            <div className="bg-slate-900 border border-slate-600 text-slate-200 text-xs rounded-md px-3 py-2 whitespace-nowrap shadow-lg">
              Connect & verify your wallet to send handshakes
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-600" />
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog {...dialogProps} />
    </>
  );
}
