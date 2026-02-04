import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Itinerary, ItineraryDay, ItineraryEvent } from '../models/types';

interface ItineraryState {
  itinerary: Itinerary | null;

  // Actions
  createItinerary: (title: string, startDate: string, endDate: string, location: string) => void;
  updateItinerary: (updates: Partial<Itinerary>) => void;
  addDay: (day: ItineraryDay) => void;
  updateDay: (date: string, updates: Partial<ItineraryDay>) => void;
  addEvent: (date: string, event: ItineraryEvent) => void;
  updateEvent: (eventId: string, updates: Partial<ItineraryEvent>) => void;
  deleteEvent: (eventId: string) => void;
  toggleChecklistItem: (itemId: string) => void;
  loadItinerary: (itinerary: Itinerary) => void;
  clearItinerary: () => void;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

export const useItinerary = create<ItineraryState>()(
  persist(
    (set) => ({
      itinerary: null,

      createItinerary: (title, startDate, endDate, location) => {
        const id = generateId();
        const now = new Date().toISOString();

        // Generate days between start and end date
        const days: ItineraryDay[] = [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        let dayNumber = 1;

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          days.push({
            date: d.toISOString().split('T')[0],
            dayNumber,
            events: [],
            checklist: [],
            goals: [],
          });
          dayNumber++;
        }

        const newItinerary: Itinerary = {
          id,
          title,
          startDate,
          endDate,
          location,
          days,
          transitSegments: [],
          createdAt: now,
          updatedAt: now,
        };

        set({ itinerary: newItinerary });
      },

      updateItinerary: (updates) => {
        set((state) => {
          if (!state.itinerary) return state;
          return {
            itinerary: {
              ...state.itinerary,
              ...updates,
              updatedAt: new Date().toISOString(),
            },
          };
        });
      },

      addDay: (day) => {
        set((state) => {
          if (!state.itinerary) return state;
          return {
            itinerary: {
              ...state.itinerary,
              days: [...state.itinerary.days, day].sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
              ),
              updatedAt: new Date().toISOString(),
            },
          };
        });
      },

      updateDay: (date, updates) => {
        set((state) => {
          if (!state.itinerary) return state;
          return {
            itinerary: {
              ...state.itinerary,
              days: state.itinerary.days.map((day) =>
                day.date === date ? { ...day, ...updates } : day
              ),
              updatedAt: new Date().toISOString(),
            },
          };
        });
      },

      addEvent: (date, event) => {
        set((state) => {
          if (!state.itinerary) return state;
          return {
            itinerary: {
              ...state.itinerary,
              days: state.itinerary.days.map((day) =>
                day.date === date
                  ? {
                      ...day,
                      events: [...day.events, event].sort(
                        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
                      ),
                    }
                  : day
              ),
              updatedAt: new Date().toISOString(),
            },
          };
        });
      },

      updateEvent: (eventId, updates) => {
        set((state) => {
          if (!state.itinerary) return state;
          return {
            itinerary: {
              ...state.itinerary,
              days: state.itinerary.days.map((day) => ({
                ...day,
                events: day.events.map((event) =>
                  event.id === eventId ? { ...event, ...updates } : event
                ),
              })),
              updatedAt: new Date().toISOString(),
            },
          };
        });
      },

      deleteEvent: (eventId) => {
        set((state) => {
          if (!state.itinerary) return state;
          return {
            itinerary: {
              ...state.itinerary,
              days: state.itinerary.days.map((day) => ({
                ...day,
                events: day.events.filter((event) => event.id !== eventId),
              })),
              updatedAt: new Date().toISOString(),
            },
          };
        });
      },

      toggleChecklistItem: (itemId) => {
        set((state) => {
          if (!state.itinerary) return state;
          return {
            itinerary: {
              ...state.itinerary,
              days: state.itinerary.days.map((day) => ({
                ...day,
                checklist: day.checklist.map((item) =>
                  item.id === itemId ? { ...item, completed: !item.completed } : item
                ),
                events: day.events.map((event) => ({
                  ...event,
                  checklist: event.checklist?.map((item) =>
                    item.id === itemId ? { ...item, completed: !item.completed } : item
                  ),
                })),
              })),
              updatedAt: new Date().toISOString(),
            },
          };
        });
      },

      loadItinerary: (itinerary) => {
        set({ itinerary });
      },

      clearItinerary: () => {
        set({ itinerary: null });
      },
    }),
    {
      name: 'itinerary-storage',
    }
  )
);

export const generateEventId = generateId;
