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
}

export type ContactsMap = Record<string, Contact>;

export type AttachmentEntry = string | { name: string; meta?: Record<string, any> };

export interface HistoryEntry {
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
  lineItems?: Record<string, string | number | boolean>[];
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
