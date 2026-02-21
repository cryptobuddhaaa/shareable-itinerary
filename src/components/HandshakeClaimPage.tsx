/**
 * HandshakeClaimPage — landing page for receivers claiming a handshake.
 * URL pattern: ?claim=<handshakeId>
 */

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { useAuth } from '../hooks/useAuth';
import { useHandshakes } from '../hooks/useHandshakes';
import { useUserWallet } from '../hooks/useUserWallet';
import { authFetch } from '../lib/authFetch';
import { HANDSHAKE_FEE_SOL, POINTS_PER_HANDSHAKE } from '../lib/constants';
import { toast } from './Toast';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

interface ClaimData {
  handshakeId: string;
  status: string;
  transaction: string;
  initiatorName: string;
}

interface HandshakeClaimPageProps {
  handshakeId: string;
  onDone: () => void;
}

export function HandshakeClaimPage({ handshakeId, onDone }: HandshakeClaimPageProps) {
  const { user } = useAuth();
  const { connected, publicKey, signTransaction, signMessage } = useWallet();
  const { getPrimaryWallet, linkWallet, verifyWallet } = useUserWallet();
  const { initialize: refreshHandshakes } = useHandshakes();
  const [claimData, setClaimData] = useState<ClaimData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const verifyAttempted = useRef(false);
  const { confirm, dialogProps } = useConfirmDialog();
  const [tgGenerating, setTgGenerating] = useState(false);
  const [tgLoginUrl, setTgLoginUrl] = useState<string | null>(null);
  const [tgCopied, setTgCopied] = useState(false);

  const wallet = getPrimaryWallet();

  const isTelegramWebApp = typeof window !== 'undefined' &&
    (!!(window as unknown as Record<string, unknown>).TelegramWebviewProxy || location.hash.includes('tgWebAppData'));

  // Auto-link and verify wallet when connected but not yet verified
  useEffect(() => {
    if (!user || !connected || !publicKey || !signMessage || wallet || verifyAttempted.current) return;

    verifyAttempted.current = true;

    const autoVerify = async () => {

      try {
        const walletAddress = publicKey.toBase58();
        const linked = await linkWallet(user.id, walletAddress);
        if (!linked) {
          setError('Failed to link wallet. Please try again.');
          return;
        }

        if (linked.verifiedAt) {
          // Already verified from a previous session
          return;
        }

        if (typeof signMessage !== 'function') {
          setError('Wallet does not support message signing. Please use Phantom.');
          return;
        }

        // Match the exact format the verify API expects
        const message = `Verify wallet ownership for Shareable Itinerary\n\nUser: ${user.id}\nTimestamp: ${Date.now()}`;
        const encodedMessage = new TextEncoder().encode(message);
        const signatureBytes = await signMessage(encodedMessage);
        const signatureBase58 = bs58.encode(signatureBytes);

        const verified = await verifyWallet(linked.id, signatureBase58, message, walletAddress);
        if (!verified) {
          setError('Wallet verification failed. Please try again.');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to verify wallet';
        if (msg.includes('User rejected')) {
          toast.info('Wallet verification cancelled. Please approve the signature to continue.');
        } else {
          setError(msg);
        }
      }
    };

    autoVerify();
  }, [user, connected, publicKey, signMessage, wallet, linkWallet, verifyWallet]);

  // Step 1: Claim the handshake (get transaction to sign)
  const claimAttempted = useRef(false);
  useEffect(() => {
    if (!user || !wallet || claimAttempted.current) return;
    claimAttempted.current = true;

    const claim = async () => {
      setLoading(true);
      try {
        const response = await authFetch('/api/handshake?action=claim', {
          method: 'POST',
          body: JSON.stringify({
            handshakeId,
            walletAddress: wallet.walletAddress,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          // If the handshake is already claimed/matched/minted, treat as success
          if (err.status === 'matched' || err.status === 'minted' || err.status === 'claimed') {
            setSuccess(true);
            return;
          }
          setError(err.error || 'Failed to claim handshake');
          return;
        }

        const data = await response.json();
        setClaimData(data);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    claim();
  }, [handshakeId, user, wallet]);

  const handleSign = async () => {
    if (!claimData || !signTransaction) return;

    setSigning(true);
    try {
      const txBytes = Uint8Array.from(atob(claimData.transaction), (c) => c.charCodeAt(0));
      const transaction = Transaction.from(txBytes);
      const signedTx = await signTransaction(transaction);

      const serialized = signedTx.serialize();
      const response = await authFetch('/api/handshake?action=confirm-tx', {
        method: 'POST',
        body: JSON.stringify({
          handshakeId: claimData.handshakeId,
          signedTransaction: btoa(String.fromCharCode(...serialized)),
          side: 'receiver',
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to confirm transaction');
      }

      const result = await response.json();

      // If both sides have paid, trigger minting
      if (result.bothPaid) {
        try {
          const mintResponse = await authFetch('/api/handshake?action=mint', {
            method: 'POST',
            body: JSON.stringify({ handshakeId: claimData.handshakeId }),
          });

          if (!mintResponse.ok) {
            const mintErr = await mintResponse.json().catch(() => ({}));
            console.error('Mint failed:', mintErr);
            toast.error(mintErr.error || 'NFT minting failed. It can be retried later.');
          } else {
            toast.success('Handshake confirmed and NFT minted!');
          }
        } catch (mintErr) {
          console.error('Mint network error:', mintErr);
          toast.error('NFT minting failed due to a network error.');
        }
      } else {
        toast.success('Handshake payment confirmed!');
      }

      // Refresh the Zustand store so Dashboard/HandshakeButton reflect the update
      if (user) {
        refreshHandshakes(user.id).catch(() => {});
      }

      setSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign';
      if (message.includes('User rejected')) {
        toast.info('Transaction cancelled');
      } else {
        toast.error(message);
      }
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-purple-900/30 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0 0v2.5m0-2.5h2.5M7 14H4.5m11-3.5V14m0 0v2.5m0-2.5h2.5M15.5 14H13" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Proof of Handshake</h1>
          <p className="text-slate-400 text-sm mt-1">Confirm your connection</p>
        </div>

        {success ? (
          <div className="text-center">
            <div className="bg-green-900/30 border border-green-700/50 rounded-lg p-4 mb-4">
              <svg className="w-8 h-8 mx-auto text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-green-300 font-medium">Handshake confirmed!</p>
              <p className="text-green-400/70 text-sm mt-1">
                Your soulbound NFT is being minted. +{POINTS_PER_HANDSHAKE} points!
              </p>
            </div>
            <button
              onClick={onDone}
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              Go to app
            </button>
          </div>
        ) : error ? (
          <div className="text-center">
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 mb-4">
              <p className="text-red-300">{error}</p>
            </div>
            <button
              onClick={onDone}
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              Go back to app
            </button>
          </div>
        ) : !user ? (
          <div className="text-center">
            <p className="text-slate-300 mb-4">Sign in to claim this handshake.</p>
            <p className="text-slate-400 text-sm">You'll need to be logged in and have a verified wallet.</p>
          </div>
        ) : !connected && isTelegramWebApp ? (
          <div className="text-center">
            <p className="text-slate-300 mb-4">You need to connect a wallet to claim this handshake.</p>
            <p className="text-slate-400 text-sm mb-4">Tap Connect wallet to generate a wallet-friendly link.</p>
            {tgLoginUrl ? (
              <div className="flex flex-col gap-2 mx-auto max-w-sm">
                <p className="text-xs text-slate-400">Long-press to select, then copy and paste in your wallet browser:</p>
                <div className="flex gap-1">
                  <input
                    type="text"
                    readOnly
                    value={tgLoginUrl}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-xs text-white font-mono break-all select-all"
                    style={{ userSelect: 'all', WebkitUserSelect: 'all' } as React.CSSProperties}
                  />
                  <button
                    onClick={() => setTgLoginUrl(null)}
                    className="px-2 py-1.5 text-xs text-slate-400 hover:text-white"
                    aria-label="Close"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={onDone}
                  className="text-blue-400 hover:text-blue-300 text-sm mt-2"
                >
                  Go to home
                </button>
              </div>
            ) : tgCopied ? (
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-1.5 text-green-400 text-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Link copied! Paste it in your wallet browser.
                </div>
                <button
                  onClick={onDone}
                  className="text-blue-400 hover:text-blue-300 text-sm"
                >
                  Go to home
                </button>
              </div>
            ) : (
              <button
                onClick={async () => {
                  if (tgGenerating) return;
                  setTgGenerating(true);
                  try {
                    const response = await authFetch('/api/auth/wallet-login', { method: 'POST' });
                    if (!response.ok) throw new Error('Failed to generate login link');
                    const { url: baseUrl } = await response.json();
                    // Append claim param so the wallet browser lands on the claim page
                    const claimUrl = `${baseUrl}&claim=${handshakeId}`;

                    const ok = await confirm({
                      title: 'Connect wallet',
                      message:
                        'To claim this handshake, you need to open this link in your wallet browser (Phantom or Solflare).\n\n' +
                        'Tap OK to copy the link, then paste it into your wallet browser.',
                      confirmLabel: 'OK',
                    });
                    if (!ok) return;

                    // Try clipboard
                    let didCopy = false;
                    try {
                      await navigator.clipboard.writeText(claimUrl);
                      didCopy = true;
                    } catch { /* not available */ }
                    if (!didCopy) {
                      try {
                        const textarea = document.createElement('textarea');
                        textarea.value = claimUrl;
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
                      setTgCopied(true);
                    } else {
                      setTgLoginUrl(claimUrl);
                    }
                  } catch {
                    toast.error('Failed to generate login link. Please try again.');
                  } finally {
                    setTgGenerating(false);
                  }
                }}
                disabled={tgGenerating}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                {tgGenerating ? 'Generating...' : 'Connect wallet'}
              </button>
            )}
            <ConfirmDialog {...dialogProps} />
          </div>
        ) : !connected ? (
          <div className="text-center">
            <p className="text-slate-300 mb-4">Connect your Solana wallet to proceed.</p>
            <div className="flex justify-center">
              <WalletMultiButton />
            </div>
          </div>
        ) : !wallet ? (
          <div className="text-center">
            <svg className="w-8 h-8 animate-spin mx-auto text-purple-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-slate-400 mt-2">Verifying wallet...</p>
            <p className="text-slate-500 text-xs mt-1">Please approve the signature request in your wallet.</p>
          </div>
        ) : loading ? (
          <div className="text-center">
            <svg className="w-8 h-8 animate-spin mx-auto text-purple-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-slate-400 mt-2">Loading handshake...</p>
          </div>
        ) : claimData ? (
          <div>
            <div className="bg-slate-700/50 rounded-lg p-4 mb-4">
              <p className="text-white font-medium">{claimData.initiatorName}</p>
              <p className="text-slate-400 text-sm mt-1">
                Fee: {HANDSHAKE_FEE_SOL} SOL to confirm this handshake
              </p>
            </div>
            <button
              onClick={handleSign}
              disabled={signing}
              className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-600 text-white font-medium rounded-lg transition-colors"
            >
              {signing ? 'Signing transaction...' : `Confirm & Pay ${HANDSHAKE_FEE_SOL} SOL`}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
