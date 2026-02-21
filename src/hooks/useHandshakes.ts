/**
 * Zustand store for handshake state.
 * Manages initiating, claiming, and tracking proof-of-handshake flows.
 */

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { authFetch } from '../lib/authFetch';
import type { Handshake } from '../models/types';

interface HandshakeState {
  handshakes: Handshake[];
  loading: boolean;
  initialized: boolean;

  initialize: (userId: string) => Promise<void>;
  initiate: (userId: string, contactId: string, walletAddress: string) => Promise<{
    handshakeId: string;
    transaction: string;
    receiverIdentifier: string;
    contactName: string;
  } | null>;
  confirmTx: (handshakeId: string, signedTransaction: string, side: 'initiator' | 'receiver') => Promise<{
    txSignature: string;
    bothPaid: boolean;
  } | null>;
  mint: (handshakeId: string) => Promise<boolean>;
  getByContactId: (contactId: string) => Handshake | undefined;
  getByIdentifier: (identifier: string) => Handshake | undefined;
  getByInitiatorName: (contactName: string) => Handshake | undefined;
  getByInitiatorEmail: (email: string) => Handshake | undefined;
  reset: () => void;
}

function mapRowToHandshake(row: Record<string, unknown>): Handshake {
  return {
    id: row.id as string,
    initiatorUserId: row.initiator_user_id as string,
    receiverUserId: (row.receiver_user_id as string) || null,
    receiverIdentifier: row.receiver_identifier as string,
    contactId: (row.contact_id as string) || null,
    eventId: (row.event_id as string) || null,
    eventTitle: (row.event_title as string) || null,
    eventDate: (row.event_date as string) || null,
    initiatorWallet: (row.initiator_wallet as string) || null,
    receiverWallet: (row.receiver_wallet as string) || null,
    initiatorMintedAt: (row.initiator_minted_at as string) || null,
    receiverMintedAt: (row.receiver_minted_at as string) || null,
    status: row.status as Handshake['status'],
    initiatorNftAddress: (row.initiator_nft_address as string) || null,
    receiverNftAddress: (row.receiver_nft_address as string) || null,
    initiatorTxSignature: (row.initiator_tx_signature as string) || null,
    receiverTxSignature: (row.receiver_tx_signature as string) || null,
    pointsAwarded: (row.points_awarded as number) || 0,
    mintFeeLamports: (row.mint_fee_lamports as number) || 0,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    ...(row.initiator_name ? { initiatorName: row.initiator_name as string } : {}),
    ...(row.initiator_email ? { initiatorEmail: row.initiator_email as string } : {}),
  };
}

export const useHandshakes = create<HandshakeState>((set, get) => ({
  handshakes: [],
  loading: false,
  initialized: false,

  initialize: async (userId: string) => {
    set({ loading: true });
    try {
      // Fetch handshakes where user is initiator or already-claimed receiver
      const { data: ownData, error: ownError } = await supabase
        .from('handshakes')
        .select('id, initiator_user_id, receiver_user_id, receiver_identifier, contact_id, event_id, event_title, event_date, initiator_wallet, receiver_wallet, initiator_minted_at, receiver_minted_at, status, initiator_nft_address, receiver_nft_address, initiator_tx_signature, receiver_tx_signature, points_awarded, mint_fee_lamports, created_at, expires_at')
        .or(`initiator_user_id.eq.${userId},receiver_user_id.eq.${userId}`)
        .in('status', ['pending', 'claimed', 'matched', 'minted'])
        .order('created_at', { ascending: false });

      if (ownError) {
        console.error('Error loading handshakes:', ownError);
        set({ handshakes: [], loading: false, initialized: true });
        return;
      }

      // Also fetch pending handshakes where user is the RECEIVER by identifier
      // (receiver_user_id is NULL until claimed, so RLS blocks the client query)
      let pendingForMe: Record<string, unknown>[] = [];
      try {
        const response = await authFetch(`/api/handshake?action=pending`);
        if (response.ok) {
          const result = await response.json();
          pendingForMe = result.handshakes || [];
        }
      } catch {
        // Non-critical — just means receiver won't see pending handshakes
        console.warn('Failed to fetch pending handshakes for receiver');
      }

      // Merge and deduplicate by ID. Enriched data from the pending endpoint
      // (has initiator_name/email) takes priority over the direct query.
      const allRows = [...pendingForMe, ...(ownData || [])];
      const seen = new Set<string>();
      const unique = allRows.filter((row) => {
        const id = row.id as string;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      set({
        handshakes: unique.map(mapRowToHandshake),
        loading: false,
        initialized: true,
      });
    } catch (error) {
      console.error('Failed to initialize handshakes:', error);
      set({ handshakes: [], loading: false, initialized: true });
    }
  },

  initiate: async (userId: string, contactId: string, walletAddress: string) => {
    try {
      const response = await authFetch('/api/handshake?action=initiate', {
        method: 'POST',
        body: JSON.stringify({ contactId, walletAddress }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to initiate handshake');
      }

      const result = await response.json();

      // Refresh handshakes list
      await get().initialize(userId);

      return result;
    } catch (error) {
      console.error('Failed to initiate handshake:', error);
      throw error;
    }
  },

  confirmTx: async (handshakeId: string, signedTransaction: string, side: 'initiator' | 'receiver') => {
    try {
      const response = await authFetch('/api/handshake?action=confirm-tx', {
        method: 'POST',
        body: JSON.stringify({ handshakeId, signedTransaction, side }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to confirm transaction');
      }

      const result = await response.json();

      // Refresh store so UI reflects the new status (matched, etc.)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await get().initialize(user.id);
      }

      return result;
    } catch (error) {
      console.error('Failed to confirm tx:', error);
      throw error;
    }
  },

  mint: async (handshakeId: string) => {
    try {
      const response = await authFetch('/api/handshake?action=mint', {
        method: 'POST',
        body: JSON.stringify({ handshakeId }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to mint');
      }

      // Refresh store so UI reflects minted status
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await get().initialize(user.id);
      }

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to mint';
      console.error('Failed to mint:', msg);
      throw error;
    }
  },

  getByContactId: (contactId: string) => {
    return get().handshakes.find(
      (h) => h.contactId === contactId && ['pending', 'claimed', 'matched', 'minted'].includes(h.status)
    );
  },

  getByIdentifier: (identifier: string) => {
    if (!identifier) return undefined;
    const normalized = identifier.replace('@', '').toLowerCase();
    return get().handshakes.find(
      (h) =>
        ['pending', 'claimed', 'matched', 'minted'].includes(h.status) &&
        h.receiverIdentifier?.replace('@', '').toLowerCase() === normalized
    );
  },

  getByInitiatorName: (contactName: string) => {
    if (!contactName || !contactName.trim()) return undefined;
    const normalized = contactName.toLowerCase().trim();
    return get().handshakes.find(
      (h) =>
        ['pending', 'claimed', 'matched', 'minted'].includes(h.status) &&
        h.initiatorName?.toLowerCase().trim() === normalized
    );
  },

  getByInitiatorEmail: (email: string) => {
    if (!email) return undefined;
    const normalized = email.toLowerCase();
    return get().handshakes.find(
      (h) =>
        ['pending', 'claimed', 'matched', 'minted'].includes(h.status) &&
        h.initiatorEmail?.toLowerCase() === normalized
    );
  },

  reset: () => {
    set({ handshakes: [], loading: false, initialized: false });
  },
}));
