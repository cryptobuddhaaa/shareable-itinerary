/**
 * UpgradeModal — shown when user hits a free-tier limit or clicks "Upgrade".
 * Offers Monthly ($5) and Annual ($45, save $15) with 3 payment options:
 * Stripe (card), Solana Pay (SOL), Telegram Stars.
 */

import { useState } from 'react';
import { useSubscription } from '../hooks/useSubscription';
import type { BillingPeriod } from '../models/types';
import { toast } from './Toast';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  triggerReason?: string; // e.g. "contacts limit", "enrichments limit"
}

export function UpgradeModal({ open, onClose, triggerReason }: UpgradeModalProps) {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const { stripeCheckout } = useSubscription();

  if (!open) return null;

  const isMonthly = period === 'monthly';
  const price = isMonthly ? '$5' : '$45';
  const stars = isMonthly ? '350' : '3,000';

  const handleStripe = async () => {
    setLoading('stripe');
    try {
      await stripeCheckout(period);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start checkout');
      setLoading(null);
    }
  };

  const handleTelegramStars = () => {
    // Deep link to bot /subscribe command
    const botUsername = 'convenubot';
    window.open(`https://t.me/${botUsername}?start=subscribe_${period}`, '_blank');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Upgrade to Premium</h2>
              {triggerReason && (
                <p className="text-sm text-slate-400 mt-1">You've hit your {triggerReason} limit</p>
              )}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Period Toggle */}
          <div className="mt-4 flex bg-slate-900 rounded-lg p-1">
            <button
              onClick={() => setPeriod('monthly')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                isMonthly ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setPeriod('annual')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                !isMonthly ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Annual <span className="text-green-400 text-xs ml-1">Save $15</span>
            </button>
          </div>
        </div>

        {/* Features */}
        <div className="p-6 space-y-3">
          <div className="text-center mb-4">
            <span className="text-3xl font-bold text-white">{price}</span>
            <span className="text-slate-400 text-sm">/{isMonthly ? 'month' : 'year'}</span>
          </div>

          <div className="space-y-2 text-sm">
            {[
              ['100 AI enrichments/month', '10/month'],
              ['Enhanced AI (Sonnet model)', 'Haiku only'],
              ['Batch enrich up to 10 contacts', 'One at a time'],
              ['Unlimited contacts', '100 max'],
              ['Unlimited itineraries', '10 max'],
              ['Unlimited events per trip', '20 max'],
              ['25 tags', '10 max'],
              ['vCard export', 'CSV only'],
            ].map(([premium, free]) => (
              <div key={premium} className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <span className="text-white">{premium}</span>
                  <span className="text-slate-500 ml-2 text-xs">({free})</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Buttons */}
        <div className="p-6 pt-2 space-y-3 border-t border-slate-700">
          <button
            onClick={handleStripe}
            disabled={!!loading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            {loading === 'stripe' ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            )}
            Pay with Card — {price}
          </button>

          <button
            onClick={handleTelegramStars}
            disabled={!!loading}
            className="w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <span className="text-lg">&#11088;</span>
            Pay with Telegram Stars — {stars}
          </button>

          <p className="text-center text-xs text-slate-500">
            SOL payments available via the Solana Pay option on your profile page
          </p>
        </div>
      </div>
    </div>
  );
}
