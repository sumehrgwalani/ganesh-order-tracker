import type { OrderStage } from '../types';

export const ORDER_STAGES: OrderStage[] = [
  { id: 1, name: 'Order Confirmed', shortName: 'PO Sent', description: 'Purchase Order received/sent', color: 'blue' },
  { id: 2, name: 'Proforma Issued', shortName: 'PI Issued', description: 'Proforma Invoice issued', color: 'indigo' },
  { id: 3, name: 'Artwork Approved', shortName: 'Artwork OK', description: 'Complete when email says "ARTWORK IS OK"', color: 'purple' },
  { id: 4, name: 'Quality Check', shortName: 'QC Done', description: 'QC from Hansel Fernandez or J B Boda', color: 'pink' },
  { id: 5, name: 'Schedule Confirmed', shortName: 'Scheduled', description: 'Vessel schedule confirmed', color: 'orange' },
  { id: 6, name: 'Draft Documents', shortName: 'Docs OK', description: 'Complete when "DOCUMENTS OK" received', color: 'yellow' },
  { id: 7, name: 'Final Documents', shortName: 'Final Docs', description: 'Final document copies sent', color: 'teal' },
  { id: 8, name: 'DHL Shipped', shortName: 'DHL Sent', description: 'DHL tracking number shared', color: 'green' },
];

export const LOGO_URL: string = "https://raw.githubusercontent.com/sumehrgwalani/ganesh-order-tracker/main/FinalLogo%20Circle.png";
export const GI_LOGO_URL: string = "https://raw.githubusercontent.com/sumehrgwalani/ganesh-order-tracker/main/logo2-2.png";

// Buyer reference codes for PO numbering
export const BUYER_CODES: Record<string, string> = {
  'Pescados E Guillem': 'EG',
  'Seapeix': 'SP',
  'Noriberica': 'NB',
  'Mariberica': 'MB',
  'Dagustin': 'DG',
  'Easy Fish': 'EF',
  'Argyronisos': 'AR',
  'Ruggiero Seafood': 'RG',
  'Compesca': 'CP',
  'Soguima': 'SG',
  'Fiorital': 'FI',
  'Ferrittica': 'FE',
};
