import { create } from 'zustand';
import type { ContactEnrichment, EnrichmentUsage } from '../models/types';
import { authFetch } from '../lib/authFetch';

interface EnrichmentState {
  enrichments: Map<string, ContactEnrichment>; // keyed by contactId
  usage: EnrichmentUsage;
  loading: boolean;
  enrichingContactId: string | null; // currently enriching
  initialized: boolean;

  batchEnriching: boolean;

  // Actions
  initialize: () => Promise<void>;
  enrich: (contactId: string, name: string, context?: string, enhanced?: boolean) => Promise<ContactEnrichment>;
  batchEnrich: (contacts: Array<{ contactId: string; name: string; context?: string }>) => Promise<ContactEnrichment[]>;
  getByContactId: (contactId: string) => ContactEnrichment | undefined;
  reset: () => void;
}

export const useEnrichment = create<EnrichmentState>((set, get) => ({
  enrichments: new Map(),
  usage: { used: 0, limit: 10 },
  loading: false,
  enrichingContactId: null,
  batchEnriching: false,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;
    set({ loading: true });
    try {
      const resp = await authFetch('/api/profile?action=enrich-usage');
      if (resp.ok) {
        const data = await resp.json();
        const enrichments = new Map<string, ContactEnrichment>();
        for (const e of (data.enrichments || []) as ContactEnrichment[]) {
          // Keep latest enrichment per contact
          if (!enrichments.has(e.contactId)) {
            enrichments.set(e.contactId, e);
          }
        }
        set({
          enrichments,
          usage: data.usage || { used: 0, limit: 10 },
          initialized: true,
        });
      }
    } catch (err) {
      console.error('Failed to initialize enrichments:', err);
    } finally {
      set({ loading: false });
    }
  },

  enrich: async (contactId: string, name: string, context?: string, enhanced?: boolean) => {
    set({ enrichingContactId: contactId });
    try {
      const resp = await authFetch('/api/profile?action=enrich', {
        method: 'POST',
        body: JSON.stringify({ contactId, name, context, enhanced: enhanced || false }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || 'Enrichment failed');
      }

      const { enrichment } = await resp.json() as { enrichment: ContactEnrichment };

      set((state) => {
        const updated = new Map(state.enrichments);
        updated.set(contactId, enrichment);
        return {
          enrichments: updated,
          usage: { ...state.usage, used: state.usage.used + 1 },
        };
      });

      return enrichment;
    } finally {
      set({ enrichingContactId: null });
    }
  },

  batchEnrich: async (contacts: Array<{ contactId: string; name: string; context?: string }>) => {
    set({ batchEnriching: true });
    try {
      const resp = await authFetch('/api/profile?action=batch-enrich', {
        method: 'POST',
        body: JSON.stringify({ contacts }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || 'Batch enrichment failed');
      }

      const { results } = await resp.json() as { results: ContactEnrichment[] };

      set((state) => {
        const updated = new Map(state.enrichments);
        for (const enrichment of results) {
          updated.set(enrichment.contactId, enrichment);
        }
        return {
          enrichments: updated,
          usage: { ...state.usage, used: state.usage.used + results.length },
        };
      });

      return results;
    } finally {
      set({ batchEnriching: false });
    }
  },

  getByContactId: (contactId: string) => {
    return get().enrichments.get(contactId);
  },

  reset: () => {
    set({
      enrichments: new Map(),
      usage: { used: 0, limit: 10 },
      loading: false,
      enrichingContactId: null,
      batchEnriching: false,
      initialized: false,
    });
  },
}));
