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
  initials?: string;
}

export type ContactsMap = Record<string, Contact>;

export interface HistoryEntry {
  stage: number;
  timestamp: string;
  from: string;
  to?: string;
  subject: string;
  body: string;
  hasAttachment?: boolean;
  attachments?: string[];
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
  lineItems?: Record<string, string | number | boolean>[];
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
