import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface SyncedEmail {
  id: string;
  gmail_id: string;
  from_email: string;
  from_name: string;
  to_email: string;
  subject: string;
  body_text: string;
  date: string;
  has_attachment: boolean;
  matched_order_id: string | null;
  detected_stage: number | null;
  ai_summary: string | null;
  ai_confidence: string | null;
  ai_suggested_order_id: string | null;
  auto_advanced: boolean;
  user_linked_order_id: string | null;
  user_link_note: string | null;
  user_linked_at: string | null;
  dismissed: boolean;
  reviewed: boolean;
  email_type: 'inbox' | 'sent' | 'draft';
}

export function useSyncedEmails(orgId: string | null) {
  const [emails, setEmails] = useState<SyncedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    if (!orgId) {
      setEmails([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('synced_emails')
        .select('*')
        .eq('organization_id', orgId)
        .order('date', { ascending: false });

      if (fetchError) throw fetchError;
      setEmails(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch emails');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  // Folder splits by email_type
  const inboxEmails = emails.filter(e => e.email_type !== 'sent' && e.email_type !== 'draft');
  const sentEmails = emails.filter(e => e.email_type === 'sent');
  const draftEmails = emails.filter(e => e.email_type === 'draft');

  // Status splits (work across all folders)
  const matchedEmails = emails.filter(
    (e) => e.matched_order_id || e.user_linked_order_id
  );
  const unmatchedEmails = emails.filter(
    (e) => !e.matched_order_id && !e.user_linked_order_id && !e.dismissed && !e.reviewed
  );
  const suggestedEmails = emails.filter(
    (e) => !e.matched_order_id && !e.user_linked_order_id && e.ai_suggested_order_id
  );
  const reviewedEmails = emails.filter(
    (e) => !e.matched_order_id && !e.user_linked_order_id && !e.dismissed && e.reviewed
  );

  // Link an unmatched email to an order
  const linkEmailToOrder = async (
    emailId: string,
    orderId: string,
    orderPoNumber: string,
    note?: string,
    originalAiMatch?: string | null
  ) => {
    const updateData: Record<string, unknown> = {
      user_linked_order_id: orderId,
      user_link_note: note || null,
      user_linked_at: new Date().toISOString(),
    };
    if (originalAiMatch) {
      updateData.ai_original_order_id = originalAiMatch;
    }
    const { error: updateError } = await supabase
      .from('synced_emails')
      .update(updateData)
      .eq('id', emailId);

    if (updateError) throw updateError;

    const email = emails.find((e) => e.id === emailId);
    if (email) {
      const { error: historyError } = await supabase
        .from('order_history')
        .insert({
          order_id: orderId,
          stage: email.detected_stage || 1,
          timestamp: email.date,
          from_address: email.from_email,
          to_address: email.to_email,
          subject: email.subject,
          body: email.body_text,
          has_attachment: email.has_attachment,
        });

      if (historyError) {
        console.error('Failed to create history entry:', historyError);
      }
    }

    setEmails((prev) =>
      prev.map((e) =>
        e.id === emailId
          ? {
              ...e,
              user_linked_order_id: orderId,
              user_link_note: note || null,
              user_linked_at: new Date().toISOString(),
            }
          : e
      )
    );
  };

  const unlinkEmail = async (emailId: string) => {
    const { error: updateError } = await supabase
      .from('synced_emails')
      .update({
        matched_order_id: null,
        detected_stage: null,
        ai_summary: null,
        auto_advanced: false,
        user_linked_order_id: null,
        user_link_note: null,
        user_linked_at: null,
      })
      .eq('id', emailId);

    if (updateError) throw updateError;

    setEmails((prev) =>
      prev.map((e) =>
        e.id === emailId
          ? {
              ...e,
              matched_order_id: null,
              detected_stage: null,
              ai_summary: null,
              auto_advanced: false,
              user_linked_order_id: null,
              user_link_note: null,
              user_linked_at: null,
            }
          : e
      )
    );
  };

  const markReviewed = async (emailId: string) => {
    const { error: updateError } = await supabase
      .from('synced_emails')
      .update({ reviewed: true })
      .eq('id', emailId);

    if (updateError) throw updateError;

    setEmails((prev) =>
      prev.map((e) =>
        e.id === emailId ? { ...e, reviewed: true } : e
      )
    );
  };

  const unmarkReviewed = async (emailId: string) => {
    const { error: updateError } = await supabase
      .from('synced_emails')
      .update({ reviewed: false })
      .eq('id', emailId);

    if (updateError) throw updateError;

    setEmails((prev) =>
      prev.map((e) =>
        e.id === emailId ? { ...e, reviewed: false } : e
      )
    );
  };

  const dismissEmail = async (emailId: string) => {
    const { error: updateError } = await supabase
      .from('synced_emails')
      .update({ dismissed: true })
      .eq('id', emailId);

    if (updateError) throw updateError;

    setEmails((prev) =>
      prev.map((e) =>
        e.id === emailId ? { ...e, dismissed: true } : e
      )
    );
  };

  return {
    emails,
    inboxEmails,
    sentEmails,
    draftEmails,
    matchedEmails,
    unmatchedEmails,
    suggestedEmails,
    reviewedEmails,
    loading,
    error,
    linkEmailToOrder,
    unlinkEmail,
    dismissEmail,
    markReviewed,
    unmarkReviewed,
    refetch: fetchEmails,
  };
}
