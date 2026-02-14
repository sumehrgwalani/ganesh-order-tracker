-- Migration: Backend Improvements
-- Description: Add missing columns and soft delete support to orders and order_line_items tables
-- Date: 2026-02-08

-- Add deleted_at column to orders table for soft deletes
DO $$
BEGIN
  ALTER TABLE orders ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN
  -- Column already exists, continue
  NULL;
END $$;

-- Add metadata column to orders table for storing additional order data
DO $$
BEGIN
  ALTER TABLE orders ADD COLUMN metadata JSONB DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN
  -- Column already exists, continue
  NULL;
END $$;

-- Add freezing column to order_line_items table
DO $$
BEGIN
  ALTER TABLE order_line_items ADD COLUMN freezing TEXT;
EXCEPTION WHEN duplicate_column THEN
  -- Column already exists, continue
  NULL;
END $$;

-- Add glaze_marked column to order_line_items table
DO $$
BEGIN
  ALTER TABLE order_line_items ADD COLUMN glaze_marked TEXT;
EXCEPTION WHEN duplicate_column THEN
  -- Column already exists, continue
  NULL;
END $$;

-- Create index on deleted_at for efficient soft delete filtering
CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at);

-- Create index for soft delete filtering combined with organization_id for common queries
CREATE INDEX IF NOT EXISTS idx_orders_organization_deleted ON orders(organization_id, deleted_at);

-- Update RLS policies to filter out soft-deleted orders
-- Drop and recreate SELECT policy to include deleted_at IS NULL filter
DO $$
BEGIN
  -- Try to drop the old policy, then create the updated one
  DROP POLICY IF EXISTS "Users can view orders in their organization" ON public.orders;
  CREATE POLICY "Users can view orders in their organization"
    ON public.orders FOR SELECT
    USING (
      deleted_at IS NULL
      AND organization_id IN (
        SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
      )
    );
EXCEPTION WHEN OTHERS THEN
  -- Policy may have a different name or already be correct
  NULL;
END $$;
