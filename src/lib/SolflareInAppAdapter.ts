/**
 * Lightweight Solflare adapter for use ONLY inside Solflare's in-app browser.
 *
 * The official SolflareWalletAdapter from @solana/wallet-adapter-solflare ALWAYS
 * dynamically imports @solflare-wallet/sdk, whose connect() injects a fullscreen
 * iframe (z-index 99999, position: fixed, 100% w/h) from connect.solflare.com.
 * Inside Solflare's own in-app browser this iframe never resolves and blocks ALL
 * touch events.
 *
 * This adapter wraps `window.solflare` (the native provider Solflare's browser
 * injects) directly — no SDK import, no iframe. It only reports as "Installed"
 * when `window.solflare.isSolflare` is detected.
 */

import {
  BaseMessageSignerWalletAdapter,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
  scopePollingDetectionStrategy,
} from '@solana/wallet-adapter-base';
import type { WalletName } from '@solana/wallet-adapter-base';
import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

interface SolflareProvider {
  isSolflare: boolean;
  isConnected: boolean;
  publicKey: PublicKey | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

export const SolflareInAppWalletName = 'Solflare' as WalletName<'Solflare'>;

// Solflare logo from @solana/wallet-adapter-solflare
const ICON =
  'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c3ZnIGlkPSJTIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MCA1MCI+PGRlZnM+PHN0eWxlPi5jbHMtMXtmaWxsOiMwMjA1MGE7c3Ryb2tlOiNmZmVmNDY7c3Ryb2tlLW1pdGVybGltaXQ6MTA7c3Ryb2tlLXdpZHRoOi41cHg7fS5jbHMtMntmaWxsOiNmZmVmNDY7fTwvc3R5bGU+PC9kZWZzPjxyZWN0IGNsYXNzPSJjbHMtMiIgeD0iMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiByeD0iMTIiIHJ5PSIxMiIvPjxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTI0LjIzLDI2LjQybDIuNDYtMi4zOCw0LjU5LDEuNWMzLjAxLDEsNC41MSwyLjg0LDQuNTEsNS40MywwLDEuOTYtLjc1LDMuMjYtMi4yNSw0LjkzbC0uNDYuNS4xNy0xLjE3Yy42Ny00LjI2LS41OC02LjA5LTQuNzItNy40M2wtNC4zLTEuMzhoMFpNMTguMDUsMTEuODVsMTIuNTIsNC4xNy0yLjcxLDIuNTktNi41MS0yLjE3Yy0yLjI1LS43NS0zLjAxLTEuOTYtMy4zLTQuNTF2LS4wOGgwWk0xNy4zLDMzLjA2bDIuODQtMi43MSw1LjM0LDEuNzVjMi44LjkyLDMuNzYsMi4xMywzLjQ2LDUuMThsLTExLjY1LTQuMjJoMFpNMTMuNzEsMjAuOTVjMC0uNzkuNDItMS41NCwxLjEzLTIuMTcuNzUsMS4wOSwyLjA1LDIuMDUsNC4wOSwyLjcxbDQuNDIsMS40Ni0yLjQ2LDIuMzgtNC4zNC0xLjQyYy0yLS42Ny0yLjg0LTEuNjctMi44NC0yLjk2TTI2LjgyLDQyLjg3YzkuMTgtNi4wOSwxNC4xMS0xMC4yMywxNC4xMS0xNS4zMiwwLTMuMzgtMi01LjI2LTYuNDMtNi43MmwtMy4zNC0xLjEzLDkuMTQtOC43Ny0xLjg0LTEuOTYtMi43MSwyLjM4LTEyLjgxLTQuMjJjLTMuOTcsMS4yOS04Ljk3LDUuMDktOC45Nyw4Ljg5LDAsLjQyLjA0LjgzLjE3LDEuMjktMy4zLDEuODgtNC42MywzLjYzLTQuNjMsNS44LDAsMi4wNSwxLjA5LDQuMDksNC41NSw1LjIybDIuNzUuOTItOS41Miw5LjE0LDEuODQsMS45NiwyLjk2LTIuNzEsMTQuNzMsNS4yMmgwWiIvPjwvc3ZnPg==' as const;

function getProvider(): SolflareProvider | null {
  if (typeof window === 'undefined') return null;
  const provider = (window as unknown as Record<string, unknown>).solflare as SolflareProvider | undefined;
  if (provider?.isSolflare) return provider;
  return null;
}

export class SolflareInAppAdapter extends BaseMessageSignerWalletAdapter {
  name = SolflareInAppWalletName;
  url = 'https://solflare.com';
  icon = ICON;
  supportedTransactionVersions = new Set<'legacy' | 0>(['legacy', 0]);

  private _provider: SolflareProvider | null = null;
  private _connecting = false;
  // Start as Loadable (not NotDetected) so the wallet modal calls connect()
  // instead of redirecting to the download page. Polling upgrades to Installed.
  private _readyState: WalletReadyState =
    typeof window === 'undefined' ? WalletReadyState.Unsupported : WalletReadyState.Loadable;

  constructor() {
    super();
    if (this._readyState !== WalletReadyState.Unsupported) {
      scopePollingDetectionStrategy(() => {
        const provider = getProvider();
        if (provider) {
          this._readyState = WalletReadyState.Installed;
          this.emit('readyStateChange', this._readyState);
          return true;
        }
        return false;
      });
    }
  }

  get publicKey(): PublicKey | null {
    return this._provider?.publicKey ?? null;
  }
  get connecting(): boolean {
    return this._connecting;
  }
  get connected(): boolean {
    return !!this._provider?.isConnected;
  }
  get readyState(): WalletReadyState {
    return this._readyState;
  }

  async connect(): Promise<void> {
    if (this.connected || this._connecting) return;

    const provider = getProvider();
    if (!provider) throw new WalletNotReadyError();

    this._connecting = true;
    try {
      // In Solflare's in-app browser, the provider may already be connected.
      // Calling connect() on an already-connected provider can silently fail or hang.
      if (!provider.isConnected) {
        await provider.connect();
      }

      this._provider = provider;

      provider.on('disconnect', this._onDisconnect);
      provider.on('accountChanged', this._onAccountChanged);

      if (!provider.publicKey) {
        throw new Error('No public key available after connect');
      }

      this.emit('connect', provider.publicKey);
    } catch (error: unknown) {
      this._provider = null;
      throw new WalletConnectionError((error as Error)?.message, error);
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const provider = this._provider;
    if (provider) {
      provider.off('disconnect', this._onDisconnect);
      provider.off('accountChanged', this._onAccountChanged);
      try {
        await provider.disconnect();
      } catch (error: unknown) {
        throw new WalletDisconnectionError((error as Error)?.message, error);
      } finally {
        this._provider = null;
        this.emit('disconnect');
      }
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    const provider = this._provider;
    if (!provider) throw new WalletNotConnectedError();
    try {
      return await provider.signTransaction(transaction);
    } catch (error: unknown) {
      throw new WalletSignTransactionError((error as Error)?.message, error);
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    const provider = this._provider;
    if (!provider) throw new WalletNotConnectedError();
    try {
      return await provider.signAllTransactions(transactions);
    } catch (error: unknown) {
      throw new WalletSignTransactionError((error as Error)?.message, error);
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const provider = this._provider;
    if (!provider) throw new WalletNotConnectedError();
    try {
      // Solflare provider may return Uint8Array directly or { signature: Uint8Array }
      const result = await provider.signMessage(message);
      if (result instanceof Uint8Array) return result;
      return (result as unknown as { signature: Uint8Array }).signature;
    } catch (error: unknown) {
      throw new WalletSignMessageError((error as Error)?.message, error);
    }
  }

  private _onDisconnect = () => {
    this._provider = null;
    this.emit('disconnect');
  };

  private _onAccountChanged = (...args: unknown[]) => {
    const publicKey = args[0] as PublicKey;
    this.emit('connect', publicKey);
  };
}
