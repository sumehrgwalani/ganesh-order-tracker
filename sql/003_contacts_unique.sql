-- Add unique constraint on (email, organization_id) for contact upserts
-- This allows the bulk import to update existing contacts by email
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_email_org_unique UNIQUE (email, organization_id);
