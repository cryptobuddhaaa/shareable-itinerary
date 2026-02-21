/**
 * Zustand store for user wallet state (DB-persisted wallet links).
 * This tracks which wallets a user has linked and verified in our database,
 * separate from the Solana wallet-adapter connection state.
 */

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { authFetch } from '../lib/authFetch';
import type { UserWallet } from '../models/types';

interface UserWalletState {
  wallets: UserWallet[];
  loading: boolean;
  initialized: boolean;

  initialize: (userId: string) => Promise<void>;
  linkWallet: (userId: string, walletAddress: string) => Promise<UserWallet | null>;
  verifyWallet: (walletId: string, signature: string, message: string, walletAddress: string) => Promise<boolean>;
  unlinkWallet: (walletId: string) => Promise<void>;
  unlinkAllWallets: (userId: string) => Promise<void>;
  getPrimaryWallet: () => UserWallet | null;
  reset: () => void;
}

function mapRowToWallet(row: Record<string, unknown>): UserWallet {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    walletAddress: row.wallet_address as string,
    isPrimary: row.is_primary as boolean,
    verifiedAt: row.verified_at as string | null,
    createdAt: row.created_at as string,
  };
}

export const useUserWallet = create<UserWalletState>((set, get) => ({
  wallets: [],
  loading: false,
  initialized: false,

  initialize: async (userId: string) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('user_wallets')
        .select('id, user_id, wallet_address, is_primary, verified_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error loading wallets:', error);
        set({ wallets: [], loading: false, initialized: true });
        return;
      }

      set({
        wallets: (data || []).map(mapRowToWallet),
        loading: false,
        initialized: true,
      });
    } catch (error) {
      console.error('Failed to initialize wallets:', error);
      set({ wallets: [], loading: false, initialized: true });
    }
  },

  linkWallet: async (userId: string, walletAddress: string) => {
    try {
      // Check if wallet already linked to this account (in store)
      const existing = get().wallets.find((w) => w.walletAddress === walletAddress);
      if (existing) return existing;

      // Block if user already has a DIFFERENT verified wallet (permanent binding)
      const verifiedWallet = get().wallets.find((w) => w.verifiedAt);
      if (verifiedWallet && verifiedWallet.walletAddress !== walletAddress) {
        throw new Error(
          'This account is permanently bound to a different wallet. ' +
          'Soulbound NFTs and points are tied to that address and cannot be transferred.'
        );
      }

      // Clean up any stale unverified wallet entries (abandoned connection attempts)
      const unverified = get().wallets.filter((w) => !w.verifiedAt);
      for (const w of unverified) {
        await supabase.from('user_wallets').delete().eq('id', w.id);
      }
      if (unverified.length > 0) {
        set({ wallets: get().wallets.filter((w) => w.verifiedAt) });
      }

      // Clear is_primary on any other orphaned rows to avoid partial unique index conflict
      await supabase
        .from('user_wallets')
        .update({ is_primary: false })
        .eq('user_id', userId)
        .neq('wallet_address', walletAddress);

      // Use upsert to handle re-linking a wallet address that has an orphaned DB row.
      // Do NOT reset verified_at — if the wallet was previously verified, preserve it.
      const { data, error } = await supabase
        .from('user_wallets')
        .upsert(
          {
            user_id: userId,
            wallet_address: walletAddress,
            is_primary: true,
          },
          { onConflict: 'user_id,wallet_address', ignoreDuplicates: false }
        )
        .select()
        .single();

      if (error) {
        console.error('Error linking wallet:', error);
        return null;
      }

      const wallet = mapRowToWallet(data);
      set({ wallets: [...get().wallets.filter((w) => w.id !== wallet.id), wallet] });
      return wallet;
    } catch (error) {
      // Re-throw user-facing errors
      if (error instanceof Error && (error.message.includes('already') || error.message.includes('permanently'))) {
        throw error;
      }
      console.error('Failed to link wallet:', error);
      return null;
    }
  },

  verifyWallet: async (walletId: string, signature: string, message: string, walletAddress: string) => {
    try {
      const response = await authFetch('/api/wallet/verify', {
        method: 'POST',
        body: JSON.stringify({ walletId, signature, message, walletAddress }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Wallet verification failed');
      }

      const { verified } = await response.json();
      if (verified) {
        set({
          wallets: get().wallets.map((w) =>
            w.id === walletId ? { ...w, verifiedAt: new Date().toISOString() } : w
          ),
        });
      }
      return verified;
    } catch (error) {
      console.error('Failed to verify wallet:', error);
      return false;
    }
  },

  unlinkWallet: async (walletId: string) => {
    try {
      const { error } = await supabase
        .from('user_wallets')
        .delete()
        .eq('id', walletId);

      if (error) {
        console.error('Error unlinking wallet:', error);
        return;
      }

      set({ wallets: get().wallets.filter((w) => w.id !== walletId) });
    } catch (error) {
      console.error('Failed to unlink wallet:', error);
    }
  },

  unlinkAllWallets: async (userId: string) => {
    try {
      const { error } = await supabase
        .from('user_wallets')
        .delete()
        .eq('user_id', userId);

      if (error) {
        console.error('Error unlinking all wallets:', error);
        return;
      }

      set({ wallets: [] });
    } catch (error) {
      console.error('Failed to unlink all wallets:', error);
    }
  },

  getPrimaryWallet: () => {
    return get().wallets.find((w) => w.isPrimary && w.verifiedAt) || null;
  },

  reset: () => {
    set({ wallets: [], loading: false, initialized: false });
  },
}));
