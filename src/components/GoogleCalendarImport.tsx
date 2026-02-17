/**
 * Google Calendar Import Component
 * Allows users to import Luma events from their Google Calendar
 */

import { useState, useEffect } from 'react';
import { Calendar, Download, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { googleCalendarService, type GoogleCalendarEvent } from '../services/googleCalendarService';
import type { Itinerary, ItineraryEvent } from '../models/types';

interface GoogleCalendarImportProps {
  itinerary: Itinerary;
  onEventsImport: (events: ItineraryEvent[]) => Promise<void>;
}

export default function GoogleCalendarImport({ itinerary, onEventsImport }: GoogleCalendarImportProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lumaEvents, setLumaEvents] = useState<GoogleCalendarEvent[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if just connected from OAuth callback
    const justConnected = sessionStorage.getItem('google_calendar_connected') === 'true';
    const hasToken = googleCalendarService.isConnected();

    if (justConnected) {
      sessionStorage.removeItem('google_calendar_connected');
      setIsConnected(true);
      // Auto-fetch Luma events after connection
      handleFetchLumaEvents();
    } else if (hasToken) {
      setIsConnected(true);
    }
  }, []);

  const handleConnect = () => {
    googleCalendarService.initiateOAuth();
  };

  const handleDisconnect = () => {
    googleCalendarService.clearTokens();
    setIsConnected(false);
    setLumaEvents([]);
    setShowPreview(false);
  };

  const handleFetchLumaEvents = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const accessToken = googleCalendarService.getAccessToken();
      if (!accessToken) {
        throw new Error('Not connected to Google Calendar');
      }

      // Fetch events within the itinerary date range
      const timeMin = new Date(itinerary.startDate).toISOString();
      const timeMax = new Date(itinerary.endDate);
      timeMax.setHours(23, 59, 59, 999);
      const timeMaxISO = timeMax.toISOString();

      const { events, debug } = await googleCalendarService.fetchLumaEvents(
        accessToken,
        timeMin,
        timeMaxISO
      );

      // Log debug info to help diagnose detection issues
      if (debug) {
        console.log('Luma import debug:', {
          calendarsQueried: debug.calendarsQueried,
          calendarSources: debug.calendarSources,
          totalCalendarEvents: debug.totalCalendarEvents,
          lumaEventsFound: debug.lumaEventsFound,
          nonMatchingEvents: debug.nonMatchingEvents,
        });
      }

      setLumaEvents(events);

      if (events.length > 0) {
        setShowPreview(true);
        // Auto-select all events
        const allEventIds = new Set(events.map((e) => e.id));
        setSelectedEvents(allEventIds);
      } else {
        let errorMsg = `No Luma events found in your calendar between ${new Date(itinerary.startDate).toLocaleDateString()} and ${new Date(itinerary.endDate).toLocaleDateString()}.`;

        if (debug && debug.totalCalendarEvents > 0) {
          errorMsg += `\n\nFound ${debug.totalCalendarEvents} calendar event(s) in this range, but none matched Luma filters (organizer @lu.ma, attendee @lu.ma, or lu.ma/luma.com link in description).`;

          if (debug.nonMatchingEvents && debug.nonMatchingEvents.length > 0) {
            errorMsg += '\n\nNon-matching events:';
            for (const sample of debug.nonMatchingEvents) {
              errorMsg += `\n• "${sample.summary}" — organizer: ${sample.organizer}, description: ${sample.hasDescription ? 'yes' : 'none'}`;
              if (sample.descriptionSnippet) {
                errorMsg += `\n  Snippet: ${sample.descriptionSnippet.substring(0, 200)}`;
              }
            }
          }
        } else if (debug && debug.totalCalendarEvents === 0) {
          errorMsg += '\n\nNo calendar events at all were found in this date range.';
        }

        setError(errorMsg);
      }
    } catch (err) {
      console.error('Error fetching Luma events:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch Luma events';
      setError(message);

      // If token expired, disconnect
      if (message.includes('expired') || message.includes('invalid')) {
        handleDisconnect();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleEventSelection = (eventId: string) => {
    setSelectedEvents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  const handleImport = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Convert selected events to itinerary format
      const eventsToImport = lumaEvents
        .filter((e) => selectedEvents.has(e.id))
        .map((e) => googleCalendarService.convertToItineraryEvent(e));

      await onEventsImport(eventsToImport);

      // Close preview and show success
      setShowPreview(false);
      setLumaEvents([]);
      setSelectedEvents(new Set());
    } catch (err) {
      console.error('Error importing events:', err);
      setError(err instanceof Error ? err.message : 'Failed to import events');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!isConnected ? (
        <button
          onClick={handleConnect}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors shadow-sm"
        >
          <Calendar className="w-4 h-4" />
          Connect Google Calendar
        </button>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <button
              onClick={handleFetchLumaEvents}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Import Luma Events
            </button>

            <button
              onClick={handleDisconnect}
              className="text-sm text-slate-400 hover:text-slate-200 underline"
            >
              Disconnect
            </button>

            {isConnected && !showPreview && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle className="w-4 h-4" />
                Connected
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300">
              <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-sans flex-1">{error}</pre>
            </div>
          )}
        </div>
      )}

      {/* Event Preview Modal */}
      {showPreview && lumaEvents.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-700">
              <h2 className="text-xl font-semibold text-white">
                Import Luma Events ({selectedEvents.size} selected)
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Found {lumaEvents.length} Luma event{lumaEvents.length !== 1 ? 's' : ''} in your calendar
              </p>
            </div>

            {/* Event List */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-3">
                {lumaEvents.map((event) => (
                  <div
                    key={event.id}
                    onClick={() => toggleEventSelection(event.id)}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      selectedEvents.has(event.id)
                        ? 'border-purple-500 bg-purple-900/30'
                        : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedEvents.has(event.id)}
                        onChange={() => toggleEventSelection(event.id)}
                        className="mt-1 w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-white">{event.summary}</h3>
                        <div className="mt-1 space-y-1 text-sm text-slate-400">
                          <p>
                            📅 {new Date(event.start.dateTime || event.start.date!).toLocaleString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              hour: event.start.dateTime ? 'numeric' : undefined,
                              minute: event.start.dateTime ? '2-digit' : undefined,
                            })}
                          </p>
                          {event.location && <p>📍 {event.location}</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowPreview(false);
                  setSelectedEvents(new Set());
                }}
                className="px-4 py-2 text-slate-300 border border-slate-600 rounded-lg hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={selectedEvents.size === 0 || isLoading}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  `Import ${selectedEvents.size} Event${selectedEvents.size !== 1 ? 's' : ''}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
