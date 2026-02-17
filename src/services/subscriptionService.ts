/**
 * Subscription Service
 * Handles user subscription tier management and usage tracking
 */

import { supabase } from '../lib/supabase';

export type SubscriptionTier = 'free' | 'premium' | 'pro';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';

export interface Subscription {
  id: string;
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  current_period_start?: string;
  current_period_end?: string;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface UsageInfo {
  tier: SubscriptionTier;
  limit: number;
  used: number;
  remaining: number;
  isUnlimited: boolean;
}

class SubscriptionService {
  /**
   * Get user's current subscription
   */
  async getUserSubscription(userId: string): Promise<Subscription | null> {
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();

      if (error) {
        console.error('Error fetching subscription:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Failed to get user subscription:', error);
      return null;
    }
  }

  /**
   * Get user's current tier
   */
  async getUserTier(userId: string): Promise<SubscriptionTier> {
    try {
      const subscription = await this.getUserSubscription(userId);
      return subscription?.tier || 'free';
    } catch (error) {
      console.error('Failed to get user tier:', error);
      return 'free';
    }
  }

  /**
   * Get AI usage information for current month
   */
  async getAIUsage(userId: string, featureType: string = 'event_creation'): Promise<UsageInfo> {
    try {
      const tier = await this.getUserTier(userId);

      // Set limits based on tier
      const limits: Record<SubscriptionTier, number> = {
        free: 3,
        premium: 50, // 50 queries per month
        pro: -1 // Unlimited
      };

      const limit = limits[tier];
      const isUnlimited = limit === -1;

      // If unlimited, return early
      if (isUnlimited) {
        return {
          tier,
          limit: -1,
          used: 0,
          remaining: -1,
          isUnlimited: true
        };
      }

      // Count usage in current month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data: _data, error, count } = await supabase
        .from('ai_usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('feature_type', featureType)
        .eq('success', true)
        .gte('created_at', startOfMonth.toISOString());

      if (error) {
        console.error('Error fetching AI usage:', error);
        // On error, be conservative and assume limit reached
        return {
          tier,
          limit,
          used: limit,
          remaining: 0,
          isUnlimited: false
        };
      }

      const used = count || 0;
      const remaining = Math.max(0, limit - used);

      return {
        tier,
        limit,
        used,
        remaining,
        isUnlimited: false
      };
    } catch (error) {
      console.error('Failed to get AI usage:', error);
      // On error, assume free tier with limit reached
      return {
        tier: 'free',
        limit: 3,
        used: 3,
        remaining: 0,
        isUnlimited: false
      };
    }
  }

  /**
   * Check if user can make an AI query
   */
  async canUseAI(userId: string, featureType: string = 'event_creation'): Promise<boolean> {
    try {
      const usage = await this.getAIUsage(userId, featureType);
      return usage.isUnlimited || usage.remaining > 0;
    } catch (error) {
      console.error('Failed to check AI usage:', error);
      return false;
    }
  }

  /**
   * Track AI usage
   */
  async trackAIUsage(
    userId: string,
    featureType: string,
    tokensUsed: number = 0,
    costCents: number = 0,
    success: boolean = true
  ): Promise<void> {
    try {
      const { error } = await supabase.from('ai_usage').insert({
        user_id: userId,
        feature_type: featureType,
        tokens_used: tokensUsed,
        cost_cents: costCents,
        success
      });

      if (error) {
        console.error('Error tracking AI usage:', error);
      }
    } catch (error) {
      console.error('Failed to track AI usage:', error);
      // Don't throw - usage tracking failure shouldn't break the app
    }
  }

  /**
   * Create or update user subscription
   */
  async upsertSubscription(
    userId: string,
    tier: SubscriptionTier,
    stripeCustomerId?: string,
    stripeSubscriptionId?: string
  ): Promise<void> {
    try {
      const { error } = await supabase.from('subscriptions').upsert(
        {
          user_id: userId,
          tier,
          status: 'active',
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'user_id'
        }
      );

      if (error) {
        console.error('Error upserting subscription:', error);
        throw error;
      }
    } catch (error) {
      console.error('Failed to upsert subscription:', error);
      throw error;
    }
  }

  /**
   * Get tier pricing information
   */
  getTierPricing(tier: SubscriptionTier): {
    name: string;
    price: number;
    priceYearly: number;
    features: string[];
  } {
    const pricing = {
      free: {
        name: 'Free',
        price: 0,
        priceYearly: 0,
        features: [
          'Up to 10 itineraries',
          'Up to 20 events per itinerary',
          'Up to 100 contacts',
          '10 AI queries per month',
          'Basic features'
        ]
      },
      premium: {
        name: 'Premium',
        price: 7.77,
        priceYearly: 77.77,
        features: [
          'Unlimited itineraries',
          'Unlimited events',
          'Unlimited contacts',
          '50 AI queries per month',
          'Voice input (coming soon)',
          'Schedule conflict detection',
          'Priority support'
        ]
      },
      pro: {
        name: 'Pro',
        price: 18.88,
        priceYearly: 188.88,
        features: [
          'Everything in Premium',
          'Unlimited AI queries',
          'Advanced analytics',
          'Contact network visualization',
          'Meeting briefings (coming soon)',
          'Auto-follow-up suggestions',
          'API access (coming soon)'
        ]
      }
    };

    return pricing[tier];
  }

  /**
   * Check for abuse patterns
   */
  async checkAbusePatterns(userId: string): Promise<{
    isSuspicious: boolean;
    reason: string;
    action: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('detect_abuse_patterns', {
        p_user_id: userId
      });

      if (error) {
        console.error('Error checking abuse patterns:', error);
        return {
          isSuspicious: false,
          reason: 'Error checking patterns',
          action: 'none'
        };
      }

      // RPC returns array, get first result
      const result = Array.isArray(data) ? data[0] : data;

      return {
        isSuspicious: result.is_suspicious || false,
        reason: result.reason || 'No issues detected',
        action: result.action || 'none'
      };
    } catch (error) {
      console.error('Failed to check abuse patterns:', error);
      return {
        isSuspicious: false,
        reason: 'Error',
        action: 'none'
      };
    }
  }
}

// Export singleton instance
export const subscriptionService = new SubscriptionService();
export default subscriptionService;
