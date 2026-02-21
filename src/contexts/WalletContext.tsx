import { useCallback, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { WalletError, WalletConnectionError } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { clusterApiUrl } from '@solana/web3.js';

// Solflare's iOS in-app browser sets window.solflareWalletStandardInitialized to a
// WKWebView UserMessageHandler (truthy), which causes the SDK's initialize() to bail
// out thinking registration already happened. Reset it before calling initialize()
// so the Wallet Standard wallet actually gets registered.
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  if (w.solflareWalletStandardInitialized && w.solflareWalletStandardInitialized !== true) {
    w.solflareWalletStandardInitialized = undefined;
  }
}

// This must be called AFTER resetting the flag above.
// initialize() registers a Wallet Standard wallet via registerWallet(new SolflareWallet()).
// The iframe (which caused the iOS freeze) is only created later during connect(), not here.
import { initialize as initializeSolflare } from '@solflare-wallet/wallet-adapter';
initializeSolflare();

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
  // Solflare: Registered via Wallet Standard by initializeSolflare() above.
  // Do NOT add SolflareWalletAdapter here — it would shadow the Wallet Standard one.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter()],
    [],
  );

  const onError = useCallback((error: WalletError) => {
    // Silently ignore autoConnect / silent-connect failures — the wallet adapter
    // retries on the next user-initiated connect anyway.
    if (error instanceof WalletConnectionError) {
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
