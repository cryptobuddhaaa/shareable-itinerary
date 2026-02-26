import { useState, useMemo, useEffect } from 'react';
import { useContacts } from '../hooks/useContacts';
import { useHandshakes } from '../hooks/useHandshakes';
import { useEnrichment } from '../hooks/useEnrichment';
import { useAuth } from '../hooks/useAuth';
import ContactsList from './ContactsList';
import ContactForm from './ContactForm';
import FollowUpDialog from './FollowUpDialog';
import { toast } from './Toast';
import { isTelegramWebApp, openTelegramLink } from '../lib/telegram';
import {
  generateTelegramLinkCode,
  getTelegramLinkStatus,
  unlinkTelegram,
} from '../services/telegramService';

type SortOption = 'dateMet' | 'firstName' | 'lastName' | 'lastContacted';

export default function ContactsPage() {
  const { user } = useAuth();
  const { contacts, tags, addTag, deleteTag, initialize } = useContacts();
  const { initialize: initializeHandshakes } = useHandshakes();
  const { usage } = useEnrichment();

  // Auto-refresh contacts and handshakes when tab is opened (component mounts)
  useEffect(() => {
    if (user) {
      initialize(user.id);
      initializeHandshakes(user.id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('dateMet');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState<string>();
  const [linkLoading, setLinkLoading] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  useEffect(() => {
    getTelegramLinkStatus().then((status) => {
      setTelegramLinked(status.linked);
      setTelegramUsername(status.username);
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'n' && !showAddContact && !showFollowUp) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        setShowAddContact(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showAddContact, showFollowUp]);

  const handleLinkTelegram = async () => {
    setLinkLoading(true);
    try {
      const { deepLink } = await generateTelegramLinkCode();
      openTelegramLink(deepLink);
      toast.info('Complete linking in Telegram. Then refresh this page.');
    } catch {
      toast.error('Failed to generate link code.');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    try {
      await unlinkTelegram();
      setTelegramLinked(false);
      setTelegramUsername(undefined);
      toast.info('Telegram unlinked.');
    } catch {
      toast.error('Failed to unlink Telegram.');
    }
  };

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      await addTag(name);
      setNewTagName('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add tag';
      toast.error(msg.includes('LIMIT_REACHED') ? msg.split(':')[1] : msg.includes('duplicate') ? 'Tag already exists' : msg);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    try {
      await deleteTag(tagId);
      // Clear filter if the deleted tag was active
      const deleted = tags.find((t) => t.id === tagId);
      if (deleted && filterTag === deleted.name) setFilterTag(null);
    } catch {
      toast.error('Failed to delete tag');
    }
  };

  // Filter and sort contacts
  const filteredAndSortedContacts = useMemo(() => {
    let result = [...contacts];

    // Apply tag filter
    if (filterTag) {
      result = result.filter((c) => c.tags?.includes(filterTag));
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (contact) =>
          contact.firstName.toLowerCase().includes(query) ||
          contact.lastName.toLowerCase().includes(query) ||
          contact.projectCompany?.toLowerCase().includes(query) ||
          contact.position?.toLowerCase().includes(query) ||
          contact.eventTitle?.toLowerCase().includes(query) ||
          contact.email?.toLowerCase().includes(query) ||
          contact.telegramHandle?.toLowerCase().includes(query) ||
          contact.tags?.some((t) => t.toLowerCase().includes(query))
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'dateMet':
          return (new Date(b.dateMet || 0).getTime()) - (new Date(a.dateMet || 0).getTime());
        case 'lastContacted':
          // Contacts never contacted go to the bottom
          if (!a.lastContactedAt && !b.lastContactedAt) return 0;
          if (!a.lastContactedAt) return 1;
          if (!b.lastContactedAt) return -1;
          return new Date(b.lastContactedAt).getTime() - new Date(a.lastContactedAt).getTime();
        case 'firstName':
          return a.firstName.localeCompare(b.firstName);
        case 'lastName':
          return a.lastName.localeCompare(b.lastName);
        default:
          return 0;
      }
    });

    return result;
  }, [contacts, searchQuery, sortBy, filterTag]);

  const exportToCSV = () => {
    if (filteredAndSortedContacts.length === 0) {
      toast.info('No contacts to export');
      return;
    }

    // Define CSV headers
    const headers = [
      'First Name',
      'Last Name',
      'Project/Company',
      'Position',
      'Telegram Handle',
      'Email',
      'Notes',
      'Event',
      'Date Met',
    ];

    // Convert contacts to CSV rows
    const rows = filteredAndSortedContacts.map((contact) => [
      contact.firstName,
      contact.lastName,
      contact.projectCompany || '',
      contact.position || '',
      contact.telegramHandle || '',
      contact.email || '',
      contact.notes || '',
      contact.eventTitle || '',
      contact.dateMet || '',
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => {
          let cellStr = String(cell);
          // Prevent CSV formula injection: prefix dangerous characters with a single quote
          if (/^[=+\-@\t\r]/.test(cellStr)) {
            cellStr = `'${cellStr}`;
          }
          // Escape cells that contain commas, quotes, or newlines
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return `"${cellStr.replace(/"/g, '""')}"`;
          }
          return cellStr;
        }).join(',')
      ),
    ].join('\n');

    // Create a Blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `contacts_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (isTelegramWebApp()) {
        toast.info('If the download didn\u2019t start, try exporting from the browser version.');
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">My Contacts</h2>
            <p className="text-sm text-slate-400 mt-1">
              People you've connected with across all your trips and events
            </p>
          </div>
          {contacts.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-900/30 border border-purple-700/50 rounded-lg flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              <span className="text-xs text-purple-300">
                {usage.used}/{usage.limit} enrichments
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowAddContact(true)}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-blue-500"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Contact
          </button>
          {contacts.length > 0 && (
            <>
              <button
                onClick={() => setShowFollowUp(true)}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-green-500"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Follow-Up
              </button>
              <button
                onClick={exportToCSV}
                className="inline-flex items-center px-3 py-1.5 border border-slate-600 text-sm font-medium rounded-md text-slate-300 bg-slate-700 hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-blue-500"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export CSV
              </button>
            </>
          )}
        </div>
      </div>

      {/* Telegram Bot Link */}
      <div className="mb-6 flex items-center gap-3 p-3 bg-blue-900/30 border border-blue-700 rounded-lg">
        <svg className="w-5 h-5 text-blue-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
        {telegramLinked ? (
          <div className="flex items-center gap-3 flex-1">
            <span className="text-sm text-blue-200">
              Telegram linked{telegramUsername ? ` (@${telegramUsername})` : ''}
              {' — '}use the bot to quickly add contacts from events
            </span>
            <button
              onClick={handleUnlinkTelegram}
              className="text-xs text-blue-400 hover:text-blue-300 underline whitespace-nowrap"
            >
              Unlink
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-1">
            <span className="text-sm text-blue-200">
              Link Telegram to quickly add contacts from events via bot
            </span>
            <button
              onClick={handleLinkTelegram}
              disabled={linkLoading}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              {linkLoading ? 'Generating...' : 'Link Telegram'}
            </button>
          </div>
        )}
      </div>

      {contacts.length > 0 && (
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          {/* Search input */}
          <div className="flex-1">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full pl-10 pr-3 py-2 border border-slate-600 rounded-md leading-5 bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  aria-label="Clear search"
                >
                  <svg className="h-5 w-5 text-slate-400 hover:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Sort dropdown */}
          <div className="sm:w-48">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="block w-full px-3 py-2 border border-slate-600 rounded-md leading-5 bg-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="dateMet">Sort by Date Met</option>
              <option value="lastContacted">Sort by Last Contacted</option>
              <option value="firstName">Sort by First Name</option>
              <option value="lastName">Sort by Last Name</option>
            </select>
          </div>
        </div>
      )}

      {/* Tags section */}
      {contacts.length > 0 && (
        <div className="mb-4 p-3 bg-slate-800 border border-slate-700 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-300">Labels</h3>
            {tags.length > 0 && (
              <button
                onClick={() => setShowTagManager(!showTagManager)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {showTagManager ? 'Done' : 'Manage Labels'}
              </button>
            )}
          </div>

          {/* Tag filter chips */}
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button
                onClick={() => setFilterTag(null)}
                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                  !filterTag
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'border-slate-600 text-slate-300 hover:border-slate-500'
                }`}
              >
                All
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setFilterTag(filterTag === tag.name ? null : tag.name)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    filterTag === tag.name
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'border-slate-600 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}

          {/* Tag manager (create/delete) — always visible when 0 tags, or when toggled */}
          {(showTagManager || tags.length === 0) && (
            <>
              {tags.length === 0 && (
                <p className="text-xs text-slate-400 mb-2">
                  Create labels to categorize contacts (e.g. investor, developer, speaker). Up to 10 labels, 3 per contact.
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(); }}
                  placeholder="New label name..."
                  maxLength={20}
                  className="flex-1 px-2 py-1 text-sm bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddTag}
                  disabled={!newTagName.trim() || tags.length >= 10}
                  className="px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
                <span className="text-xs text-slate-500">{tags.length}/10</span>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag) => (
                    <span key={tag.id} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-slate-700 text-slate-300 border border-slate-600">
                      {tag.name}
                      <button
                        onClick={() => handleDeleteTag(tag.id)}
                        className="text-slate-500 hover:text-red-400"
                        aria-label={`Delete tag ${tag.name}`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="text-center py-16 bg-slate-800 rounded-lg shadow">
          <svg className="mx-auto h-16 w-16 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-white">No contacts yet</h3>
          <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
            Start building your network by adding contacts from events,
            or forward messages in the Telegram bot to quickly save people you meet.
          </p>
          <button
            onClick={() => setShowAddContact(true)}
            className="mt-6 inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Your First Contact
          </button>
        </div>
      ) : (
        <>
          {filteredAndSortedContacts.length === 0 && searchQuery && (
            <div className="text-center py-12 bg-slate-800 rounded-lg shadow">
              <svg className="mx-auto h-12 w-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-white">No contacts found</h3>
              <p className="mt-1 text-sm text-slate-400">Try adjusting your search query</p>
            </div>
          )}

          <ContactsList contacts={filteredAndSortedContacts} />
        </>
      )}

      {showAddContact && (
        <ContactForm onClose={() => setShowAddContact(false)} />
      )}

      {showFollowUp && (
        <FollowUpDialog onClose={() => setShowFollowUp(false)} />
      )}
    </div>
  );
}
