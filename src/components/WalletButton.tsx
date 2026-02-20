/**
 * Wallet connection button with verification flow.
 * Uses @solana/wallet-adapter for connection and our useUserWallet for DB persistence.
 *
 * Once a wallet is verified, the binding is PERMANENT — the wallet address
 * is used for soulbound NFT minting and cannot be changed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useUserWallet } from '../hooks/useUserWallet';
import { useAuth } from '../hooks/useAuth';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';
import { toast } from './Toast';
import bs58 from 'bs58';

export function WalletButton() {
  const { user } = useAuth();
  const { publicKey, signMessage, connected, disconnect } = useWallet();
  const { linkWallet, verifyWallet, unlinkWallet, getPrimaryWallet } = useUserWallet();
  const [verifying, setVerifying] = useState(false);
  const { confirm, dialogProps } = useConfirmDialog();

  const primaryWallet = getPrimaryWallet();
  const walletAddress = publicKey?.toBase58();

  // Guards to prevent double-fire and post-disconnect runs
  const isLinkingRef = useRef(false);
  const isDisconnectingRef = useRef(false);

  // Core link + verify flow. Called once when adapter connects.
  const handleLink = useCallback(async () => {
    // Read fresh from the store (not from a stale closure)
    const storeWallets = useUserWallet.getState().wallets;

    if (!user || !walletAddress) return;
    if (isLinkingRef.current || isDisconnectingRef.current) return;

    // Already verified this exact wallet — nothing to do
    const existing = storeWallets.find((w) => w.walletAddress === walletAddress);
    if (existing?.verifiedAt) return;

    // If user already has a DIFFERENT verified wallet, block immediately
    const verifiedWallet = storeWallets.find((w) => w.verifiedAt);
    if (verifiedWallet && verifiedWallet.walletAddress !== walletAddress) {
      toast.error(
        'This account is permanently bound to a different wallet. ' +
        'Soulbound NFTs and points are tied to that address and cannot be transferred.'
      );
      disconnect();
      return;
    }

    isLinkingRef.current = true;
    try {
      // Link wallet to DB
      const linked = existing || await linkWallet(user.id, walletAddress);
      if (!linked) {
        toast.error('Failed to link wallet. Please try again.');
        disconnect();
        return;
      }

      // If already verified (e.g. from linkWallet returning existing), done
      if (linked.verifiedAt) return;

      // Guard: signMessage must be available
      if (typeof signMessage !== 'function') {
        disconnect();
        return;
      }

      // --- Confirmation dialog (only for first-time verification) ---
      const confirmed = await confirm({
        title: 'Link wallet to your account',
        message:
          'This wallet address will be permanently bound to your account. ' +
          'All soulbound Proof-of-Handshake NFTs and points will be minted to this address. ' +
          'This cannot be changed later.\n\n' +
          `Wallet: ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`,
        confirmLabel: 'Link Wallet',
      });

      if (!confirmed) {
        toast.info('Wallet linking cancelled.');
        await unlinkWallet(linked.id);
        disconnect();
        return;
      }

      // --- Signature verification ---
      setVerifying(true);
      const message = `Verify wallet ownership for Shareable Itinerary\n\nUser: ${user.id}\nTimestamp: ${Date.now()}`;
      const encoded = new TextEncoder().encode(message);

      // Guard again — adapter may have disconnected while dialog was open
      if (typeof signMessage !== 'function') {
        await unlinkWallet(linked.id);
        return;
      }

      const signature = await signMessage(encoded);
      const signatureBase58 = bs58.encode(signature);

      const verified = await verifyWallet(linked.id, signatureBase58, message, walletAddress);
      if (verified) {
        toast.success('Wallet verified and linked!');
      } else {
        toast.error('Wallet verification failed. Please try again.');
        await unlinkWallet(linked.id);
        disconnect();
      }
    } catch (error) {
      if (isDisconnectingRef.current) return; // swallow errors during disconnect

      const msg = (error as Error)?.message || '';
      if (msg.includes('rejected') || msg.includes('User rejected')) {
        toast.info('Wallet verification cancelled.');
      } else if (msg.includes('already')) {
        toast.error(msg);
      } else if (msg.includes('signMessage') || msg.includes('is not a function')) {
        // Wallet disconnected mid-flow — suppress cryptic adapter errors
        console.warn('[Wallet] Adapter disconnected during verification');
      } else {
        console.error('Wallet verification error:', error);
        toast.error('Wallet verification failed. Please try again.');
      }
      // Clean up unverified entry
      const storeNow = useUserWallet.getState().wallets;
      const unverified = storeNow.find((w) => w.walletAddress === walletAddress && !w.verifiedAt);
      if (unverified) {
        await unlinkWallet(unverified.id);
      }
      if (connected) disconnect();
    } finally {
      isLinkingRef.current = false;
      setVerifying(false);
    }
  }, [user, walletAddress, signMessage, connected, linkWallet, verifyWallet, unlinkWallet, disconnect, confirm]);

  // Trigger handleLink when adapter connects — deps are minimal to avoid re-fires.
  // The ref guard (isLinkingRef) prevents the double-fire caused by wallets/signMessage dep changes.
  useEffect(() => {
    if (connected && walletAddress && user && !isDisconnectingRef.current) {
      handleLink();
    }
  }, [connected, walletAddress, user, handleLink]);

  // Disconnect handler — just disconnects the adapter session.
  // Once a wallet is verified, the DB binding is PERMANENT (no unlinkAllWallets).
  const handleDisconnect = useCallback(async () => {
    isDisconnectingRef.current = true;
    // Only clean up unverified (incomplete) entries, never verified ones
    const storeWallets = useUserWallet.getState().wallets;
    for (const w of storeWallets) {
      if (!w.verifiedAt) {
        await unlinkWallet(w.id);
      }
    }
    disconnect();
    // Small delay to let adapter state settle before allowing new connections
    setTimeout(() => { isDisconnectingRef.current = false; }, 300);
  }, [unlinkWallet, disconnect]);

  // When adapter disconnects externally (Phantom UI, extension, page unload),
  // clean up any unverified entries but preserve verified ones.
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (prevConnected.current && !connected && !isDisconnectingRef.current && user) {
      const storeWallets = useUserWallet.getState().wallets;
      const unverified = storeWallets.filter((w) => !w.verifiedAt);
      for (const w of unverified) {
        unlinkWallet(w.id);
      }
    }
    prevConnected.current = connected;
  }, [connected, user, unlinkWallet]);

  // If user already has a verified wallet but adapter connected to a DIFFERENT address,
  // block it immediately. Handles Phantom account-switch mid-session.
  useEffect(() => {
    if (!connected || !walletAddress || !primaryWallet) return;
    if (primaryWallet.walletAddress !== walletAddress) {
      toast.error(
        'Your account is permanently bound to wallet ' +
        `${primaryWallet.walletAddress.slice(0, 4)}...${primaryWallet.walletAddress.slice(-4)}. ` +
        'Please switch back to that wallet address. ' +
        'Connecting a different wallet would affect your soulbound NFTs and points.'
      );
      disconnect();
    }
  }, [connected, walletAddress, primaryWallet, disconnect]);

  // If wallet is connected and verified, show compact display
  if (primaryWallet && connected) {
    const shortAddress = `${primaryWallet.walletAddress.slice(0, 4)}...${primaryWallet.walletAddress.slice(-4)}`;
    return (
      <>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/40 border border-emerald-700/50 rounded-md">
            <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
            <span className="text-xs text-emerald-300 font-mono">{shortAddress}</span>
          </div>
          <button
            onClick={handleDisconnect}
            className="text-xs text-slate-500 hover:text-slate-300"
            title="Disconnect wallet session"
            aria-label="Disconnect wallet session"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ConfirmDialog {...dialogProps} />
      </>
    );
  }

  // Detect Telegram WebApp — wallets can't connect in Telegram's webview.
  // Guide users to open the app URL in their wallet's in-app browser.
  const isTelegramWebApp = typeof window !== 'undefined' &&
    (!!(window as unknown as Record<string, unknown>).TelegramWebviewProxy || location.hash.includes('tgWebAppData'));
  if (isTelegramWebApp && !primaryWallet && !connected) {
    const appUrl = window.location.origin;
    const [copied, setCopied] = useState(false);
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(appUrl);
              setCopied(true);
              toast.success('Link copied! Open it in your Phantom or Solflare browser.');
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Fallback: open in external browser
              try {
                window.Telegram?.WebApp.openLink(appUrl);
              } catch {
                window.open(appUrl, '_blank');
              }
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-900/40 border border-purple-700/50 rounded-md hover:bg-purple-900/60 transition-colors"
          title="Copy link to open in wallet browser"
          aria-label="Copy app link for wallet browser"
        >
          {copied ? (
            <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          )}
          <span className="text-xs text-purple-300">{copied ? 'Copied!' : 'Open in wallet browser'}</span>
        </button>
      </div>
    );
  }

  // If verifying, show spinner
  if (verifying) {
    return (
      <>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 rounded-md">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-purple-400 border-t-transparent"></div>
          <span className="text-xs text-slate-300">Verifying...</span>
        </div>
        <ConfirmDialog {...dialogProps} />
      </>
    );
  }

  // Verified wallet but adapter disconnected — show reconnect button
  if (primaryWallet && !connected) {
    const shortAddress = `${primaryWallet.walletAddress.slice(0, 4)}...${primaryWallet.walletAddress.slice(-4)}`;
    return (
      <>
        <WalletMultiButton
          style={{ backgroundColor: 'rgb(71, 85, 105)' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#64748b', display: 'inline-block', flexShrink: 0 }} />
            {shortAddress} — Reconnect
          </span>
        </WalletMultiButton>
        <ConfirmDialog {...dialogProps} />
      </>
    );
  }

  // Default: show wallet connect button
  return (
    <>
      <WalletMultiButton
        style={{ backgroundColor: 'rgb(126, 34, 206)' }}
      />
      <ConfirmDialog {...dialogProps} />
    </>
  );
}
