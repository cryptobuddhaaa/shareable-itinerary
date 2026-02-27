/**
 * AI-powered contact enrichment: web search + LLM profile synthesis.
 * Uses Brave Search API for web results and Anthropic Claude Haiku for summarization.
 * All writes use service role key (no client-side RLS insert policies).
 */

import { createClient } from '@supabase/supabase-js';
import { getUserTier, getTierLimits } from './subscription.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// --- Types ---

export interface EnrichmentRole {
  title: string;
  organization: string;
  current: boolean;
}

export interface EnrichmentSocialLink {
  platform: string;
  url?: string;
  handle?: string;
}

export interface EnrichmentData {
  summary: string;
  roles: EnrichmentRole[];
  background: string[];
  notableActivity: string[];
  talkingPoints: string[];
  socialLinks: EnrichmentSocialLink[];
  suggestedTags: string[];
}

export interface ContactEnrichment {
  id: string;
  contactId: string;
  userId: string;
  queryName: string;
  queryContext: string | null;
  enrichmentData: EnrichmentData;
  confidence: 'low' | 'medium' | 'high' | null;
  sources: string[];
  status: 'pending' | 'completed' | 'failed';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

// --- Web Search ---

async function searchBrave(query: string): Promise<BraveSearchResult[]> {
  if (!BRAVE_SEARCH_API_KEY) {
    console.error('[Enrichment] BRAVE_SEARCH_API_KEY not set');
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: query,
      count: '10',
      text_decorations: 'false',
      search_lang: 'en',
    });

    const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_SEARCH_API_KEY,
      },
    });

    if (!resp.ok) {
      console.error('[Enrichment] Brave Search error:', resp.status, await resp.text());
      return [];
    }

    const data = await resp.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
    const results: BraveSearchResult[] = (data.web?.results || []).map(
      (r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        description: r.description,
      })
    );
    return results;
  } catch (err) {
    console.error('[Enrichment] Brave Search fetch error:', err);
    return [];
  }
}

async function searchWeb(name: string, context?: string): Promise<{ results: BraveSearchResult[]; queries: string[] }> {
  const queries: string[] = [];

  // Query 1: name + context (exact match attempt)
  if (context) {
    queries.push(`"${name}" ${context}`);
  }

  // Query 2: name without quotes + context (fallback for less-known people)
  queries.push(`${name} ${context || ''} professional background`.trim());

  // Query 3: name + crypto/web3 context
  queries.push(`${name} ${context || ''} crypto web3 blockchain`.trim());

  // Query 4: name + LinkedIn/Twitter for social links
  queries.push(`${name} ${context ? context + ' ' : ''}site:linkedin.com OR site:x.com OR site:twitter.com`);

  const allResults: BraveSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const query of queries) {
    const results = await searchBrave(query);
    for (const r of results) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        allResults.push(r);
      }
    }
  }

  console.log(`[Enrichment] Search for "${name}" (context: ${context || 'none'}): ${allResults.length} unique results from ${queries.length} queries`);

  return { results: allResults, queries };
}

// --- LLM Summarization ---

async function synthesizeProfile(
  name: string,
  context: string | undefined,
  searchResults: BraveSearchResult[],
  enhanced?: boolean
): Promise<{ data: EnrichmentData; confidence: 'low' | 'medium' | 'high' }> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const searchContext = searchResults
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`)
    .join('\n\n');

  const resultCount = searchResults.length;
  const prompt = `You are an expert professional networking researcher preparing a contact dossier. Build a comprehensive, structured profile for "${name}"${context ? ` (associated with: ${context})` : ''}.

SEARCH RESULTS (${resultCount} found):
${searchContext || 'No search results available.'}

Return a JSON object with this exact structure (no markdown, no code fences, just raw JSON):
{
  "summary": "2-3 sentence professional summary — who they are, what they're known for, and why they matter in their field",
  "roles": [{"title": "their role", "organization": "company/org", "current": true}],
  "background": ["key career milestone or background point"],
  "notableActivity": ["recent talk, project, publication, tweet, or event participation"],
  "talkingPoints": ["specific, actionable conversation starter based on their work and interests"],
  "socialLinks": [{"platform": "twitter", "handle": "@handle"}, {"platform": "linkedin", "url": "full url"}],
  "suggestedTags": ["professional category tag"]
}

Rules:
- Prioritize information from the search results. For details not in search results, you may supplement with your general knowledge if you recognize this person, but clearly ground claims in what's plausible.
- Provide at least 3-5 background points covering career trajectory, education, and key achievements.
- Provide at least 3-4 talking points that are specific and actionable — reference their actual projects, talks, or interests.
- notableActivity should include recent events, talks, projects, or public activity with approximate dates if available.
- suggestedTags should be 2-4 relevant professional categories (e.g., "community-builder", "investor", "developer", "founder").
- For socialLinks, include any handles/URLs found in search results. If you recognize this person and know their handles, include those too.
- ${context ? `Important context: this person is associated with "${context}" — make sure to explore this connection in the profile.` : 'If no organization context was provided, focus on what can be determined from search results and general knowledge.'}
- DO NOT return sparse/minimal output. Even with limited search results, provide a useful networking brief using all available signals.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: enhanced ? 'claude-sonnet-4-5-20241022' : 'claude-haiku-4-5-20251001',
      max_tokens: enhanced ? 4000 : 2500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[Enrichment] Anthropic API error:', resp.status, errText);
    throw new Error(`LLM API error: ${resp.status}`);
  }

  const llmResponse = await resp.json() as { content?: Array<{ text?: string }> };
  const text: string = llmResponse.content?.[0]?.text || '{}';

  // Parse JSON from response (handle potential markdown fences)
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed: EnrichmentData;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error('[Enrichment] Failed to parse LLM JSON:', jsonStr.substring(0, 200));
    parsed = {
      summary: `Limited information found for ${name}.`,
      roles: [],
      background: [],
      notableActivity: [],
      talkingPoints: [`Ask about their work${context ? ` at ${context}` : ''}`],
      socialLinks: [],
      suggestedTags: [],
    };
  }

  // Determine confidence based on result quality + profile completeness
  let confidence: 'low' | 'medium' | 'high' = 'low';
  const profileRichness = (parsed.roles?.length || 0) + (parsed.background?.length || 0) + (parsed.notableActivity?.length || 0);
  if (searchResults.length >= 8 && profileRichness >= 5 && parsed.summary.length > 80) {
    confidence = 'high';
  } else if ((searchResults.length >= 3 || profileRichness >= 3) && parsed.summary.length > 40) {
    confidence = 'medium';
  }

  return { data: parsed, confidence };
}

// --- Usage Tracking ---

export async function getUsage(userId: string): Promise<{ used: number; limit: number; tier: string }> {
  const month = new Date().toISOString().substring(0, 7); // YYYY-MM

  const [usageResult, tier] = await Promise.all([
    supabase
      .from('enrichment_usage')
      .select('usage_count')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle(),
    getUserTier(userId),
  ]);

  const limits = getTierLimits(tier);

  return {
    used: usageResult.data?.usage_count ?? 0,
    limit: limits.enrichments,
    tier,
  };
}

async function incrementUsage(userId: string): Promise<void> {
  const month = new Date().toISOString().substring(0, 7);

  // Upsert: create row if not exists, increment if exists
  const { data: existing } = await supabase
    .from('enrichment_usage')
    .select('id, usage_count')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('enrichment_usage')
      .update({ usage_count: existing.usage_count + 1 })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('enrichment_usage')
      .insert({ user_id: userId, month, usage_count: 1 });
  }
}

// --- Main Enrichment Pipeline ---

export async function performEnrichment(
  userId: string,
  contactId: string,
  name: string,
  context?: string,
  enhanced?: boolean
): Promise<ContactEnrichment> {
  // Check usage limit (tier-aware)
  const usage = await getUsage(userId);
  if (usage.used >= usage.limit) {
    throw new Error(`LIMIT_REACHED:You have used all your enrichments for this month (${usage.used}/${usage.limit}).`);
  }

  // Enhanced enrichment requires premium tier
  if (enhanced && usage.tier !== 'premium') {
    enhanced = false;
  }

  // Verify the contact belongs to this user
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('user_id', userId)
    .single();

  if (!contact) {
    throw new Error('Contact not found or does not belong to you.');
  }

  // Create pending enrichment record
  const { data: enrichmentRow, error: insertError } = await supabase
    .from('contact_enrichments')
    .insert({
      contact_id: contactId,
      user_id: userId,
      query_name: name,
      query_context: context || null,
      status: 'pending',
    })
    .select()
    .single();

  if (insertError || !enrichmentRow) {
    console.error('[Enrichment] Insert error:', insertError?.message, insertError?.code, insertError?.details);
    throw new Error(`Failed to create enrichment record: ${insertError?.message || 'unknown error'}`);
  }

  const enrichmentId = enrichmentRow.id as string;

  try {
    // Step 1: Web search
    const { results: searchResults } = await searchWeb(name, context);

    // Step 2: LLM synthesis (use Sonnet for enhanced/premium enrichments)
    const { data: enrichmentData, confidence } = await synthesizeProfile(name, context, searchResults, enhanced);

    // Step 3: Extract source URLs
    const sources = searchResults.slice(0, 5).map((r) => r.url);

    // Step 4: Update enrichment record
    const { data: updated, error: updateError } = await supabase
      .from('contact_enrichments')
      .update({
        enrichment_data: enrichmentData,
        confidence,
        sources,
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrichmentId)
      .select()
      .single();

    if (updateError) {
      console.error('[Enrichment] Update error:', updateError);
      throw new Error('Failed to save enrichment results.');
    }

    // Step 5: Increment usage
    await incrementUsage(userId);

    return mapRow(updated);
  } catch (err) {
    // Mark enrichment as failed
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await supabase
      .from('contact_enrichments')
      .update({
        status: 'failed',
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrichmentId);

    throw err;
  }
}

// --- Fetch Enrichments ---

export async function getEnrichmentsForUser(
  userId: string
): Promise<ContactEnrichment[]> {
  const { data, error } = await supabase
    .from('contact_enrichments')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Enrichment] Fetch error:', error);
    return [];
  }

  return (data || []).map(mapRow);
}

export async function getEnrichmentForContact(
  userId: string,
  contactId: string
): Promise<ContactEnrichment | null> {
  const { data, error } = await supabase
    .from('contact_enrichments')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return mapRow(data);
}

// --- Row mapper ---

function mapRow(row: Record<string, unknown>): ContactEnrichment {
  return {
    id: row.id as string,
    contactId: row.contact_id as string,
    userId: row.user_id as string,
    queryName: row.query_name as string,
    queryContext: row.query_context as string | null,
    enrichmentData: row.enrichment_data as EnrichmentData,
    confidence: row.confidence as 'low' | 'medium' | 'high' | null,
    sources: (row.sources as string[]) || [],
    status: row.status as 'pending' | 'completed' | 'failed',
    errorMessage: row.error_message as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
