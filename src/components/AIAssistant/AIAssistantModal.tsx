/**
 * AI Assistant Modal
 * Main interface for text-based AI event creation
 */

import { useState, useEffect, useRef } from 'react';
import { X, Send, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import aiService from '../../services/aiService';
import { subscriptionService } from '../../services/subscriptionService';
import { PaywallModal } from '../Premium/PaywallModal';
import { sanitizeText } from '../../lib/validation';
import { normalizeEvents } from '../../utils/eventNormalizer';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  suggestedEvent?: any;
}

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  itinerary: any;
  currentDate?: string;
  existingEvents?: any[];
  onEventCreate: (event: any) => void;
  user: any;
}

export function AIAssistantModal({
  isOpen,
  onClose,
  itinerary,
  currentDate,
  existingEvents = [],
  onEventCreate,
  user
}: AIAssistantModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedEvent, setSuggestedEvent] = useState<any | null>(null);
  const [usageInfo, setUsageInfo] = useState({
    remaining: 3,
    limit: 3,
    tier: 'free' as 'free' | 'premium' | 'pro'
  });
  const [showPaywall, setShowPaywall] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation history from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(`ai-conversation-${itinerary.id}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Convert timestamp strings back to Date objects
        const restoredMessages = parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
        setMessages(restoredMessages);
      } catch (e) {
        console.error('Error loading conversation history:', e);
      }
    }
  }, [itinerary.id]);

  // Save conversation history to localStorage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`ai-conversation-${itinerary.id}`, JSON.stringify(messages));
    }
  }, [messages, itinerary.id]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Load usage info when modal opens
  useEffect(() => {
    if (isOpen && user) {
      checkUsageLimit();
    }
  }, [isOpen, user]);

  // Add welcome message when modal opens (only if no conversation history)
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      // Check if there's saved conversation
      const stored = localStorage.getItem(`ai-conversation-${itinerary.id}`);
      if (!stored) {
        setMessages([
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: `Hi! I'm your AI assistant. I can help you create events for "${itinerary.title}". Just tell me what you'd like to add, for example:\n\n• "My flight arrives at 8am on Feb 9"\n• "Lunch meeting with Sarah at noon tomorrow"\n• "Conference keynote from 10am to 11:30am on Monday"\n\nWhat would you like to add?`,
            timestamp: new Date()
          }
        ]);
      }
    }
  }, [isOpen, itinerary.id]);

  const checkUsageLimit = async () => {
    try {
      const usage = await aiService.checkUsageLimit(user.id, 'event_creation');
      setUsageInfo({
        remaining: usage.remaining === -1 ? 999 : usage.remaining,
        limit: usage.limit === -1 ? 999 : usage.limit,
        tier: usage.tier as 'free' | 'premium' | 'pro'
      });
    } catch (error) {
      console.error('Failed to check usage limit:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = sanitizeText(inputValue.trim());

    // Check usage limit
    if (usageInfo.remaining <= 0) {
      setShowPaywall(true);
      return;
    }

    // Add user message
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      // Prepare context
      // Normalize all events to camelCase format
      const normalizedEvents = normalizeEvents(existingEvents);

      const context = {
        title: itinerary.title,
        startDate: itinerary.start_date,
        endDate: itinerary.end_date,
        location: itinerary.location,
        goals: itinerary.goals,
        currentDate,
        existingEvents: normalizedEvents.map((e) => ({
          title: e.title,
          startTime: e.startTime,
          endTime: e.endTime,
          eventType: e.eventType,
          date: e.startTime ? new Date(e.startTime).toISOString().split('T')[0] : ''
        }))
      };

      // Prepare conversation history (exclude system/welcome messages)
      // Format: array of {role, content} for Claude API
      const conversationHistory = messages
        .filter((msg) => msg.role !== 'assistant' || !msg.content.includes('Hi! I\'m your AI assistant')) // Exclude welcome message
        .map((msg) => ({
          role: msg.role,
          content: msg.content
        }));

      // Call AI service with conversation history
      const response = await aiService.parseEventInput(userMessage, context, conversationHistory);

      // Add AI response
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message,
        timestamp: new Date(),
        suggestedEvent: response.event
      };

      setMessages((prev) => [...prev, aiMsg]);

      // If event was successfully parsed, show confirmation
      if (response.action === 'create_event' && response.event) {
        setSuggestedEvent(response.event);
      }

      // Track usage
      await aiService.trackUsage(user.id, 'event_creation', 1000, 1, true);

      // Update usage count
      setUsageInfo((prev) => ({
        ...prev,
        remaining: Math.max(0, prev.remaining - 1)
      }));

      // Recheck usage limit to get fresh data
      await checkUsageLimit();
    } catch (error: any) {
      console.error('AI assistant error:', error);
      setError(error.message || 'Failed to process your request. Please try again.');

      // Add error message
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date()
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmEvent = () => {
    if (!suggestedEvent) return;

    // Convert AI event format to app event format
    const event = {
      title: suggestedEvent.title,
      start_time: suggestedEvent.startTime,
      end_time: suggestedEvent.endTime,
      event_type: suggestedEvent.eventType,
      location: suggestedEvent.location,
      description: suggestedEvent.description || ''
    };

    onEventCreate(event);
    setSuggestedEvent(null);

    // Add confirmation message
    const confirmMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: `✅ Event "${suggestedEvent.title}" has been added to your itinerary! Would you like to add anything else?`,
      timestamp: new Date()
    };
    setMessages((prev) => [...prev, confirmMsg]);
  };

  const handleCancelEvent = () => {
    setSuggestedEvent(null);

    const cancelMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: 'No problem! Let me know if you\'d like to create a different event.',
      timestamp: new Date()
    };
    setMessages((prev) => [...prev, cancelMsg]);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearConversation = () => {
    if (confirm('Clear conversation history? This cannot be undone.')) {
      setMessages([]);
      localStorage.removeItem(`ai-conversation-${itinerary.id}`);
      // Add welcome message again
      setMessages([
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Hi! I'm your AI assistant. I can help you create events for "${itinerary.title}". Just tell me what you'd like to add, for example:\n\n• "My flight arrives at 8am on Feb 9"\n• "Lunch meeting with Sarah at noon tomorrow"\n• "Conference keynote from 10am to 11:30am on Monday"\n\nWhat would you like to add?`,
          timestamp: new Date()
        }
      ]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            <h2 className="text-xl font-semibold text-gray-900">AI Assistant</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">
              {usageInfo.remaining}/{usageInfo.limit} queries remaining
            </div>
            {messages.length > 1 && (
              <button
                onClick={handleClearConversation}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded hover:bg-gray-100"
                title="Clear conversation history"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                <p className="text-xs mt-1 opacity-70">
                  {msg.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-lg px-4 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-gray-600" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Event Confirmation */}
        {suggestedEvent && (
          <div className="px-6 py-4 bg-purple-50 border-t border-purple-200">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 mb-2">
                  Confirm Event:
                </p>
                <div className="space-y-1 text-sm text-gray-700">
                  <p><strong>Title:</strong> {suggestedEvent.title}</p>
                  <p>
                    <strong>Time:</strong>{' '}
                    {new Date(suggestedEvent.startTime).toLocaleString()} -{' '}
                    {new Date(suggestedEvent.endTime).toLocaleTimeString()}
                  </p>
                  <p><strong>Type:</strong> {suggestedEvent.eventType}</p>
                  {suggestedEvent.location && (
                    <p><strong>Location:</strong> {suggestedEvent.location.name}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 ml-4">
                <button
                  onClick={handleConfirmEvent}
                  className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Add Event
                </button>
                <button
                  onClick={handleCancelEvent}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-6 py-3 bg-red-50 border-t border-red-200">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-6 py-4 border-t border-gray-200">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message... (e.g., 'Add flight at 8am tomorrow')"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              rows={2}
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !inputValue.trim()}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* Paywall Modal */}
      <PaywallModal
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        currentTier={usageInfo.tier}
        usageInfo={{
          used: usageInfo.limit - usageInfo.remaining,
          limit: usageInfo.limit
        }}
      />
    </div>
  );
}
