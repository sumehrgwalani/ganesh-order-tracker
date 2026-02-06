-- Ganesh Order Tracker - Database Schema
-- Complete PostgreSQL/Supabase schema with RLS policies and indexes

-- ============================================================================
-- TABLES
-- ============================================================================

-- Organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Organization members (users within organizations)
CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- Contacts
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  country TEXT,
  initials TEXT,
  color TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Products
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  specs TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Buyer settings
CREATE TABLE IF NOT EXISTS public.buyer_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  buyer_company TEXT NOT NULL,
  buyer_code TEXT NOT NULL,
  default_destination TEXT,
  default_payment_terms TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, buyer_company)
);

-- Orders
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  po_number TEXT,
  pi_number TEXT,
  company TEXT NOT NULL,
  brand TEXT,
  product TEXT NOT NULL,
  specs TEXT,
  from_location TEXT,
  to_location TEXT,
  order_date DATE,
  current_stage SMALLINT NOT NULL DEFAULT 1,
  supplier TEXT NOT NULL,
  artwork_status TEXT,
  awb_number TEXT,
  total_value TEXT,
  total_kilos NUMERIC(12, 2),
  delivery_terms TEXT,
  commission TEXT,
  overseas_commission TEXT,
  overseas_commission_company TEXT,
  payment_terms TEXT,
  lote_number TEXT,
  shipping_marks TEXT,
  buyer_bank TEXT,
  status TEXT DEFAULT 'sent',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, order_id)
);

-- Order line items
CREATE TABLE IF NOT EXISTS public.order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product TEXT,
  brand TEXT,
  size TEXT,
  glaze TEXT,
  packing TEXT,
  cases INTEGER,
  kilos NUMERIC(10, 2),
  price_per_kg NUMERIC(10, 2),
  currency TEXT DEFAULT 'USD',
  total NUMERIC(12, 2),
  sort_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Order history
CREATE TABLE IF NOT EXISTS public.order_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stage SMALLINT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body TEXT,
  has_attachment BOOLEAN DEFAULT false,
  attachments TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Product inquiries
CREATE TABLE IF NOT EXISTS public.product_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  sizes TEXT[],
  total TEXT,
  from_company TEXT NOT NULL,
  brand TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Enable on all tables
-- ============================================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inquiries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES - organizations table
-- ============================================================================

CREATE POLICY "organizations_select_policy"
  ON public.organizations
  FOR SELECT
  USING (
    id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "organizations_insert_policy"
  ON public.organizations
  FOR INSERT
  WITH CHECK (
    id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "organizations_update_policy"
  ON public.organizations
  FOR UPDATE
  USING (
    id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "organizations_delete_policy"
  ON public.organizations
  FOR DELETE
  USING (
    id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - organization_members table
-- ============================================================================

CREATE POLICY "organization_members_select_policy"
  ON public.organization_members
  FOR SELECT
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "organization_members_insert_policy"
  ON public.organization_members
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "organization_members_update_policy"
  ON public.organization_members
  FOR UPDATE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "organization_members_delete_policy"
  ON public.organization_members
  FOR DELETE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - contacts table
-- ============================================================================

CREATE POLICY "contacts_select_policy"
  ON public.contacts
  FOR SELECT
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "contacts_insert_policy"
  ON public.contacts
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "contacts_update_policy"
  ON public.contacts
  FOR UPDATE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "contacts_delete_policy"
  ON public.contacts
  FOR DELETE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - products table
-- ============================================================================

CREATE POLICY "products_select_policy"
  ON public.products
  FOR SELECT
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "products_insert_policy"
  ON public.products
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "products_update_policy"
  ON public.products
  FOR UPDATE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "products_delete_policy"
  ON public.products
  FOR DELETE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - buyer_settings table
-- ============================================================================

CREATE POLICY "buyer_settings_select_policy"
  ON public.buyer_settings
  FOR SELECT
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "buyer_settings_insert_policy"
  ON public.buyer_settings
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "buyer_settings_update_policy"
  ON public.buyer_settings
  FOR UPDATE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "buyer_settings_delete_policy"
  ON public.buyer_settings
  FOR DELETE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - orders table
-- ============================================================================

CREATE POLICY "orders_select_policy"
  ON public.orders
  FOR SELECT
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "orders_insert_policy"
  ON public.orders
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "orders_update_policy"
  ON public.orders
  FOR UPDATE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "orders_delete_policy"
  ON public.orders
  FOR DELETE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - order_line_items table (join through orders)
-- ============================================================================

CREATE POLICY "order_line_items_select_policy"
  ON public.order_line_items
  FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "order_line_items_insert_policy"
  ON public.order_line_items
  FOR INSERT
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "order_line_items_update_policy"
  ON public.order_line_items
  FOR UPDATE
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "order_line_items_delete_policy"
  ON public.order_line_items
  FOR DELETE
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  );

-- ============================================================================
-- RLS POLICIES - order_history table (join through orders)
-- ============================================================================

CREATE POLICY "order_history_select_policy"
  ON public.order_history
  FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "order_history_insert_policy"
  ON public.order_history
  FOR INSERT
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "order_history_update_policy"
  ON public.order_history
  FOR UPDATE
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "order_history_delete_policy"
  ON public.order_history
  FOR DELETE
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
    )
  );

-- ============================================================================
-- RLS POLICIES - product_inquiries table
-- ============================================================================

CREATE POLICY "product_inquiries_select_policy"
  ON public.product_inquiries
  FOR SELECT
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "product_inquiries_insert_policy"
  ON public.product_inquiries
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "product_inquiries_update_policy"
  ON public.product_inquiries
  FOR UPDATE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

CREATE POLICY "product_inquiries_delete_policy"
  ON public.product_inquiries
  FOR DELETE
  USING (
    organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Indexes on organization_id for all applicable tables
CREATE INDEX idx_organization_members_organization_id ON public.organization_members(organization_id);
CREATE INDEX idx_contacts_organization_id ON public.contacts(organization_id);
CREATE INDEX idx_products_organization_id ON public.products(organization_id);
CREATE INDEX idx_buyer_settings_organization_id ON public.buyer_settings(organization_id);
CREATE INDEX idx_orders_organization_id ON public.orders(organization_id);
CREATE INDEX idx_product_inquiries_organization_id ON public.product_inquiries(organization_id);

-- Indexes on user_id for organization_members (for faster lookups)
CREATE INDEX idx_organization_members_user_id ON public.organization_members(user_id);

-- Indexes on order_id for related tables
CREATE INDEX idx_order_line_items_order_id ON public.order_line_items(order_id);
CREATE INDEX idx_order_history_order_id ON public.order_history(order_id);

-- Additional useful indexes
CREATE INDEX idx_organizations_slug ON public.organizations(slug);
CREATE INDEX idx_contacts_email ON public.contacts(email);
CREATE INDEX idx_orders_order_id ON public.orders(order_id);
CREATE INDEX idx_product_inquiries_status ON public.product_inquiries(status);
CREATE INDEX idx_order_history_stage ON public.order_history(stage);
