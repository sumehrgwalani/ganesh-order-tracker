-- 009: Notifications table for in-app notifications
-- Supports invitation accept/decline, order updates, and other notification types

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,          -- 'invitation', 'order_update', 'inquiry', etc.
  title TEXT NOT NULL,
  message TEXT,
  data JSONB DEFAULT '{}',     -- flexible payload: invitation_id, org_name, etc.
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

-- RLS: users can only see their own notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Allow inserts from authenticated users (for creating notifications for others)
CREATE POLICY "Authenticated users can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
