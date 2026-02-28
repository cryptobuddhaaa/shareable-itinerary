/**
 * UpgradeModal — shown when user hits a free-tier limit or clicks "Upgrade".
 * Offers Monthly ($5) and Annual ($45, save $15) with 3 payment options:
 * Stripe (card), Solana Pay (SOL), Telegram Stars.
 */

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useSubscription } from '../hooks/useSubscription';
import type { BillingPeriod } from '../models/types';
import { toast } from './Toast';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* Clipboard API not available in this webview */ }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) return true;
  } catch { /* execCommand not supported */ }
  return false;
}

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  triggerReason?: string; // e.g. "contacts limit", "enrichments limit"
}

interface SolPricing {
  sol: number;
  usd: number;
  solPrice: number;
  treasuryWallet: string;
  periodDays: number;
}

export function UpgradeModal({ open, onClose, triggerReason }: UpgradeModalProps) {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const { subscription, stripeCheckout, solanaCheckout, solanaConfirm, stripeUpgradeAnnual } = useSubscription();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();

  // SOL manual payment state
  const [solPricing, setSolPricing] = useState<SolPricing | null>(null);
  const [txSignature, setTxSignature] = useState('');

  if (!open) return null;

  // Detect if this is a monthly→annual upgrade
  const isUpgrade = subscription?.tier === 'premium' && subscription?.billingPeriod === 'monthly';

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

  const handleSolana = async () => {
    setLoading('solana');
    try {
      const pricing = await solanaCheckout(period);
      setSolPricing(pricing);

      // If wallet-adapter is connected, auto-pay directly
      if (publicKey) {
        const lamports = Math.ceil(pricing.sol * LAMPORTS_PER_SOL);
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(pricing.treasuryWallet),
            lamports,
          })
        );
        const signature = await sendTransaction(tx, connection);
        await connection.confirmTransaction(signature, 'confirmed');
        await solanaConfirm(signature, period);
        toast.success('Payment confirmed! Welcome to Premium.');
        onClose();
        return;
      }
    } catch (err) {
      // If wallet-adapter auto-pay failed or wasn't available, show manual flow
      if (!solPricing) {
        toast.error(err instanceof Error ? err.message : 'Failed to load SOL pricing');
        setSolPricing(null);
      }
      // If we have pricing, fall through to show the manual payment panel
    } finally {
      setLoading(null);
    }
  };

  const handleVerifyTx = async () => {
    const sig = txSignature.trim();
    if (!sig) {
      toast.error('Paste your transaction signature first');
      return;
    }
    setLoading('verify');
    try {
      await solanaConfirm(sig, period);
      toast.success('Payment confirmed! Welcome to Premium.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed — check your signature');
    } finally {
      setLoading(null);
    }
  };

  const handleTelegramStars = () => {
    // Deep link to bot /subscribe command
    const botUsername = 'convenubot';
    window.open(`https://t.me/${botUsername}?start=subscribe_${period}`, '_blank');
    onClose();
  };

  // --- Upgrade handlers (monthly → annual) ---

  const handleUpgradeStripe = async () => {
    setLoading('stripe');
    try {
      await stripeUpgradeAnnual();
      toast.success('Upgraded to annual! Stripe will prorate your billing.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upgrade');
    } finally {
      setLoading(null);
    }
  };

  const handleUpgradeSolana = async () => {
    setLoading('solana');
    try {
      const pricing = await solanaCheckout('annual', true);
      setSolPricing(pricing);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load upgrade pricing');
    } finally {
      setLoading(null);
    }
  };

  const handleUpgradeVerifyTx = async () => {
    const sig = txSignature.trim();
    if (!sig) {
      toast.error('Paste your transaction signature first');
      return;
    }
    setLoading('verify');
    try {
      await solanaConfirm(sig, 'annual', true);
      toast.success('Upgraded to annual!');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(null);
    }
  };

  const handleUpgradeStars = () => {
    const botUsername = 'convenubot';
    window.open(`https://t.me/${botUsername}?start=subscribe_upgrade`, '_blank');
    onClose();
  };

  // --- Upgrade UI (monthly → annual) ---

  if (isUpgrade) {
    const provider = subscription?.paymentProvider;

    // SOL manual payment panel for upgrade
    if (solPricing && !connected) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl">
            <div className="p-6 pb-4 border-b border-slate-700">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Upgrade to Annual — Pay with SOL</h2>
                <button onClick={() => { setSolPricing(null); setTxSignature(''); }} className="text-slate-400 hover:text-white p-1">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-slate-400 mb-1">Send exactly</p>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-white">{solPricing.sol.toFixed(4)} SOL</span>
                  <button onClick={async () => { const ok = await copyToClipboard(solPricing.sol.toFixed(4)); toast[ok ? 'success' : 'error'](ok ? 'Amount copied' : 'Copy failed'); }} className="text-slate-400 hover:text-white p-1" title="Copy amount">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">~${solPricing.usd} USD (SOL @ ${solPricing.solPrice.toFixed(2)})</p>
              </div>
              <div>
                <p className="text-sm text-slate-400 mb-1">To this address</p>
                <div className="bg-slate-900 rounded-lg p-3 flex items-center gap-2">
                  <code className="text-sm text-white break-all flex-1">{solPricing.treasuryWallet}</code>
                  <button onClick={async () => { const ok = await copyToClipboard(solPricing.treasuryWallet); toast[ok ? 'success' : 'error'](ok ? 'Address copied' : 'Copy failed'); }} className="text-slate-400 hover:text-white p-1.5 flex-shrink-0" title="Copy address">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">Transaction signature</label>
                <input type="text" value={txSignature} onChange={(e) => setTxSignature(e.target.value)} placeholder="Paste your tx signature here..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500" />
              </div>
              <button onClick={handleUpgradeVerifyTx} disabled={!txSignature.trim() || !!loading} className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors">
                {loading === 'verify' ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                )}
                Verify Payment
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl">
          <div className="p-6 pb-4 border-b border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Upgrade to Annual</h2>
                <p className="text-sm text-slate-400 mt-1">Save $15/year by switching to annual billing</p>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="bg-slate-900/50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Current plan</span>
                <span className="text-white">Monthly ($5/mo)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">New plan</span>
                <span className="text-white">Annual ($45/yr)</span>
              </div>
              {provider === 'stripe' ? (
                <div className="flex justify-between border-t border-slate-700 pt-2">
                  <span className="text-slate-400">You pay</span>
                  <span className="text-green-400">Prorated by Stripe</span>
                </div>
              ) : (
                <div className="flex justify-between border-t border-slate-700 pt-2">
                  <span className="text-slate-400">You pay</span>
                  <span className="text-green-400">$40 (save $5)</span>
                </div>
              )}
              <p className="text-xs text-slate-500 pt-1">
                {provider === 'stripe'
                  ? 'Stripe automatically credits your remaining monthly balance.'
                  : 'Your subscription will extend 11 months from your current expiry date.'}
              </p>
            </div>

            {provider === 'stripe' && (
              <button onClick={handleUpgradeStripe} disabled={!!loading} className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors">
                {loading === 'stripe' ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                )}
                Upgrade to Annual
              </button>
            )}

            {provider === 'solana' && (
              <button onClick={handleUpgradeSolana} disabled={!!loading} className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors">
                {loading === 'solana' ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.28 6.82a.67.67 0 00-.47-.2H4.39a.34.34 0 00-.24.57l2.44 2.44a.67.67 0 00.47.2h12.42a.34.34 0 00.24-.57L17.28 6.82z" /><path d="M6.72 14.18a.67.67 0 01.47-.2h12.42a.34.34 0 01.24.57l-2.44 2.44a.67.67 0 01-.47.2H4.52a.34.34 0 01-.24-.57l2.44-2.44z" /></svg>
                )}
                Upgrade with SOL — ~$40
              </button>
            )}

            {provider === 'telegram_stars' && (
              <button onClick={handleUpgradeStars} className="w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors">
                <span className="text-lg">&#11088;</span>
                Upgrade with Stars — 2,650
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // SOL manual payment panel (shown after clicking "Pay with SOL" when no wallet-adapter)
  if (solPricing && !connected) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl">
          <div className="p-6 pb-4 border-b border-slate-700">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Pay with SOL</h2>
              <button onClick={() => { setSolPricing(null); setTxSignature(''); }} className="text-slate-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* Amount */}
            <div>
              <p className="text-sm text-slate-400 mb-1">Send exactly</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-white">{solPricing.sol.toFixed(4)} SOL</span>
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(solPricing.sol.toFixed(4));
                    toast[ok ? 'success' : 'error'](ok ? 'Amount copied' : 'Copy failed');
                  }}
                  className="text-slate-400 hover:text-white p-1"
                  title="Copy amount"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">~${solPricing.usd} USD (SOL @ ${solPricing.solPrice.toFixed(2)})</p>
            </div>

            {/* Treasury address */}
            <div>
              <p className="text-sm text-slate-400 mb-1">To this address</p>
              <div className="bg-slate-900 rounded-lg p-3 flex items-center gap-2">
                <code className="text-sm text-white break-all flex-1">{solPricing.treasuryWallet}</code>
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(solPricing.treasuryWallet);
                    toast[ok ? 'success' : 'error'](ok ? 'Address copied' : 'Copy failed');
                  }}
                  className="text-slate-400 hover:text-white p-1.5 flex-shrink-0"
                  title="Copy address"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Instructions */}
            <div className="bg-slate-900/50 rounded-lg p-3 text-xs text-slate-400 space-y-1">
              <p>1. Copy the address and amount above</p>
              <p>2. Open your Solana wallet (Phantom, Solflare, etc.)</p>
              <p>3. Send the exact SOL amount to the address</p>
              <p>4. Paste your transaction signature below to verify</p>
            </div>

            {/* Tx signature input */}
            <div>
              <label className="text-sm text-slate-400 block mb-1">Transaction signature</label>
              <input
                type="text"
                value={txSignature}
                onChange={(e) => setTxSignature(e.target.value)}
                placeholder="Paste your tx signature here..."
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <button
              onClick={handleVerifyTx}
              disabled={!txSignature.trim() || !!loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {loading === 'verify' ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              Verify Payment
            </button>
          </div>
        </div>
      </div>
    );
  }

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
              Annual <span className="text-green-400 text-xs ml-1">3 Months FREE</span>
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

          <button
            onClick={handleSolana}
            disabled={!!loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            {loading === 'solana' ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.28 6.82a.67.67 0 00-.47-.2H4.39a.34.34 0 00-.24.57l2.44 2.44a.67.67 0 00.47.2h12.42a.34.34 0 00.24-.57L17.28 6.82z" />
                <path d="M6.72 14.18a.67.67 0 01.47-.2h12.42a.34.34 0 01.24.57l-2.44 2.44a.67.67 0 01-.47.2H4.52a.34.34 0 01-.24-.57l2.44-2.44z" />
                <path d="M17.28 10.32a.67.67 0 00-.47-.2H4.39a.34.34 0 01-.24-.57l2.44-2.44" opacity="0" />
              </svg>
            )}
            Pay with SOL
          </button>
        </div>
      </div>
    </div>
  );
}
