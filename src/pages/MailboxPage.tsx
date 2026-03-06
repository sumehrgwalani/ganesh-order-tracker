import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import LinkEmailModal from '../components/LinkEmailModal';
import { useSyncedEmails, SyncedEmail } from '../hooks/useSyncedEmails';
import { useToast } from '../components/Toast';
import { supabase } from '../lib/supabase';
import { apiCall } from '../utils/api';
import type { Order } from '../types';

interface Props {
  orgId: string | null;
  orders: Order[];
  userId?: string;
}

type SyncPhase = 'idle' | 'pulling' | 'matching' | 'reprocessing' | 'extracting' | 'recovering' | 'done';
type Folder = 'inbox' | 'sent' | 'drafts';
type Filter = 'all' | 'matched' | 'unmatched' | 'reviewed';

function MailboxPage({ orgId, orders, userId }: Props) {
  const navigate = useNavigate();
  const { inboxEmails, sentEmails, draftEmails, matchedEmails, unmatchedEmails, reviewedEmails, loading, linkEmailToOrder, unlinkEmail, dismissEmail, markReviewed, unmarkReviewed, refetch } = useSyncedEmails(orgId);
  const { showToast } = useToast();

  const [activeFolder, setActiveFolder] = useState<Folder>('inbox');
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [linkingEmail, setLinkingEmail] = useState<SyncedEmail | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const readingPaneRef = useRef<HTMLDivElement>(null);

  // Sync state
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle');
  const [syncProgress, setSyncProgress] = useState('');
  const [matchProgress, setMatchProgress] = useState({ matched: 0, remaining: 0, total: 0 });
  const [syncSummary, setSyncSummary] = useState<{
    pulled: number; regexMatched: number; threadMatched: number; aiMatched: number;
    created: number; totalMatched: number; totalEmails: number; dismissed: number; recovered: number;
  } | null>(null);

  const handleDismiss = async (email: SyncedEmail) => {
    try {
      await dismissEmail(email.id);
      showToast('Email dismissed', 'success');
      if (selectedEmailId === email.id) setSelectedEmailId(null);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to dismiss', 'error');
    }
  };

  const handleUnlink = async (email: SyncedEmail) => {
    try {
      await unlinkEmail(email.id);
      showToast('Email delinked', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delink', 'error');
    }
  };

  const orderOptions = orders.map((o) => ({
    id: o.id, poNumber: o.poNumber || o.id, company: o.company, product: o.product,
  }));

  const handleLink = async (orderId: string, orderPoNumber: string, note: string) => {
    if (!linkingEmail) return;
    try {
      const originalAiMatch = linkingEmail.matched_order_id || null;
      if (linkingEmail.matched_order_id) await unlinkEmail(linkingEmail.id);
      await linkEmailToOrder(linkingEmail.id, orderId, orderPoNumber, note, originalAiMatch);
      showToast('Email linked to order', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to link', 'error');
      throw err;
    }
  };

  // ── Sync handlers ──
  const handleQuickSync = async () => {
    if (!orgId || !userId) return;
    try {
      setSyncPhase('pulling');
      setSyncProgress('Fetching latest emails...');
      let pullDone = false, totalPulled = 0, pullRound = 0;
      while (!pullDone && pullRound < 3) {
        pullRound++;
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'pull' });
        if (e) throw e;
        totalPulled += d?.synced || 0;
        const pending = d?.pendingDownload || 0;
        setSyncProgress(pending > 0 ? `Downloaded ${totalPulled} emails (${pending} remaining)...` : `Pulled ${totalPulled} new emails`);
        pullDone = d?.done !== false || (d?.synced || 0) === 0;
        if (!pullDone) await new Promise(r => setTimeout(r, 500));
      }
      if (totalPulled === 0) {
        setSyncPhase('done'); setSyncProgress('No new emails found'); showToast('No new emails', 'info'); refetch();
        setTimeout(() => { setSyncPhase('idle'); setSyncProgress(''); }, 3000); return;
      }
      setSyncPhase('matching');
      let matchBatch = 0, totalMatched = 0, matchDone = false;
      let sR = 0, sT = 0, sA = 0, sC = 0, sTE = 0, sD = 0;
      while (!matchDone && matchBatch < 20) {
        matchBatch++;
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'match' });
        if (e) { setSyncProgress(`Error: ${e.message}`); break; }
        const rem = d?.remaining || 0; totalMatched = d?.totalMatched || 0;
        sR += d?.regexMatched || 0; sT += d?.threadMatched || 0; sA += d?.aiMatched || 0; sC += d?.created || 0;
        sTE = d?.totalEmails || sTE; sD = d?.dismissed || sD;
        setSyncProgress(rem > 0 ? `Matching: ${rem} remaining...` : `Matched ${totalMatched} emails`);
        setMatchProgress({ matched: totalMatched, remaining: rem, total: d?.totalEmails || 0 });
        matchDone = d?.done === true || rem === 0;
        if (!matchDone) await new Promise(r => setTimeout(r, 1000));
      }
      setSyncPhase('reprocessing');
      let rpDone = false, totalRp = 0;
      while (!rpDone && totalRp < 50) {
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'reprocess' });
        if (e) break; totalRp += d?.processed || 0;
        setSyncProgress(d?.remaining > 0 ? `Attachments: ${totalRp} done, ${d.remaining} left...` : 'Attachments processed');
        rpDone = d?.done === true || (d?.remaining || 0) === 0;
        if (!rpDone) await new Promise(r => setTimeout(r, 500));
      }
      setSyncPhase('extracting');
      let exDone = false, totalEx = 0;
      while (!exDone && totalEx < 20) {
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'bulk-extract' });
        if (e) break; totalEx += d?.batchProcessed || 0;
        setSyncProgress(d?.remaining > 0 ? `Extracting: ${totalEx} done, ${d.remaining} left...` : 'Extracted');
        exDone = d?.done === true || (d?.remaining || 0) === 0;
        if (!exDone) await new Promise(r => setTimeout(r, 500));
      }
      setSyncPhase('done');
      setSyncProgress(`Synced ${totalPulled} new emails`);
      setSyncSummary({ pulled: totalPulled, regexMatched: sR, threadMatched: sT, aiMatched: sA, created: sC, totalMatched, totalEmails: sTE, dismissed: sD, recovered: 0 });
      refetch();
      setTimeout(() => { setSyncPhase('idle'); setSyncProgress(''); setSyncSummary(null); }, 12000);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Sync failed', 'error');
      setSyncPhase('idle'); setSyncProgress('');
    }
  };

  const handleFullSync = async () => {
    if (!orgId || !userId) return;
    setSyncPhase('pulling'); setSyncProgress('Downloading emails from Gmail...');
    try {
      let pullDone = false, totalPulled = 0, pullRound = 0;
      while (!pullDone && pullRound < 5) {
        pullRound++;
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'pull' });
        if (e) throw e; totalPulled += d?.synced || 0;
        setSyncProgress(d?.pendingDownload > 0 ? `Downloaded ${totalPulled} (${d.pendingDownload} remaining)...` : `Downloaded ${totalPulled} emails`);
        pullDone = d?.done !== false || (d?.synced || 0) === 0;
        if (!pullDone) await new Promise(r => setTimeout(r, 500));
      }
      showToast(`${totalPulled} emails downloaded`, 'success');
      setSyncPhase('matching');
      let batch = 0, done = false, fR = 0, fT = 0, fA = 0, fC = 0, fTE = 0, fTM = 0, fD = 0;
      while (!done && batch < 200) {
        batch++;
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'match' });
        if (e) throw e; const rem = d?.remaining || 0;
        fR += d?.regexMatched || 0; fT += d?.threadMatched || 0; fA += d?.aiMatched || 0; fC += d?.created || 0;
        fTE = d?.totalEmails || fTE; fTM = d?.totalMatched || 0; fD = d?.dismissed || fD;
        setMatchProgress({ matched: fTM, remaining: rem, total: fTE });
        setSyncProgress(rem > 0 ? `Matching batch ${batch}: ${fTM} matched, ${rem} left...` : `${fTM} emails matched`);
        if (d?.created > 0) showToast(`${d.created} new orders discovered`, 'success');
        done = d?.done === true || rem === 0;
        if (!done) await new Promise(r => setTimeout(r, 1000));
      }
      setSyncPhase('reprocessing');
      let rpDone = false, totalRp = 0;
      while (!rpDone && totalRp < 300) {
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'reprocess' });
        if (e) break; totalRp += d?.processed || 0;
        setSyncProgress(d?.remaining > 0 ? `Attachments: ${totalRp} done, ${d.remaining} left...` : 'Attachments done');
        rpDone = d?.done === true || (d?.remaining || 0) === 0;
        if (!rpDone) await new Promise(r => setTimeout(r, 500));
      }
      setSyncPhase('extracting');
      let exDone = false, totalEx = 0;
      while (!exDone && totalEx < 200) {
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'bulk-extract' });
        if (e) break; totalEx += d?.batchProcessed || 0;
        setSyncProgress(d?.remaining > 0 ? `Extracting: ${totalEx} done, ${d.remaining} left...` : 'Extracted');
        exDone = d?.done === true || (d?.remaining || 0) === 0;
        if (!exDone) await new Promise(r => setTimeout(r, 500));
      }
      setSyncPhase('recovering'); setSyncProgress('Recovering missing data...');
      let recDone = false, totalRec = 0;
      while (!recDone && totalRec < 50) {
        const { data: d, error: e } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'recover' });
        if (e) break; totalRec += d?.recovered || 0;
        setSyncProgress(d?.remaining > 0 ? `Recovering: ${totalRec} done...` : totalRec > 0 ? `Recovered ${totalRec} orders` : 'No recovery needed');
        recDone = d?.done === true || (d?.remaining || 0) === 0;
        if (!recDone) await new Promise(r => setTimeout(r, 500));
      }
      setSyncPhase('done'); setSyncProgress('Full sync complete!');
      setSyncSummary({ pulled: totalPulled, regexMatched: fR, threadMatched: fT, aiMatched: fA, created: fC, totalMatched: fTM, totalEmails: fTE, dismissed: fD, recovered: totalRec });
      refetch();
      setTimeout(() => { setSyncPhase('idle'); setSyncProgress(''); setSyncSummary(null); }, 15000);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Sync failed', 'error');
      setSyncPhase('idle'); setSyncProgress('');
    }
  };

  // ── Helpers ──
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diff === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatFullDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const getOrderLabel = (email: SyncedEmail) => {
    const oid = email.matched_order_id || email.user_linked_order_id;
    if (!oid) return null;
    const order = orders.find(o => o.id === oid);
    return order ? `${order.poNumber || order.id} — ${order.company}` : oid;
  };

  const getSnippet = (body: string) => {
    if (!body) return '';
    const cleaned = body.replace(/^(>.*\n?)+/gm, '').replace(/\n{2,}/g, '\n').trim();
    const first = cleaned.split('\n')[0] || '';
    return first.length > 100 ? first.slice(0, 100) + '...' : first;
  };

  // ── Folder + Filter logic ──
  const folderEmails = useMemo(() => {
    if (activeFolder === 'sent') return sentEmails;
    if (activeFolder === 'drafts') return draftEmails;
    return inboxEmails;
  }, [activeFolder, inboxEmails, sentEmails, draftEmails]);

  const filteredEmails = useMemo(() => {
    let list = folderEmails;
    if (activeFilter === 'matched') list = list.filter(e => e.matched_order_id || e.user_linked_order_id);
    else if (activeFilter === 'unmatched') list = list.filter(e => !e.matched_order_id && !e.user_linked_order_id && !e.dismissed && !e.reviewed);
    else if (activeFilter === 'reviewed') list = list.filter(e => e.reviewed && !e.matched_order_id && !e.user_linked_order_id);

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(e =>
        (e.subject || '').toLowerCase().includes(q) ||
        (e.from_name || '').toLowerCase().includes(q) ||
        (e.from_email || '').toLowerCase().includes(q) ||
        (e.body_text || '').toLowerCase().includes(q) ||
        (e.matched_order_id || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [folderEmails, activeFilter, searchTerm]);

  // Filter counts for current folder
  const folderMatchedCount = folderEmails.filter(e => e.matched_order_id || e.user_linked_order_id).length;
  const folderUnmatchedCount = folderEmails.filter(e => !e.matched_order_id && !e.user_linked_order_id && !e.dismissed && !e.reviewed).length;
  const folderReviewedCount = folderEmails.filter(e => e.reviewed && !e.matched_order_id && !e.user_linked_order_id).length;

  const isSyncing = syncPhase !== 'idle' && syncPhase !== 'done';
  const selectedEmail = filteredEmails.find(e => e.id === selectedEmailId) || null;

  // Auto-select first email when folder/filter changes
  useEffect(() => {
    if (filteredEmails.length > 0 && !filteredEmails.find(e => e.id === selectedEmailId)) {
      setSelectedEmailId(filteredEmails[0].id);
    }
  }, [activeFolder, activeFilter, filteredEmails.length]);

  useEffect(() => {
    if (readingPaneRef.current) readingPaneRef.current.scrollTop = 0;
  }, [selectedEmailId]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Mailbox" subtitle="Email integration for order tracking" onBack={() => navigate('/')} />
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  const isEmailMatched = (e: SyncedEmail) => !!(e.matched_order_id || e.user_linked_order_id);
  const isEmailUnmatched = (e: SyncedEmail) => !e.matched_order_id && !e.user_linked_order_id && !e.dismissed && !e.reviewed;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      {/* Header with sync buttons */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600">
            <Icon name="ChevronLeft" size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Mailbox</h1>
            <p className="text-xs text-gray-400">Email integration for order tracking</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleQuickSync} disabled={isSyncing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isSyncing ? 'bg-gray-100 text-gray-400' : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'}`}>
            <Icon name="Download" size={13} className={syncPhase === 'pulling' ? 'animate-bounce' : ''} />
            {syncPhase === 'pulling' ? 'Pulling...' : 'Quick Sync'}
          </button>
          <button onClick={handleFullSync} disabled={isSyncing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isSyncing ? 'bg-blue-50 text-blue-500' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            <Icon name="RefreshCw" size={13} className={isSyncing && syncPhase !== 'pulling' ? 'animate-spin' : ''} />
            {syncPhase === 'matching' ? 'Matching...' : syncPhase === 'reprocessing' ? 'Processing...' : syncPhase === 'extracting' ? 'Extracting...' : syncPhase === 'recovering' ? 'Recovering...' : syncPhase === 'done' ? 'Done!' : 'Full Sync'}
          </button>
        </div>
      </div>

      {/* Sync progress banner */}
      {syncPhase !== 'idle' && (
        <div className={`mb-3 rounded-lg px-4 py-2.5 flex items-center gap-3 flex-shrink-0 ${syncPhase === 'done' ? 'bg-green-50 border border-green-200' : 'bg-blue-50 border border-blue-200'}`}>
          {syncPhase !== 'done' && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          {syncPhase === 'done' && <Icon name="CheckCircle" size={16} className="text-green-600 flex-shrink-0" />}
          <div className="flex-1">
            <p className={`text-xs font-medium ${syncPhase === 'done' ? 'text-green-800' : 'text-blue-800'}`}>{syncProgress}</p>
            {syncPhase === 'matching' && matchProgress.total > 0 && (
              <div className="mt-1.5 h-1 bg-blue-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${Math.round(((matchProgress.total - matchProgress.remaining) / matchProgress.total) * 100)}%` }} />
              </div>
            )}
            {syncPhase === 'done' && syncSummary && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {syncSummary.pulled > 0 && <span className="text-xs bg-white px-1.5 py-0.5 rounded border border-green-100"><b className="text-green-700">{syncSummary.pulled}</b> new</span>}
                {syncSummary.totalMatched > 0 && <span className="text-xs bg-white px-1.5 py-0.5 rounded border border-green-100"><b className="text-blue-700">{syncSummary.totalMatched}</b>/{syncSummary.totalEmails} matched</span>}
                {syncSummary.created > 0 && <span className="text-xs bg-white px-1.5 py-0.5 rounded border border-green-100"><b className="text-green-600">{syncSummary.created}</b> orders created</span>}
              </div>
            )}
          </div>
          {syncPhase === 'done' && (
            <button onClick={() => { setSyncPhase('idle'); setSyncProgress(''); setSyncSummary(null); }} className="text-gray-400 hover:text-gray-600">
              <Icon name="X" size={14} />
            </button>
          )}
        </div>
      )}

      {/* Main layout: Folder sidebar + Email list + Reading pane */}
      <div className="flex-1 flex min-h-0 rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">

        {/* Folder sidebar */}
        <div className="w-[180px] flex-shrink-0 bg-gray-50 border-r border-gray-200 py-3 flex flex-col">
          <div className="px-3 mb-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Folders</p>
          </div>
          {[
            { key: 'inbox' as Folder, label: 'Inbox', icon: 'Inbox', count: inboxEmails.length },
            { key: 'sent' as Folder, label: 'Sent', icon: 'Send', count: sentEmails.length },
            { key: 'drafts' as Folder, label: 'Drafts', icon: 'Edit', count: draftEmails.length },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => { setActiveFolder(f.key); setActiveFilter('all'); setSelectedEmailId(null); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                activeFolder === f.key
                  ? 'bg-blue-100 text-blue-700 border-r-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon name={f.icon as any} size={16} />
              <span className="text-sm font-medium flex-1">{f.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full min-w-[24px] text-center ${
                activeFolder === f.key ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-500'
              }`}>{f.count}</span>
            </button>
          ))}

          {/* Divider */}
          <div className="border-t border-gray-200 my-3 mx-3" />

          {/* Status filters */}
          <div className="px-3 mb-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</p>
          </div>
          {[
            { key: 'all' as Filter, label: 'All Emails', count: folderEmails.length },
            { key: 'matched' as Filter, label: 'Matched', count: folderMatchedCount },
            { key: 'unmatched' as Filter, label: 'Unmatched', count: folderUnmatchedCount },
            { key: 'reviewed' as Filter, label: 'Reviewed', count: folderReviewedCount },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => { setActiveFilter(f.key); setSelectedEmailId(null); }}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                activeFilter === f.key
                  ? 'bg-gray-200 text-gray-800'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <span className="text-xs font-medium flex-1">{f.label}</span>
              <span className="text-xs text-gray-400">{f.count}</span>
            </button>
          ))}
        </div>

        {/* Email list */}
        <div className="w-[380px] flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Icon name="Search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text" placeholder="Search emails..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <Icon name="X" size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Email rows */}
          <div className="flex-1 overflow-y-auto">
            {filteredEmails.length === 0 ? (
              <div className="p-8 text-center">
                <Icon name="Mail" size={28} className="mx-auto mb-2 text-gray-200" />
                <p className="text-xs text-gray-400">No emails in this view</p>
              </div>
            ) : (
              filteredEmails.map(email => {
                const isSelected = selectedEmailId === email.id;
                const orderLabel = getOrderLabel(email);
                const isUserLinked = !!email.user_linked_order_id;
                const isSent = email.email_type === 'sent';

                return (
                  <button
                    key={email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-50 transition-all ${
                      isSelected ? 'bg-blue-50 border-l-[3px] border-l-blue-500' : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Avatar */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold ${
                        isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {(email.from_name || email.from_email || '?')[0].toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Sender + Date */}
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-[13px] truncate ${isSelected ? 'font-semibold text-blue-900' : 'font-medium text-gray-800'}`}>
                            {isSent ? `To: ${email.to_email?.split(',')[0]?.trim() || ''}` : (email.from_name || email.from_email)}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {email.has_attachment && <Icon name="Paperclip" size={10} className="text-gray-300" />}
                            <span className="text-[10px] text-gray-400">{formatDate(email.date)}</span>
                          </div>
                        </div>

                        {/* Subject */}
                        <p className={`text-xs truncate mt-0.5 ${isSelected ? 'text-blue-800' : 'text-gray-600'}`}>{email.subject}</p>

                        {/* Snippet */}
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{getSnippet(email.body_text)}</p>

                        {/* Order badge or suggested */}
                        {orderLabel && (
                          <div className="mt-1 flex items-center gap-1">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded truncate max-w-[260px] ${
                              isUserLinked ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                            }`}>
                              {orderLabel}
                            </span>
                            {!isUserLinked && email.ai_confidence && (
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                email.ai_confidence === 'high' ? 'bg-green-500' : email.ai_confidence === 'medium' ? 'bg-yellow-500' : 'bg-red-500'
                              }`} />
                            )}
                          </div>
                        )}
                        {!orderLabel && email.ai_suggested_order_id && (
                          <div className="mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-500">
                              Suggested: {orders.find(o => o.id === email.ai_suggested_order_id)?.poNumber || email.ai_suggested_order_id}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Reading pane */}
        <div ref={readingPaneRef} className="flex-1 overflow-y-auto bg-white">
          {selectedEmail ? (
            <div className="p-6">
              {/* Subject */}
              <h2 className="text-lg font-semibold text-gray-900 mb-5 leading-snug">{selectedEmail.subject}</h2>

              {/* Sender info */}
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0 text-white font-semibold">
                  {(selectedEmail.from_name || selectedEmail.from_email || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-gray-800">{selectedEmail.from_name || selectedEmail.from_email}</span>
                      <span className="text-xs text-gray-400 ml-2">&lt;{selectedEmail.from_email}&gt;</span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0 ml-3">{formatFullDate(selectedEmail.date)}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    To: {selectedEmail.to_email}
                    {selectedEmail.detected_stage && <span className="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">Stage {selectedEmail.detected_stage}</span>}
                  </p>
                </div>
              </div>

              {/* Order link bar */}
              {getOrderLabel(selectedEmail) && (
                <div className="mb-4 flex items-center gap-2 bg-gradient-to-r from-blue-50 to-blue-50/50 rounded-lg px-3 py-2 border border-blue-100">
                  <Icon name="Package" size={14} className="text-blue-500" />
                  <span className="text-sm text-blue-700 font-medium truncate">{getOrderLabel(selectedEmail)}</span>
                  <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => { const oid = selectedEmail.matched_order_id || selectedEmail.user_linked_order_id; if (oid) navigate(`/orders/${encodeURIComponent(oid)}`); }}
                      className="text-[11px] px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1">
                      <Icon name="ExternalLink" size={10} /> View
                    </button>
                    <button onClick={() => setLinkingEmail(selectedEmail)}
                      className="text-[11px] px-2 py-1 bg-white text-orange-600 border border-orange-200 rounded hover:bg-orange-50 flex items-center gap-1">
                      <Icon name="RefreshCw" size={10} /> Reassign
                    </button>
                    <button onClick={() => handleUnlink(selectedEmail)}
                      className="text-[11px] px-2 py-1 bg-white text-red-500 border border-red-200 rounded hover:bg-red-50 flex items-center gap-1">
                      <Icon name="X" size={10} /> Delink
                    </button>
                  </div>
                </div>
              )}

              {/* Actions for unmatched */}
              {isEmailUnmatched(selectedEmail) && (
                <div className="mb-4 flex items-center gap-2">
                  <button onClick={() => setLinkingEmail(selectedEmail)}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5">
                    <Icon name="Link" size={12} /> Link to Order
                  </button>
                  <button onClick={() => markReviewed(selectedEmail.id).then(() => showToast('Moved to Reviewed', 'success')).catch(() => showToast('Failed', 'error'))}
                    className="text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 flex items-center gap-1.5">
                    <Icon name="CheckCircle" size={12} /> Reviewed
                  </button>
                  <button onClick={() => handleDismiss(selectedEmail)}
                    className="text-xs px-3 py-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 flex items-center gap-1.5">
                    <Icon name="X" size={12} /> Dismiss
                  </button>
                </div>
              )}

              {/* Reviewed actions */}
              {selectedEmail.reviewed && !isEmailMatched(selectedEmail) && (
                <div className="mb-4">
                  <button onClick={() => unmarkReviewed(selectedEmail.id).then(() => showToast('Moved back', 'success')).catch(() => showToast('Failed', 'error'))}
                    className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 flex items-center gap-1.5">
                    <Icon name="Inbox" size={12} /> Move back to Unmatched
                  </button>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-gray-100 my-4" />

              {/* Email body */}
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{selectedEmail.body_text}</pre>

              {/* Auto-advanced */}
              {selectedEmail.auto_advanced && (
                <div className="mt-5 flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
                  <Icon name="CheckCircle" size={14} />
                  <span>Auto-advanced the order stage</span>
                </div>
              )}

              {/* AI summary */}
              {selectedEmail.ai_summary && (
                <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  <Icon name="Zap" size={14} className="flex-shrink-0 mt-0.5 text-amber-500" />
                  <span>{selectedEmail.ai_summary}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Icon name="Mail" size={28} className="text-gray-200" />
                </div>
                <p className="text-sm text-gray-400">Select an email to read</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Link Email Modal */}
      {linkingEmail && (
        <LinkEmailModal orders={orderOptions} onLink={handleLink} onClose={() => setLinkingEmail(null)} />
      )}
    </div>
  );
}

export default MailboxPage;
