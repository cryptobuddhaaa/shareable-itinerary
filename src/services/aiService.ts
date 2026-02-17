/**
 * AI Service for Claude API integration
 * Handles event creation, analysis, and contact intelligence
 */

import { getEventCreationPrompt, getAnalysisPrompt, getContactBriefingPrompt, type ItineraryContext } from '../utils/promptTemplates';
import type { Itinerary, ItineraryEvent, Contact } from '../models/types';

interface AIResponse {
  action: 'create_event' | 'delete_event' | 'clarify' | 'error';
  event?: {
    title: string;
    startTime: string;
    endTime: string;
    eventType: string;
    location: {
      name: string;
      address?: string;
    };
    description?: string;
  };
  // For delete_event action
  eventTitle?: string;
  eventDate?: string;
  eventTime?: string;
  hasContacts?: boolean;
  contactCount?: number;
  message: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
}

interface AnalysisResponse {
  conflicts: Array<{
    type: string;
    severity: string;
    events: string[];
    message: string;
    suggestion: string;
  }>;
  optimizations: Array<{
    type: string;
    message: string;
    events: string[];
    reasoning: string;
  }>;
  goalAlignment: {
    score: number;
    analysis: string;
    suggestions: string[];
  };
  summary: string;
}

interface BriefingResponse {
  briefing: string;
  keyPoints: string[];
  suggestedTopics: string[];
  followUps: string[];
  objectives: string[];
}

class AIService {
  private apiKey: string;
  // Use proxy endpoint in development, will be serverless in production
  private apiEndpoint = import.meta.env.DEV ? '/api/claude' : 'https://api.anthropic.com/v1/messages';
  private model = 'claude-sonnet-4-5-20250929';

  constructor() {
    // In production, this will be accessed via serverless function
    // For now, we'll structure it to work with environment variables
    this.apiKey = import.meta.env.CLAUDE_API_KEY || '';
  }

  /**
   * Parse user input and create event suggestion
   */
  async parseEventInput(
    userMessage: string,
    itineraryContext: ItineraryContext,
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<AIResponse> {
    try {
      const prompt = getEventCreationPrompt(userMessage, itineraryContext);

      const response = await this.callClaudeAPI(prompt, {
        temperature: 0.3, // Lower temperature for more consistent output
        maxTokens: 1024,
        conversationHistory // Pass conversation history for context
      });

      // Parse JSON response from Claude
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse AI response');
      }

      const parsedResponse: AIResponse = JSON.parse(jsonMatch[0]);
      return parsedResponse;
    } catch (error) {
      console.error('AI parsing error:', error);
      return {
        action: 'error',
        message: 'Sorry, I had trouble understanding that. Could you try rephrasing?',
        needsClarification: true,
        clarificationQuestion: 'Could you provide more details about the event you want to create?'
      };
    }
  }

  /**
   * Analyze itinerary for conflicts and optimizations
   */
  async analyzeItinerary(
    itinerary: Itinerary,
    events: ItineraryEvent[]
  ): Promise<AnalysisResponse> {
    try {
      const prompt = getAnalysisPrompt(itinerary, events);

      const response = await this.callClaudeAPI(prompt, {
        temperature: 0.2,
        maxTokens: 2048
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse analysis response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Analysis error:', error);
      throw new Error('Failed to analyze itinerary');
    }
  }

  /**
   * Generate meeting briefing
   */
  async generateBriefing(
    event: ItineraryEvent,
    contacts: Contact[]
  ): Promise<BriefingResponse> {
    try {
      const prompt = getContactBriefingPrompt(event, contacts);

      const response = await this.callClaudeAPI(prompt, {
        temperature: 0.4,
        maxTokens: 1536
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse briefing response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Briefing generation error:', error);
      throw new Error('Failed to generate briefing');
    }
  }

  /**
   * Call Claude API
   * NOTE: In production, this should be proxied through a serverless function
   * to protect the API key
   */
  private async callClaudeAPI(
    prompt: string,
    options: {
      temperature?: number;
      maxTokens?: number;
      conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    } = {}
  ): Promise<string> {
    const { temperature = 0.3, maxTokens = 1024, conversationHistory = [] } = options;

    // For MVP, we'll call the API via proxy in dev, serverless in production
    // In dev mode, the Vite proxy adds the API key header
    if (!import.meta.env.DEV && !this.apiKey) {
      throw new Error('Claude API key not configured');
    }

    // Headers differ based on whether we're using the proxy
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Only add API key header if not using dev proxy (proxy adds it)
    if (!import.meta.env.DEV) {
      headers['x-api-key'] = this.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    // Build messages array
    // If we have conversation history, use it and append the current message
    // Otherwise, start a new conversation with the current prompt
    const messages = conversationHistory.length > 0
      ? [
          ...conversationHistory,
          {
            role: 'user' as const,
            content: prompt
          }
        ]
      : [
          {
            role: 'user' as const,
            content: prompt
          }
        ];

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature,
        messages
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Claude API error:', error);
      throw new Error(`API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new Error('Unexpected API response format');
    }
    return text;
  }

  /**
   * Track AI usage for billing purposes
   * This should be called after each successful AI query
   */
  async trackUsage(
    userId: string,
    featureType: 'event_creation' | 'analysis' | 'briefing',
    tokensUsed: number,
    costCents: number,
    success: boolean = true
  ): Promise<void> {
    try {
      // Import dynamically to avoid circular dependency
      const { subscriptionService } = await import('./subscriptionService');
      await subscriptionService.trackAIUsage(userId, featureType, tokensUsed, costCents, success);
    } catch (error) {
      console.error('Failed to track usage:', error);
      // Don't throw - usage tracking failure shouldn't break the app
    }
  }

  /**
   * Check if user has remaining AI queries for current month
   */
  async checkUsageLimit(
    userId: string,
    featureType: string
  ): Promise<{
    allowed: boolean;
    remaining: number;
    limit: number;
    tier: string;
  }> {
    try {
      // Import dynamically to avoid circular dependency
      const { subscriptionService } = await import('./subscriptionService');
      const usage = await subscriptionService.getAIUsage(userId, featureType);

      return {
        allowed: usage.isUnlimited || usage.remaining > 0,
        remaining: usage.isUnlimited ? -1 : usage.remaining,
        limit: usage.isUnlimited ? -1 : usage.limit,
        tier: usage.tier
      };
    } catch (error) {
      console.error('Failed to check usage limit:', error);
      // On error, be conservative and deny access
      return {
        allowed: false,
        remaining: 0,
        limit: 3,
        tier: 'free'
      };
    }
  }
}

// Export singleton instance
export const aiService = new AIService();
export default aiService;
