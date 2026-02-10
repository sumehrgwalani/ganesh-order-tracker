import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import ComposeEmailModal from '../components/ComposeEmailModal';
import { getContactInfo } from '../utils/helpers';
import { supabase } from '../lib/supabase';
import { ORDER_STAGES } from '../data/constants';
import type { SyncedEmail, ContactsMap } from '../types';

interface Props {
  orgId: string | null;
}

function MailboxPage({ orgId }: Props) {
  const navigate = useNavigate();
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [emails, setEmails] = useState<SyncedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string>('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ synced: number; advanced: number } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<SyncedEmail | null>(null);
  const [contacts, setContacts] = useState<ContactsMap>({});

  // Fetch contacts for auto-complete
  useEffect(() => {
    if (!orgId) return;
    supabase.from('contacts').select('*').eq('organization_id', orgId)
      .then(({ data }) => {
        const map: ContactsMap = {};
        for (const c of (data || [])) {
          map[c.email] = { name: c.name, company: c.company, role: c.role, initials: c.initials || '', color: c.color || 'bg-blue-500', phone: c.phone || '', address: c.address || '', notes: c.notes || '', country: c.country || '', default_brand: c.default_brand || '', default_packing: c.default_packing || '' };
        }
        setContacts(map);
      });
  }, [orgId]);

  // Fetch Gmail connection status + emails
  const fetchEmails = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      // Check current user's Gmail connection
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: member } = await supabase
        .from('organization_members')
        .select('gmail_email, gmail_refresh_token, gmail_last_sync')
        .eq('user_id', user.id)
        .eq('organization_id', orgId)
        .single();

      if (member?.gmail_email && member?.gmail_refresh_token) {
        setGmailConnected(true);
        setGmailEmail(member.gmail_email);
        setLastSync(member.gmail_last_sync);
      }

      // Fetch synced emails
      const { data: emailData } = await supabase
        .from('synced_emails')
        .select('*')
        .eq('organization_id', orgId)
        .order('date', { ascending: false })
        .limit(100);

      setEmails(emailData || []);
    } catch (err) {
      console.error('Failed to fetch emails:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  // Auto-sync on page load if Gmail connected
  useEffect(() => {
    if (gmailConnected && orgId && !syncing) {
      handleSync();
    }
  }, [gmailConnected]);

  // Auto-sync every 10 minutes
  useEffect(() => {
    if (!gmailConnected || !orgId) return;
    const interval = setInterval(() => {
      if (!syncing) handleSync();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [gmailConnected, orgId, syncing]);

  const handleSync = async () => {
    if (!orgId || syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('sync-emails', {
        body: { organization_id: orgId, user_id: user.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setSyncResult({ synced: data.synced || 0, advanced: data.advanced || 0 });
      setLastSync(new Date().toISOString());

      // Refresh email list
      const { data: emailData } = await supabase
        .from('synced_emails')
        .select('*')
        .eq('organization_id', orgId)
        .order('date', { ascending: false })
        .limit(100);

      setEmails(emailData || []);
    } catch (err: any) {
      console.error('Sync failed:', err);
      setSyncResult(null);
    } finally {
      setSyncing(false);
    }
  };

  // Build folder list from email senders
  const senderCompanies = new Map<string, { name: string; count: number }>();
  emails.forEach(e => {
    const key = (e.from_name || e.from_email || 'Unknown').trim();
    const existing = senderCompanies.get(key);
    if (existing) {
      existing.count++;
    } else {
      senderCompanies.set(key, { name: key, count: 1 });
    }
  });

  const folders = [
    { id: 'all', name: 'All Mail', icon: 'Inbox', count: emails.length },
    { id: 'matched', name: 'Matched to Orders', icon: 'Link', count: emails.filter(e => e.matched_order_id).length },
    { id: 'advanced', name: 'Auto-Advanced', icon: 'Zap', count: emails.filter(e => e.auto_advanced).length },
    { id: 'unmatched', name: 'Unmatched', icon: 'HelpCircle', count: emails.filter(e => !e.matched_order_id).length },
  ];

  // Filter emails
  const filteredEmails = emails.filter(email => {
    const matchesFolder = selectedFolder === 'all' ||
      (selectedFolder === 'matched' && email.matched_order_id) ||
      (selectedFolder === 'advanced' && email.auto_advanced) ||
      (selectedFolder === 'unmatched' && !email.matched_order_id);
    const matchesSearch = !searchTerm ||
      (email.subject || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (email.from_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (email.from_email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (email.ai_summary || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFolder && matchesSearch;
  });

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getStageName = (stage: number): string => {
    const s = ORDER_STAGES.find(s => s.id === stage);
    return s ? s.name : `Stage ${stage}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!gmailConnected) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="Mail" size={32} className="text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Gmail Not Connected</h3>
          <p className="text-sm text-gray-500 mb-4">Connect your Gmail in Settings to start syncing emails and auto-advancing orders.</p>
          <button onClick={() => navigate('/settings')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full -m-6">
      {/* Folder Sidebar */}
      <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            <span className="text-sm">Back</span>
          </button>
          <h2 className="text-lg font-semibold text-gray-800">Mailbox</h2>
          <p className="text-xs text-gray-500 mt-1">{gmailEmail}</p>
          {lastSync && <p className="text-xs text-gray-400 mt-0.5">Last sync: {new Date(lastSync).toLocaleTimeString()}</p>}
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {folders.map(folder => {
            const isSelected = selectedFolder === folder.id;
            return (
              <button
                key={folder.id}
                onClick={() => setSelectedFolder(folder.id)}
                className={`w-full px-4 py-2 flex items-center justify-between hover:bg-gray-100 transition-colors ${isSelected ? 'bg-blue-50 border-r-2 border-blue-600' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <Icon name={folder.icon as any} size={16} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
                  <span className={`text-sm ${isSelected ? 'font-medium text-blue-600' : 'text-gray-700'}`}>{folder.name}</span>
                </div>
                {folder.count > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isSelected ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-600'}`}>
                    {folder.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-gray-200">
          {syncResult && (
            <div className="mb-3 text-xs text-center">
              <span className="text-green-600">{syncResult.synced} synced</span>
              {syncResult.advanced > 0 && <span className="text-amber-600 ml-2">{syncResult.advanced} auto-advanced</span>}
            </div>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
          >
            <Icon name="RefreshCw" size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync Gmail'}
          </button>
        </div>
      </div>

      {/* Email List */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">{folders.find(f => f.id === selectedFolder)?.name || 'All Mail'}</h3>
              <p className="text-xs text-gray-500">{filteredEmails.length} emails</p>
            </div>
            <button
              onClick={() => { setReplyTo(null); setComposeOpen(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              <Icon name="Edit" size={14} />
              Compose
            </button>
          </div>
          <div className="relative">
            <Icon name="Search" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search emails..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Email List */}
        <div className="flex-1 overflow-y-auto">
          {filteredEmails.length > 0 ? (
            filteredEmails.map(email => {
              const contact = getContactInfo(email.from_email || '');
              return (
                <div
                  key={email.id}
                  onClick={() => setSelectedEmail(selectedEmail === email.id ? null : email.id)}
                  className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${selectedEmail === email.id ? 'bg-gray-100' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 ${contact.color} rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0`}>
                      {contact.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">
                          {email.from_name || email.from_email}
                        </span>
                        <div className="flex items-center gap-2">
                          {email.auto_advanced && (
                            <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">Auto-Advanced</span>
                          )}
                          {email.matched_order_id && (
                            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">{email.matched_order_id}</span>
                          )}
                          {email.has_attachment && <Icon name="Paperclip" size={14} className="text-gray-400" />}
                          <span className="text-xs text-gray-500">{formatDate(email.date)}</span>
                        </div>
                      </div>
                      <p className="text-sm truncate text-gray-700">{email.subject}</p>
                      {email.ai_summary ? (
                        <p className="text-xs text-gray-500 truncate mt-1">{email.ai_summary}</p>
                      ) : (
                        <p className="text-xs text-gray-500 truncate mt-1">{(email.body_text || '').substring(0, 120)}</p>
                      )}
                      {email.detected_stage && (
                        <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                          → {getStageName(email.detected_stage)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expanded Email View */}
                  {selectedEmail === email.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">From:</span>
                            <span className="text-sm text-gray-600">{email.from_name} &lt;{email.from_email}&gt;</span>
                          </div>
                          <span className="text-xs text-gray-500">{email.date ? new Date(email.date).toLocaleString() : ''}</span>
                        </div>

                        {email.ai_summary && (
                          <div className="mb-3 p-2 bg-blue-50 border border-blue-100 rounded-lg">
                            <p className="text-xs font-medium text-blue-700 mb-0.5">AI Summary</p>
                            <p className="text-sm text-blue-800">{email.ai_summary}</p>
                          </div>
                        )}

                        <p className="text-sm text-gray-700 whitespace-pre-line">{(email.body_text || '').substring(0, 2000)}</p>

                        {email.has_attachment && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <p className="text-xs text-gray-500 mb-2">Has attachment(s)</p>
                          </div>
                        )}

                        <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setReplyTo(email); setComposeOpen(true); }}
                            className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs font-medium hover:bg-gray-700 flex items-center gap-1"
                          >
                            <Icon name="CornerUpLeft" size={12} />
                            Reply
                          </button>
                          {email.matched_order_id && (
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/orders/${email.matched_order_id}`); }}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
                            >
                              View Order {email.matched_order_id}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center">
                <Icon name="Inbox" size={48} className="mx-auto mb-4 text-gray-300" />
                <p className="font-medium text-gray-500">
                  {emails.length === 0 ? 'No emails synced yet' : 'No emails found'}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {emails.length === 0 ? 'Click "Sync Gmail" to fetch your latest emails' : 'Try a different search term or folder'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compose Email Modal */}
      <ComposeEmailModal
        isOpen={composeOpen}
        onClose={() => { setComposeOpen(false); setReplyTo(null); }}
        orgId={orgId}
        contacts={contacts}
        prefillTo={replyTo?.from_email ? [replyTo.from_email] : undefined}
        prefillSubject={replyTo ? 'Re: ' + (replyTo.subject || '') : undefined}
        prefillBody={replyTo ? '\n\n--- Original Message ---\nFrom: ' + (replyTo.from_name || replyTo.from_email) + '\nDate: ' + (replyTo.date ? new Date(replyTo.date).toLocaleString() : '') + '\n\n' + (replyTo.body_text || '').substring(0, 2000) : undefined}
        inReplyToMessageId={replyTo?.gmail_id}
        onSent={fetchEmails}
      />
    </div>
  );
}

export default MailboxPage;
