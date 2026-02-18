/**
 * Wallet connection button with verification flow.
 * Uses @solana/wallet-adapter for connection and our useUserWallet for DB persistence.
 */

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useUserWallet } from '../hooks/useUserWallet';
import { useAuth } from '../hooks/useAuth';
import { toast } from './Toast';
import bs58 from 'bs58';

export function WalletButton() {
  const { user } = useAuth();
  const { publicKey, signMessage, connected, disconnect } = useWallet();
  const { wallets, linkWallet, verifyWallet, unlinkWallet, getPrimaryWallet } = useUserWallet();
  const [verifying, setVerifying] = useState(false);

  const primaryWallet = getPrimaryWallet();
  const walletAddress = publicKey?.toBase58();

  // When wallet connects, check if it needs linking/verification
  const handleLink = useCallback(async () => {
    if (!user || !walletAddress || !signMessage) return;

    // Check if this wallet is already linked and verified
    const existing = wallets.find((w) => w.walletAddress === walletAddress);
    if (existing?.verifiedAt) return;

    // Link wallet to DB if not already
    const linked = existing || await linkWallet(user.id, walletAddress);
    if (!linked) {
      toast.error('Failed to link wallet. Please try again.');
      return;
    }

    // If not verified, prompt for signature
    if (!linked.verifiedAt) {
      setVerifying(true);
      try {
        const message = `Verify wallet ownership for Shareable Itinerary\n\nUser: ${user.id}\nTimestamp: ${Date.now()}`;
        const encoded = new TextEncoder().encode(message);
        const signature = await signMessage(encoded);
        const signatureBase58 = bs58.encode(signature);

        const verified = await verifyWallet(linked.id, signatureBase58, message, walletAddress);
        if (verified) {
          toast.success('Wallet verified and linked!');
        } else {
          toast.error('Wallet verification failed. Please try again.');
        }
      } catch (error) {
        // User rejected the signature request
        if ((error as Error)?.message?.includes('rejected')) {
          toast.info('Wallet verification cancelled.');
        } else {
          console.error('Wallet verification error:', error);
          toast.error('Failed to verify wallet.');
        }
      } finally {
        setVerifying(false);
      }
    }
  }, [user, walletAddress, signMessage, wallets, linkWallet, verifyWallet]);

  // Auto-trigger link when wallet connects
  useEffect(() => {
    if (connected && walletAddress && user) {
      handleLink();
    }
  }, [connected, walletAddress, user, handleLink]);

  const handleDisconnect = useCallback(async () => {
    if (primaryWallet) {
      await unlinkWallet(primaryWallet.id);
    }
    disconnect();
  }, [primaryWallet, unlinkWallet, disconnect]);

  // If wallet is connected and verified, show compact display
  if (primaryWallet && connected) {
    const shortAddress = `${primaryWallet.walletAddress.slice(0, 4)}...${primaryWallet.walletAddress.slice(-4)}`;
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/40 border border-emerald-700/50 rounded-md">
          <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
          <span className="text-xs text-emerald-300 font-mono">{shortAddress}</span>
        </div>
        <button
          onClick={handleDisconnect}
          className="text-xs text-slate-500 hover:text-slate-300"
          title="Disconnect wallet"
          aria-label="Disconnect wallet"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // If verifying, show spinner
  if (verifying) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 rounded-md">
        <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-purple-400 border-t-transparent"></div>
        <span className="text-xs text-slate-300">Verifying...</span>
      </div>
    );
  }

  // Default: show wallet connect button
  return (
    <WalletMultiButton
      style={{
        height: '34px',
        fontSize: '12px',
        padding: '0 12px',
        borderRadius: '6px',
        backgroundColor: 'rgb(126, 34, 206)',
        lineHeight: '34px',
      }}
    />
  );
}
