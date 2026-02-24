import { useCallback, useRef, useState } from 'react';
import { useItinerary } from '../hooks/useItinerary';
import { useContacts } from '../hooks/useContacts';
import EventForm from './EventForm';
import EditEventDialog from './EditEventDialog';
import ContactForm from './ContactForm';
import ContactsList from './ContactsList';
import GoogleCalendarImport from './GoogleCalendarImport';
import type { Itinerary, ItineraryDay, ItineraryEvent } from '../models/types';
import { mapsService } from '../services/mapsService';
import { printItinerary } from '../services/printService';
import { toast } from './Toast';
import { isTelegramWebApp } from '../lib/telegram';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

interface ItineraryTimelineProps {
  sharedItinerary?: Itinerary;
  readOnly?: boolean;
}

export default function ItineraryTimeline({ sharedItinerary, readOnly = false }: ItineraryTimelineProps = {}) {
  const { currentItinerary, deleteEvent, clearItinerary, addEvent } = useItinerary();
  const { getContactsByEvent, deleteContactsByEvent } = useContacts();
  const [selectedDay, setSelectedDay] = useState<ItineraryDay | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<{ event: ItineraryEvent; dayDate: string } | null>(null);
  const [addingContactFor, setAddingContactFor] = useState<{ event: ItineraryEvent; dayDate: string } | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [contactsExpanded, setContactsExpanded] = useState(true);
  const [eventSearch, setEventSearch] = useState('');
  const { confirm, dialogProps } = useConfirmDialog();
  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const itinerary = sharedItinerary || currentItinerary();
  if (!itinerary) return null;

  const todayStr = new Date().toISOString().split('T')[0];
  const hasToday = itinerary.days.some((d) => d.date === todayStr);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const scrollToToday = useCallback(() => {
    // Expand today's day card
    setExpandedDays((prev) => {
      const newSet = new Set(prev);
      newSet.add(todayStr);
      return newSet;
    });
    // Scroll to it after a tick (so it has time to expand)
    setTimeout(() => {
      const el = dayRefs.current.get(todayStr);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, [todayStr]);

  const hasLocation = (event: ItineraryEvent) =>
    event.location && (event.location.name || event.location.address || event.location.coordinates);

  const getDayRouteUrl = (events: ItineraryEvent[]) => {
    const locEvents = events.filter(hasLocation);
    if (locEvents.length < 2) return null;
    const waypoints = locEvents.map((e) => mapsService.locationToQuery(e.location));
    // Google Maps directions URL with waypoints
    const origin = encodeURIComponent(waypoints[0]);
    const destination = encodeURIComponent(waypoints[waypoints.length - 1]);
    const waypointStr = waypoints.length > 2
      ? `&waypoints=${waypoints.slice(1, -1).map(encodeURIComponent).join('|')}`
      : '';
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointStr}`;
  };

  const toggleDayExpansion = (date: string) => {
    setExpandedDays((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(date)) {
        newSet.delete(date);
      } else {
        newSet.add(date);
      }
      return newSet;
    });
  };

  const handleDeleteEvent = async (event: ItineraryEvent) => {
    const eventContacts = getContactsByEvent(event.id);
    const contactCount = eventContacts.length;

    let message = 'This action cannot be undone.';
    if (contactCount > 0) {
      message = `This event has ${contactCount} contact${contactCount > 1 ? 's' : ''} associated with it. ${contactCount > 1 ? 'They' : 'This contact'} will also be deleted.`;
    }

    const confirmed = await confirm({
      title: `Delete "${event.title}"?`,
      message,
      confirmLabel: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      try {
        if (contactCount > 0) {
          await deleteContactsByEvent(event.id);
        }
        await deleteEvent(event.id);
      } catch (error) {
        console.error('Error deleting event and contacts:', error);
        toast.error('Failed to delete event. Please try again.');
      }
    }
  };

  const handleGoogleCalendarImport = async (events: ItineraryEvent[]) => {
    try {
      let importedCount = 0;
      let skippedCount = 0;
      const skippedEvents: string[] = [];

      for (const event of events) {
        if (!event.startTime || !event.endTime) {
          skippedCount++;
          continue;
        }

        const startDate = new Date(event.startTime);
        if (isNaN(startDate.getTime())) {
          skippedCount++;
          continue;
        }

        // Check for duplicate events by matching title and start time
        const isDuplicate = itinerary.days.some(day =>
          day.events.some(existingEvent => {
            const titleMatch = existingEvent.title.trim().toLowerCase() === event.title.trim().toLowerCase();
            const timeMatch = existingEvent.startTime === event.startTime;
            return titleMatch && timeMatch;
          })
        );

        if (isDuplicate) {
          skippedEvents.push(event.title);
          skippedCount++;
          continue;
        }

        const dateStr = event.startTime.split('T')[0];
        await addEvent(dateStr, event);
        importedCount++;
      }

      // Show result message
      let message = '';
      if (importedCount > 0) {
        message += `Successfully imported ${importedCount} event${importedCount !== 1 ? 's' : ''}!`;
      }
      if (skippedCount > 0) {
        message += `${importedCount > 0 ? '\n\n' : ''}Skipped ${skippedCount} duplicate event${skippedCount !== 1 ? 's' : ''}`;
        if (skippedEvents.length > 0) {
          message += `:\n• ${skippedEvents.join('\n• ')}`;
        }
      }
      if (message) {
        toast.info(message);
      }
    } catch (error) {
      console.error('Error importing events:', error);
      toast.error('Failed to import some events. Please try again.');
    }
  };

  return (
    <div>
      <div className="bg-slate-800 shadow rounded-lg p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">{itinerary.title}</h2>
            <p className="text-slate-300 mt-1">{itinerary.location}</p>
            <p className="text-sm text-slate-400 mt-1">
              {formatDate(itinerary.startDate)} - {formatDate(itinerary.endDate)}
            </p>
            {itinerary.goals && (
              <p className="text-sm text-slate-300 mt-2">{itinerary.goals}</p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {!readOnly && (
              <GoogleCalendarImport
                itinerary={itinerary}
                onEventsImport={handleGoogleCalendarImport}
              />
            )}
            <button
              onClick={() => {
                if (isTelegramWebApp()) {
                  toast.info('Export is available in the browser version of the app.');
                  return;
                }
                printItinerary(itinerary);
              }}
              className="inline-flex items-center px-3 py-1.5 border border-slate-600 text-sm font-medium rounded-md text-slate-300 bg-slate-700 hover:bg-slate-600"
              title="Export as PDF"
              aria-label="Export as PDF"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Export
            </button>
            {!readOnly && (
              <button
                onClick={async () => {
                  const confirmed = await confirm({
                    title: 'Clear Itinerary',
                    message: 'Are you sure you want to start over? All events and data will be deleted.',
                    confirmLabel: 'Clear',
                    variant: 'danger',
                  });
                  if (confirmed) clearItinerary();
                }}
                className="text-sm text-red-400 hover:text-red-300 px-3 py-1.5"
              >
                Clear Itinerary
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Event search + Today button */}
      {itinerary.days.some((d) => d.events.length > 0) && (
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search events..."
              value={eventSearch}
              onChange={(e) => setEventSearch(e.target.value)}
              className="block w-full pl-9 pr-8 py-2 text-sm border border-slate-600 rounded-md bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {eventSearch && (
              <button
                onClick={() => setEventSearch('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                aria-label="Clear search"
              >
                <svg className="h-4 w-4 text-slate-400 hover:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {hasToday && (
            <button
              onClick={scrollToToday}
              className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Today
            </button>
          )}
        </div>
      )}

      {itinerary.days.map((day) => {
        const searchLower = eventSearch.toLowerCase().trim();
        const filteredEvents = searchLower
          ? day.events.filter((ev) =>
              ev.title.toLowerCase().includes(searchLower) ||
              ev.location.name.toLowerCase().includes(searchLower) ||
              ev.location.address?.toLowerCase().includes(searchLower) ||
              ev.eventType.toLowerCase().includes(searchLower) ||
              ev.goals?.some((g) => g.toLowerCase().includes(searchLower))
            )
          : day.events;

        // Hide days with no matching events when searching
        if (searchLower && filteredEvents.length === 0) return null;

        const isExpanded = searchLower ? true : expandedDays.has(day.date);
        return (
          <div
            key={day.date}
            ref={(el) => { if (el) dayRefs.current.set(day.date, el); }}
            className={`bg-slate-800 shadow rounded-lg p-6 mb-6${day.date === todayStr ? ' ring-1 ring-blue-500/50' : ''}`}
          >
            <div className="flex justify-between items-center mb-4">
              <button
                onClick={() => toggleDayExpansion(day.date)}
                className="flex-1 text-left flex items-center gap-2 hover:bg-slate-700 p-2 -ml-2 rounded-lg transition-colors"
              >
                <svg
                  className={`w-5 h-5 text-slate-400 transition-transform duration-200 flex-shrink-0 ${
                    isExpanded ? 'transform rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                <div>
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    Day {day.dayNumber}: {formatDate(day.date)}
                    {day.date === todayStr && (
                      <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-blue-600 text-white">Today</span>
                    )}
                  </h3>
                  {day.goals.length > 0 && (
                    <p className="text-sm text-slate-300 mt-1">Goals: {day.goals.join(', ')}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    {searchLower
                      ? `${filteredEvents.length} of ${day.events.length} event${day.events.length !== 1 ? 's' : ''}`
                      : `${day.events.length} event${day.events.length !== 1 ? 's' : ''}`
                    }
                  </p>
                </div>
              </button>
            <div className="flex gap-2 items-center flex-shrink-0">
              {(() => {
                const sorted = [...day.events].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                const routeUrl = getDayRouteUrl(sorted);
                return routeUrl ? (
                  <a
                    href={routeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-emerald-300 bg-emerald-900/40 hover:bg-emerald-900/60"
                    title="View day's route on Google Maps"
                    aria-label="View route on map"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Route
                  </a>
                ) : null;
              })()}
              {!readOnly && (
                <button
                  onClick={() => {
                    setSelectedDay(day);
                    setShowEventForm(true);
                  }}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-blue-300 bg-blue-900/40 hover:bg-blue-900/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-blue-500"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Event
                </button>
              )}
            </div>
          </div>

          {isExpanded && (
            <>
              {filteredEvents.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No events scheduled for this day</p>
              ) : (
                <div className="space-y-4">
              {(() => {
                const sorted = [...filteredEvents].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                return sorted.map((event, idx) => (
                <div key={event.id}>
                {/* Direction link from previous event */}
                {idx > 0 && hasLocation(sorted[idx - 1]) && hasLocation(event) && (
                  <a
                    href={mapsService.generateDirectionsUrl(sorted[idx - 1].location, event.location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 py-1.5 px-4 -mx-0 mb-2 text-xs text-slate-400 hover:text-blue-400 transition-colors group"
                    title={`Directions: ${sorted[idx - 1].location.name} → ${event.location.name}`}
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0 text-slate-500 group-hover:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                    <span className="border-b border-dashed border-slate-600 group-hover:border-blue-400">
                      Get directions to {event.location.name}
                    </span>
                  </a>
                )}
                <div className="border-l-4 border-blue-500 pl-4 py-2">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{event.title}</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">
                          {event.eventType}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 mt-1">
                        {formatTime(event.startTime)} - {formatTime(event.endTime)}
                      </p>
                      <div className="text-sm text-slate-300 mt-1">
                        {event.location.mapsUrl ? (
                          <a
                            href={event.location.mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {event.location.name}
                            {event.location.address && ` (${event.location.address})`}
                          </a>
                        ) : (
                          <span>
                            {event.location.name}
                            {event.location.address && ` (${event.location.address})`}
                          </span>
                        )}
                      </div>
                      {event.goals && event.goals.length > 0 && (
                        <p className="text-sm text-slate-300 mt-1">
                          {event.goals.join(', ')}
                        </p>
                      )}
                      {event.lumaEventUrl && (
                        <a
                          href={event.lumaEventUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-400 hover:text-blue-300 mt-1 inline-block"
                        >
                          View Event →
                        </a>
                      )}
                    </div>
                    {!readOnly && (
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => {
                            setAddingContactFor({ event, dayDate: day.date });
                          }}
                          className="text-green-400 hover:text-green-300 p-1.5"
                          title="Add contact from this event"
                          aria-label="Add contact from this event"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setEditingEvent({ event, dayDate: day.date });
                          }}
                          className="text-blue-400 hover:text-blue-300 p-1.5"
                          title="Edit event"
                          aria-label="Edit event"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteEvent(event)}
                          className="text-red-400 hover:text-red-300 p-1.5"
                          title="Delete event"
                          aria-label="Delete event"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                </div>
                ));
              })()}
                </div>
              )}
            </>
          )}
        </div>
        );
      })}

      {!readOnly && (
        <div className="bg-slate-800 shadow rounded-lg p-6 mt-6">
          <button
            onClick={() => setContactsExpanded(!contactsExpanded)}
            className="w-full flex items-center justify-between mb-4 hover:bg-slate-700 p-2 rounded-lg transition-colors"
          >
            <div>
              <h3 className="text-lg font-semibold text-white text-left">Contacts from this Trip</h3>
              <p className="text-sm text-slate-400 mt-1 text-left">
                People you've connected with during this trip
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-slate-400 transition-transform duration-200 flex-shrink-0 ml-4 ${
                contactsExpanded ? 'transform rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {contactsExpanded && <ContactsList itineraryId={itinerary.id} />}
        </div>
      )}

      {showEventForm && selectedDay && (
        <EventForm
          day={selectedDay}
          onClose={() => {
            setShowEventForm(false);
            setSelectedDay(null);
          }}
        />
      )}

      {editingEvent && (
        <EditEventDialog
          event={editingEvent.event}
          dayDate={editingEvent.dayDate}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {addingContactFor && (
        <ContactForm
          itineraryId={itinerary.id}
          eventId={addingContactFor.event.id}
          eventTitle={addingContactFor.event.title}
          lumaEventUrl={addingContactFor.event.lumaEventUrl}
          dateMet={addingContactFor.dayDate}
          onClose={() => setAddingContactFor(null)}
        />
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
