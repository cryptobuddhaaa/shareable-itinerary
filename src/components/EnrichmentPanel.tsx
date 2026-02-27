import { useState } from 'react';
import type { ContactEnrichment } from '../models/types';

interface EnrichmentPanelProps {
  enrichment: ContactEnrichment;
  onRegenerate: (enhanced?: boolean) => void;
  regenerating: boolean;
  isPremium?: boolean;
}

function getTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks}w ago`;
  }
  const months = Math.floor(diffDays / 30);
  return `${months}mo ago`;
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  const colors = {
    high: 'bg-green-900/50 text-green-300 border-green-700/50',
    medium: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
    low: 'bg-slate-700 text-slate-400 border-slate-600',
  };
  const cls = colors[(confidence as keyof typeof colors) || 'low'] || colors.low;
  return (
    <span className={`px-1.5 py-0.5 text-[10px] rounded border ${cls}`}>
      {confidence || 'low'} confidence
    </span>
  );
}

export default function EnrichmentPanel({ enrichment, onRegenerate, regenerating, isPremium }: EnrichmentPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const data = enrichment.enrichmentData;

  if (!data) return null;

  return (
    <div className="mt-3 pt-3 border-t border-purple-700/30">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left group"
      >
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
          <span className="text-xs font-medium text-purple-300">AI Profile</span>
          <ConfidenceBadge confidence={enrichment.confidence} />
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2.5 text-xs">
          {/* Summary */}
          {data.summary && (
            <p className="text-slate-300 leading-relaxed">{data.summary}</p>
          )}

          {/* Roles */}
          {data.roles && data.roles.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Roles</h4>
              <div className="space-y-0.5">
                {data.roles.map((role, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-slate-300">
                    {role.current && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                    )}
                    <span>{role.title}</span>
                    <span className="text-slate-500">at</span>
                    <span className="text-slate-200">{role.organization}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Background */}
          {data.background && data.background.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Background</h4>
              <ul className="space-y-0.5 text-slate-400">
                {data.background.map((item, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-slate-600 flex-shrink-0">-</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Notable Activity */}
          {data.notableActivity && data.notableActivity.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Recent Activity</h4>
              <ul className="space-y-0.5 text-slate-400">
                {data.notableActivity.map((item, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-slate-600 flex-shrink-0">-</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Talking Points */}
          {data.talkingPoints && data.talkingPoints.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Talking Points</h4>
              <ul className="space-y-0.5">
                {data.talkingPoints.map((item, i) => (
                  <li key={i} className="flex gap-1.5 text-blue-300">
                    <span className="text-blue-500 flex-shrink-0">-</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Social Links */}
          {data.socialLinks && data.socialLinks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.socialLinks.map((link, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 border border-slate-600">
                  <span className="text-slate-500">{link.platform}</span>
                  {link.handle && <span>{link.handle}</span>}
                  {link.url && !link.handle && (
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate max-w-[120px]">
                      link
                    </a>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Suggested Tags */}
          {data.suggestedTags && data.suggestedTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.suggestedTags.map((tag, i) => (
                <span key={i} className="px-1.5 py-0.5 text-[10px] rounded-full bg-purple-900/50 text-purple-300 border border-purple-700/50">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-700/50">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-600">
                Enriched {getTimeAgo(enrichment.createdAt)}
              </span>
              {enrichment.sources.length > 0 && (
                <span className="text-[10px] text-slate-600">
                  {enrichment.sources.length} sources
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isPremium && (
                <label className="flex items-center gap-1 cursor-pointer" title="Use Sonnet model for deeper AI analysis">
                  <input
                    type="checkbox"
                    checked={enhanced}
                    onChange={(e) => setEnhanced(e.target.checked)}
                    className="w-3 h-3 rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500"
                  />
                  <span className="text-[10px] text-amber-400">Enhanced AI</span>
                </label>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRegenerate(enhanced);
                }}
                disabled={regenerating}
                className="text-[10px] text-purple-400 hover:text-purple-300 disabled:opacity-50 flex items-center gap-1"
              >
                <svg className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {regenerating ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Loading skeleton shown while enrichment is in progress
export function EnrichmentSkeleton() {
  return (
    <div className="mt-3 pt-3 border-t border-purple-700/30">
      <div className="flex items-center gap-1.5 mb-2">
        <svg className="w-3.5 h-3.5 text-purple-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
        <span className="text-xs font-medium text-purple-300">Enriching profile...</span>
      </div>
      <div className="space-y-2 animate-pulse">
        <div className="h-3 bg-slate-700 rounded w-full" />
        <div className="h-3 bg-slate-700 rounded w-5/6" />
        <div className="h-3 bg-slate-700 rounded w-3/4" />
        <div className="h-2.5 bg-slate-700 rounded w-1/2 mt-3" />
        <div className="h-2.5 bg-slate-700 rounded w-2/3" />
      </div>
    </div>
  );
}
