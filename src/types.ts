// ===== Core Data Types =====

export interface Contact {
  name: string;
  company: string;
  role: string;
  initials: string;
  color: string;
  phone: string;
  address: string;
  notes: string;
  country: string;
  default_brand: string;
}

export interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  company: string;
  role: string;
  category: string;
  color: string;
  country?: string;
  initials?: string;
  default_brand?: string;
}

export type ContactsMap = Record<string, Contact>;

export type AttachmentEntry = string | { name: string; meta?: Record<string, any> };

export interface HistoryEntry {
  id?: string;
  stage: number;
  timestamp: string;
  from: string;
  to?: string;
  subject: string;
  body: string;
  hasAttachment?: boolean;
  attachments?: AttachmentEntry[];
}

// Helper to normalize attachment entry (handles stringified JSON from DB)
const normalizeAttachment = (att: AttachmentEntry): AttachmentEntry => {
  if (typeof att === 'string') {
    // Try to parse JSON strings that might have been stringified in DB
    if (att.startsWith('{') && att.includes('"name"')) {
      try { return JSON.parse(att); } catch { return att; }
    }
    return att;
  }
  return att;
};

// Helper to extract filename from attachment entry
export const getAttachmentName = (att: AttachmentEntry): string => {
  const normalized = normalizeAttachment(att);
  return typeof normalized === 'string' ? normalized : normalized.name;
};

// Helper to extract metadata from attachment entry
export const getAttachmentMeta = (att: AttachmentEntry): Record<string, any> | undefined => {
  const normalized = normalizeAttachment(att);
  return typeof normalized === 'object' ? normalized.meta : undefined;
};

export interface OrderLineItem {
  product: string;
  brand: string;
  freezing: string;
  size: string;
  glaze: string;
  glazeMarked: string;
  packing: string;
  cases: number;
  kilos: number;
  pricePerKg: number;
  currency: string;
  total: number;
}

export interface Order {
  id: string;
  poNumber: string;
  piNumber?: string;
  company: string;
  brand?: string;
  product: string;
  specs: string;
  from: string;
  to: string;
  date: string;
  currentStage: number;
  supplier: string;
  artworkStatus?: string;
  awbNumber?: string | null;
  totalValue?: string;
  totalKilos?: number;
  lineItems?: OrderLineItem[];
  metadata?: Record<string, any>;
  history: HistoryEntry[];
}

export interface ProductInquiry {
  product: string;
  sizes?: string[];
  total: string;
  from: string;
  brand?: string;
}

export interface OrderStage {
  id: number;
  name: string;
  shortName: string;
  description: string;
  color: string;
}

export interface Stats {
  active: number;
  completed: number;
  inquiries: number;
  contacts: number;
  products: number;
}

// ===== PO Generator Types =====

export interface LineItem {
  product: string;
  size: string;
  packing: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  currency: string;
  glazing: string;
  brand: string;
  printedBag: boolean;
  remarks: string;
}

export interface POFormData {
  buyerCompany: string;
  buyerContact: string;
  buyerEmail: string;
  supplierCompany: string;
  supplierContact: string;
  supplierEmail: string;
  poNumber: string;
  poDate: string;
  deliveryTerms: string;
  paymentTerms: string;
  destination: string;
  specialInstructions: string;
  lineItems: LineItem[];
}

// ===== Team & Organization Types =====

export interface Department {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;              // organization_members.id
  user_id: string;
  organization_id: string;
  role: string;            // 'owner' | 'head' | 'member'
  department_id: string | null;       // legacy single dept
  department?: Department;            // legacy
  department_ids: string[];           // multi-department support
  departments: Department[];          // multi-department support
  created_at: string;
  email?: string;          // from auth.users
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  department_id: string | null;
  department?: Department;
  role: string;
  invited_by: string | null;
  token: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  created_at: string;
  expires_at: string;
}

// ===== Settings Types =====

export interface OrganizationSettings {
  id: string;
  organization_id: string;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  gst_number: string | null;
  tax_id: string | null;
  default_currency: string;
  weight_unit: string;
  date_format: string;
  email_provider: 'smtp' | 'sendgrid' | 'resend' | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  smtp_from_email: string | null;
  smtp_use_tls: boolean;
  api_key: string | null;
  notify_new_order: boolean;
  notify_order_updated: boolean;
  notify_stage_changed: boolean;
  notify_new_inquiry: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  display_name: string | null;
  phone: string | null;
  notify_new_order: boolean | null;
  notify_order_updated: boolean | null;
  notify_stage_changed: boolean | null;
  notify_new_inquiry: boolean | null;
}

// ===== Notification Types =====

export interface AppNotification {
  id: string;
  user_id: string;
  organization_id: string | null;
  type: 'invitation' | 'order_update' | 'inquiry' | 'general';
  title: string;
  message: string | null;
  data: {
    invitation_id?: string;
    org_name?: string;
    invited_by_email?: string;
    department_name?: string;
    role?: string;
    [key: string]: any;
  };
  read: boolean;
  created_at: string;
}
