import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import LinkEmailModal from '../components/LinkEmailModal';
import { useSyncedEmails, SyncedEmail } from '../hooks/useSyncedEmails';
import { useToast } from '../components/Toast';
import { supabase } from '../lib/supabase';
import type { Order } from '../types';

interface Props {
  orgId: string | null;
  orders: Order[];
  userId?: string;
}

type SyncPhase = 'idle' | 'pulling' | 'matching' | 'done';

function MailboxPage({ orgId, orders, userId }: Props) {
  const navigate = useNavigate();
  const { matchedEmails, unmatchedEmails, loading, linkEmailToOrder, unlinkEmail, refetch } = useSyncedEmails(orgId);
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'matched' | 'conversations'>('matched');
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [linkingEmail, setLinkingEmail] = useState<SyncedEmail | null>(null);

  // Two-phase sync state
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle');
  const [syncProgress, setSyncProgress] = useState('');
  const [matchProgress, setMatchProgress] = useState({ matched: 0, remaining: 0, total: 0 });

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
      // If reassigning, clear old AI match first
      if (linkingEmail.matched_order_id) {
        await unlinkEmail(linkingEmail.id);
      }
      await linkEmailToOrder(linkingEmail.id, orderId, orderPoNumber, note);
      showToast('Email linked to order', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to link email', 'error');
      throw err;
    }
  };

  const handleFullSync = async () => {
    if (!orgId || !userId) return;

    // Phase 1: Pull emails from Gmail
    setSyncPhase('pulling');
    setSyncProgress('Downloading emails from Gmail...');

    try {
      const { data: pullData, error: pullError } = await supabase.functions.invoke('sync-emails', {
        body: { organization_id: orgId, user_id: userId, mode: 'pull' },
      });
      if (pullError) throw pullError;

      const pulled = pullData?.synced || 0;
      const total = pullData?.total || 0;
      setSyncProgress(`Downloaded ${pulled} new emails (${total} total)`);
      showToast(`Phase 1 complete — ${pulled} emails downloaded`, 'success');

      // Phase 2: AI matching in batches
      setSyncPhase('matching');
      let batchNum = 0;
      let isDone = false;

      const MAX_BATCHES = 50; // Safety limit to prevent infinite loops
      while (!isDone && batchNum < MAX_BATCHES) {
        batchNum++;
        const { data: matchData, error: matchError } = await supabase.functions.invoke('sync-emails', {
          body: { organization_id: orgId, user_id: userId, mode: 'match' },
        });
        if (matchError) throw matchError;

        const remaining = matchData?.remaining || 0;
        const totalEmails = matchData?.totalEmails || 0;
        const totalMatched = matchData?.totalMatched || 0;
        const created = matchData?.created || 0;

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

      setSyncPhase('done');
      showToast('Full sync complete!', 'success');
      refetch();

      // Reset after a few seconds
      setTimeout(() => {
        setSyncPhase('idle');
        setSyncProgress('');
      }, 5000);
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

  const currentEmails = activeTab === 'matched' ? matchedEmails : unmatchedEmails;
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
          <button
            onClick={handleFullSync}
            disabled={isSyncing}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isSyncing
                ? 'bg-blue-50 text-blue-600'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Icon name="RefreshCw" size={16} className={isSyncing ? 'animate-spin' : ''} />
            {syncPhase === 'pulling' ? 'Pulling...' : syncPhase === 'matching' ? 'Matching...' : syncPhase === 'done' ? 'Done!' : 'Full Sync'}
          </button>
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
          </div>
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
                    <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                      isUserLinked
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                    }`}>
                      {isUserLinked && <Icon name="Link" size={10} className="inline mr-1" />}
                      {orderLabel}
                    </span>
                  )}

                  {/* Link button (conversations tab) */}
                  {activeTab === 'conversations' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLinkingEmail(email);
                      }}
                      className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 flex-shrink-0 flex items-center gap-1"
                    >
                      <Icon name="Link" size={12} />
                      Link to Order
                    </button>
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

                      {/* AI Summary */}
                      {email.ai_summary && (
                        <div className="bg-blue-50 rounded-lg p-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Icon name="Sparkles" size={14} className="text-blue-600" />
                            <span className="text-xs font-medium text-blue-700">AI Summary</span>
                          </div>
                          <p className="text-sm text-blue-800">{email.ai_summary}</p>
                        </div>
                      )}

                      {/* Email body */}
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">
                          {email.body_text}
                        </p>
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
                        <button
                          onClick={() => setLinkingEmail(email)}
                          className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                        >
                          <Icon name="Link" size={14} />
                          Link to Order
                        </button>
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
