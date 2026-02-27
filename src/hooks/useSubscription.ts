import { create } from 'zustand';
import type { SubscriptionInfo, TierLimits, Tier, BillingPeriod } from '../models/types';
import { authFetch } from '../lib/authFetch';

// Default free tier limits (must match server TIER_LIMITS)
const FREE_LIMITS: TierLimits = {
  itineraries: 10,
  eventsPerItinerary: 20,
  contacts: 100,
  enrichments: 10,
  tags: 10,
  templates: 3,
  notes: 10,
  batchEnrich: false,
  enhancedEnrich: false,
};

interface SubscriptionState {
  subscription: SubscriptionInfo | null;
  loading: boolean;
  initialized: boolean;

  // Derived helpers
  tier: Tier;
  limits: TierLimits;
  isPremium: boolean;

  // Actions
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  stripeCheckout: (period: BillingPeriod) => Promise<void>;
  stripePortal: () => Promise<void>;
  solanaCheckout: (period: BillingPeriod) => Promise<{ sol: number; usd: number; solPrice: number; treasuryWallet: string; periodDays: number }>;
  solanaConfirm: (txSignature: string, period: BillingPeriod) => Promise<void>;
  reset: () => void;
}

export const useSubscription = create<SubscriptionState>((set, get) => ({
  subscription: null,
  loading: false,
  initialized: false,
  tier: 'free',
  limits: FREE_LIMITS,
  isPremium: false,

  initialize: async () => {
    if (get().initialized) return;
    set({ loading: true });
    try {
      const resp = await authFetch('/api/profile?action=subscription');
      if (resp.ok) {
        const data = await resp.json();
        const sub = data.subscription as SubscriptionInfo;
        set({
          subscription: sub,
          tier: sub.tier,
          limits: sub.limits,
          isPremium: sub.tier === 'premium',
          initialized: true,
        });
      }
    } catch (err) {
      console.error('Failed to initialize subscription:', err);
    } finally {
      set({ loading: false });
    }
  },

  refresh: async () => {
    try {
      const resp = await authFetch('/api/profile?action=subscription');
      if (resp.ok) {
        const data = await resp.json();
        const sub = data.subscription as SubscriptionInfo;
        set({
          subscription: sub,
          tier: sub.tier,
          limits: sub.limits,
          isPremium: sub.tier === 'premium',
        });
      }
    } catch (err) {
      console.error('Failed to refresh subscription:', err);
    }
  },

  stripeCheckout: async (period: BillingPeriod) => {
    const resp = await authFetch('/api/profile?action=stripe-checkout', {
      method: 'POST',
      body: JSON.stringify({ period }),
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.error || 'Failed to create checkout session');
    }

    const { url } = await resp.json();
    window.location.href = url;
  },

  stripePortal: async () => {
    const resp = await authFetch('/api/profile?action=stripe-portal', {
      method: 'POST',
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.error || 'Failed to create portal session');
    }

    const { url } = await resp.json();
    window.location.href = url;
  },

  solanaCheckout: async (period: BillingPeriod) => {
    const resp = await authFetch('/api/profile?action=solana-checkout', {
      method: 'POST',
      body: JSON.stringify({ period }),
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.error || 'Failed to get SOL price');
    }

    return await resp.json();
  },

  solanaConfirm: async (txSignature: string, period: BillingPeriod) => {
    const resp = await authFetch('/api/profile?action=solana-confirm', {
      method: 'POST',
      body: JSON.stringify({ txSignature, period }),
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.error || 'Failed to confirm payment');
    }

    // Refresh subscription status after successful payment
    await get().refresh();
  },

  reset: () => {
    set({
      subscription: null,
      loading: false,
      initialized: false,
      tier: 'free',
      limits: FREE_LIMITS,
      isPremium: false,
    });
  },
}));
