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
  auto_advanced: boolean;
  user_linked_order_id: string | null;
  user_link_note: string | null;
  user_linked_at: string | null;
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

  // Split into matched and unmatched
  const matchedEmails = emails.filter(
    (e) => e.matched_order_id || e.user_linked_order_id
  );
  const unmatchedEmails = emails.filter(
    (e) => !e.matched_order_id && !e.user_linked_order_id
  );

  // Link an unmatched email to an order
  const linkEmailToOrder = async (
    emailId: string,
    orderId: string,
    orderPoNumber: string,
    note?: string
  ) => {
    // 1. Update synced_emails with user's link
    const { error: updateError } = await supabase
      .from('synced_emails')
      .update({
        user_linked_order_id: orderId,
        user_link_note: note || null,
        user_linked_at: new Date().toISOString(),
      })
      .eq('id', emailId);

    if (updateError) throw updateError;

    // 2. Find the email data to create a history entry
    const email = emails.find((e) => e.id === emailId);
    if (email) {
      // Create an order_history entry so it shows in the order timeline
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

    // 3. Update local state
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

  // Delink an email from its matched order (clears AI match or user link)
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

    // Update local state
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

  return {
    emails,
    matchedEmails,
    unmatchedEmails,
    loading,
    error,
    linkEmailToOrder,
    unlinkEmail,
    refetch: fetchEmails,
  };
}
