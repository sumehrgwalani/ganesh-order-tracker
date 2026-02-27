import { useState } from 'react';
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

type SyncPhase = 'idle' | 'pulling' | 'matching' | 'reprocessing' | 'extracting' | 'done';

function MailboxPage({ orgId, orders, userId }: Props) {
  const navigate = useNavigate();
  const { matchedEmails, unmatchedEmails, suggestedEmails, loading, linkEmailToOrder, unlinkEmail, dismissEmail, refetch } = useSyncedEmails(orgId);
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'matched' | 'conversations'>('matched');
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [linkingEmail, setLinkingEmail] = useState<SyncedEmail | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Two-phase sync state
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle');
  const [syncProgress, setSyncProgress] = useState('');
  const [matchProgress, setMatchProgress] = useState({ matched: 0, remaining: 0, total: 0 });
  const [syncSummary, setSyncSummary] = useState<{
    pulled: number; regexMatched: number; threadMatched: number; aiMatched: number;
    created: number; totalMatched: number; totalEmails: number; dismissed: number;
  } | null>(null);

  const handleDismiss = async (email: SyncedEmail) => {
    try {
      await dismissEmail(email.id);
      showToast('Email dismissed — it won\'t appear again', 'success');
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

  // Build order options for the link modal
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
      // If reassigning, clear old AI match first
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
      // Phase 1: Pull latest emails
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

      // Phase 2: Match new emails to orders
      setSyncPhase('matching');
      let matchBatch = 0;
      let totalMatched = 0;
      let matchDone = false;
      let sumRegex = 0, sumThread = 0, sumAI = 0, sumCreated = 0, sumTotalEmails = 0, sumDismissed = 0;
      while (!matchDone && matchBatch < 20) {
        matchBatch++;
        const { data: matchData, error: matchError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'match' });
        if (matchError) { console.error('Match error:', matchError); break; }
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

      // Phase 3: Process attachments for new emails
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

      // Phase 4: Extract line items from new POs
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
        aiMatched: sumAI, created: sumCreated, totalMatched, totalEmails: sumTotalEmails, dismissed: sumDismissed,
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

    // Phase 1: Pull emails from Gmail
    setSyncPhase('pulling');
    setSyncProgress('Downloading emails from Gmail...');

    try {
      // Pull loops until all emails are downloaded (400 per call with 300s timeout)
      let pullDone = false;
      let totalPulled = 0;
      let pullRound = 0;
      const MAX_PULL_ROUNDS = 5;
      while (!pullDone && pullRound < MAX_PULL_ROUNDS) {
        pullRound++;
        const { data: pullData, error: pullError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'pull' });
        if (pullError) throw pullError;
        totalPulled += pullData?.synced || 0;
        const total = pullData?.total || 0;
        const pending = pullData?.pendingDownload || 0;
        setSyncProgress(pending > 0 ? `Downloaded ${totalPulled} emails so far (${pending} remaining)...` : `Downloaded ${totalPulled} new emails (${total} total)`);
        pullDone = pullData?.done !== false || (pullData?.synced || 0) === 0;
        if (!pullDone) await new Promise((r) => setTimeout(r, 500));
      }
      showToast(`Phase 1 complete — ${totalPulled} emails downloaded`, 'success');

      // Phase 2: AI matching in batches
      setSyncPhase('matching');
      let batchNum = 0;
      let isDone = false;
      let fSumRegex = 0, fSumThread = 0, fSumAI = 0, fSumCreated = 0, fSumTotalEmails = 0, fSumTotalMatched = 0, fSumDismissed = 0;

      const MAX_BATCHES = 200; // Safety limit to prevent infinite loops
      while (!isDone && batchNum < MAX_BATCHES) {
        batchNum++;
        const { data: matchData, error: matchError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'match' });
        if (matchError) throw matchError;

        const remaining = matchData?.remaining || 0;
        const totalEmails = matchData?.totalEmails || 0;
        const totalMatched = matchData?.totalMatched || 0;
        const created = matchData?.created || 0;
        fSumRegex += matchData?.regexMatched || 0;
        fSumThread += matchData?.threadMatched || 0;
        fSumAI += matchData?.aiMatched || 0;
        fSumCreated += created;
        fSumTotalEmails = totalEmails;
        fSumTotalMatched = totalMatched;
        fSumDismissed = matchData?.dismissed || fSumDismissed;

        setMatchProgress({ matched: totalMatched, remaining, total: totalEmails });
        setSyncProgress(
          remaining > 0
            ? `AI matching batch ${batchNum}: ${totalMatched} matched, ${remaining} remaining...`
            : `Complete! ${totalMatched} emails matched to orders`
        );

        if (matchData?.message) {
          showToast(matchData.message, 'info');
        }

        if (created > 0) {
          showToast(`Discovered ${created} new orders from emails`, 'success');
        }

        isDone = matchData?.done === true || remaining === 0;

        if (!isDone) {
          // Small delay between batches
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Phase 3: Reprocess attachments (download + classify + upload, 5 emails per call)
      setSyncPhase('reprocessing');
      let reprocessDone = false;
      let totalReprocessed = 0;
      const MAX_REPROCESS = 300;

      while (!reprocessDone && totalReprocessed < MAX_REPROCESS) {
        const { data: rpData, error: rpError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'reprocess' });
        if (rpError) { console.error('Reprocess error:', rpError); break; }

        totalReprocessed += rpData?.processed || 0;
        const rpRemaining = rpData?.remaining || 0;
        setSyncProgress(
          rpRemaining > 0
            ? `Processing attachments: ${totalReprocessed} done, ${rpRemaining} remaining...`
            : `Attachments processed!`
        );

        reprocessDone = rpData?.done === true || rpRemaining === 0;
        if (!reprocessDone) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // Phase 4: Extract line items from PO attachments (3 orders per call)
      setSyncPhase('extracting');
      let extractDone = false;
      let totalExtracted = 0;
      const MAX_EXTRACT = 200;

      while (!extractDone && totalExtracted < MAX_EXTRACT) {
        const { data: exData, error: exError } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'bulk-extract' });
        if (exError) { console.error('Extract error:', exError); break; }

        totalExtracted += exData?.batchProcessed || 0;
        const exRemaining = exData?.remaining || 0;
        setSyncProgress(
          exRemaining > 0
            ? `Extracting line items: ${totalExtracted} done, ${exRemaining} remaining...`
            : `Line items extracted!`
        );

        extractDone = exData?.done === true || exRemaining === 0;
        if (!extractDone) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      setSyncPhase('done');
      setSyncProgress('Full sync complete!');
      setSyncSummary({
        pulled: totalPulled, regexMatched: fSumRegex, threadMatched: fSumThread,
        aiMatched: fSumAI, created: fSumCreated, totalMatched: fSumTotalMatched,
        totalEmails: fSumTotalEmails, dismissed: fSumDismissed,
      });
      refetch();

      // Reset after 15 seconds (longer so user can read summary)
      setTimeout(() => {
        setSyncPhase('idle');
        setSyncProgress('');
        setSyncSummary(null);
      }, 15000);
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
    if (diffDays === 0) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getOrderLabel = (email: SyncedEmail) => {
    const orderId = email.matched_order_id || email.user_linked_order_id;
    if (!orderId) return null;
    const order = orders.find((o) => o.id === orderId);
    if (order) return `${order.poNumber || order.id} — ${order.company}`;
    return orderId;
  };

  const tabEmails = activeTab === 'matched' ? matchedEmails : unmatchedEmails;
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
    <div>
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
                isSyncing
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Icon name="Download" size={15} className={syncPhase === 'pulling' ? 'animate-bounce' : ''} />
              {syncPhase === 'pulling' ? 'Pulling...' : 'Quick Sync'}
            </button>
            <button
              onClick={handleFullSync}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isSyncing
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <Icon name="RefreshCw" size={15} className={isSyncing && syncPhase !== 'pulling' ? 'animate-spin' : ''} />
              {syncPhase === 'matching' ? 'Matching...' : syncPhase === 'reprocessing' ? 'Processing...' : syncPhase === 'extracting' ? 'Extracting...' : syncPhase === 'done' ? 'Done!' : 'Full Sync'}
            </button>
          </div>
        }
      />

      {/* Sync progress banner */}
      {syncPhase !== 'idle' && (
        <div className={`mb-4 rounded-xl px-4 py-3 flex items-center gap-3 ${
          syncPhase === 'done' ? 'bg-green-50 border border-green-200' : 'bg-blue-50 border border-blue-200'
        }`}>
          {syncPhase !== 'done' && (
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          {syncPhase === 'done' && <Icon name="CheckCircle" size={20} className="text-green-600 flex-shrink-0" />}
          <div className="flex-1">
            <p className={`text-sm font-medium ${syncPhase === 'done' ? 'text-green-800' : 'text-blue-800'}`}>
              {syncProgress}
            </p>
            {/* Progress bar during matching */}
            {syncPhase === 'matching' && matchProgress.total > 0 && (
              <div className="mt-2">
                <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round(((matchProgress.total - matchProgress.remaining) / matchProgress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-blue-600 mt-1">
                  {matchProgress.total - matchProgress.remaining} of {matchProgress.total} processed
                </p>
              </div>
            )}
            {/* Sync results summary */}
            {syncPhase === 'done' && syncSummary && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {syncSummary.pulled > 0 && (
                  <div className="bg-white rounded-lg px-3 py-2 border border-green-100">
                    <p className="text-lg font-bold text-green-700">{syncSummary.pulled}</p>
                    <p className="text-xs text-gray-500">New emails</p>
                  </div>
                )}
                {syncSummary.regexMatched > 0 && (
                  <div className="bg-white rounded-lg px-3 py-2 border border-green-100">
                    <p className="text-lg font-bold text-blue-700">{syncSummary.regexMatched}</p>
                    <p className="text-xs text-gray-500">By PO number</p>
                  </div>
                )}
                {syncSummary.threadMatched > 0 && (
                  <div className="bg-white rounded-lg px-3 py-2 border border-green-100">
                    <p className="text-lg font-bold text-purple-700">{syncSummary.threadMatched}</p>
                    <p className="text-xs text-gray-500">By thread</p>
                  </div>
                )}
                {syncSummary.aiMatched > 0 && (
                  <div className="bg-white rounded-lg px-3 py-2 border border-green-100">
                    <p className="text-lg font-bold text-amber-700">{syncSummary.aiMatched}</p>
                    <p className="text-xs text-gray-500">By AI</p>
                  </div>
                )}
                {syncSummary.created > 0 && (
                  <div className="bg-white rounded-lg px-3 py-2 border border-green-100">
                    <p className="text-lg font-bold text-green-600">{syncSummary.created}</p>
                    <p className="text-xs text-gray-500">Orders created</p>
                  </div>
                )}
                <div className="bg-white rounded-lg px-3 py-2 border border-green-100">
                  <p className="text-lg font-bold text-gray-700">{syncSummary.totalMatched}/{syncSummary.totalEmails}</p>
                  <p className="text-xs text-gray-500">Total matched</p>
                </div>
                {syncSummary.dismissed > 0 && (
                  <div className="bg-white rounded-lg px-3 py-2 border border-green-100">
                    <p className="text-lg font-bold text-gray-400">{syncSummary.dismissed}</p>
                    <p className="text-xs text-gray-500">Dismissed</p>
                  </div>
                )}
              </div>
            )}
          </div>
          {syncPhase === 'done' && syncSummary && (
            <button onClick={() => { setSyncPhase('idle'); setSyncProgress(''); setSyncSummary(null); }} className="text-gray-400 hover:text-gray-600 flex-shrink-0 self-start mt-1">
              <Icon name="X" size={16} />
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('matched')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'matched' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Matched
          <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
            {matchedEmails.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('conversations')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'conversations' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Conversations
          <span className="ml-1.5 text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
            {unmatchedEmails.length}
          </span>
        </button>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search emails by subject, sender, content, or order..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <Icon name="X" size={14} />
          </button>
        )}
      </div>

      {/* Email list */}
      {currentEmails.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name={activeTab === 'matched' ? 'FileText' : 'MessageSquare'} size={32} className="text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {activeTab === 'matched' ? 'No matched emails yet' : 'No conversations'}
          </h3>
          <p className="text-gray-500 text-sm">
            {activeTab === 'matched'
              ? 'Click "Full Sync" to pull emails from Gmail and match them to orders.'
              : 'General emails that don\'t match any order will show up here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {currentEmails.map((email) => {
            const isExpanded = expandedEmail === email.id;
            const orderLabel = getOrderLabel(email);
            const isUserLinked = !!email.user_linked_order_id;

            return (
              <div key={email.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* Compact row */}
                <button
                  onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-700 text-sm font-medium">
                      {(email.from_name || email.from_email || '?')[0].toUpperCase()}
                    </span>
                  </div>

                  {/* Sender + subject */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {email.from_name || email.from_email}
                      </span>
                      {email.has_attachment && (
                        <Icon name="Paperclip" size={14} className="text-gray-400 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-gray-500 truncate">{email.subject}</p>
                  </div>

                  {/* Order badge (matched tab) */}
                  {orderLabel && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        isUserLinked
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}>
                        {isUserLinked && <Icon name="Link" size={10} className="inline mr-1" />}
                        {orderLabel}
                      </span>
                      {!isUserLinked && email.ai_confidence && (
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          email.ai_confidence === 'high' ? 'bg-green-500' :
                          email.ai_confidence === 'medium' ? 'bg-yellow-500' : 'bg-red-500'
                        }`} title={`AI confidence: ${email.ai_confidence}`} />
                      )}
                    </div>
                  )}

                  {/* Suggested match badge (low confidence, in conversations tab) */}
                  {!orderLabel && email.ai_suggested_order_id && activeTab === 'conversations' && (
                    <span className="text-xs px-2 py-1 rounded-full flex-shrink-0 bg-orange-50 text-orange-700 border border-orange-200">
                      Suggested: {orders.find(o => o.id === email.ai_suggested_order_id)?.poNumber || email.ai_suggested_order_id}
                    </span>
                  )}

                  {/* Link + Dismiss buttons (conversations tab) */}
                  {activeTab === 'conversations' && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLinkingEmail(email);
                        }}
                        className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 flex-shrink-0 flex items-center gap-1"
                      >
                        <Icon name="Link" size={12} />
                        Link
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDismiss(email);
                        }}
                        className="text-xs px-2 py-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg flex-shrink-0 flex items-center gap-1"
                        title="Not an order email — dismiss"
                      >
                        <Icon name="X" size={12} />
                      </button>
                    </>
                  )}

                  {/* Date */}
                  <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                    {formatDate(email.date)}
                  </span>

                  <Icon
                    name="ChevronRight"
                    size={16}
                    className={`text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-50">
                    <div className="mt-3 space-y-3">
                      {/* Email details */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                        <div>
                          <span className="font-medium text-gray-600">From:</span> {email.from_name || ''} &lt;{email.from_email}&gt;
                        </div>
                        <div>
                          <span className="font-medium text-gray-600">To:</span> {email.to_email}
                        </div>
                        <div>
                          <span className="font-medium text-gray-600">Date:</span>{' '}
                          {new Date(email.date).toLocaleString()}
                        </div>
                        {email.detected_stage && (
                          <div>
                            <span className="font-medium text-gray-600">Detected Stage:</span> {email.detected_stage}
                          </div>
                        )}
                      </div>

                      {/* Full email body */}
                      <div className="bg-gray-50 rounded-lg p-3">
                        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                          {email.body_text}
                        </pre>
                      </div>

                      {/* Auto-advanced badge */}
                      {email.auto_advanced && (
                        <div className="flex items-center gap-1.5 text-xs text-green-700">
                          <Icon name="CheckCircle" size={14} />
                          <span>Auto-advanced order stage</span>
                        </div>
                      )}

                      {/* Actions for conversations tab */}
                      {activeTab === 'conversations' && (
                        <div className="flex items-center gap-2">
                        <button
                          onClick={() => setLinkingEmail(email)}
                          className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                        >
                          <Icon name="Link" size={14} />
                          Link to Order
                        </button>
                        <button
                          onClick={() => handleDismiss(email)}
                          className="text-sm px-4 py-2 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 flex items-center gap-2"
                        >
                          <Icon name="X" size={14} />
                          Not an order
                        </button>
                        </div>
                      )}

                      {/* Actions for matched tab: View, Reassign, Delink */}
                      {orderLabel && (
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => {
                              const orderId = email.matched_order_id || email.user_linked_order_id;
                              if (orderId) navigate(`/orders/${encodeURIComponent(orderId)}`);
                            }}
                            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            <Icon name="ExternalLink" size={14} />
                            View Order
                          </button>
                          <button
                            onClick={() => setLinkingEmail(email)}
                            className="text-sm text-orange-600 hover:text-orange-800 flex items-center gap-1"
                          >
                            <Icon name="RefreshCw" size={14} />
                            Reassign
                          </button>
                          <button
                            onClick={() => handleUnlink(email)}
                            className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1"
                          >
                            <Icon name="X" size={14} />
                            Delink
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
