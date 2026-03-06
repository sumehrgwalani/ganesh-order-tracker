import { useState, useRef, useEffect } from 'react';
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

function MailboxPage({ orgId, orders, userId }: Props) {
  const navigate = useNavigate();
  const { matchedEmails, unmatchedEmails, suggestedEmails, reviewedEmails, loading, linkEmailToOrder, unlinkEmail, dismissEmail, markReviewed, unmarkReviewed, refetch } = useSyncedEmails(orgId);
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'matched' | 'conversations' | 'reviewed'>('matched');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [linkingEmail, setLinkingEmail] = useState<SyncedEmail | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const readingPaneRef = useRef<HTMLDivElement>(null);

  // Two-phase sync state
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
      showToast(err instanceof Error ? err.message : 'Failed to dismiss email', 'error');
    }
  };

  const handleUnlink = async (email: SyncedEmail) => {
    try {
      await unlinkEmail(email.id);
      showToast('Email delinked from order', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delink email', 'error');
    }
  };

  const orderOptions = orders.map((o) => ({
    id: o.id,
    poNumber: o.poNumber || o.id,
    company: o.company,
    product: o.product,
  }));

  const handleLink = async (orderId: string, orderPoNumber: string, note: string) => {
    if (!linkingEmail) return;
    try {
      const originalAiMatch = linkingEmail.matched_order_id || null;
      if (linkingEmail.matched_order_id) {
        await unlinkEmail(linkingEmail.id);
      }
      await linkEmailToOrder(linkingEmail.id, orderId, orderPoNumber, note, originalAiMatch);
      showToast('Email linked to order', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to link email', 'error');
      throw err;
    }
  };

  const handleQuickSync = async () => {
    if (!orgId || !userId) return;
    try {
      setSyncPhase('pulling');
      setSyncProgress('Fetching latest emails...');
      let pullDone = false;
      let totalPulled = 0;
      let pullRound = 0;
      while (!pullDone && pullRound < 3) {
        pullRound++;
        const { data: pullData, error: pullError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'pull' });
        if (pullError) throw pullError;
        totalPulled += pullData?.synced || 0;
        const pending = pullData?.pendingDownload || 0;
        setSyncProgress(pending > 0 ? `Downloaded ${totalPulled} emails (${pending} remaining)...` : `Pulled ${totalPulled} new emails`);
        pullDone = pullData?.done !== false || (pullData?.synced || 0) === 0;
        if (!pullDone) await new Promise((r) => setTimeout(r, 500));
      }
      if (totalPulled === 0) {
        setSyncPhase('done');
        setSyncProgress('No new emails found');
        showToast('No new emails to sync', 'info');
        refetch();
        setTimeout(() => { setSyncPhase('idle'); setSyncProgress(''); }, 3000);
        return;
      }
      setSyncPhase('matching');
      let matchBatch = 0;
      let totalMatched = 0;
      let matchDone = false;
      let sumRegex = 0, sumThread = 0, sumAI = 0, sumCreated = 0, sumTotalEmails = 0, sumDismissed = 0;
      while (!matchDone && matchBatch < 20) {
        matchBatch++;
        const { data: matchData, error: matchError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'match' });
        if (matchError) { console.error('Match error:', matchError); setSyncProgress(`Error matching emails: ${matchError.message}`); break; }
        const remaining = matchData?.remaining || 0;
        totalMatched = matchData?.totalMatched || 0;
        sumRegex += matchData?.regexMatched || 0;
        sumThread += matchData?.threadMatched || 0;
        sumAI += matchData?.aiMatched || 0;
        sumCreated += matchData?.created || 0;
        sumTotalEmails = matchData?.totalEmails || sumTotalEmails;
        sumDismissed = matchData?.dismissed || sumDismissed;
        setSyncProgress(remaining > 0 ? `Matching: ${remaining} emails remaining...` : `Matched ${totalMatched} emails`);
        setMatchProgress({ matched: totalMatched, remaining, total: matchData?.totalEmails || 0 });
        matchDone = matchData?.done === true || remaining === 0;
        if (!matchDone) await new Promise((r) => setTimeout(r, 1000));
      }
      setSyncPhase('reprocessing');
      let rpDone = false;
      let totalRp = 0;
      while (!rpDone && totalRp < 50) {
        const { data: rpData, error: rpError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'reprocess' });
        if (rpError) { console.error('Reprocess error:', rpError); break; }
        totalRp += rpData?.processed || 0;
        const rpRemaining = rpData?.remaining || 0;
        setSyncProgress(rpRemaining > 0 ? `Processing attachments: ${totalRp} done, ${rpRemaining} remaining...` : 'Attachments processed');
        rpDone = rpData?.done === true || rpRemaining === 0;
        if (!rpDone) await new Promise((r) => setTimeout(r, 500));
      }
      setSyncPhase('extracting');
      let exDone = false;
      let totalEx = 0;
      while (!exDone && totalEx < 20) {
        const { data: exData, error: exError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'bulk-extract' });
        if (exError) { console.error('Extract error:', exError); break; }
        totalEx += exData?.batchProcessed || 0;
        const exRemaining = exData?.remaining || 0;
        setSyncProgress(exRemaining > 0 ? `Extracting line items: ${totalEx} done, ${exRemaining} remaining...` : 'Line items extracted');
        exDone = exData?.done === true || exRemaining === 0;
        if (!exDone) await new Promise((r) => setTimeout(r, 500));
      }
      setSyncPhase('done');
      setSyncProgress(`Quick sync done — ${totalPulled} new emails processed`);
      setSyncSummary({
        pulled: totalPulled, regexMatched: sumRegex, threadMatched: sumThread,
        aiMatched: sumAI, created: sumCreated, totalMatched, totalEmails: sumTotalEmails, dismissed: sumDismissed, recovered: 0,
      });
      refetch();
      setTimeout(() => { setSyncPhase('idle'); setSyncProgress(''); }, 15000);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Quick sync failed', 'error');
      setSyncPhase('idle');
      setSyncProgress('');
    }
  };

  const handleFullSync = async () => {
    if (!orgId || !userId) return;
    setSyncPhase('pulling');
    setSyncProgress('Downloading emails from Gmail...');
    try {
      let pullDone = false;
      let totalPulled = 0;
      let pullRound = 0;
      while (!pullDone && pullRound < 5) {
        pullRound++;
        const { data: pullData, error: pullError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'pull' });
        if (pullError) throw pullError;
        totalPulled += pullData?.synced || 0;
        const pending = pullData?.pendingDownload || 0;
        setSyncProgress(pending > 0 ? `Downloaded ${totalPulled} emails (${pending} remaining)...` : `Downloaded ${totalPulled} new emails`);
        pullDone = pullData?.done !== false || (pullData?.synced || 0) === 0;
        if (!pullDone) await new Promise((r) => setTimeout(r, 500));
      }
      showToast(`Phase 1 complete — ${totalPulled} emails downloaded`, 'success');

      setSyncPhase('matching');
      let batchNum = 0, isDone = false;
      let fSumRegex = 0, fSumThread = 0, fSumAI = 0, fSumCreated = 0, fSumTotalEmails = 0, fSumTotalMatched = 0, fSumDismissed = 0;
      while (!isDone && batchNum < 200) {
        batchNum++;
        const { data: matchData, error: matchError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'match' });
        if (matchError) throw matchError;
        const remaining = matchData?.remaining || 0;
        fSumRegex += matchData?.regexMatched || 0;
        fSumThread += matchData?.threadMatched || 0;
        fSumAI += matchData?.aiMatched || 0;
        fSumCreated += matchData?.created || 0;
        fSumTotalEmails = matchData?.totalEmails || fSumTotalEmails;
        fSumTotalMatched = matchData?.totalMatched || 0;
        fSumDismissed = matchData?.dismissed || fSumDismissed;
        setMatchProgress({ matched: fSumTotalMatched, remaining, total: fSumTotalEmails });
        setSyncProgress(remaining > 0 ? `AI matching batch ${batchNum}: ${fSumTotalMatched} matched, ${remaining} remaining...` : `Complete! ${fSumTotalMatched} emails matched`);
        if (matchData?.created > 0) showToast(`Discovered ${matchData.created} new orders`, 'success');
        isDone = matchData?.done === true || remaining === 0;
        if (!isDone) await new Promise((r) => setTimeout(r, 1000));
      }

      setSyncPhase('reprocessing');
      let reprocessDone = false, totalReprocessed = 0;
      while (!reprocessDone && totalReprocessed < 300) {
        const { data: rpData, error: rpError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'reprocess' });
        if (rpError) { console.error('Reprocess error:', rpError); break; }
        totalReprocessed += rpData?.processed || 0;
        const rpRemaining = rpData?.remaining || 0;
        setSyncProgress(rpRemaining > 0 ? `Processing attachments: ${totalReprocessed} done, ${rpRemaining} remaining...` : 'Attachments processed!');
        reprocessDone = rpData?.done === true || rpRemaining === 0;
        if (!reprocessDone) await new Promise((r) => setTimeout(r, 500));
      }

      setSyncPhase('extracting');
      let extractDone = false, totalExtracted = 0;
      while (!extractDone && totalExtracted < 200) {
        const { data: exData, error: exError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'bulk-extract' });
        if (exError) { console.error('Extract error:', exError); break; }
        totalExtracted += exData?.batchProcessed || 0;
        const exRemaining = exData?.remaining || 0;
        setSyncProgress(exRemaining > 0 ? `Extracting line items: ${totalExtracted} done, ${exRemaining} remaining...` : 'Line items extracted!');
        extractDone = exData?.done === true || exRemaining === 0;
        if (!extractDone) await new Promise((r) => setTimeout(r, 500));
      }

      setSyncPhase('recovering');
      setSyncProgress('Recovering missing order data...');
      let recoverDone = false, totalRecovered = 0;
      while (!recoverDone && totalRecovered < 50) {
        const { data: recData, error: recError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'recover' });
        if (recError) { console.error('Recover error:', recError); break; }
        totalRecovered += recData?.recovered || 0;
        const recRemaining = recData?.remaining || 0;
        setSyncProgress(recRemaining > 0 ? `Recovering: ${totalRecovered} done, ${recRemaining} remaining...` : totalRecovered > 0 ? `Recovered ${totalRecovered} orders!` : 'No recovery needed');
        recoverDone = recData?.done === true || recRemaining === 0;
        if (!recoverDone) await new Promise((r) => setTimeout(r, 500));
      }

      setSyncPhase('done');
      setSyncProgress('Full sync complete!');
      setSyncSummary({
        pulled: totalPulled, regexMatched: fSumRegex, threadMatched: fSumThread,
        aiMatched: fSumAI, created: fSumCreated, totalMatched: fSumTotalMatched,
        totalEmails: fSumTotalEmails, dismissed: fSumDismissed, recovered: totalRecovered,
      });
      refetch();
      setTimeout(() => { setSyncPhase('idle'); setSyncProgress(''); setSyncSummary(null); }, 15000);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Sync failed', 'error');
      setSyncPhase('idle');
      setSyncProgress('');
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatFullDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const getOrderLabel = (email: SyncedEmail) => {
    const orderId = email.matched_order_id || email.user_linked_order_id;
    if (!orderId) return null;
    const order = orders.find((o) => o.id === orderId);
    if (order) return `${order.poNumber || order.id} — ${order.company}`;
    return orderId;
  };

  const getSnippet = (body: string) => {
    if (!body) return '';
    // Strip common email noise and get first meaningful line
    const cleaned = body.replace(/^(>.*\n?)+/gm, '').replace(/\n{2,}/g, '\n').trim();
    const firstLine = cleaned.split('\n')[0] || '';
    return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
  };

  const tabEmails = activeTab === 'matched' ? matchedEmails : activeTab === 'conversations' ? unmatchedEmails : reviewedEmails;
  const currentEmails = searchTerm
    ? tabEmails.filter(e => {
        const q = searchTerm.toLowerCase();
        return (e.subject || '').toLowerCase().includes(q) ||
          (e.from_name || '').toLowerCase().includes(q) ||
          (e.from_email || '').toLowerCase().includes(q) ||
          (e.body_text || '').toLowerCase().includes(q) ||
          (e.matched_order_id || '').toLowerCase().includes(q) ||
          (e.user_linked_order_id || '').toLowerCase().includes(q);
      })
    : tabEmails;
  const isSyncing = syncPhase !== 'idle' && syncPhase !== 'done';

  const selectedEmail = currentEmails.find(e => e.id === selectedEmailId) || null;

  // Auto-select first email when tab changes
  useEffect(() => {
    if (currentEmails.length > 0 && !currentEmails.find(e => e.id === selectedEmailId)) {
      setSelectedEmailId(currentEmails[0].id);
    }
  }, [activeTab, currentEmails.length]);

  // Scroll reading pane to top when email changes
  useEffect(() => {
    if (readingPaneRef.current) {
      readingPaneRef.current.scrollTop = 0;
    }
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

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      <PageHeader
        title="Mailbox"
        subtitle="Email integration for order tracking"
        onBack={() => navigate('/')}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleQuickSync}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isSyncing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Icon name="Download" size={15} className={syncPhase === 'pulling' ? 'animate-bounce' : ''} />
              {syncPhase === 'pulling' ? 'Pulling...' : 'Quick Sync'}
            </button>
            <button
              onClick={handleFullSync}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isSyncing ? 'bg-blue-50 text-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <Icon name="RefreshCw" size={15} className={isSyncing && syncPhase !== 'pulling' ? 'animate-spin' : ''} />
              {syncPhase === 'matching' ? 'Matching...' : syncPhase === 'reprocessing' ? 'Processing...' : syncPhase === 'extracting' ? 'Extracting...' : syncPhase === 'recovering' ? 'Recovering...' : syncPhase === 'done' ? 'Done!' : 'Full Sync'}
            </button>
          </div>
        }
      />

      {/* Sync progress banner */}
      {syncPhase !== 'idle' && (
        <div className={`mb-3 rounded-xl px-4 py-3 flex items-center gap-3 flex-shrink-0 ${
          syncPhase === 'done' ? 'bg-green-50 border border-green-200' : 'bg-blue-50 border border-blue-200'
        }`}>
          {syncPhase !== 'done' && <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          {syncPhase === 'done' && <Icon name="CheckCircle" size={20} className="text-green-600 flex-shrink-0" />}
          <div className="flex-1">
            <p className={`text-sm font-medium ${syncPhase === 'done' ? 'text-green-800' : 'text-blue-800'}`}>{syncProgress}</p>
            {syncPhase === 'matching' && matchProgress.total > 0 && (
              <div className="mt-2">
                <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${Math.round(((matchProgress.total - matchProgress.remaining) / matchProgress.total) * 100)}%` }} />
                </div>
                <p className="text-xs text-blue-600 mt-1">{matchProgress.total - matchProgress.remaining} of {matchProgress.total} processed</p>
              </div>
            )}
            {syncPhase === 'done' && syncSummary && (
              <div className="mt-2 flex flex-wrap gap-2">
                {syncSummary.pulled > 0 && <span className="text-xs bg-white px-2 py-1 rounded border border-green-100"><strong className="text-green-700">{syncSummary.pulled}</strong> new</span>}
                {syncSummary.regexMatched > 0 && <span className="text-xs bg-white px-2 py-1 rounded border border-green-100"><strong className="text-blue-700">{syncSummary.regexMatched}</strong> by PO</span>}
                {syncSummary.threadMatched > 0 && <span className="text-xs bg-white px-2 py-1 rounded border border-green-100"><strong className="text-purple-700">{syncSummary.threadMatched}</strong> by thread</span>}
                {syncSummary.aiMatched > 0 && <span className="text-xs bg-white px-2 py-1 rounded border border-green-100"><strong className="text-amber-700">{syncSummary.aiMatched}</strong> by AI</span>}
                {syncSummary.created > 0 && <span className="text-xs bg-white px-2 py-1 rounded border border-green-100"><strong className="text-green-600">{syncSummary.created}</strong> orders created</span>}
                <span className="text-xs bg-white px-2 py-1 rounded border border-green-100"><strong className="text-gray-700">{syncSummary.totalMatched}/{syncSummary.totalEmails}</strong> total</span>
              </div>
            )}
          </div>
          {syncPhase === 'done' && (
            <button onClick={() => { setSyncPhase('idle'); setSyncProgress(''); setSyncSummary(null); }} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <Icon name="X" size={16} />
            </button>
          )}
        </div>
      )}

      {/* Tabs + Search row */}
      <div className="flex items-center gap-3 mb-3 flex-shrink-0">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {[
            { key: 'matched' as const, label: 'Inbox', count: matchedEmails.length, icon: 'Inbox' },
            { key: 'conversations' as const, label: 'Unmatched', count: unmatchedEmails.length, icon: 'MessageSquare' },
            { key: 'reviewed' as const, label: 'Reviewed', count: reviewedEmails.length, icon: 'CheckCircle' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === tab.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon name={tab.icon as any} size={14} />
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search emails..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <Icon name="X" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Split pane: Email list + Reading pane */}
      <div className="flex-1 flex gap-0 min-h-0 rounded-xl border border-gray-200 overflow-hidden bg-white">
        {/* Left: Email list */}
        <div className="w-[420px] flex-shrink-0 border-r border-gray-200 overflow-y-auto bg-white">
          {currentEmails.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <Icon name="Mail" size={24} className="text-gray-300" />
              </div>
              <p className="text-sm text-gray-500">
                {activeTab === 'matched' ? 'No matched emails yet' : activeTab === 'reviewed' ? 'No reviewed emails' : 'No unmatched conversations'}
              </p>
            </div>
          ) : (
            currentEmails.map((email) => {
              const isSelected = selectedEmailId === email.id;
              const orderLabel = getOrderLabel(email);
              const isUserLinked = !!email.user_linked_order_id;

              return (
                <button
                  key={email.id}
                  onClick={() => setSelectedEmailId(email.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                    isSelected
                      ? 'bg-blue-50 border-l-2 border-l-blue-500'
                      : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isSelected ? 'bg-blue-200' : 'bg-gray-100'
                    }`}>
                      <span className={`text-xs font-semibold ${isSelected ? 'text-blue-700' : 'text-gray-600'}`}>
                        {(email.from_name || email.from_email || '?')[0].toUpperCase()}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Row 1: Sender + Date */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-800 truncate">
                          {email.from_name || email.from_email}
                        </span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(email.date)}</span>
                      </div>

                      {/* Row 2: Subject + attachment icon */}
                      <div className="flex items-center gap-1 mt-0.5">
                        <p className="text-sm text-gray-700 truncate">{email.subject}</p>
                        {email.has_attachment && <Icon name="Paperclip" size={12} className="text-gray-400 flex-shrink-0" />}
                      </div>

                      {/* Row 3: Body snippet */}
                      <p className="text-xs text-gray-400 truncate mt-0.5">{getSnippet(email.body_text)}</p>

                      {/* Row 4: Order badge */}
                      {orderLabel && (
                        <div className="mt-1.5 flex items-center gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full truncate max-w-[280px] ${
                            isUserLinked
                              ? 'bg-green-50 text-green-700 border border-green-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}>
                            {isUserLinked && <Icon name="Link" size={10} className="inline mr-1" />}
                            {orderLabel}
                          </span>
                          {!isUserLinked && email.ai_confidence && (
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              email.ai_confidence === 'high' ? 'bg-green-500' :
                              email.ai_confidence === 'medium' ? 'bg-yellow-500' : 'bg-red-500'
                            }`} />
                          )}
                        </div>
                      )}

                      {/* Suggested match (conversations tab) */}
                      {!orderLabel && email.ai_suggested_order_id && activeTab === 'conversations' && (
                        <div className="mt-1.5">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">
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

        {/* Right: Reading pane */}
        <div ref={readingPaneRef} className="flex-1 overflow-y-auto">
          {selectedEmail ? (
            <div className="p-6">
              {/* Email header */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{selectedEmail.subject}</h2>

                <div className="flex items-start gap-3">
                  {/* Sender avatar */}
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-700 font-semibold">
                      {(selectedEmail.from_name || selectedEmail.from_email || '?')[0].toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-semibold text-gray-800">{selectedEmail.from_name || selectedEmail.from_email}</span>
                        <span className="text-sm text-gray-400 ml-2">&lt;{selectedEmail.from_email}&gt;</span>
                      </div>
                      <span className="text-xs text-gray-400">{formatFullDate(selectedEmail.date)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      To: {selectedEmail.to_email}
                      {selectedEmail.detected_stage && (
                        <span className="ml-3 text-blue-600">Stage {selectedEmail.detected_stage}</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Order link bar */}
                {getOrderLabel(selectedEmail) && (
                  <div className="mt-4 flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                    <Icon name="Package" size={14} className="text-blue-600" />
                    <span className="text-sm text-blue-700 font-medium">{getOrderLabel(selectedEmail)}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => {
                          const orderId = selectedEmail.matched_order_id || selectedEmail.user_linked_order_id;
                          if (orderId) navigate(`/orders/${encodeURIComponent(orderId)}`);
                        }}
                        className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-1"
                      >
                        <Icon name="ExternalLink" size={12} />
                        View Order
                      </button>
                      <button
                        onClick={() => setLinkingEmail(selectedEmail)}
                        className="text-xs px-2.5 py-1 bg-white text-orange-600 border border-orange-200 rounded-md hover:bg-orange-50 flex items-center gap-1"
                      >
                        <Icon name="RefreshCw" size={12} />
                        Reassign
                      </button>
                      <button
                        onClick={() => handleUnlink(selectedEmail)}
                        className="text-xs px-2.5 py-1 bg-white text-red-500 border border-red-200 rounded-md hover:bg-red-50 flex items-center gap-1"
                      >
                        <Icon name="X" size={12} />
                        Delink
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions for conversations/reviewed tabs */}
                {activeTab === 'conversations' && !getOrderLabel(selectedEmail) && (
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => setLinkingEmail(selectedEmail)}
                      className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                    >
                      <Icon name="Link" size={14} />
                      Link to Order
                    </button>
                    <button
                      onClick={() => markReviewed(selectedEmail.id).then(() => showToast('Moved to Reviewed', 'success')).catch(() => showToast('Failed', 'error'))}
                      className="text-sm px-4 py-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 flex items-center gap-2"
                    >
                      <Icon name="CheckCircle" size={14} />
                      Mark Reviewed
                    </button>
                    <button
                      onClick={() => handleDismiss(selectedEmail)}
                      className="text-sm px-4 py-2 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 flex items-center gap-2"
                    >
                      <Icon name="X" size={14} />
                      Not an order
                    </button>
                  </div>
                )}

                {activeTab === 'reviewed' && (
                  <div className="mt-4">
                    <button
                      onClick={() => unmarkReviewed(selectedEmail.id).then(() => showToast('Moved back', 'success')).catch(() => showToast('Failed', 'error'))}
                      className="text-sm px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 flex items-center gap-2"
                    >
                      <Icon name="Undo2" size={14} />
                      Move back to Unmatched
                    </button>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100 mb-4" />

              {/* Email body */}
              <div className="prose prose-sm max-w-none">
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-transparent p-0 m-0 border-none">
                  {selectedEmail.body_text}
                </pre>
              </div>

              {/* Auto-advanced badge */}
              {selectedEmail.auto_advanced && (
                <div className="mt-6 flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                  <Icon name="CheckCircle" size={16} />
                  <span>This email auto-advanced the order stage</span>
                </div>
              )}

              {/* AI summary */}
              {selectedEmail.ai_summary && (
                <div className="mt-4 flex items-start gap-2 text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  <Icon name="Zap" size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{selectedEmail.ai_summary}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <Icon name="Mail" size={48} className="mx-auto mb-3 text-gray-200" />
                <p className="text-sm">Select an email to read</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Link Email Modal */}
      {linkingEmail && (
        <LinkEmailModal
          orders={orderOptions}
          onLink={handleLink}
          onClose={() => setLinkingEmail(null)}
        />
      )}
    </div>
  );
}

export default MailboxPage;
