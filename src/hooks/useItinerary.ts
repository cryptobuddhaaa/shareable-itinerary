import { create } from 'zustand';
import type { Itinerary, ItineraryDay, ItineraryEvent } from '../models/types';
import { supabase } from '../lib/supabase';
import { toast } from '../components/Toast';

interface ItineraryState {
  itineraries: Itinerary[];
  currentItineraryId: string | null;
  loading: boolean;
  initialized: boolean;
  userCount: number | null;

  // Computed
  currentItinerary: () => Itinerary | null;

  // Actions
  initialize: (userId: string) => Promise<void>;
  checkUserLimit: () => Promise<{ allowed: boolean; currentCount: number }>;
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
  cloneItinerary: (source: Itinerary) => Promise<string>;
  clearItinerary: () => Promise<void>;
  reset: () => void;
}

const generateId = () => crypto.randomUUID().replace(/-/g, '').substring(0, 9);

function syncToSupabase(currentId: string, updated: Itinerary) {
  supabase
    .from('itineraries')
    .update({
      data: { days: updated.days, transitSegments: updated.transitSegments },
    })
    .eq('id', currentId)
    .then(({ error }) => {
      if (error) {
        console.error('Error syncing to database:', error);
        toast.error('Failed to save changes. Please refresh and try again.');
      }
    });
}

export const useItinerary = create<ItineraryState>()((set, get) => ({
  itineraries: [],
  currentItineraryId: null,
  loading: false,
  initialized: false,
  userCount: null,

  currentItinerary: () => {
    const state = get();
    return state.itineraries.find((it) => it.id === state.currentItineraryId) || null;
  },

  checkUserLimit: async () => {
    try {
      const { data, error } = await supabase.rpc('get_user_count');

      if (error) {
        console.error('Error checking user limit:', error);
        return { allowed: false, currentCount: 0 }; // Fail closed for safety
      }

      const currentCount = data || 0;
      set({ userCount: currentCount });

      return {
        allowed: currentCount < 100,
        currentCount,
      };
    } catch (error) {
      console.error('Error checking user limit:', error);
      return { allowed: false, currentCount: 0 }; // Fail closed for safety
    }
  },

  initialize: async (userId: string) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('itineraries')
        .select('id, title, description, start_date, end_date, location, data, created_by_name, created_by_email, created_at, updated_at')
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
        createdByName: row.created_by_name || 'Unknown',
        createdByEmail: row.created_by_email,
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
    // Check itinerary limit (max 10 per user)
    const currentItineraries = get().itineraries;
    if (currentItineraries.length >= 10) {
      throw new Error('LIMIT_REACHED:You have reached the maximum limit of 10 itineraries. Please delete an existing itinerary before creating a new one.');
    }

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
        created_by_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
        created_by_email: user.email,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating itinerary:', error);
      // Check for user limit error from database trigger
      if (error.message && error.message.includes('USER_LIMIT_REACHED:')) {
        const message = error.message.split('USER_LIMIT_REACHED:')[1] || 'User limit reached';
        throw new Error('USER_LIMIT_REACHED:' + message);
      }
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
      createdByName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
      createdByEmail: user.email,
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

    // If updating dates, validate that existing events fall within new date range
    if ((updates.startDate || updates.endDate) && currentItinerary) {
      const newStartDate = updates.startDate || currentItinerary.startDate;
      const newEndDate = updates.endDate || currentItinerary.endDate;

      // Find all events across all days
      const allEvents: { date: string; title: string }[] = [];
      currentItinerary.days.forEach((day) => {
        day.events.forEach((event) => {
          allEvents.push({ date: day.date, title: event.title });
        });
      });

      // Check if any events fall outside the new date range
      const eventsOutsideRange = allEvents.filter((event) => {
        const eventDate = new Date(event.date);
        const startDate = new Date(newStartDate);
        const endDate = new Date(newEndDate);
        return eventDate < startDate || eventDate > endDate;
      });

      if (eventsOutsideRange.length > 0) {
        const eventsList = eventsOutsideRange
          .map((e) => `- ${e.title} (${new Date(e.date).toLocaleDateString()})`)
          .join('\n');

        throw new Error(
          `DATE_CONFLICT:Cannot change date range. You have ${eventsOutsideRange.length} event(s) outside the new date range:\n\n${eventsList}\n\nPlease edit or delete these events first before changing the itinerary dates.`
        );
      }

      // Regenerate days array for the new date range
      const days: ItineraryDay[] = [];
      const start = new Date(newStartDate);
      const end = new Date(newEndDate);
      let dayNumber = 1;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        // Find existing day data if it exists
        const existingDay = currentItinerary.days.find((day) => day.date === dateStr);

        days.push({
          date: dateStr,
          dayNumber,
          events: existingDay?.events || [],
          checklist: existingDay?.checklist || [],
          goals: existingDay?.goals || [],
        });
        dayNumber++;
      }

      updates.days = days;
    }

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

      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) syncToSupabase(currentId, updated);

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

      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) syncToSupabase(currentId, updated);

      return { itineraries: updatedItineraries };
    });
  },

  addEvent: async (date, event) => {
    const state = get();
    const currentId = state.currentItineraryId;
    if (!currentId) return;

    // Check event limit (max 20 events per itinerary)
    const currentItinerary = state.itineraries.find((it) => it.id === currentId);
    if (currentItinerary) {
      const totalEvents = currentItinerary.days.reduce((sum, day) => sum + day.events.length, 0);
      if (totalEvents >= 20) {
        throw new Error('LIMIT_REACHED:You have reached the maximum limit of 20 events for this itinerary. Please delete an existing event before adding a new one.');
      }
    }

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

      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) syncToSupabase(currentId, updated);

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

      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) syncToSupabase(currentId, updated);

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

      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) syncToSupabase(currentId, updated);

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

      const updated = updatedItineraries.find((it) => it.id === currentId);
      if (updated) syncToSupabase(currentId, updated);

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

  cloneItinerary: async (source: Itinerary) => {
    // Check itinerary limit
    const currentItineraries = get().itineraries;
    if (currentItineraries.length >= 10) {
      throw new Error('LIMIT_REACHED:You have reached the maximum limit of 10 itineraries. Please delete an existing itinerary before adding a new one.');
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Re-generate event IDs so the clone is fully independent
    const days = source.days.map((day) => ({
      ...day,
      events: day.events.map((event) => ({
        ...event,
        id: generateId(),
      })),
      checklist: (day.checklist || []).map((item) => ({
        ...item,
        id: generateId(),
      })),
    }));

    const { data, error } = await supabase
      .from('itineraries')
      .insert({
        user_id: user.id,
        title: source.title,
        start_date: source.startDate,
        end_date: source.endDate,
        location: source.location,
        description: source.description,
        data: { days, transitSegments: source.transitSegments || [] },
        created_by_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
        created_by_email: user.email,
      })
      .select()
      .single();

    if (error) {
      console.error('Error cloning itinerary:', error);
      if (error.message && error.message.includes('USER_LIMIT_REACHED:')) {
        const message = error.message.split('USER_LIMIT_REACHED:')[1] || 'User limit reached';
        throw new Error('USER_LIMIT_REACHED:' + message);
      }
      throw error;
    }

    const newItinerary: Itinerary = {
      id: data.id,
      title: source.title,
      description: source.description,
      startDate: source.startDate,
      endDate: source.endDate,
      location: source.location,
      days,
      transitSegments: source.transitSegments || [],
      createdByName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
      createdByEmail: user.email,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };

    set((state) => ({
      itineraries: [newItinerary, ...state.itineraries],
      currentItineraryId: data.id,
    }));

    return data.id;
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
