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
import { isTelegramWebApp as checkTelegramWebApp } from '../lib/telegram';
import { authFetch } from '../lib/authFetch';
import bs58 from 'bs58';

export function WalletButton() {
  const { user } = useAuth();
  const { publicKey, signMessage, connected, disconnect } = useWallet();
  const { linkWallet, verifyWallet, unlinkWallet, getPrimaryWallet } = useUserWallet();
  const [verifying, setVerifying] = useState(false);
  const { confirm, dialogProps } = useConfirmDialog();

  // Telegram webview state — hooks must be at top level (not inside conditionals)
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showLoginUrl, setShowLoginUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      const message = `Verify wallet ownership for Convenu\n\nUser: ${user.id}\nTimestamp: ${Date.now()}`;
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

  // Detect mobile browsers and Telegram WebApp — wallet adapter modals don't work
  // in mobile browsers (no extension) or Telegram's webview.
  // Guide users to copy a magic link and paste it into their wallet's in-app browser.
  const isMobile = checkTelegramWebApp() || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (isMobile && !connected) {

    // Copy text to clipboard with fallbacks for iOS Telegram webview
    const copyToClipboard = async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch { /* not available in this webview */ }
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) return true;
      } catch { /* execCommand not supported */ }
      return false;
    };

    // If showing the URL for manual copy (iOS fallback when clipboard fails)
    if (showLoginUrl) {
      return (
        <div className="flex flex-col gap-2 w-full max-w-sm">
          <p className="text-xs text-slate-400">Long-press to select, then copy and paste in your wallet browser:</p>
          <div className="flex gap-1">
            <input
              ref={inputRef}
              type="text"
              readOnly
              value={showLoginUrl}
              onFocus={(e) => e.target.select()}
              className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-xs text-white font-mono break-all select-all"
              style={{ userSelect: 'all', WebkitUserSelect: 'all' } as React.CSSProperties}
            />
            <button
              onClick={() => setShowLoginUrl(null)}
              className="px-2 py-1.5 text-xs text-slate-400 hover:text-white"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if (generating) return;
              setGenerating(true);
              try {
                // Generate the magic login link first
                const response = await authFetch('/api/auth/wallet-login', { method: 'POST' });
                if (!response.ok) throw new Error('Failed to generate login link');
                const { url } = await response.json();

                // Show instructions dialog, auto-copy when user taps OK
                const ok = await confirm({
                  title: 'Connect wallet',
                  message:
                    'To execute on-chain handshakes, you need to open this app in your wallet browser (Phantom).\n\n' +
                    'Tap OK to copy a one-time login link, then paste it into your wallet browser.',
                  confirmLabel: 'OK',
                });

                if (!ok) return;

                const didCopy = await copyToClipboard(url);
                if (didCopy) {
                  setCopied(true);
                  toast.success('Link copied! Paste it in your wallet browser.');
                  setTimeout(() => setCopied(false), 3000);
                } else {
                  // iOS fallback: show selectable URL input
                  setShowLoginUrl(url);
                }
              } catch {
                toast.error('Failed to generate login link. Please try again.');
              } finally {
                setGenerating(false);
              }
            }}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-900/40 border border-purple-700/50 rounded-md hover:bg-purple-900/60 transition-colors disabled:opacity-50"
            title="Connect wallet"
            aria-label="Connect wallet"
          >
            {generating ? (
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-purple-400 border-t-transparent" />
            ) : copied ? (
              <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
              </svg>
            )}
            <span className="text-xs text-purple-300">
              {generating ? 'Generating...' : copied ? 'Copied!' : 'Connect wallet'}
            </span>
          </button>
        </div>
        <ConfirmDialog {...dialogProps} />
      </>
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

  // Verified wallet but adapter disconnected — show connect button with address hint
  if (primaryWallet && !connected) {
    const shortAddress = `${primaryWallet.walletAddress.slice(0, 4)}...${primaryWallet.walletAddress.slice(-4)}`;
    return (
      <>
        <div className="flex items-center gap-2">
          <WalletMultiButton
            style={{ backgroundColor: 'rgb(126, 34, 206)' }}
          />
          <span className="text-xs text-slate-500 font-mono hidden sm:inline">{shortAddress}</span>
        </div>
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
