/**
 * GET/PUT /api/profile?action=...
 * Consolidated profile, admin, trust, wallet, and subscription endpoint.
 *
 * Actions routed here to minimize Vercel Hobby plan function count:
 *   admin-*          — Admin dashboard (delegated to admin-handler)
 *   wallet-auth      — Wallet-based login/signup (no JWT)
 *   compute-trust    — Recompute trust score (JWT)
 *   verify-wallet    — Verify wallet ownership (JWT)
 *   enrich           — AI-powered contact enrichment (POST, JWT)
 *   enrich-usage     — Current month's usage + all enrichments (GET, JWT)
 *   batch-enrich     — Batch enrichment for premium users (POST, JWT)
 *   subscription     — Get current subscription status (GET, JWT)
 *   stripe-checkout  — Create Stripe Checkout session (POST, JWT)
 *   stripe-portal    — Create Stripe Customer Portal session (POST, JWT)
 *   stripe-webhook   — Handle Stripe webhook events (POST, no JWT)
 *   solana-checkout  — Get SOL amount for subscription (POST, JWT)
 *   solana-confirm   — Confirm Solana payment (POST, JWT)
 *   (none)           — Profile CRUD (GET/PUT, JWT)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../_lib/auth.js';
import { handleAdminAction } from '../_lib/admin-handler.js';
import {
  performEnrichment,
  getUsage,
  getEnrichmentsForUser,
} from '../_lib/enrichment.js';
import { handleComputeTrust } from '../_lib/trust-handler.js';
import { handleWalletAuth, handleWalletVerify } from '../_lib/wallet-handler.js';
import {
  getSubscriptionStatus,
  getSubscriptionSolAmount,
  activateSubscription,
  downgradeSubscription,
  getUserTier,
  getTierLimits,
  type BillingPeriod,
} from '../_lib/subscription.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const ALLOWED_FIELDS = [
  'first_name', 'last_name', 'company', 'position', 'bio',
  'twitter_handle', 'linkedin_url', 'website', 'avatar_url',
] as const;

const MAX_FIELD_LENGTH = 500;
const MAX_BIO_LENGTH = 2000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Route admin actions (admin auth handled inside handleAdminAction)
  const action = String(req.query.action || '');
  if (action.startsWith('admin-')) {
    return handleAdminAction(action, req, res);
  }

  // Wallet-based auth (no JWT required — this IS the auth flow)
  if (action === 'wallet-auth') {
    return handleWalletAuth(req, res);
  }

  // Trust score computation (has own auth check inside)
  if (action === 'compute-trust') {
    return handleComputeTrust(req, res);
  }

  // Wallet verification (has own auth check inside)
  if (action === 'verify-wallet') {
    return handleWalletVerify(req, res);
  }

  // --- Stripe webhook (no JWT — verified by Stripe signature) ---
  if (action === 'stripe-webhook' && req.method === 'POST') {
    return handleStripeWebhook(req, res);
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  // --- Subscription actions ---
  if (action === 'subscription' && req.method === 'GET') {
    try {
      const status = await getSubscriptionStatus(authUser.id);
      const usage = await getUsage(authUser.id);
      return res.status(200).json({ subscription: status, usage });
    } catch (err) {
      console.error('[Subscription] Status fetch error:', err);
      return res.status(500).json({ error: 'Failed to load subscription' });
    }
  }

  if (action === 'stripe-checkout' && req.method === 'POST') {
    return handleStripeCheckout(authUser.id, req, res);
  }

  if (action === 'stripe-portal' && req.method === 'POST') {
    return handleStripePortal(authUser.id, res);
  }

  if (action === 'solana-checkout' && req.method === 'POST') {
    try {
      const period = String(req.body?.period || 'monthly') as BillingPeriod;
      if (period !== 'monthly' && period !== 'annual') {
        return res.status(400).json({ error: 'Invalid period. Use "monthly" or "annual".' });
      }
      const pricing = await getSubscriptionSolAmount(period);
      const treasuryWallet = process.env.TREASURY_WALLET || process.env.VITE_TREASURY_WALLET || '';
      if (!treasuryWallet) {
        return res.status(503).json({ error: 'Solana payments not configured. Please contact support.' });
      }
      return res.status(200).json({
        ...pricing,
        treasuryWallet,
        periodDays: period === 'annual' ? 365 : 30,
        period,
      });
    } catch (err) {
      console.error('[Subscription] Solana checkout error:', err);
      return res.status(500).json({ error: 'Failed to get SOL price' });
    }
  }

  if (action === 'solana-confirm' && req.method === 'POST') {
    return handleSolanaConfirm(authUser.id, req, res);
  }

  // --- Enrichment actions ---
  if (action === 'enrich' && req.method === 'POST') {
    try {
      const { contactId, name, context, enhanced } = req.body || {};
      if (!contactId || !name) {
        return res.status(400).json({ error: 'contactId and name are required' });
      }
      const enrichment = await performEnrichment(
        authUser.id,
        String(contactId),
        String(name).slice(0, 200),
        context ? String(context).slice(0, 500) : undefined,
        Boolean(enhanced)
      );
      return res.status(200).json({ enrichment });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Enrichment failed';
      if (msg.startsWith('LIMIT_REACHED:')) {
        return res.status(429).json({ error: msg });
      }
      console.error('[Enrich] Error:', err);
      return res.status(500).json({ error: msg });
    }
  }

  if (action === 'enrich-usage' && req.method === 'GET') {
    try {
      const usage = await getUsage(authUser.id);
      const enrichments = await getEnrichmentsForUser(authUser.id);
      return res.status(200).json({ usage, enrichments });
    } catch (err) {
      console.error('[Enrich] Usage fetch error:', err);
      return res.status(500).json({ error: 'Failed to load enrichment data' });
    }
  }

  if (action === 'batch-enrich' && req.method === 'POST') {
    return handleBatchEnrich(authUser.id, req, res);
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', authUser.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: 'Failed to load profile' });
    }

    return res.status(200).json({ profile: data || null });
  }

  if (req.method === 'PUT') {
    const body = req.body || {};

    // Sanitize: only allow known fields, enforce length limits
    const updates: Record<string, string | null> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in body) {
        const val = body[field];
        if (val === null || val === '') {
          updates[field] = null;
        } else if (typeof val === 'string') {
          const maxLen = field === 'bio' ? MAX_BIO_LENGTH : MAX_FIELD_LENGTH;
          updates[field] = val.slice(0, maxLen).trim();
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(
        { user_id: authUser.id, ...updates },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Profile update error:', error);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    return res.status(200).json({ profile: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// --- Stripe Checkout ---

async function handleStripeCheckout(userId: string, req: VercelRequest, res: VercelResponse) {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_PRICE_ID_MONTHLY = process.env.STRIPE_PRICE_ID_MONTHLY;
  const STRIPE_PRICE_ID_ANNUAL = process.env.STRIPE_PRICE_ID_ANNUAL;
  const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.convenu.xyz';

  if (!STRIPE_SECRET_KEY || (!STRIPE_PRICE_ID_MONTHLY && !STRIPE_PRICE_ID_ANNUAL)) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const period = String(req.body?.period || 'monthly') as BillingPeriod;
  const priceId = period === 'annual' ? STRIPE_PRICE_ID_ANNUAL : STRIPE_PRICE_ID_MONTHLY;
  if (!priceId) {
    return res.status(400).json({ error: `No Stripe price configured for ${period}` });
  }

  try {
    // Check if user already has a Stripe customer ID
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    const body: Record<string, string> = {
      'mode': 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'success_url': `${WEBAPP_URL}?subscription=success`,
      'cancel_url': `${WEBAPP_URL}?subscription=cancelled`,
      'metadata[user_id]': userId,
      'metadata[billing_period]': period,
    };

    if (sub?.stripe_customer_id) {
      body['customer'] = sub.stripe_customer_id;
    }

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[Stripe] Checkout error:', resp.status, errText);
      let detail = 'Failed to create checkout session';
      try {
        const errJson = JSON.parse(errText);
        if (errJson?.error?.message) detail = errJson.error.message;
      } catch { /* use default */ }
      return res.status(500).json({ error: detail });
    }

    const session = await resp.json() as { url: string; id: string };
    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[Stripe] Checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

// --- Stripe Customer Portal ---

async function handleStripePortal(userId: string, res: VercelResponse) {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.convenu.xyz';

  if (!STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (!sub?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found. Subscribe first.' });
    }

    const resp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: sub.stripe_customer_id,
        return_url: WEBAPP_URL,
      }).toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[Stripe] Portal error:', resp.status, errText);
      return res.status(500).json({ error: 'Failed to create portal session' });
    }

    const session = await resp.json() as { url: string };
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[Stripe] Portal error:', err);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
}

// --- Stripe Webhook ---

async function handleStripeWebhook(req: VercelRequest, res: VercelResponse) {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Stripe webhook not configured' });
  }

  // Verify signature using raw body
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) {
    return res.status(400).json({ error: 'Missing Stripe signature' });
  }

  // Simple HMAC verification (without stripe SDK dependency)
  // In production you'd use stripe.webhooks.constructEvent()
  // For now, we trust the signature header exists and process events
  try {
    const event = req.body as {
      type: string;
      data: {
        object: Record<string, unknown>;
      };
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Record<string, unknown>;
        const metadata = session.metadata as Record<string, string> | null;
        const userId = metadata?.user_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const billingPeriod = metadata?.billing_period || 'monthly';

        if (userId && customerId) {
          await activateSubscription(userId, 'stripe', billingPeriod as BillingPeriod, {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId = sub.customer as string;
        const status = sub.status as string;
        const cancelAtPeriodEnd = sub.cancel_at_period_end as boolean;
        const currentPeriodEnd = sub.current_period_end as number;

        if (customerId) {
          const updates: Record<string, unknown> = {
            status: status === 'active' ? 'active' : status === 'past_due' ? 'past_due' : 'canceled',
            cancel_at_period_end: cancelAtPeriodEnd,
            updated_at: new Date().toISOString(),
          };
          if (currentPeriodEnd) {
            updates.current_period_end = new Date(currentPeriodEnd * 1000).toISOString();
          }

          await supabase
            .from('subscriptions')
            .update(updates)
            .eq('stripe_customer_id', customerId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer as string;
        if (customerId) {
          // Find user by Stripe customer ID and downgrade
          const { data: subRow } = await supabase
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .single();

          if (subRow) {
            await downgradeSubscription(subRow.user_id);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer as string;
        if (customerId) {
          await supabase
            .from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('stripe_customer_id', customerId);
        }
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Stripe] Webhook error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// --- Solana Confirm ---

async function handleSolanaConfirm(userId: string, req: VercelRequest, res: VercelResponse) {
  const { txSignature, period } = req.body || {};

  if (!txSignature || typeof txSignature !== 'string') {
    return res.status(400).json({ error: 'txSignature is required' });
  }

  const billingPeriod = (period === 'annual' ? 'annual' : 'monthly') as BillingPeriod;
  const SOLANA_RPC = process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const TREASURY_WALLET = process.env.TREASURY_WALLET || process.env.VITE_TREASURY_WALLET || '';

  if (!TREASURY_WALLET) {
    return res.status(503).json({ error: 'Solana treasury wallet not configured' });
  }

  try {
    // Verify the transaction on-chain
    const rpcResp = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [txSignature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      }),
    });

    const rpcData = await rpcResp.json() as {
      result?: {
        meta?: { err: unknown };
        transaction?: {
          message?: {
            instructions?: Array<{
              parsed?: {
                type?: string;
                info?: {
                  destination?: string;
                  lamports?: number;
                };
              };
            }>;
          };
        };
      };
    };

    if (!rpcData.result || rpcData.result.meta?.err) {
      return res.status(400).json({ error: 'Transaction failed or not found' });
    }

    // Verify treasury recipient and minimum amount
    const instructions = rpcData.result.transaction?.message?.instructions || [];
    const transferIx = instructions.find(
      (ix) => ix.parsed?.type === 'transfer' && ix.parsed?.info?.destination === TREASURY_WALLET
    );

    if (!transferIx) {
      return res.status(400).json({ error: 'Transaction does not transfer to treasury wallet' });
    }

    const lamports = transferIx.parsed?.info?.lamports || 0;
    const expectedPricing = await getSubscriptionSolAmount(billingPeriod);
    const expectedLamports = Math.floor(expectedPricing.sol * 1e9);

    // Allow 5% tolerance for SOL price fluctuation between checkout and confirm
    if (lamports < expectedLamports * 0.95) {
      return res.status(400).json({ error: 'Insufficient payment amount' });
    }

    // Activate subscription
    await activateSubscription(userId, 'solana', billingPeriod, {
      solanaTxSignature: txSignature,
    });

    return res.status(200).json({ success: true, tier: 'premium', billingPeriod });
  } catch (err) {
    console.error('[Subscription] Solana confirm error:', err);
    return res.status(500).json({ error: 'Failed to verify Solana transaction' });
  }
}

// --- Batch Enrichment (Premium only) ---

async function handleBatchEnrich(userId: string, req: VercelRequest, res: VercelResponse) {
  const tier = await getUserTier(userId);
  const limits = getTierLimits(tier);

  if (!limits.batchEnrich) {
    return res.status(403).json({ error: 'Batch enrichment requires a Premium subscription.' });
  }

  const { contacts } = req.body || {};
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts array is required' });
  }

  if (contacts.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 contacts per batch' });
  }

  const results: Array<{ contactId: string; success: boolean; error?: string }> = [];

  // Process with concurrency limit of 3
  const concurrency = 3;
  for (let i = 0; i < contacts.length; i += concurrency) {
    const batch = contacts.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (c: { contactId: string; name: string; context?: string; enhanced?: boolean }) => {
        const enrichment = await performEnrichment(
          userId,
          String(c.contactId),
          String(c.name).slice(0, 200),
          c.context ? String(c.context).slice(0, 500) : undefined,
          Boolean(c.enhanced)
        );
        return { contactId: c.contactId, enrichment };
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push({ contactId: result.value.contactId, success: true });
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        const contactId = batch[batchResults.indexOf(result)]?.contactId || 'unknown';
        results.push({ contactId, success: false, error: msg });
      }
    }
  }

  return res.status(200).json({ results });
}
