import { useState } from 'react';
import { useItinerary } from '../hooks/useItinerary';
import EventForm from './EventForm';
import type { Itinerary, ItineraryDay } from '../models/types';

interface ItineraryTimelineProps {
  sharedItinerary?: Itinerary;
  readOnly?: boolean;
}

export default function ItineraryTimeline({ sharedItinerary, readOnly = false }: ItineraryTimelineProps = {}) {
  const { currentItinerary, deleteEvent, clearItinerary } = useItinerary();
  const [selectedDay, setSelectedDay] = useState<ItineraryDay | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);

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

  return (
    <div>
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{itinerary.title}</h2>
            <p className="text-gray-600 mt-1">{itinerary.location}</p>
            <p className="text-sm text-gray-500 mt-1">
              {formatDate(itinerary.startDate)} - {formatDate(itinerary.endDate)}
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to start over?')) {
                  clearItinerary();
                }
              }}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Clear Itinerary
            </button>
          )}
        </div>
      </div>

      {itinerary.days.map((day) => (
        <div key={day.date} className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">
                Day {day.dayNumber}: {formatDate(day.date)}
              </h3>
              {day.goals.length > 0 && (
                <p className="text-sm text-gray-600 mt-1">Goals: {day.goals.join(', ')}</p>
              )}
            </div>
            {!readOnly && (
              <button
                onClick={() => {
                  setSelectedDay(day);
                  setShowEventForm(true);
                }}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Event
              </button>
            )}
          </div>

          {day.events.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No events scheduled for this day</p>
          ) : (
            <div className="space-y-4">
              {day.events.map((event) => (
                <div key={event.id} className="border-l-4 border-blue-500 pl-4 py-2">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{event.title}</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                          {event.eventType}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {formatTime(event.startTime)} - {formatTime(event.endTime)}
                      </p>
                      <div className="text-sm text-gray-700 mt-1">
                        {event.location.mapsUrl ? (
                          <a
                            href={event.location.mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-blue-600 hover:text-blue-800 hover:underline"
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
                            📍 {event.location.name}
                            {event.location.address && ` (${event.location.address})`}
                          </span>
                        )}
                      </div>
                      {event.goals && event.goals.length > 0 && (
                        <p className="text-sm text-gray-600 mt-1">
                          🎯 {event.goals.join(', ')}
                        </p>
                      )}
                      {event.lumaEventUrl && (
                        <a
                          href={event.lumaEventUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-800 mt-1 inline-block"
                        >
                          View Event →
                        </a>
                      )}
                    </div>
                    {!readOnly && (
                      <button
                        onClick={() => {
                          if (confirm('Delete this event?')) {
                            deleteEvent(event.id);
                          }
                        }}
                        className="ml-4 text-red-600 hover:text-red-800 p-2"
                        title="Delete event"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {showEventForm && selectedDay && (
        <EventForm
          day={selectedDay}
          onClose={() => {
            setShowEventForm(false);
            setSelectedDay(null);
          }}
        />
      )}
    </div>
  );
}
