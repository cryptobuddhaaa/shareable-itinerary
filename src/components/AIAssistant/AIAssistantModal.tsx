/**
 * AI Assistant Modal
 * Main interface for text-based AI event creation
 */

import { useState, useEffect, useRef } from 'react';
import { X, Send, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import aiService from '../../services/aiService';
import { PaywallModal } from '../Premium/PaywallModal';
import { sanitizeText } from '../../lib/validation';
import type { Itinerary, ItineraryEvent, Contact } from '../../models/types';
import { ConfirmDialog, useConfirmDialog } from '../ConfirmDialog';

type SuggestedEvent = {
  _deleteAction?: false;
  title: string;
  startTime: string;
  endTime: string;
  eventType: string;
  location?: { name: string; address?: string };
  description?: string;
} | {
  _deleteAction: true;
  eventTitle: string;
  eventDate?: string;
  eventTime?: string;
  hasContacts?: boolean;
  contactCount?: number;
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  suggestedEvent?: SuggestedEvent;
}

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  itinerary: Itinerary;
  currentDate?: string;
  existingEvents?: ItineraryEvent[];
  contacts?: Contact[];
  onEventCreate: (event: Partial<ItineraryEvent>) => void;
  onEventDelete: (eventId: string) => Promise<void>;
  user: User;
}

export function AIAssistantModal({
  isOpen,
  onClose,
  itinerary,
  currentDate,
  existingEvents = [],
  contacts = [],
  onEventCreate,
  onEventDelete,
  user
}: AIAssistantModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedEvent, setSuggestedEvent] = useState<SuggestedEvent | null>(null);
  const [usageInfo, setUsageInfo] = useState({
    remaining: 3,
    limit: 3,
    tier: 'free' as 'free' | 'premium' | 'pro'
  });
  const [showPaywall, setShowPaywall] = useState(false);
  const { confirm, dialogProps } = useConfirmDialog();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation history from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(`ai-conversation-${itinerary.id}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Convert timestamp strings back to Date objects
        const restoredMessages: Message[] = parsed.map((msg: Omit<Message, 'timestamp'> & { timestamp: string }) => ({
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
            content: `Hi! I'm your AI assistant for "${itinerary.title}". I can help you:\n\n• **Manage events** - Add or delete events using natural language\n• **View your schedule** - Ask "What's on my schedule for Feb 9?"\n• **Search contacts** - Find people you've met, like "Who did I meet at the networking event?"\n• **Plan logistics** - Calculate transit times and identify tight transitions\n\nExamples:\n• "My flight arrives at 8am on Feb 9"\n• "Show me what I have tomorrow"\n• "How long between my lunch and next meeting?"\n• "Who did I meet on Feb 9?"\n\nHow can I help you today?`,
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
      // Prepare context — events are already camelCase from the store
      const context = {
        title: itinerary.title,
        startDate: itinerary.startDate,
        endDate: itinerary.endDate,
        location: itinerary.location,
        goals: itinerary.goals,
        currentDate,
        existingEvents: existingEvents.map((e) => ({
          title: e.title,
          startTime: e.startTime,
          endTime: e.endTime,
          eventType: e.eventType,
          date: e.startTime ? new Date(e.startTime).toISOString().split('T')[0] : '',
          location: e.location ? {
            name: e.location.name || '',
            address: e.location.address || ''
          } : undefined
        })),
        contacts: contacts.map((c) => ({
          firstName: c.firstName,
          lastName: c.lastName,
          projectCompany: c.projectCompany,
          position: c.position,
          eventTitle: c.eventTitle,
          dateMet: c.dateMet,
          notes: c.notes
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

      // If delete was requested, store it for confirmation
      if (response.action === 'delete_event' && response.eventTitle) {
        setSuggestedEvent({
          _deleteAction: true,
          eventTitle: response.eventTitle,
          eventDate: response.eventDate,
          eventTime: response.eventTime,
          hasContacts: response.hasContacts,
          contactCount: response.contactCount
        });
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
    } catch (error) {
      console.error('AI assistant error:', error);
      setError(error instanceof Error ? error.message : 'Failed to process your request. Please try again.');

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

  const handleConfirmEvent = async () => {
    if (!suggestedEvent) return;

    // Check if this is a delete action
    if (suggestedEvent._deleteAction) {
      const targetTitle = suggestedEvent.eventTitle;
      // Find the event to delete
      const eventToDelete = existingEvents.find((e: ItineraryEvent) =>
        e.title.toLowerCase().includes(targetTitle.toLowerCase()) ||
        targetTitle.toLowerCase().includes(e.title.toLowerCase())
      );

      if (eventToDelete) {
        try {
          await onEventDelete(eventToDelete.id);
          setSuggestedEvent(null);

          // Add confirmation message
          const confirmMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `✅ Event "${eventToDelete.title}" has been deleted from your itinerary${suggestedEvent.hasContacts ? ` along with ${suggestedEvent.contactCount ?? 0} contact${(suggestedEvent.contactCount ?? 0) > 1 ? 's' : ''}` : ''}. Anything else I can help with?`,
            timestamp: new Date()
          };
          setMessages((prev) => [...prev, confirmMsg]);
        } catch (error) {
          console.error('Error deleting event:', error);
          const errorMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `❌ Sorry, I couldn't delete that event. Please try again or delete it manually.`,
            timestamp: new Date()
          };
          setMessages((prev) => [...prev, errorMsg]);
        }
      } else {
        // Event not found
        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `❌ I couldn't find the event "${suggestedEvent.eventTitle}" in your schedule. It may have already been deleted.`,
          timestamp: new Date()
        };
        setMessages((prev) => [...prev, errorMsg]);
        setSuggestedEvent(null);
      }
    } else {
      // Regular create event action — pass camelCase matching ItineraryEvent
      const event: Partial<ItineraryEvent> = {
        title: suggestedEvent.title,
        startTime: suggestedEvent.startTime,
        endTime: suggestedEvent.endTime,
        eventType: suggestedEvent.eventType as ItineraryEvent['eventType'],
        location: suggestedEvent.location ? { name: suggestedEvent.location.name, address: suggestedEvent.location.address ?? '' } : undefined,
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
    }
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

  const handleClearConversation = async () => {
    const confirmed = await confirm({
      title: 'Clear conversation',
      message: 'Clear conversation history? This cannot be undone.',
      confirmLabel: 'Clear',
      variant: 'danger',
    });
    if (confirmed) {
      setMessages([]);
      localStorage.removeItem(`ai-conversation-${itinerary.id}`);
      // Add welcome message again
      setMessages([
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Hi! I'm your AI assistant for "${itinerary.title}". I can help you:\n\n• **Manage events** - Add or delete events using natural language\n• **View your schedule** - Ask "What's on my schedule for Feb 9?"\n• **Search contacts** - Find people you've met, like "Who did I meet at the networking event?"\n• **Plan logistics** - Calculate transit times between events (coming soon)\n\nExamples:\n• "My flight arrives at 8am on Feb 9"\n• "Show me what I have tomorrow"\n• "Delete the lunch meeting on Monday"\n• "Who did I meet on Feb 9?"\n\nHow can I help you today?`,
          timestamp: new Date()
        }
      ]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-2xl bg-slate-800 rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h2 className="text-xl font-semibold text-white">AI Assistant</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-400">
              {usageInfo.remaining}/{usageInfo.limit} queries remaining
            </div>
            <button
              onClick={handleClearConversation}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-700"
              title="Clear conversation history"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors"
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
                    : 'bg-slate-700 text-slate-200'
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
              <div className="bg-slate-700 rounded-lg px-4 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Event Confirmation */}
        {suggestedEvent && (
          <div className={`px-6 py-4 border-t ${suggestedEvent._deleteAction ? 'bg-red-900/30 border-red-700' : 'bg-purple-900/30 border-purple-700'}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-white mb-2">
                  {suggestedEvent._deleteAction ? 'Confirm Deletion:' : 'Confirm Event:'}
                </p>
                {suggestedEvent._deleteAction ? (
                  <div className="space-y-1 text-sm text-slate-300">
                    <p><strong>Event:</strong> {suggestedEvent.eventTitle}</p>
                    {suggestedEvent.eventDate && (
                      <p><strong>Date:</strong> {new Date(suggestedEvent.eventDate).toLocaleDateString()}</p>
                    )}
                    {suggestedEvent.eventTime && (
                      <p><strong>Time:</strong> {suggestedEvent.eventTime}</p>
                    )}
                    {suggestedEvent.hasContacts && (
                      <p className="text-red-400 font-medium mt-2">
                        ⚠️ {suggestedEvent.contactCount ?? 0} contact{(suggestedEvent.contactCount ?? 0) > 1 ? 's' : ''} will also be deleted
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1 text-sm text-slate-300">
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
                )}
              </div>
              <div className="flex gap-2 ml-4">
                <button
                  onClick={handleConfirmEvent}
                  className={`px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors ${
                    suggestedEvent._deleteAction
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {suggestedEvent._deleteAction ? 'Delete Event' : 'Add Event'}
                </button>
                <button
                  onClick={handleCancelEvent}
                  className="px-4 py-2 bg-slate-700 border border-slate-600 text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-6 py-3 bg-red-900/30 border-t border-red-700">
            <div className="flex items-center gap-2 text-sm text-red-300">
              <AlertCircle className="w-4 h-4" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-6 py-4 border-t border-slate-700">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message... (e.g., 'Add flight at 8am tomorrow')"
              className="flex-1 px-4 py-2 border border-slate-600 rounded-lg resize-none bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
          <p className="text-xs text-slate-500 mt-2">
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

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
