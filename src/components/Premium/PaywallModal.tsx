/**
 * Paywall Modal
 * Shows upgrade prompts when users reach their AI query limits
 */

import { X, Check, Sparkles, Zap } from 'lucide-react';
import { subscriptionService, type SubscriptionTier } from '../../services/subscriptionService';
import { toast } from '../Toast';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTier: SubscriptionTier;
  usageInfo?: {
    used: number;
    limit: number;
  };
}

export function PaywallModal({ isOpen, onClose, currentTier, usageInfo }: PaywallModalProps) {
  if (!isOpen) return null;

  const premiumPricing = subscriptionService.getTierPricing('premium');
  const proPricing = subscriptionService.getTierPricing('pro');

  const handleUpgrade = (tier: SubscriptionTier) => {
    toast.info(`Stripe integration coming soon! You selected ${tier} tier.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-4xl bg-white rounded-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-8 text-white">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="text-center">
            <Sparkles className="w-12 h-12 mx-auto mb-3" />
            <h2 className="text-2xl font-bold mb-2">Unlock More AI Power</h2>
            {usageInfo && (
              <p className="text-white/90">
                You've used {usageInfo.used} of {usageInfo.limit} AI queries this month
              </p>
            )}
            {currentTier === 'free' && (
              <p className="text-white/90 mt-1">
                Upgrade to Premium or Pro for unlimited access
              </p>
            )}
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-6 p-6">
          {/* Premium Tier */}
          <div className="border-2 border-purple-200 rounded-lg p-6 hover:border-purple-400 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">{premiumPricing.name}</h3>
              <div className="flex items-center gap-1 text-purple-600">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>

            <div className="mb-4">
              <div className="flex items-baseline">
                <span className="text-4xl font-bold text-gray-900">
                  ${premiumPricing.price}
                </span>
                <span className="text-gray-600 ml-2">/month</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                or ${premiumPricing.priceYearly}/year (save 17%)
              </p>
            </div>

            <ul className="space-y-3 mb-6">
              {premiumPricing.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleUpgrade('premium')}
              className="w-full py-3 px-4 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors"
            >
              Upgrade to Premium
            </button>
          </div>

          {/* Pro Tier */}
          <div className="border-2 border-blue-400 rounded-lg p-6 relative overflow-hidden hover:border-blue-500 transition-colors">
            <div className="absolute top-0 right-0 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
              BEST VALUE
            </div>

            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">{proPricing.name}</h3>
              <div className="flex items-center gap-1 text-blue-600">
                <Zap className="w-5 h-5" />
              </div>
            </div>

            <div className="mb-4">
              <div className="flex items-baseline">
                <span className="text-4xl font-bold text-gray-900">
                  ${proPricing.price}
                </span>
                <span className="text-gray-600 ml-2">/month</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                or ${proPricing.priceYearly}/year (save 17%)
              </p>
            </div>

            <ul className="space-y-3 mb-6">
              {proPricing.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleUpgrade('pro')}
              className="w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Upgrade to Pro
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <p className="text-xs text-gray-600 text-center">
            💡 All plans include unlimited itineraries, events, and contacts. Cancel anytime.
          </p>
          <p className="text-xs text-gray-500 text-center mt-1">
            Secure payment processing by Stripe
          </p>
        </div>
      </div>
    </div>
  );
}
