import { useContacts } from '../hooks/useContacts';
import ContactsList from './ContactsList';

export default function ContactsPage() {
  const { contacts } = useContacts();

  const exportToCSV = () => {
    if (contacts.length === 0) {
      alert('No contacts to export');
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
    const rows = contacts.map((contact) => [
      contact.firstName,
      contact.lastName,
      contact.projectCompany || '',
      contact.position || '',
      contact.telegramHandle || '',
      contact.email || '',
      contact.notes || '',
      contact.eventTitle,
      contact.dateMet,
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => {
          // Escape cells that contain commas, quotes, or newlines
          const cellStr = String(cell);
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
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `contacts_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">My Contacts</h2>
          <p className="text-sm text-gray-600 mt-1">
            People you've met at events across all your itineraries
          </p>
        </div>
        {contacts.length > 0 && (
          <button
            onClick={exportToCSV}
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export to CSV
          </button>
        )}
      </div>
      <ContactsList />
    </div>
  );
}
