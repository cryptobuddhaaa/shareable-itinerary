import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// Register Solflare with Wallet Standard (replaces legacy @solana/wallet-adapter-solflare)
import { initialize as initializeSolflare } from '@solflare-wallet/wallet-adapter';
initializeSolflare();

// Register Mobile Wallet Adapter for Android MWA support
import {
  registerMwa,
  createDefaultWalletNotFoundHandler,
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
} from '@solana-mobile/wallet-standard-mobile';

registerMwa({
  appIdentity: {
    name: 'Shareable Itinerary',
    uri: typeof window !== 'undefined' ? window.location.origin : 'https://localhost',
  },
  authorizationCache: createDefaultAuthorizationCache(),
  chains: ['solana:devnet' as const],
  chainSelector: createDefaultChainSelector(),
  onWalletNotFound: createDefaultWalletNotFoundHandler(),
});

import '@solana/wallet-adapter-react-ui/styles.css';

interface SolanaWalletProviderProps {
  children: React.ReactNode;
}

export function SolanaWalletProvider({ children }: SolanaWalletProviderProps) {
  const network = (import.meta.env.VITE_SOLANA_NETWORK as 'devnet' | 'mainnet-beta') || 'devnet';
  const endpoint = import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl(network);

  // Empty array — Phantom auto-registers via Wallet Standard,
  // Solflare registered via initialize(), MWA registered via registerMwa()
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
