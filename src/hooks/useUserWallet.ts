/**
 * Zustand store for user wallet state (DB-persisted wallet links).
 * This tracks which wallets a user has linked and verified in our database,
 * separate from the Solana wallet-adapter connection state.
 */

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { UserWallet } from '../models/types';

interface UserWalletState {
  wallets: UserWallet[];
  loading: boolean;
  initialized: boolean;

  initialize: (userId: string) => Promise<void>;
  linkWallet: (userId: string, walletAddress: string) => Promise<UserWallet | null>;
  verifyWallet: (walletId: string, signature: string, message: string, walletAddress: string) => Promise<boolean>;
  unlinkWallet: (walletId: string) => Promise<void>;
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
        .select('*')
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
      // Check if wallet already linked to this account
      const existing = get().wallets.find((w) => w.walletAddress === walletAddress);
      if (existing) return existing;

      // Block if user already has a verified wallet (one verified wallet per account)
      const verifiedWallet = get().wallets.find((w) => w.verifiedAt);
      if (verifiedWallet) {
        throw new Error('You already have a verified wallet. Unlink it first to connect a different one.');
      }

      const isPrimary = get().wallets.length === 0;

      const { data, error } = await supabase
        .from('user_wallets')
        .insert({
          user_id: userId,
          wallet_address: walletAddress,
          is_primary: isPrimary,
        })
        .select()
        .single();

      if (error) {
        console.error('Error linking wallet:', error);
        return null;
      }

      const wallet = mapRowToWallet(data);
      set({ wallets: [...get().wallets, wallet] });
      return wallet;
    } catch (error) {
      console.error('Failed to link wallet:', error);
      return null;
    }
  },

  verifyWallet: async (walletId: string, signature: string, message: string, walletAddress: string) => {
    try {
      const response = await fetch('/api/wallet/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  getPrimaryWallet: () => {
    return get().wallets.find((w) => w.isPrimary && w.verifiedAt) || null;
  },

  reset: () => {
    set({ wallets: [], loading: false, initialized: false });
  },
}));
