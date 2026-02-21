import { useCallback, useEffect, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { WalletError, WalletConnectionError, isWalletAdapterCompatibleStandardWallet } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { clusterApiUrl } from '@solana/web3.js';
import { getWallets } from '@wallet-standard/app';

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
  // Solflare: Do NOT add SolflareWalletAdapter here — it imports @solflare-wallet/sdk
  // whose connect() injects a fullscreen iframe that freezes iOS in-app browsers.
  // Solflare's in-app browser registers via Wallet Standard (solflareWalletStandardInitialized),
  // which @solana/wallet-adapter-react auto-detects. No manual adapter needed.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter()],
    [],
  );

  // ── DEBUG: Wallet Standard registry probe ──
  useEffect(() => {
    const dbg = (msg: string) => {
      const el = document.getElementById('__sfdbg') || (() => {
        const d = document.createElement('div');
        d.id = '__sfdbg';
        d.style.cssText =
          'position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow-y:auto;' +
          'background:rgba(0,0,0,0.9);color:#0f0;font:11px/1.4 monospace;padding:8px;z-index:999999;' +
          'pointer-events:auto;white-space:pre-wrap;';
        document.body.appendChild(d);
        return d;
      })();
      const ts = new Date().toISOString().slice(11, 23);
      el.textContent += `${ts} ${msg}\n`;
      el.scrollTop = el.scrollHeight;
    };

    const w = window as unknown as Record<string, unknown>;

    // 1. Dump SolflareApp keys
    const sfApp = w.SolflareApp;
    if (sfApp && typeof sfApp === 'object') {
      const keys = Object.getOwnPropertyNames(sfApp);
      dbg('SolflareApp keys: ' + keys.join(', '));
      const proto = Object.getPrototypeOf(sfApp);
      if (proto && proto !== Object.prototype) {
        const protoKeys = Object.getOwnPropertyNames(proto).filter(k => k !== 'constructor');
        dbg('SolflareApp proto: ' + protoKeys.join(', '));
      }
    } else {
      dbg('SolflareApp: ' + String(sfApp));
    }

    // 2. Check navigator.wallets
    const navWallets = (navigator as unknown as Record<string, unknown>).wallets;
    dbg('navigator.wallets type=' + typeof navWallets);
    if (navWallets && typeof navWallets === 'object') {
      dbg('navigator.wallets keys: ' + Object.keys(navWallets as object).join(', '));
      if (Array.isArray(navWallets)) {
        dbg('navigator.wallets is array, length=' + navWallets.length);
      }
    }

    // 3. Wallet Standard registry
    const { get, on, register } = getWallets();
    const all = get();
    dbg('[WalletStd] Registered wallets: ' + all.length);
    all.forEach((wallet, i) => {
      const features = Object.keys(wallet.features).join(', ');
      const compat = isWalletAdapterCompatibleStandardWallet(wallet);
      dbg(`  [${i}] "${wallet.name}" compat=${compat} features=${features}`);
    });

    // 4. Try to re-trigger wallet standard registration
    // Solflare may have registered before our listener was ready.
    // Reset the flag and re-dispatch app-ready to trigger re-registration.
    const wasInit = w.solflareWalletStandardInitialized;
    dbg('solflareWalletStandardInitialized=' + String(wasInit));
    if (wasInit) {
      dbg('Resetting flag and re-dispatching app-ready...');
      w.solflareWalletStandardInitialized = false;
      try {
        const api = Object.freeze({ register });
        window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
        dbg('app-ready dispatched');
      } catch (e) {
        dbg('app-ready dispatch failed: ' + (e as Error).message);
      }
      // Check again after a short delay
      setTimeout(() => {
        const after = get();
        dbg('[WalletStd] After re-trigger: ' + after.length + ' wallets');
        after.forEach((wallet, i) => {
          const features = Object.keys(wallet.features).join(', ');
          const compat = isWalletAdapterCompatibleStandardWallet(wallet);
          dbg(`  [${i}] "${wallet.name}" compat=${compat} features=${features}`);
        });
      }, 1000);
    }

    const off = on('register', (...wallets) => {
      dbg('[WalletStd] register event: +' + wallets.length + ' (' + wallets.map(wallet => wallet.name).join(', ') + ')');
      const updated = get();
      updated.forEach((wallet, i) => {
        const features = Object.keys(wallet.features).join(', ');
        const compat = isWalletAdapterCompatibleStandardWallet(wallet);
        dbg(`  [${i}] "${wallet.name}" compat=${compat} features=${features}`);
      });
    });
    return off;
  }, []);
  // ── END DEBUG ──

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
