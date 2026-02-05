import { create } from 'zustand';
import type { Itinerary, ItineraryDay, ItineraryEvent } from '../models/types';
import { supabase } from '../lib/supabase';

interface ItineraryState {
  itineraries: Itinerary[];
  currentItineraryId: string | null;
  loading: boolean;
  initialized: boolean;

  // Computed
  currentItinerary: () => Itinerary | null;

  // Actions
  initialize: (userId: string) => Promise<void>;
  createItinerary: (title: string, startDate: string, endDate: string, location: string) => Promise<void>;
  selectItinerary: (id: string) => void;
  deleteItinerary: (id: string) => Promise<void>;
  updateItinerary: (updates: Partial<Itinerary>) => Promise<void>;
  addDay: (day: ItineraryDay) => void;
  updateDay: (date: string, updates: Partial<ItineraryDay>) => void;
  addEvent: (date: string, event: ItineraryEvent) => Promise<void>;
  updateEvent: (eventId: string, updates: Partial<ItineraryEvent>) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  toggleChecklistItem: (itemId: string) => void;
  loadItinerary: (itinerary: Itinerary) => void;
  clearItinerary: () => Promise<void>;
  reset: () => void;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

export const useItinerary = create<ItineraryState>()((set, get) => ({
  itineraries: [],
  currentItineraryId: null,
  loading: false,
  initialized: false,

  currentItinerary: () => {
    const state = get();
    return state.itineraries.find((it) => it.id === state.currentItineraryId) || null;
  },

  initialize: async (userId: string) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('itineraries')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const itineraries: Itinerary[] = (data || []).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description || undefined,
        startDate: row.start_date,
        endDate: row.end_date,
        location: row.location,
        ...row.data,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      set({
        itineraries,
        currentItineraryId: itineraries[0]?.id || null,
        initialized: true,
      });
    } catch (error) {
      console.error('Error loading itineraries:', error);
    } finally {
      set({ loading: false });
    }
  },

  createItinerary: async (title, startDate, endDate, location) => {
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

    // Save to Supabase (let it generate the UUID)
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('itineraries')
      .insert({
        user_id: user.id,
        title,
        start_date: startDate,
        end_date: endDate,
        location,
        data: { days, transitSegments: [] },
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating itinerary:', error);
      throw error;
    }

    const newItinerary: Itinerary = {
      id: data.id,
      title,
      startDate,
      endDate,
      location,
      days,
      transitSegments: [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };

    set((state) => ({
      itineraries: [newItinerary, ...state.itineraries],
      currentItineraryId: data.id,
    }));
  },

  selectItinerary: (id) => {
    set({ currentItineraryId: id });
  },

  deleteItinerary: async (id) => {
    const { error } = await supabase.from('itineraries').delete().eq('id', id);

    if (error) {
      console.error('Error deleting itinerary:', error);
      throw error;
    }

    set((state) => {
      const newItineraries = state.itineraries.filter((it) => it.id !== id);
      const newCurrentId =
        state.currentItineraryId === id ? newItineraries[0]?.id || null : state.currentItineraryId;

      return {
        itineraries: newItineraries,
        currentItineraryId: newCurrentId,
      };
    });
  },

  updateItinerary: async (updates) => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    const currentItinerary = state.itineraries.find((it) => it.id === currentId);
    if (!currentItinerary) return;

    const updatedItinerary = {
      ...currentItinerary,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Update in Supabase
    const { error } = await supabase
      .from('itineraries')
      .update({
        title: updatedItinerary.title,
        start_date: updatedItinerary.startDate,
        end_date: updatedItinerary.endDate,
        location: updatedItinerary.location,
        description: updatedItinerary.description,
        data: {
          days: updatedItinerary.days,
          transitSegments: updatedItinerary.transitSegments,
          metrics: updatedItinerary.metrics,
        },
      })
      .eq('id', currentId);

    if (error) {
      console.error('Error updating itinerary:', error);
      throw error;
    }

    set((state) => ({
      itineraries: state.itineraries.map((it) => (it.id === currentId ? updatedItinerary : it)),
    }));
  },

  addDay: (day) => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    set((state) => {
      const updatedItineraries = state.itineraries.map((it) =>
        it.id === currentId
          ? {
              ...it,
              days: [...it.days, day].sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
              ),
              updatedAt: new Date().toISOString(),
            }
          : it
      );

      // Sync with Supabase asynchronously
      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) {
        supabase
          .from('itineraries')
          .update({
            data: { days: updated.days, transitSegments: updated.transitSegments },
          })
          .eq('id', currentId)
          .then(({ error }) => {
            if (error) console.error('Error syncing day:', error);
          });
      }

      return { itineraries: updatedItineraries };
    });
  },

  updateDay: (date, updates) => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    set((state) => {
      const updatedItineraries = state.itineraries.map((it) =>
        it.id === currentId
          ? {
              ...it,
              days: it.days.map((day) => (day.date === date ? { ...day, ...updates } : day)),
              updatedAt: new Date().toISOString(),
            }
          : it
      );

      // Sync with Supabase asynchronously
      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) {
        supabase
          .from('itineraries')
          .update({
            data: { days: updated.days, transitSegments: updated.transitSegments },
          })
          .eq('id', currentId)
          .then(({ error }) => {
            if (error) console.error('Error syncing day update:', error);
          });
      }

      return { itineraries: updatedItineraries };
    });
  },

  addEvent: async (date, event) => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    set((state) => {
      const updatedItineraries = state.itineraries.map((it) =>
        it.id === currentId
          ? {
              ...it,
              days: it.days.map((day) =>
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
            }
          : it
      );

      // Sync with Supabase
      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) {
        supabase
          .from('itineraries')
          .update({
            data: { days: updated.days, transitSegments: updated.transitSegments },
          })
          .eq('id', currentId)
          .then(({ error }) => {
            if (error) console.error('Error syncing event:', error);
          });
      }

      return { itineraries: updatedItineraries };
    });
  },

  updateEvent: async (eventId, updates) => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    set((state) => {
      const updatedItineraries = state.itineraries.map((it) =>
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
      );

      // Sync with Supabase
      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) {
        supabase
          .from('itineraries')
          .update({
            data: { days: updated.days, transitSegments: updated.transitSegments },
          })
          .eq('id', currentId)
          .then(({ error }) => {
            if (error) console.error('Error syncing event update:', error);
          });
      }

      return { itineraries: updatedItineraries };
    });
  },

  deleteEvent: async (eventId) => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    set((state) => {
      const updatedItineraries = state.itineraries.map((it) =>
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
      );

      // Sync with Supabase
      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) {
        supabase
          .from('itineraries')
          .update({
            data: { days: updated.days, transitSegments: updated.transitSegments },
          })
          .eq('id', currentId)
          .then(({ error }) => {
            if (error) console.error('Error syncing event deletion:', error);
          });
      }

      return { itineraries: updatedItineraries };
    });
  },

  toggleChecklistItem: (itemId) => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    set((state) => {
      const updatedItineraries = state.itineraries.map((it) =>
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
      );

      // Sync with Supabase
      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) {
        supabase
          .from('itineraries')
          .update({
            data: { days: updated.days, transitSegments: updated.transitSegments },
          })
          .eq('id', currentId)
          .then(({ error }) => {
            if (error) console.error('Error syncing checklist toggle:', error);
          });
      }

      return { itineraries: updatedItineraries };
    });
  },

  loadItinerary: (itinerary) => {
    set((state) => {
      // Check if itinerary already exists
      const exists = state.itineraries.some((it) => it.id === itinerary.id);

      if (exists) {
        // Update existing
        return {
          itineraries: state.itineraries.map((it) => (it.id === itinerary.id ? itinerary : it)),
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

  clearItinerary: async () => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    await get().deleteItinerary(currentId);
  },

  reset: () => {
    set({
      itineraries: [],
      currentItineraryId: null,
      loading: false,
      initialized: false,
    });
  },
}));

export const generateEventId = generateId;
