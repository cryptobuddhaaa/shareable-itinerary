/**
 * Subscription tier helper.
 * Centralizes tier detection, limits config, and subscription management.
 * Used by enrichment, profile, admin, and telegram flows.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// --- Types ---

export type Tier = 'free' | 'premium';
export type PaymentProvider = 'stripe' | 'solana' | 'telegram_stars' | 'admin';
export type BillingPeriod = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'expired';

export interface TierLimits {
  itineraries: number;       // -1 = unlimited
  eventsPerItinerary: number;
  contacts: number;
  enrichments: number;       // per month
  tags: number;
  templates: number;
  notes: number;
  batchEnrich: boolean;
  enhancedEnrich: boolean;
}

export interface SubscriptionInfo {
  tier: Tier;
  status: SubscriptionStatus;
  paymentProvider: PaymentProvider | null;
  billingPeriod: BillingPeriod | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  adminGrantedBy: string | null;
  adminGrantReason: string | null;
  limits: TierLimits;
}

// --- Limits Config ---

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    itineraries: 10,
    eventsPerItinerary: 20,
    contacts: 100,
    enrichments: 10,
    tags: 10,
    templates: 3,
    notes: 10,
    batchEnrich: false,
    enhancedEnrich: false,
  },
  premium: {
    itineraries: -1,
    eventsPerItinerary: -1,
    contacts: -1,
    enrichments: 100,
    tags: 25,
    templates: 10,
    notes: -1,
    batchEnrich: true,
    enhancedEnrich: true,
  },
};

// --- Pricing ---

export const PRICES = {
  monthly: { usd: 5, usdCents: 500, stars: 350 },
  annual: { usd: 45, usdCents: 4500, stars: 3000 },
} as const;

// --- Tier Detection ---

/**
 * Get the effective tier for a user. Checks subscription status and period expiry.
 */
export async function getUserTier(userId: string): Promise<Tier> {
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, current_period_end, payment_provider')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .single();

  if (!data || data.tier === 'free') return 'free';

  // Admin-granted with no expiry = perpetual
  if (data.payment_provider === 'admin' && !data.current_period_end) {
    return data.tier as Tier;
  }

  // Check period expiry
  if (data.current_period_end && new Date(data.current_period_end) < new Date()) {
    return 'free';
  }

  return data.tier as Tier;
}

/**
 * Get tier limits for a given tier.
 */
export function getTierLimits(tier: Tier): TierLimits {
  return TIER_LIMITS[tier];
}

/**
 * Get full subscription status for a user (used by client API).
 */
export async function getSubscriptionStatus(userId: string): Promise<SubscriptionInfo> {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!data) {
    return {
      tier: 'free',
      status: 'active',
      paymentProvider: null,
      billingPeriod: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      adminGrantedBy: null,
      adminGrantReason: null,
      limits: TIER_LIMITS.free,
    };
  }

  // Determine effective tier (check expiry)
  let effectiveTier: Tier = data.tier as Tier;
  if (effectiveTier !== 'free') {
    const isAdminPerp = data.payment_provider === 'admin' && !data.current_period_end;
    const isExpired = data.current_period_end && new Date(data.current_period_end) < new Date();
    if (!isAdminPerp && isExpired) {
      effectiveTier = 'free';
    }
  }

  return {
    tier: effectiveTier,
    status: data.status as SubscriptionStatus,
    paymentProvider: data.payment_provider as PaymentProvider | null,
    billingPeriod: data.billing_period as BillingPeriod | null,
    currentPeriodStart: data.current_period_start || null,
    currentPeriodEnd: data.current_period_end || null,
    cancelAtPeriodEnd: data.cancel_at_period_end ?? false,
    adminGrantedBy: data.admin_granted_by || null,
    adminGrantReason: data.admin_grant_reason || null,
    limits: TIER_LIMITS[effectiveTier],
  };
}

// --- Subscription Management ---

/**
 * Activate or upgrade a subscription (used by all payment providers).
 */
export async function activateSubscription(
  userId: string,
  provider: PaymentProvider,
  billingPeriod: BillingPeriod,
  extras?: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    solanaTxSignature?: string;
    telegramChargeId?: string;
    adminGrantedBy?: string;
    adminGrantReason?: string;
  }
): Promise<void> {
  const now = new Date();
  const periodDays = billingPeriod === 'annual' ? 365 : 30;
  const periodEnd = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);

  const row: Record<string, unknown> = {
    user_id: userId,
    tier: 'premium',
    status: 'active',
    payment_provider: provider,
    billing_period: billingPeriod,
    current_period_start: now.toISOString(),
    current_period_end: provider === 'admin' && !extras?.adminGrantReason?.includes('expiry')
      ? null  // admin grants are perpetual unless explicitly time-limited
      : periodEnd.toISOString(),
    cancel_at_period_end: false,
    updated_at: now.toISOString(),
  };

  if (extras?.stripeCustomerId) row.stripe_customer_id = extras.stripeCustomerId;
  if (extras?.stripeSubscriptionId) row.stripe_subscription_id = extras.stripeSubscriptionId;
  if (extras?.solanaTxSignature) row.solana_tx_signature = extras.solanaTxSignature;
  if (extras?.telegramChargeId) row.telegram_charge_id = extras.telegramChargeId;
  if (extras?.adminGrantedBy) row.admin_granted_by = extras.adminGrantedBy;
  if (extras?.adminGrantReason) row.admin_grant_reason = extras.adminGrantReason;

  const { error } = await supabase
    .from('subscriptions')
    .upsert(row, { onConflict: 'user_id' });

  if (error) {
    console.error('[Subscription] Activate error:', error);
    throw new Error('Failed to activate subscription');
  }

  console.log(`[Subscription] Activated ${billingPeriod} premium for user ${userId} via ${provider}`);
}

/**
 * Downgrade a user to free tier.
 */
export async function downgradeSubscription(userId: string): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      tier: 'free',
      status: 'active',
      payment_provider: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      solana_tx_signature: null,
      telegram_charge_id: null,
      admin_granted_by: null,
      admin_grant_reason: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('[Subscription] Downgrade error:', error);
    throw new Error('Failed to downgrade subscription');
  }

  console.log(`[Subscription] Downgraded user ${userId} to free`);
}

// --- SOL Price Helper ---

let cachedSolPrice: { usd: number; fetchedAt: number } | null = null;
const SOL_PRICE_CACHE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get current SOL/USD price from CoinGecko (cached 5 min).
 */
export async function getSolPrice(): Promise<number> {
  if (cachedSolPrice && Date.now() - cachedSolPrice.fetchedAt < SOL_PRICE_CACHE_MS) {
    return cachedSolPrice.usd;
  }

  try {
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { headers: { 'Accept': 'application/json' } }
    );
    if (resp.ok) {
      const data = await resp.json() as { solana?: { usd?: number } };
      const price = data.solana?.usd;
      if (price && price > 0) {
        cachedSolPrice = { usd: price, fetchedAt: Date.now() };
        return price;
      }
    }
  } catch (err) {
    console.error('[Subscription] CoinGecko price fetch failed:', err);
  }

  // Fallback: use cached price or a reasonable default
  if (cachedSolPrice) return cachedSolPrice.usd;
  return 150; // Conservative fallback
}

/**
 * Calculate SOL amount for a given USD price.
 */
export async function getSubscriptionSolAmount(period: BillingPeriod): Promise<{ sol: number; usd: number; solPrice: number }> {
  const usd = PRICES[period].usd;
  const solPrice = await getSolPrice();
  const sol = Math.ceil((usd / solPrice) * 1e6) / 1e6; // Round up to 6 decimals
  return { sol, usd, solPrice };
}

// --- Expiration Helpers ---

/**
 * Get subscriptions expiring within N days (for Solana/Stars reminders).
 */
export async function getExpiringSubscriptions(daysOut: number): Promise<Array<{
  userId: string;
  tier: Tier;
  paymentProvider: PaymentProvider;
  currentPeriodEnd: string;
  daysLeft: number;
}>> {
  const now = new Date();
  const future = new Date(now.getTime() + daysOut * 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from('subscriptions')
    .select('user_id, tier, payment_provider, current_period_end')
    .in('payment_provider', ['solana', 'telegram_stars'])
    .eq('status', 'active')
    .eq('tier', 'premium')
    .not('current_period_end', 'is', null)
    .lte('current_period_end', future.toISOString())
    .gte('current_period_end', now.toISOString());

  return (data || []).map((row) => ({
    userId: row.user_id,
    tier: row.tier as Tier,
    paymentProvider: row.payment_provider as PaymentProvider,
    currentPeriodEnd: row.current_period_end,
    daysLeft: Math.ceil(
      (new Date(row.current_period_end).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    ),
  }));
}
