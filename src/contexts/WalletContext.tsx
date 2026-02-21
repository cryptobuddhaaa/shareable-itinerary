import { useCallback, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { WalletError, WalletConnectionError } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareInAppAdapter } from '../lib/SolflareInAppAdapter';
import { clusterApiUrl } from '@solana/web3.js';

// Register Mobile Wallet Adapter for Android MWA support (only on Android devices)
import {
  registerMwa,
  createDefaultWalletNotFoundHandler,
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
} from '@solana-mobile/wallet-standard-mobile';

if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) {
  try {
    registerMwa({
      appIdentity: {
        name: 'Shareable Itinerary',
        uri: window.location.origin,
      },
      authorizationCache: createDefaultAuthorizationCache(),
      chains: [import.meta.env.VITE_SOLANA_NETWORK === 'mainnet-beta' ? 'solana:mainnet' as const : 'solana:devnet' as const],
      chainSelector: createDefaultChainSelector(),
      onWalletNotFound: createDefaultWalletNotFoundHandler(),
    });
  } catch {
    // MWA not available on this device
  }
}

import '@solana/wallet-adapter-react-ui/styles.css';

interface SolanaWalletProviderProps {
  children: React.ReactNode;
}

export function SolanaWalletProvider({ children }: SolanaWalletProviderProps) {
  const network = (import.meta.env.VITE_SOLANA_NETWORK as 'devnet' | 'mainnet-beta') || 'devnet';
  const endpoint = import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl(network);

  // PhantomWalletAdapter: fallback for Phantom's iOS in-app browser where
  // Wallet Standard auto-detection has a timing race. Deduplicates automatically.
  //
  // SolflareInAppAdapter: lightweight adapter that wraps window.solflare directly.
  // The official SolflareWalletAdapter imports @solflare-wallet/sdk whose connect()
  // injects a fullscreen iframe that freezes Solflare's own in-app browser on iOS.
  // This adapter uses the native provider without any SDK import — no iframe, ever.
  // It only reports as Installed when window.solflare.isSolflare is detected.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareInAppAdapter()],
    [],
  );

  const onError = useCallback((error: WalletError) => {
    if (error instanceof WalletConnectionError) {
      // Show Solflare-specific connection errors (e.g., timeout) so user isn't stuck
      // on a silent "Connecting..." state. Other connection errors (autoConnect) stay silent.
      if (error.message?.includes('Solflare') || error.message?.includes('timed out')) {
        console.error('[Wallet] Solflare connection error:', error.message);
        alert(`Wallet connection failed: ${error.message}`);
        return;
      }
      console.warn('[Wallet] Connection attempt failed:', error.message);
      return;
    }
    // Surface all other wallet errors normally
    console.error('[Wallet]', error.name, error.message);
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
