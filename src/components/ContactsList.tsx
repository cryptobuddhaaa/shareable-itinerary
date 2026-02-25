import { useState, useEffect, useCallback } from 'react';
import { useContacts } from '../hooks/useContacts';
import EditContactDialog from './EditContactDialog';
import { extractLinkedInHandle } from '../lib/validation';
import type { Contact, ContactNote } from '../models/types';
import { supabase } from '../lib/supabase';
import { toast } from './Toast';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';
import { HandshakeButton } from './HandshakeButton';
import { useAuth } from '../hooks/useAuth';

function getTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  }
  const months = Math.floor(diffDays / 30);
  return `${months} month${months !== 1 ? 's' : ''} ago`;
}

interface ContactsListProps {
  itineraryId?: string; // If provided, filter contacts by itinerary
  contacts?: Contact[]; // If provided, use these contacts instead of fetching from hook
}

export default function ContactsList({ itineraryId, contacts: providedContacts }: ContactsListProps) {
  const { contacts, getContactsByItinerary, deleteContact, updateContact, addNote } = useContacts();
  const { user } = useAuth();
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  const displayContacts = providedContacts
    ? providedContacts
    : itineraryId
    ? getContactsByItinerary(itineraryId)
    : contacts;

  // Inline add-note state
  const [addingNoteFor, setAddingNoteFor] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [addingNoteLoading, setAddingNoteLoading] = useState(false);
  const [noteCountByContact, setNoteCountByContact] = useState<Map<string, number>>(new Map());

  // Batch-fetch last 3 timestamped notes for all displayed contacts
  const [notesByContact, setNotesByContact] = useState<Map<string, ContactNote[]>>(new Map());

  const fetchNotesForContacts = useCallback(async (contactIds: string[]) => {
    if (contactIds.length === 0) {
      setNotesByContact(new Map());
      return;
    }
    try {
      const { data } = await supabase
        .from('contact_notes')
        .select('id, contact_id, user_id, content, created_at')
        .in('contact_id', contactIds)
        .order('created_at', { ascending: false });

      const grouped = new Map<string, ContactNote[]>();
      if (data) {
        for (const row of data) {
          const cid = row.contact_id as string;
          const list = grouped.get(cid) || [];
          if (list.length < 3) {
            list.push({
              id: row.id as string,
              contactId: cid,
              userId: row.user_id as string,
              content: row.content as string,
              createdAt: row.created_at as string,
            });
            grouped.set(cid, list);
          }
        }
      }
      setNotesByContact(grouped);
    } catch {
      // Silently fail — notes are supplementary
    }
  }, []);

  useEffect(() => {
    const ids = displayContacts.map((c) => c.id);
    fetchNotesForContacts(ids);
  }, [displayContacts, fetchNotesForContacts]);

  const handleOpenAddNote = async (contactId: string) => {
    if (addingNoteFor === contactId) {
      setAddingNoteFor(null);
      setNewNoteText('');
      return;
    }
    setAddingNoteFor(contactId);
    setNewNoteText('');

    // Fetch total note count to enforce the 10-note limit
    try {
      const { count } = await supabase
        .from('contact_notes')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', contactId);
      setNoteCountByContact((prev) => new Map(prev).set(contactId, count ?? 0));
    } catch {
      // Fallback: allow the add, store will handle errors
    }
  };

  const handleAddNote = async (contactId: string) => {
    const text = newNoteText.trim();
    if (!text) return;
    const count = noteCountByContact.get(contactId) ?? 0;
    if (count >= 10) {
      toast.error('This contact already has 10 notes. Delete some in Edit to add more.');
      return;
    }

    setAddingNoteLoading(true);
    try {
      const note = await addNote(contactId, text);
      // Update the preview list (keep max 3, newest first)
      setNotesByContact((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(contactId) || [];
        updated.set(contactId, [note, ...existing].slice(0, 3));
        return updated;
      });
      setNoteCountByContact((prev) => new Map(prev).set(contactId, (prev.get(contactId) ?? 0) + 1));
      setAddingNoteFor(null);
      setNewNoteText('');
      toast.success('Note added');
    } catch {
      toast.error('Failed to add note');
    } finally {
      setAddingNoteLoading(false);
    }
  };

  const handleToggleContacted = async (contact: Contact) => {
    try {
      if (contact.lastContactedAt) {
        await updateContact(contact.id, { lastContactedAt: null });
        toast.info(`Cleared contacted status for ${contact.firstName}`);
      } else {
        await updateContact(contact.id, { lastContactedAt: new Date().toISOString() });
        toast.info(`Marked ${contact.firstName} as contacted`);
      }
    } catch {
      toast.error('Failed to update contact.');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleDelete = async (contact: Contact) => {
    const confirmed = await confirm({
      title: `Delete contact?`,
      message: `Are you sure you want to delete the contact for ${contact.firstName} ${contact.lastName}?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (confirmed) {
      try {
        await deleteContact(contact.id);
      } catch (error) {
        console.error('Error deleting contact:', error);
        toast.error('Failed to delete contact. Please try again.');
      }
    }
  };

  if (displayContacts.length === 0) {
    return (
      <div className="text-center py-12">
        <svg
          className="mx-auto h-12 w-12 text-slate-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-white">No contacts yet</h3>
        <p className="mt-1 text-sm text-slate-400">
          Add contacts from your trips and events to build and manage your network.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayContacts.map((contact) => (
          <div
            key={contact.id}
            className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-white">
                  {contact.firstName} {contact.lastName}
                </h3>
                {contact.projectCompany && (
                  <p className="text-sm text-slate-300 mt-1">{contact.projectCompany}</p>
                )}
                {contact.position && (
                  <p className="text-sm text-slate-400 mt-0.5">{contact.position}</p>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleToggleContacted(contact)}
                  className={`${contact.lastContactedAt ? 'text-green-400 hover:text-red-400' : 'text-slate-400 hover:text-green-400'} p-1.5`}
                  title={contact.lastContactedAt ? 'Clear contacted status' : 'Mark as contacted'}
                  aria-label={contact.lastContactedAt ? 'Clear contacted status' : 'Mark as contacted'}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => setEditingContact(contact)}
                  className="text-blue-400 hover:text-blue-300 p-1.5"
                  title="Edit contact"
                  aria-label="Edit contact"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(contact)}
                  className="text-red-400 hover:text-red-300 p-1.5"
                  title="Delete contact"
                  aria-label="Delete contact"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {contact.telegramHandle && (
                <div className="flex items-center text-slate-300">
                  <svg className="w-4 h-4 mr-2 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z" />
                  </svg>
                  <a
                    href={`https://t.me/${contact.telegramHandle.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline text-blue-400"
                  >
                    @{contact.telegramHandle.replace('@', '')}
                  </a>
                </div>
              )}

              {contact.email && (
                <div className="flex items-center text-slate-300">
                  <svg className="w-4 h-4 mr-2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  <a href={`mailto:${contact.email}`} className="hover:underline text-blue-400">
                    {contact.email}
                  </a>
                </div>
              )}

              {contact.linkedin && (
                <div className="flex items-center text-slate-300">
                  <svg className="w-4 h-4 mr-2 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  <a
                    href={`https://linkedin.com/in/${extractLinkedInHandle(contact.linkedin)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline text-blue-400"
                  >
                    {extractLinkedInHandle(contact.linkedin)}
                  </a>
                </div>
              )}

              {contact.tags && contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {contact.tags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 text-xs rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/50">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {contact.notes && (
                <div className="mt-2 text-sm text-slate-400 italic">
                  "{contact.notes}"
                </div>
              )}

              {notesByContact.get(contact.id) && notesByContact.get(contact.id)!.length > 0 && (
                <div className="mt-2 space-y-1">
                  {notesByContact.get(contact.id)!.map((note) => {
                    const noteDate = new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const preview = note.content.length > 80 ? note.content.substring(0, 77) + '...' : note.content;
                    return (
                      <div key={note.id} className="text-xs text-slate-500">
                        <span className="text-slate-600">{noteDate}:</span> {preview}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inline add note */}
              {addingNoteFor === contact.id ? (
                <div className="mt-2 flex gap-1.5">
                  <input
                    type="text"
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddNote(contact.id);
                      } else if (e.key === 'Escape') {
                        setAddingNoteFor(null);
                        setNewNoteText('');
                      }
                    }}
                    placeholder={
                      (noteCountByContact.get(contact.id) ?? 0) >= 10
                        ? 'Limit reached (10 notes)'
                        : 'Add a note...'
                    }
                    maxLength={200}
                    disabled={addingNoteLoading || (noteCountByContact.get(contact.id) ?? 0) >= 10}
                    autoFocus
                    className="flex-1 px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddNote(contact.id)}
                    disabled={!newNoteText.trim() || addingNoteLoading || (noteCountByContact.get(contact.id) ?? 0) >= 10}
                    className="px-1.5 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex-shrink-0"
                  >
                    {addingNoteLoading ? '...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddingNoteFor(null); setNewNoteText(''); }}
                    className="text-slate-400 hover:text-slate-200 flex-shrink-0 p-1"
                    aria-label="Cancel"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleOpenAddNote(contact.id)}
                  className="mt-2 text-xs text-slate-500 hover:text-blue-400 flex items-center gap-1 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add note
                </button>
              )}

              {contact.lastContactedAt && (
                <div className="flex items-center mt-2 text-xs text-green-400">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Contacted {getTimeAgo(contact.lastContactedAt)}
                </div>
              )}
            </div>

            {(contact.eventTitle || contact.dateMet) && (
              <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-xs text-slate-400">
                  {contact.eventTitle && (
                    contact.lumaEventUrl ? (
                      <a
                        href={contact.lumaEventUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-400 hover:underline"
                      >
                        {contact.eventTitle}
                      </a>
                    ) : (
                      <p className="font-medium text-slate-300">{contact.eventTitle}</p>
                    )
                  )}
                  {contact.dateMet && <p>{formatDate(contact.dateMet)}</p>}
                </div>
              </div>
            )}

            {user && (
              <div className="mt-2 pt-2 border-t border-slate-700/50">
                <HandshakeButton contact={contact} userId={user.id} />
              </div>
            )}
          </div>
        ))}
      </div>

      {editingContact && (
        <EditContactDialog contact={editingContact} onClose={() => {
          setEditingContact(null);
          // Refresh notes in case user added/deleted from the modal
          fetchNotesForContacts(displayContacts.map((c) => c.id));
        }} />
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
