import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import LinkEmailModal from '../components/LinkEmailModal';
import { useSyncedEmails, SyncedEmail } from '../hooks/useSyncedEmails';
import { useToast } from '../components/Toast';
import { supabase } from '../lib/supabase';
import { apiCall } from '../utils/api';
import type { Order } from '../types';
import DOMPurify from 'dompurify';

interface Props {
  orgId: string | null;
  orders: Order[];
  userId?: string;
}

type SyncPhase = 'idle' | 'pulling' | 'matching' | 'reprocessing' | 'extracting' | 'recovering' | 'done';
type Folder = 'inbox' | 'sent' | 'drafts';
type Filter = 'all' | 'matched' | 'unmatched' | 'reviewed';

// ── Futuristic theme constants ──
const theme = {
  mainBg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
  cardBg: 'rgba(15, 23, 42, 0.6)',
  cardBorder: '1px solid rgba(56, 189, 248, 0.1)',
  cardBorderHover: 'rgba(56, 189, 248, 0.25)',
  outerBorder: '1px solid rgba(56, 189, 248, 0.15)',
  outerShadow: '0 0 30px rgba(56, 189, 248, 0.05), 0 4px 20px rgba(0,0,0,0.15)',
  glowLine: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.4), transparent)',
  iconGradient: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
  iconGlow: '0 0 12px rgba(59, 130, 246, 0.3)',
  activeBtn: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
  activeBtnGlow: '0 0 15px rgba(59, 130, 246, 0.25)',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textCyan: '#38bdf8',
  sidebarBg: 'rgba(15, 23, 42, 0.8)',
  listBg: 'rgba(15, 23, 42, 0.4)',
  divider: 'rgba(56, 189, 248, 0.08)',
  selectedRow: 'rgba(56, 189, 248, 0.08)',
  hoverRow: 'rgba(56, 189, 248, 0.04)',
};

// Renders HTML email content in a sandboxed iframe using srcdoc
function EmailHtmlRenderer({ html }: { html: string }) {
  // Sanitize the HTML to prevent XSS attacks
  const clean = useMemo(() => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b','i','em','strong','u','a','p','br','table','tr','td','th','thead','tbody','div','span','pre','code','blockquote','hr','img','ul','ol','li','h1','h2','h3','h4','h5','h6','font','center','small'],
    ALLOWED_ATTR: ['href','src','alt','title','width','height','style','class','colspan','rowspan','align','valign','color','bgcolor','border','cellpadding','cellspacing'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script','iframe','object','embed','form','input','button','select','textarea','link','meta'],
    FORBID_ATTR: ['onerror','onload','onclick','onmouseover','onfocus','onblur'],
  }), [html]);

  // Build the full HTML document for srcdoc
  const srcdoc = useMemo(() => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.6; color: #cbd5e1; background: transparent; margin: 0; padding: 0; word-wrap: break-word; overflow-wrap: break-word; }
a { color: #38bdf8; }
img { max-width: 100%; height: auto; }
table { max-width: 100%; border-collapse: collapse; }
td, th { padding: 4px 8px; }
blockquote { border-left: 3px solid rgba(56,189,248,0.2); margin: 8px 0; padding-left: 12px; color: #94a3b8; }
pre, code { background: rgba(15,23,42,0.5); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
hr { border: none; border-top: 1px solid rgba(56,189,248,0.08); margin: 16px 0; }
</style></head><body>${clean}</body></html>`, [clean]);

  return (
    <iframe
      srcDoc={srcdoc}
      sandbox=""
      style={{
        width: '100%', border: 'none', minHeight: 400, background: 'transparent',
      }}
      title="Email content"
    />
  );
}

function MailboxPage({ orgId, orders, userId }: Props) {
  const navigate = useNavigate();
  const { inboxEmails, sentEmails, draftEmails, matchedEmails, unmatchedEmails, reviewedEmails, loading, linkEmailToOrder, unlinkEmail, dismissEmail, markReviewed, unmarkReviewed, refetch } = useSyncedEmails(orgId);
  const { showToast } = useToast();

  const [activeFolder, setActiveFolder] = useState<Folder>('inbox');
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [linkingEmail, setLinkingEmail] = useState<SyncedEmail | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [hoveredEmailId, setHoveredEmailId] = useState<string | null>(null);
  const [hoveredFolder, setHoveredFolder] = useState<Folder | null>(null);
  const [hoveredFilter, setHoveredFilter] = useState<Filter | null>(null);
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
        // Still backfill HTML for existing emails even when no new ones
        setSyncProgress('Fetching rich email content...');
        let htmlDone = false, htmlRounds = 0;
        while (!htmlDone && htmlRounds < 5) {
          htmlRounds++;
          const { data: d } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'backfill-html' });
          htmlDone = d?.done === true || (d?.remaining || 0) === 0;
          if (!htmlDone) await new Promise(r => setTimeout(r, 500));
        }
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
      // Backfill HTML for emails missing it (runs silently in background)
      setSyncProgress('Fetching rich email content...');
      let htmlDone = false, htmlRounds = 0;
      while (!htmlDone && htmlRounds < 5) {
        htmlRounds++;
        const { data: d } = await apiCall('/api/sync-emails', { organization_id: orgId, user_id: userId, mode: 'backfill-html' });
        htmlDone = d?.done === true || (d?.remaining || 0) === 0;
        if (!htmlDone) await new Promise(r => setTimeout(r, 500));
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

  const folderMatchedCount = folderEmails.filter(e => e.matched_order_id || e.user_linked_order_id).length;
  const folderUnmatchedCount = folderEmails.filter(e => !e.matched_order_id && !e.user_linked_order_id && !e.dismissed && !e.reviewed).length;
  const folderReviewedCount = folderEmails.filter(e => e.reviewed && !e.matched_order_id && !e.user_linked_order_id).length;

  const isSyncing = syncPhase !== 'idle' && syncPhase !== 'done';
  const selectedEmail = filteredEmails.find(e => e.id === selectedEmailId) || null;

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
      <div style={{ background: theme.mainBg, minHeight: '100vh', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '80px' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: '3px solid rgba(56, 189, 248, 0.3)',
            borderTopColor: '#38bdf8',
            animation: 'spin 1s linear infinite',
          }} />
        </div>
      </div>
    );
  }

  const isEmailMatched = (e: SyncedEmail) => !!(e.matched_order_id || e.user_linked_order_id);
  const isEmailUnmatched = (e: SyncedEmail) => !e.matched_order_id && !e.user_linked_order_id && !e.dismissed && !e.reviewed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textMuted, padding: 4 }}>
            <Icon name="ChevronLeft" size={20} />
          </button>
          <div style={{
            width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme.iconGradient, boxShadow: theme.iconGlow,
          }}>
            <Icon name="Mail" size={18} className="text-white" />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: theme.textPrimary, margin: 0, letterSpacing: '-0.01em' }}>Mailbox</h1>
            <p style={{ fontSize: 11, color: theme.textMuted, margin: 0, marginTop: 1 }}>Email integration for order tracking</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={handleQuickSync} disabled={isSyncing} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
            border: theme.outerBorder, cursor: isSyncing ? 'default' : 'pointer',
            background: isSyncing ? 'rgba(15, 23, 42, 0.4)' : theme.cardBg,
            color: isSyncing ? theme.textMuted : theme.textSecondary,
            transition: 'all 0.2s',
          }}>
            <Icon name="Download" size={13} className={syncPhase === 'pulling' ? 'animate-bounce' : ''} />
            {syncPhase === 'pulling' ? 'Pulling...' : 'Quick Sync'}
          </button>
          <button onClick={handleFullSync} disabled={isSyncing} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
            border: 'none', cursor: isSyncing ? 'default' : 'pointer',
            background: isSyncing ? 'rgba(59, 130, 246, 0.2)' : theme.activeBtn,
            boxShadow: isSyncing ? 'none' : theme.activeBtnGlow,
            color: '#fff',
            transition: 'all 0.2s',
          }}>
            <Icon name="RefreshCw" size={13} className={isSyncing && syncPhase !== 'pulling' ? 'animate-spin' : ''} />
            {syncPhase === 'matching' ? 'Matching...' : syncPhase === 'reprocessing' ? 'Processing...' : syncPhase === 'extracting' ? 'Extracting...' : syncPhase === 'recovering' ? 'Recovering...' : syncPhase === 'done' ? 'Done!' : 'Full Sync'}
          </button>
        </div>
      </div>

      {/* ── Sync progress banner ── */}
      {syncPhase !== 'idle' && (
        <div style={{
          marginBottom: 12, borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          background: syncPhase === 'done' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(56, 189, 248, 0.06)',
          border: syncPhase === 'done' ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(56, 189, 248, 0.15)',
        }}>
          {syncPhase !== 'done' && <div style={{ width: 16, height: 16, border: '2px solid #38bdf8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
          {syncPhase === 'done' && <Icon name="CheckCircle" size={16} className="text-emerald-400" />}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: syncPhase === 'done' ? '#34d399' : theme.textCyan, margin: 0 }}>{syncProgress}</p>
            {syncPhase === 'matching' && matchProgress.total > 0 && (
              <div style={{ marginTop: 6, height: 3, background: 'rgba(56, 189, 248, 0.1)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4, transition: 'width 0.5s',
                  background: theme.iconGradient,
                  width: `${Math.round(((matchProgress.total - matchProgress.remaining) / matchProgress.total) * 100)}%`,
                }} />
              </div>
            )}
            {syncPhase === 'done' && syncSummary && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                {syncSummary.pulled > 0 && <span style={{ fontSize: 11, background: 'rgba(56, 189, 248, 0.08)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(56, 189, 248, 0.1)', color: theme.textCyan }}><b>{syncSummary.pulled}</b> new</span>}
                {syncSummary.totalMatched > 0 && <span style={{ fontSize: 11, background: 'rgba(56, 189, 248, 0.08)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(56, 189, 248, 0.1)', color: theme.textCyan }}><b>{syncSummary.totalMatched}</b>/{syncSummary.totalEmails} matched</span>}
                {syncSummary.created > 0 && <span style={{ fontSize: 11, background: 'rgba(16, 185, 129, 0.08)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(16, 185, 129, 0.15)', color: '#34d399' }}><b>{syncSummary.created}</b> orders created</span>}
              </div>
            )}
          </div>
          {syncPhase === 'done' && (
            <button onClick={() => { setSyncPhase('idle'); setSyncProgress(''); setSyncSummary(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textMuted, padding: 4 }}>
              <Icon name="X" size={14} />
            </button>
          )}
        </div>
      )}

      {/* ── Main layout ── */}
      <div style={{
        flex: 1, display: 'flex', minHeight: 0, borderRadius: 16, overflow: 'hidden', position: 'relative',
        border: theme.outerBorder, boxShadow: theme.outerShadow,
        background: theme.mainBg,
      }}>
        {/* Top glow line */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1, zIndex: 10,
          background: theme.glowLine,
        }} />

        {/* ── Folder sidebar ── */}
        <div style={{
          width: 180, flexShrink: 0, background: theme.sidebarBg, borderRight: `1px solid ${theme.divider}`,
          padding: '14px 0', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '0 14px', marginBottom: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Folders</p>
          </div>
          {([
            { key: 'inbox' as Folder, label: 'Inbox', icon: 'Inbox', count: inboxEmails.length },
            { key: 'sent' as Folder, label: 'Sent', icon: 'Send', count: sentEmails.length },
            { key: 'drafts' as Folder, label: 'Drafts', icon: 'Edit', count: draftEmails.length },
          ]).map(f => {
            const isActive = activeFolder === f.key;
            const isHovered = hoveredFolder === f.key;
            return (
              <button
                key={f.key}
                onClick={() => { setActiveFolder(f.key); setActiveFilter('all'); setSelectedEmailId(null); }}
                onMouseEnter={() => setHoveredFolder(f.key)}
                onMouseLeave={() => setHoveredFolder(null)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                  textAlign: 'left', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                  background: isActive ? 'rgba(56, 189, 248, 0.1)' : isHovered ? 'rgba(56, 189, 248, 0.04)' : 'transparent',
                  borderRight: isActive ? '2px solid #38bdf8' : '2px solid transparent',
                  color: isActive ? theme.textCyan : theme.textSecondary,
                }}
              >
                <Icon name={f.icon as any} size={16} />
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{f.label}</span>
                <span style={{
                  fontSize: 11, padding: '1px 7px', borderRadius: 10, minWidth: 24, textAlign: 'center',
                  background: isActive ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                  color: isActive ? theme.textCyan : theme.textMuted,
                }}>{f.count}</span>
              </button>
            );
          })}

          {/* Divider */}
          <div style={{ borderTop: `1px solid ${theme.divider}`, margin: '12px 14px' }} />

          {/* Status filters */}
          <div style={{ padding: '0 14px', marginBottom: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Status</p>
          </div>
          {([
            { key: 'all' as Filter, label: 'All Emails', count: folderEmails.length },
            { key: 'matched' as Filter, label: 'Matched', count: folderMatchedCount },
            { key: 'unmatched' as Filter, label: 'Unmatched', count: folderUnmatchedCount },
            { key: 'reviewed' as Filter, label: 'Reviewed', count: folderReviewedCount },
          ]).map(f => {
            const isActive = activeFilter === f.key;
            const isHovered = hoveredFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => { setActiveFilter(f.key); setSelectedEmailId(null); }}
                onMouseEnter={() => setHoveredFilter(f.key)}
                onMouseLeave={() => setHoveredFilter(null)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px',
                  textAlign: 'left', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                  background: isActive ? 'rgba(56, 189, 248, 0.06)' : isHovered ? 'rgba(56, 189, 248, 0.03)' : 'transparent',
                  color: isActive ? theme.textSecondary : theme.textMuted,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{f.label}</span>
                <span style={{ fontSize: 11, color: theme.textMuted }}>{f.count}</span>
              </button>
            );
          })}
        </div>

        {/* ── Email list ── */}
        <div style={{
          width: 380, flexShrink: 0, borderRight: `1px solid ${theme.divider}`, display: 'flex', flexDirection: 'column',
          background: theme.listBg,
        }}>
          {/* Search */}
          <div style={{ padding: 10, borderBottom: `1px solid ${theme.divider}` }}>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted }}>
                <Icon name="Search" size={13} />
              </div>
              <input
                type="text" placeholder="Search emails..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                style={{
                  width: '100%', paddingLeft: 32, paddingRight: 28, paddingTop: 7, paddingBottom: 7,
                  borderRadius: 8, fontSize: 12, border: theme.cardBorder,
                  background: theme.cardBg, color: theme.textPrimary, outline: 'none',
                }}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: theme.textMuted, padding: 2,
                }}>
                  <Icon name="X" size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Email rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredEmails.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', margin: '0 auto 12px',
                  background: 'rgba(56, 189, 248, 0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name="Mail" size={22} className="text-slate-600" />
                </div>
                <p style={{ fontSize: 12, color: theme.textMuted, margin: 0 }}>No emails in this view</p>
              </div>
            ) : (
              filteredEmails.map(email => {
                const isSelected = selectedEmailId === email.id;
                const isHovered = hoveredEmailId === email.id;
                const orderLabel = getOrderLabel(email);
                const isUserLinked = !!email.user_linked_order_id;
                const isSent = email.email_type === 'sent';

                return (
                  <button
                    key={email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                    onMouseEnter={() => setHoveredEmailId(email.id)}
                    onMouseLeave={() => setHoveredEmailId(null)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', cursor: 'pointer',
                      borderBottom: `1px solid ${theme.divider}`, transition: 'all 0.2s',
                      borderLeft: isSelected ? '3px solid #38bdf8' : '3px solid transparent',
                      background: isSelected ? theme.selectedRow : isHovered ? theme.hoverRow : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      {/* Avatar */}
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, fontSize: 12, fontWeight: 600,
                        background: isSelected ? theme.iconGradient : 'rgba(148, 163, 184, 0.1)',
                        color: isSelected ? '#fff' : theme.textMuted,
                        boxShadow: isSelected ? '0 0 8px rgba(59, 130, 246, 0.2)' : 'none',
                      }}>
                        {(email.from_name || email.from_email || '?')[0].toUpperCase()}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Sender + Date */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                          <span style={{
                            fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            fontWeight: isSelected ? 600 : 500,
                            color: isSelected ? theme.textCyan : theme.textPrimary,
                          }}>
                            {isSent ? `To: ${email.to_email?.split(',')[0]?.trim() || ''}` : (email.from_name || email.from_email)}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            {email.has_attachment && <Icon name="Paperclip" size={10} className="text-slate-500" />}
                            <span style={{ fontSize: 10, color: theme.textMuted }}>{formatDate(email.date)}</span>
                          </div>
                        </div>

                        {/* Subject */}
                        <p style={{
                          fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          marginTop: 2, margin: '2px 0 0',
                          color: isSelected ? 'rgba(56, 189, 248, 0.7)' : theme.textSecondary,
                        }}>{email.subject}</p>

                        {/* Snippet */}
                        <p style={{
                          fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          marginTop: 2, margin: '2px 0 0', color: theme.textMuted,
                        }}>{getSnippet(email.body_text)}</p>

                        {/* Order badge */}
                        {orderLabel && (
                          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{
                              fontSize: 10, padding: '2px 7px', borderRadius: 6,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260,
                              background: isUserLinked ? 'rgba(16, 185, 129, 0.1)' : 'rgba(56, 189, 248, 0.08)',
                              color: isUserLinked ? '#34d399' : theme.textCyan,
                              border: isUserLinked ? '1px solid rgba(16, 185, 129, 0.15)' : '1px solid rgba(56, 189, 248, 0.1)',
                            }}>{orderLabel}</span>
                            {!isUserLinked && email.ai_confidence && (
                              <span style={{
                                width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                                background: email.ai_confidence === 'high' ? '#22c55e' : email.ai_confidence === 'medium' ? '#eab308' : '#ef4444',
                                boxShadow: `0 0 4px ${email.ai_confidence === 'high' ? 'rgba(34,197,94,0.3)' : email.ai_confidence === 'medium' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.3)'}`,
                              }} />
                            )}
                          </div>
                        )}
                        {!orderLabel && email.ai_suggested_order_id && (
                          <div style={{ marginTop: 5 }}>
                            <span style={{
                              fontSize: 10, padding: '2px 7px', borderRadius: 6,
                              background: 'rgba(249, 115, 22, 0.08)', color: '#fb923c',
                              border: '1px solid rgba(249, 115, 22, 0.12)',
                            }}>
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

        {/* ── Reading pane ── */}
        <div ref={readingPaneRef} style={{ flex: 1, overflowY: 'auto', background: 'rgba(15, 23, 42, 0.3)' }}>
          {selectedEmail ? (
            <div style={{ padding: 28 }}>
              {/* Subject */}
              <h2 style={{ fontSize: 17, fontWeight: 600, color: theme.textPrimary, margin: '0 0 20px', lineHeight: 1.4, letterSpacing: '-0.01em' }}>{selectedEmail.subject}</h2>

              {/* Sender info */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, color: '#fff', fontWeight: 600,
                  background: theme.iconGradient, boxShadow: theme.iconGlow,
                }}>
                  {(selectedEmail.from_name || selectedEmail.from_email || '?')[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: theme.textPrimary }}>{selectedEmail.from_name || selectedEmail.from_email}</span>
                      <span style={{ fontSize: 12, color: theme.textMuted, marginLeft: 8 }}>&lt;{selectedEmail.from_email}&gt;</span>
                    </div>
                    <span style={{ fontSize: 11, color: theme.textMuted, flexShrink: 0, marginLeft: 12 }}>{formatFullDate(selectedEmail.date)}</span>
                  </div>
                  <p style={{ fontSize: 12, color: theme.textMuted, margin: '3px 0 0' }}>
                    To: {selectedEmail.to_email}
                    {selectedEmail.detected_stage && (
                      <span style={{
                        marginLeft: 8, padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 500,
                        background: 'rgba(56, 189, 248, 0.08)', color: theme.textCyan,
                        border: '1px solid rgba(56, 189, 248, 0.1)',
                      }}>Stage {selectedEmail.detected_stage}</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Order link bar */}
              {getOrderLabel(selectedEmail) && (
                <div style={{
                  marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
                  borderRadius: 10, padding: '8px 14px',
                  background: 'rgba(56, 189, 248, 0.04)',
                  border: '1px solid rgba(56, 189, 248, 0.12)',
                }}>
                  <Icon name="Package" size={14} className="text-sky-400" />
                  <span style={{ fontSize: 13, color: theme.textCyan, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getOrderLabel(selectedEmail)}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => { const oid = selectedEmail.matched_order_id || selectedEmail.user_linked_order_id; if (oid) navigate(`/orders/${encodeURIComponent(oid)}`); }}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: theme.activeBtn, color: '#fff', display: 'flex', alignItems: 'center', gap: 4,
                        boxShadow: '0 0 8px rgba(59, 130, 246, 0.2)',
                      }}>
                      <Icon name="ExternalLink" size={10} /> View
                    </button>
                    <button onClick={() => setLinkingEmail(selectedEmail)}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                        background: 'rgba(249, 115, 22, 0.08)', color: '#fb923c',
                        border: '1px solid rgba(249, 115, 22, 0.15)', display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                      <Icon name="RefreshCw" size={10} /> Reassign
                    </button>
                    <button onClick={() => handleUnlink(selectedEmail)}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                        background: 'rgba(239, 68, 68, 0.06)', color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                      <Icon name="X" size={10} /> Delink
                    </button>
                  </div>
                </div>
              )}

              {/* Actions for unmatched */}
              {isEmailUnmatched(selectedEmail) && (
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={() => setLinkingEmail(selectedEmail)}
                    style={{
                      fontSize: 12, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: theme.activeBtn, color: '#fff', display: 'flex', alignItems: 'center', gap: 6,
                      boxShadow: theme.activeBtnGlow,
                    }}>
                    <Icon name="Link" size={12} /> Link to Order
                  </button>
                  <button onClick={() => markReviewed(selectedEmail.id).then(() => showToast('Moved to Reviewed', 'success')).catch(() => showToast('Failed', 'error'))}
                    style={{
                      fontSize: 12, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(16, 185, 129, 0.08)', color: '#34d399',
                      border: '1px solid rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                    <Icon name="CheckCircle" size={12} /> Reviewed
                  </button>
                  <button onClick={() => handleDismiss(selectedEmail)}
                    style={{
                      fontSize: 12, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(148, 163, 184, 0.06)', color: theme.textMuted,
                      border: `1px solid ${theme.divider}`, display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                    <Icon name="X" size={12} /> Dismiss
                  </button>
                </div>
              )}

              {/* Reviewed actions */}
              {selectedEmail.reviewed && !isEmailMatched(selectedEmail) && (
                <div style={{ marginBottom: 16 }}>
                  <button onClick={() => unmarkReviewed(selectedEmail.id).then(() => showToast('Moved back', 'success')).catch(() => showToast('Failed', 'error'))}
                    style={{
                      fontSize: 12, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(148, 163, 184, 0.06)', color: theme.textSecondary,
                      border: `1px solid ${theme.divider}`, display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                    <Icon name="Inbox" size={12} /> Move back to Unmatched
                  </button>
                </div>
              )}

              {/* Divider */}
              <div style={{ borderTop: `1px solid ${theme.divider}`, margin: '16px 0' }} />

              {/* Email body */}
              {selectedEmail.body_html ? (
                <EmailHtmlRenderer html={selectedEmail.body_html} />
              ) : (
                <pre style={{
                  fontSize: 13, color: theme.textSecondary, whiteSpace: 'pre-wrap', fontFamily: 'inherit',
                  lineHeight: 1.7, margin: 0,
                }}>{selectedEmail.body_text}</pre>
              )}

              {/* Auto-advanced */}
              {selectedEmail.auto_advanced && (
                <div style={{
                  marginTop: 20, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                  padding: '8px 14px', borderRadius: 10,
                  background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.12)', color: '#34d399',
                }}>
                  <Icon name="CheckCircle" size={14} />
                  <span>Auto-advanced the order stage</span>
                </div>
              )}

              {/* AI summary */}
              {selectedEmail.ai_summary && (
                <div style={{
                  marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: 'rgba(56, 189, 248, 0.04)', border: '1px solid rgba(56, 189, 248, 0.08)', color: theme.textSecondary,
                }}>
                  <div style={{ flexShrink: 0, marginTop: 1 }}>
                    <Icon name="Zap" size={14} className="text-amber-400" />
                  </div>
                  <span>{selectedEmail.ai_summary}</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px',
                  background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.08)',
                }}>
                  <Icon name="Mail" size={28} className="text-slate-600" />
                </div>
                <p style={{ fontSize: 13, color: theme.textMuted, margin: 0 }}>Select an email to read</p>
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
