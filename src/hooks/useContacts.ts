import { create } from 'zustand';
import type { Contact, UserTag, ContactNote } from '../models/types';
import { supabase } from '../lib/supabase';

interface ContactsState {
  contacts: Contact[];
  tags: UserTag[];
  loading: boolean;
  initialized: boolean;

  // Computed
  getContactsByItinerary: (itineraryId: string) => Contact[];
  getContactsByEvent: (eventId: string) => Contact[];
  findDuplicates: (firstName: string, lastName: string, telegramHandle?: string, email?: string) => Contact[];

  // Contact actions
  initialize: (userId: string) => Promise<void>;
  addContact: (contactData: {
    itineraryId?: string;
    eventId?: string;
    eventTitle?: string;
    lumaEventUrl?: string;
    dateMet?: string;
    firstName: string;
    lastName: string;
    projectCompany?: string;
    position?: string;
    telegramHandle?: string;
    email?: string;
    linkedin?: string;
    notes?: string;
    tags?: string[];
  }) => Promise<void>;
  updateContact: (contactId: string, updates: Partial<Contact>) => Promise<void>;
  deleteContact: (contactId: string) => Promise<void>;
  deleteContactsByEvent: (eventId: string) => Promise<void>;
  reset: () => void;

  // Tag actions (max 10 per user)
  addTag: (name: string) => Promise<void>;
  deleteTag: (tagId: string) => Promise<void>;

  // Note actions (max 10 per contact)
  fetchNotes: (contactId: string) => Promise<ContactNote[]>;
  addNote: (contactId: string, content: string) => Promise<ContactNote>;
  deleteNote: (noteId: string) => Promise<void>;
}

/** Maps a Supabase row (snake_case) to the Contact interface (camelCase) */
function mapRowToContact(row: Record<string, unknown>): Contact {
  return {
    id: row.id as string,
    itineraryId: (row.itinerary_id as string) || undefined,
    eventId: (row.event_id as string) || undefined,
    userId: row.user_id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    projectCompany: row.project_company as string | undefined,
    position: row.position as string | undefined,
    telegramHandle: row.telegram_handle as string | undefined,
    email: row.email as string | undefined,
    linkedin: row.linkedin as string | undefined,
    notes: row.notes as string | undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    eventTitle: (row.event_title as string) || undefined,
    lumaEventUrl: row.luma_event_url as string | undefined,
    dateMet: (row.date_met as string) || undefined,
    lastContactedAt: (row.last_contacted_at as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const useContacts = create<ContactsState>()((set, get) => ({
  contacts: [],
  tags: [],
  loading: false,
  initialized: false,

  getContactsByItinerary: (itineraryId: string) => {
    const state = get();
    return state.contacts.filter((c) => c.itineraryId === itineraryId);
  },

  getContactsByEvent: (eventId: string) => {
    const state = get();
    return state.contacts.filter((c) => c.eventId === eventId);
  },

  findDuplicates: (firstName: string, lastName: string, telegramHandle?: string, email?: string) => {
    const state = get();
    const nameKey = `${firstName.trim().toLowerCase()} ${lastName.trim().toLowerCase()}`;
    const handleNorm = telegramHandle?.replace('@', '').toLowerCase();
    const emailNorm = email?.toLowerCase();

    return state.contacts.filter((c) => {
      const cNameKey = `${c.firstName.trim().toLowerCase()} ${c.lastName.trim().toLowerCase()}`;
      if (cNameKey === nameKey) return true;
      if (handleNorm && c.telegramHandle?.replace('@', '').toLowerCase() === handleNorm) return true;
      if (emailNorm && c.email?.toLowerCase() === emailNorm) return true;
      return false;
    });
  },

  initialize: async (userId: string) => {
    set({ loading: true });
    try {
      const [contactsRes, tagsRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, itinerary_id, event_id, user_id, first_name, last_name, project_company, position, telegram_handle, email, linkedin, notes, tags, event_title, luma_event_url, date_met, last_contacted_at, created_at, updated_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('user_tags')
          .select('id, user_id, name, created_at')
          .eq('user_id', userId)
          .order('name', { ascending: true }),
      ]);

      if (contactsRes.error) throw contactsRes.error;

      const contacts: Contact[] = (contactsRes.data || []).map(mapRowToContact);
      const tags: UserTag[] = (tagsRes.data || []).map((r) => ({
        id: r.id as string,
        userId: r.user_id as string,
        name: r.name as string,
        createdAt: r.created_at as string,
      }));

      set({
        contacts,
        tags,
        initialized: true,
      });
    } catch (error) {
      console.error('Error loading contacts:', error);
    } finally {
      set({ loading: false });
    }
  },

  addContact: async (contactData) => {
    set({ loading: true });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check contact limit
      const state = get();
      if (state.contacts.length >= 100) {
        throw new Error('LIMIT_REACHED:You have reached the maximum limit of 100 contacts. Please delete some contacts before adding new ones.');
      }

      const { data, error } = await supabase
        .from('contacts')
        .insert({
          itinerary_id: contactData.itineraryId || null,
          event_id: contactData.eventId || null,
          user_id: user.id,
          first_name: contactData.firstName,
          last_name: contactData.lastName,
          project_company: contactData.projectCompany,
          position: contactData.position,
          telegram_handle: contactData.telegramHandle,
          email: contactData.email,
          linkedin: contactData.linkedin,
          notes: contactData.notes,
          tags: contactData.tags || [],
          event_title: contactData.eventTitle || null,
          luma_event_url: contactData.lumaEventUrl,
          date_met: contactData.dateMet || null,
        })
        .select()
        .single();

      if (error) throw error;

      const newContact = mapRowToContact(data);

      set((state) => ({
        contacts: [newContact, ...state.contacts],
      }));
    } catch (error) {
      console.error('Error adding contact:', error);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  updateContact: async (contactId: string, updates: Partial<Contact>) => {
    set({ loading: true });
    try {
      const updateData: Record<string, unknown> = {};
      if (updates.firstName !== undefined) updateData.first_name = updates.firstName;
      if (updates.lastName !== undefined) updateData.last_name = updates.lastName;
      if (updates.projectCompany !== undefined) updateData.project_company = updates.projectCompany;
      if (updates.position !== undefined) updateData.position = updates.position;
      if (updates.telegramHandle !== undefined) updateData.telegram_handle = updates.telegramHandle;
      if (updates.email !== undefined) updateData.email = updates.email;
      if (updates.linkedin !== undefined) updateData.linkedin = updates.linkedin;
      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.itineraryId !== undefined) updateData.itinerary_id = updates.itineraryId || null;
      if (updates.eventId !== undefined) updateData.event_id = updates.eventId || null;
      if (updates.eventTitle !== undefined) updateData.event_title = updates.eventTitle || null;
      if (updates.dateMet !== undefined) updateData.date_met = updates.dateMet || null;
      if (updates.lumaEventUrl !== undefined) updateData.luma_event_url = updates.lumaEventUrl || null;
      if (updates.tags !== undefined) updateData.tags = updates.tags;
      if (updates.lastContactedAt !== undefined) updateData.last_contacted_at = updates.lastContactedAt || null;

      const { data, error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', contactId)
        .select()
        .single();

      if (error) throw error;

      const updatedContact = mapRowToContact(data);

      set((state) => ({
        contacts: state.contacts.map((c) =>
          c.id === contactId ? updatedContact : c
        ),
      }));
    } catch (error) {
      console.error('Error updating contact:', error);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deleteContact: async (contactId: string) => {
    set({ loading: true });
    try {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', contactId);

      if (error) throw error;

      set((state) => ({
        contacts: state.contacts.filter((c) => c.id !== contactId),
      }));
    } catch (error) {
      console.error('Error deleting contact:', error);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deleteContactsByEvent: async (eventId: string) => {
    set({ loading: true });
    try {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('event_id', eventId);

      if (error) throw error;

      set((state) => ({
        contacts: state.contacts.filter((c) => c.eventId !== eventId),
      }));
    } catch (error) {
      console.error('Error deleting contacts by event:', error);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  // --- Tag actions ---

  addTag: async (name: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const state = get();
      if (state.tags.length >= 10) {
        throw new Error('LIMIT_REACHED:Maximum of 10 tags. Delete a tag before adding more.');
      }

      const { data, error } = await supabase
        .from('user_tags')
        .insert({ user_id: user.id, name: name.trim() })
        .select()
        .single();

      if (error) throw error;

      const newTag: UserTag = {
        id: data.id,
        userId: data.user_id,
        name: data.name,
        createdAt: data.created_at,
      };

      set((state) => ({
        tags: [...state.tags, newTag].sort((a, b) => a.name.localeCompare(b.name)),
      }));
    } catch (error) {
      console.error('Error adding tag:', error);
      throw error;
    }
  },

  deleteTag: async (tagId: string) => {
    try {
      const state = get();
      const tag = state.tags.find((t) => t.id === tagId);
      if (!tag) return;

      const { error } = await supabase
        .from('user_tags')
        .delete()
        .eq('id', tagId);

      if (error) throw error;

      // Also remove this tag from all contacts that have it
      const contactsWithTag = state.contacts.filter((c) => c.tags?.includes(tag.name));
      for (const c of contactsWithTag) {
        const newTags = (c.tags || []).filter((t) => t !== tag.name);
        await supabase.from('contacts').update({ tags: newTags }).eq('id', c.id);
      }

      set((state) => ({
        tags: state.tags.filter((t) => t.id !== tagId),
        contacts: state.contacts.map((c) =>
          c.tags?.includes(tag.name)
            ? { ...c, tags: (c.tags || []).filter((t) => t !== tag.name) }
            : c
        ),
      }));
    } catch (error) {
      console.error('Error deleting tag:', error);
      throw error;
    }
  },

  // --- Note actions ---

  fetchNotes: async (contactId: string) => {
    const { data, error } = await supabase
      .from('contact_notes')
      .select('id, contact_id, user_id, content, created_at')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((r) => ({
      id: r.id as string,
      contactId: r.contact_id as string,
      userId: r.user_id as string,
      content: r.content as string,
      createdAt: r.created_at as string,
    }));
  },

  addNote: async (contactId: string, content: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({ contact_id: contactId, user_id: user.id, content: content.trim() })
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id as string,
      contactId: data.contact_id as string,
      userId: data.user_id as string,
      content: data.content as string,
      createdAt: data.created_at as string,
    };
  },

  deleteNote: async (noteId: string) => {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) throw error;
  },

  reset: () => {
    set({
      contacts: [],
      tags: [],
      loading: false,
      initialized: false,
    });
  },
}));
