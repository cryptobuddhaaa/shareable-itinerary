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
    const walletStd = getWallets();
    const { get, on } = walletStd;

    // Listen for any wallet-standard:register-wallet events (raw DOM level)
    window.addEventListener('wallet-standard:register-wallet', (e) => {
      dbg('CAUGHT wallet-standard:register-wallet event!');
      dbg('  event detail type: ' + typeof (e as CustomEvent).detail);
    });

    // Monitor wallet standard register events
    const off = on('register', (...registeredWallets) => {
      dbg('[WalletStd] register event: +' + registeredWallets.length);
      const updated = get();
      updated.forEach((wallet, i) => {
        const features = Object.keys(wallet.features).join(', ');
        const compat = isWalletAdapterCompatibleStandardWallet(wallet);
        dbg(`  [${i}] "${wallet.name}" compat=${compat}`);
        dbg(`    features: ${features}`);
      });
    });

    dbg('[WalletStd] Initial registered: ' + get().length);

    // Try to trigger native wallet standard registration via WKWebView handler
    const handler = w.solflareWalletStandardInitialized;
    dbg('handler type: ' + typeof handler + ' = ' + String(handler));

    if (handler && typeof (handler as { postMessage?: unknown }).postMessage === 'function') {
      dbg('Calling solflareWalletStandardInitialized.postMessage(null)...');
      try {
        (handler as { postMessage: (v: unknown) => void }).postMessage(null);
        dbg('postMessage(null) called OK');
      } catch (e) {
        dbg('postMessage(null) error: ' + (e as Error).message);
      }

      // Also try with empty string and empty object
      setTimeout(() => {
        dbg('After 500ms: registered=' + get().length);
        if (get().length === 0) {
          dbg('Trying postMessage("")...');
          try {
            (handler as { postMessage: (v: unknown) => void }).postMessage('');
            dbg('postMessage("") called OK');
          } catch (e) {
            dbg('postMessage("") error: ' + (e as Error).message);
          }
        }
      }, 500);

      // Also try via SolflareApp.postMessage
      setTimeout(() => {
        dbg('After 1s: registered=' + get().length);
        const sfApp = w.SolflareApp;
        if (get().length === 0 && sfApp && typeof (sfApp as { postMessage?: unknown }).postMessage === 'function') {
          dbg('Trying SolflareApp.postMessage wallet_standard_init...');
          try {
            (sfApp as { postMessage: (v: string) => void }).postMessage(JSON.stringify({
              type: 'wallet_standard_init'
            }));
            dbg('SolflareApp.postMessage called OK');
          } catch (e) {
            dbg('SolflareApp.postMessage error: ' + (e as Error).message);
          }
        }
      }, 1000);

      // Check window.webkit.messageHandlers too
      setTimeout(() => {
        dbg('After 2s: registered=' + get().length);
        const webkit = w.webkit as { messageHandlers?: Record<string, unknown> } | undefined;
        if (webkit?.messageHandlers) {
          const handlerNames = Object.keys(webkit.messageHandlers);
          dbg('webkit.messageHandlers: ' + handlerNames.join(', '));
        } else {
          dbg('No webkit.messageHandlers found');
        }
        // Also check if there's a solflare wallet standard script we can find
        const scripts = document.querySelectorAll('script[src*="solflare"]');
        dbg('Solflare scripts: ' + scripts.length);
        scripts.forEach((s, i) => dbg(`  [${i}] ${(s as HTMLScriptElement).src}`));
      }, 2000);
    } else {
      dbg('No postMessage on handler');
    }

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
