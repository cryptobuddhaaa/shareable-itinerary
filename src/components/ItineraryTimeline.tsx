import { useState } from 'react';
import { useItinerary, generateEventId } from '../hooks/useItinerary';
import { useContacts } from '../hooks/useContacts';
import { useAuth } from '../hooks/useAuth';
import EventForm from './EventForm';
import EditEventDialog from './EditEventDialog';
import ContactForm from './ContactForm';
import ContactsList from './ContactsList';
import { AIAssistantModal } from './AIAssistant/AIAssistantModal';
import GoogleCalendarImport from './GoogleCalendarImport';
import type { Itinerary, ItineraryDay, ItineraryEvent } from '../models/types';
import { toast } from './Toast';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

interface ItineraryTimelineProps {
  sharedItinerary?: Itinerary;
  readOnly?: boolean;
}

export default function ItineraryTimeline({ sharedItinerary, readOnly = false }: ItineraryTimelineProps = {}) {
  const { currentItinerary, deleteEvent, clearItinerary, addEvent } = useItinerary();
  const { getContactsByEvent, deleteContactsByEvent, getContactsByItinerary } = useContacts();
  const { user } = useAuth();
  const [selectedDay, setSelectedDay] = useState<ItineraryDay | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<{ event: ItineraryEvent; dayDate: string } | null>(null);
  const [addingContactFor, setAddingContactFor] = useState<{ event: ItineraryEvent; dayDate: string } | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [contactsExpanded, setContactsExpanded] = useState(true);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const { confirm, dialogProps } = useConfirmDialog();

  const itinerary = sharedItinerary || currentItinerary();
  if (!itinerary) return null;

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

  const handleAIEventCreate = async (event: Partial<ItineraryEvent>) => {
    try {
      if (!event.startTime || !event.endTime) {
        toast.error('Event is missing required time information. Please try again.');
        return;
      }

      const startDate = new Date(event.startTime);
      if (isNaN(startDate.getTime())) {
        toast.error('Event has an invalid date/time. Please try again.');
        return;
      }

      const eventDate = startDate.toISOString().split('T')[0];
      const day = itinerary.days.find((d) => d.date === eventDate);

      if (!day) {
        toast.error(`Could not find the day ${eventDate} in your itinerary. Please try adding it manually.`);
        return;
      }

      // Ensure the event has an id and notes array
      const fullEvent: ItineraryEvent = {
        id: generateEventId(),
        title: event.title || 'Untitled Event',
        startTime: event.startTime,
        endTime: event.endTime,
        eventType: event.eventType || 'activity',
        location: event.location || { name: '', address: '' },
        description: event.description,
        notes: event.notes || [],
        ...event,
      };

      await addEvent(day.date, fullEvent);
    } catch (error) {
      console.error('Error creating AI event:', error);
      toast.error('Failed to create event. Please try again.');
    }
  };

  return (
    <div>
      <div className="bg-slate-800 shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-white">{itinerary.title}</h2>
            <p className="text-slate-300 mt-1">{itinerary.location}</p>
            <p className="text-sm text-slate-400 mt-1">
              {formatDate(itinerary.startDate)} - {formatDate(itinerary.endDate)}
            </p>
            {itinerary.goals && (
              <p className="text-sm text-slate-300 mt-2">{itinerary.goals}</p>
            )}
          </div>
          {!readOnly && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setShowAIAssistant(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-purple-500"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Assistant
              </button>
              <GoogleCalendarImport
                itinerary={itinerary}
                onEventsImport={handleGoogleCalendarImport}
              />
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
                className="text-sm text-red-400 hover:text-red-300 px-4 py-2"
              >
                Clear Itinerary
              </button>
            </div>
          )}
        </div>
      </div>

      {itinerary.days.map((day) => {
        const isExpanded = expandedDays.has(day.date);
        return (
          <div key={day.date} className="bg-slate-800 shadow rounded-lg p-6 mb-6">
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
                  <h3 className="text-xl font-semibold text-white">
                    Day {day.dayNumber}: {formatDate(day.date)}
                  </h3>
                  {day.goals.length > 0 && (
                    <p className="text-sm text-slate-300 mt-1">Goals: {day.goals.join(', ')}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    {day.events.length} event{day.events.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </button>
            {!readOnly && (
              <button
                onClick={() => {
                  setSelectedDay(day);
                  setShowEventForm(true);
                }}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-blue-300 bg-blue-900/40 hover:bg-blue-900/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-blue-500"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Event
              </button>
            )}
          </div>

          {isExpanded && (
            <>
              {day.events.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No events scheduled for this day</p>
              ) : (
                <div className="space-y-4">
              {[...day.events]
                .sort((a, b) => {
                  // Sort events by start time
                  return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
                })
                .map((event) => (
                <div key={event.id} className="border-l-4 border-blue-500 pl-4 py-2">
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
                          className="text-green-400 hover:text-green-300 p-2"
                          title="Add contact from this event"
                          aria-label="Add contact from this event"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setEditingEvent({ event, dayDate: day.date });
                          }}
                          className="text-blue-400 hover:text-blue-300 p-2"
                          title="Edit event"
                          aria-label="Edit event"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteEvent(event)}
                          className="text-red-400 hover:text-red-300 p-2"
                          title="Delete event"
                          aria-label="Delete event"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                ))}
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
              <h3 className="text-xl font-semibold text-white text-left">Contacts from this Trip</h3>
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

      {showAIAssistant && user && (
        <AIAssistantModal
          isOpen={showAIAssistant}
          onClose={() => setShowAIAssistant(false)}
          itinerary={itinerary}
          currentDate={new Date().toISOString().split('T')[0]} // Pass today's date
          existingEvents={itinerary.days.flatMap((day) => day.events)}
          contacts={getContactsByItinerary(itinerary.id)}
          onEventCreate={handleAIEventCreate}
          onEventDelete={async (eventId: string) => {
            const eventContacts = getContactsByEvent(eventId);
            // Delete associated contacts first
            if (eventContacts.length > 0) {
              await deleteContactsByEvent(eventId);
            }
            // Then delete the event
            await deleteEvent(eventId);
          }}
          user={user}
        />
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
