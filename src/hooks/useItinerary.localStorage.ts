import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Itinerary, ItineraryDay, ItineraryEvent } from '../models/types';

interface ItineraryState {
  itineraries: Itinerary[];
  currentItineraryId: string | null;

  // Computed
  currentItinerary: () => Itinerary | null;

  // Actions
  createItinerary: (title: string, startDate: string, endDate: string, location: string) => void;
  selectItinerary: (id: string) => void;
  deleteItinerary: (id: string) => void;
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

const generateId = () => Math.random().toString(36).substring(2, 11);

export const useItinerary = create<ItineraryState>()(
  persist(
    (set, get) => ({
      itineraries: [],
      currentItineraryId: null,

      currentItinerary: () => {
        const state = get();
        return state.itineraries.find((it) => it.id === state.currentItineraryId) || null;
      },

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

        set((state) => ({
          itineraries: [...state.itineraries, newItinerary],
          currentItineraryId: id,
        }));
      },

      selectItinerary: (id) => {
        set({ currentItineraryId: id });
      },

      deleteItinerary: (id) => {
        set((state) => {
          const newItineraries = state.itineraries.filter((it) => it.id !== id);
          const newCurrentId =
            state.currentItineraryId === id
              ? newItineraries[0]?.id || null
              : state.currentItineraryId;

          return {
            itineraries: newItineraries,
            currentItineraryId: newCurrentId,
          };
        });
      },

      updateItinerary: (updates) => {
        set((state) => {
          const currentId = state.currentItineraryId;
          if (!currentId) return state;

          return {
            itineraries: state.itineraries.map((it) =>
              it.id === currentId
                ? { ...it, ...updates, updatedAt: new Date().toISOString() }
                : it
            ),
          };
        });
      },

      addDay: (day) => {
        set((state) => {
          const currentId = state.currentItineraryId;
          if (!currentId) return state;

          return {
            itineraries: state.itineraries.map((it) =>
              it.id === currentId
                ? {
                    ...it,
                    days: [...it.days, day].sort(
                      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : it
            ),
          };
        });
      },

      updateDay: (date, updates) => {
        set((state) => {
          const currentId = state.currentItineraryId;
          if (!currentId) return state;

          return {
            itineraries: state.itineraries.map((it) =>
              it.id === currentId
                ? {
                    ...it,
                    days: it.days.map((day) => (day.date === date ? { ...day, ...updates } : day)),
                    updatedAt: new Date().toISOString(),
                  }
                : it
            ),
          };
        });
      },

      addEvent: (date, event) => {
        set((state) => {
          const currentId = state.currentItineraryId;
          if (!currentId) return state;

          return {
            itineraries: state.itineraries.map((it) =>
              it.id === currentId
                ? {
                    ...it,
                    days: it.days.map((day) =>
                      day.date === date
                        ? {
                            ...day,
                            events: [...day.events, event].sort(
                              (a, b) =>
                                new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
                            ),
                          }
                        : day
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : it
            ),
          };
        });
      },

      updateEvent: (eventId, updates) => {
        set((state) => {
          const currentId = state.currentItineraryId;
          if (!currentId) return state;

          return {
            itineraries: state.itineraries.map((it) =>
              it.id === currentId
                ? {
                    ...it,
                    days: it.days.map((day) => ({
                      ...day,
                      events: day.events.map((event) =>
                        event.id === eventId ? { ...event, ...updates } : event
                      ),
                    })),
                    updatedAt: new Date().toISOString(),
                  }
                : it
            ),
          };
        });
      },

      deleteEvent: (eventId) => {
        set((state) => {
          const currentId = state.currentItineraryId;
          if (!currentId) return state;

          return {
            itineraries: state.itineraries.map((it) =>
              it.id === currentId
                ? {
                    ...it,
                    days: it.days.map((day) => ({
                      ...day,
                      events: day.events.filter((event) => event.id !== eventId),
                    })),
                    updatedAt: new Date().toISOString(),
                  }
                : it
            ),
          };
        });
      },

      toggleChecklistItem: (itemId) => {
        set((state) => {
          const currentId = state.currentItineraryId;
          if (!currentId) return state;

          return {
            itineraries: state.itineraries.map((it) =>
              it.id === currentId
                ? {
                    ...it,
                    days: it.days.map((day) => ({
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
                  }
                : it
            ),
          };
        });
      },

      loadItinerary: (itinerary) => {
        set((state) => {
          // Check if itinerary already exists
          const exists = state.itineraries.some((it) => it.id === itinerary.id);

          if (exists) {
            // Update existing
            return {
              itineraries: state.itineraries.map((it) =>
                it.id === itinerary.id ? itinerary : it
              ),
              currentItineraryId: itinerary.id,
            };
          } else {
            // Add new
            return {
              itineraries: [...state.itineraries, itinerary],
              currentItineraryId: itinerary.id,
            };
          }
        });
      },

      clearItinerary: () => {
        set((state) => {
          const currentId = state.currentItineraryId;
          if (!currentId) return state;

          return {
            itineraries: state.itineraries.filter((it) => it.id !== currentId),
            currentItineraryId: state.itineraries.find((it) => it.id !== currentId)?.id || null,
          };
        });
      },
    }),
    {
      name: 'itinerary-storage',
    }
  )
);

export const generateEventId = generateId;
