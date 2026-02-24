// PO Generator helper functions — pure logic, no React dependencies
import type { Order } from '../types';

// Known buyer destinations for auto-fill
export const BUYER_DESTINATIONS: Record<string, string> = {
  'PESCADOS E.GUILLEM': 'Valencia, Spain',
  'Pescados E Guillem': 'Valencia, Spain',
  'Seapeix': 'Barcelona, Spain',
  'Noriberica': 'Portugal',
  'Ruggiero Seafood': 'Italy',
  'Fiorital': 'Italy',
  'Ferrittica': 'Italy',
  'Compesca': 'Spain',
  'Soguima': 'Spain',
  'Mariberica': 'Spain',
};

// Get next PO number for a specific buyer
export const getNextPONumber = (buyerName: string, orders: Order[], BUYER_CODES: Record<string, string>) => {
  const year = new Date().getFullYear();
  const nextYear = (year + 1).toString().slice(-2);
  const yearPrefix = `${year.toString().slice(-2)}-${nextYear}`;

  if (!buyerName) {
    const allPONumbers = orders
      .map(o => {
        const match = o.id.match(/\/(\d+)$/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(n => n > 0);
    const maxNum = allPONumbers.length > 0 ? Math.max(...allPONumbers) : 3043;
    return `GI/PO/${yearPrefix}/${maxNum + 1}`;
  }

  const buyerCode = BUYER_CODES[buyerName] || buyerName.substring(0, 2).toUpperCase();
  const buyerOrders = orders.filter(o =>
    o.id.includes(`/${buyerCode}-`) || o.company?.toLowerCase().includes(buyerName.toLowerCase())
  );

  const buyerSequences = buyerOrders
    .map(o => {
      const match = o.id.match(new RegExp(`${buyerCode}-(\\d+)$`));
      return match ? parseInt(match[1]) : 0;
    })
    .filter(n => n > 0);

  const nextSeq = buyerSequences.length > 0 ? Math.max(...buyerSequences) + 1 : 1;
  const seqStr = nextSeq.toString().padStart(3, '0');

  return `GI/PO/${yearPrefix}/${buyerCode}-${seqStr}`;
};

// Get next lote number for a buyer
export const getNextLoteNumber = (buyerName: string, orders: Order[]) => {
  if (!buyerName) return '';
  const year = new Date().getFullYear();

  const buyerOrders = orders.filter(o =>
    o.company?.toLowerCase().includes(buyerName.toLowerCase())
  );

  let maxLote = 0;
  for (const o of buyerOrders) {
    const meta = o.metadata as any;
    if (!meta?.history) continue;
    for (const h of (Array.isArray(meta.history) ? meta.history : [])) {
      for (const att of (h.attachments || [])) {
        const lote = att.meta?.loteNumber || '';
        const match = lote.match(/^(\d+)\//);
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxLote) maxLote = num;
        }
      }
    }
  }

  const nextNum = (maxLote + 1).toString().padStart(4, '0');
  return `${nextNum}/${year}`;
};

// Increment a PO number's sequence: "GI/PO/25-26/EG-001" → "GI/PO/25-26/EG-002"
export const incrementPONumber = (poNumber: string): string => {
  const buyerMatch = poNumber.match(/^(.*\/)([A-Z]+-?)(\d+)$/);
  if (buyerMatch) {
    const nextNum = (parseInt(buyerMatch[3]) + 1).toString().padStart(buyerMatch[3].length, '0');
    return buyerMatch[1] + buyerMatch[2] + nextNum;
  }
  const genericMatch = poNumber.match(/^(.*\/)(\d+)$/);
  if (genericMatch) {
    return genericMatch[1] + (parseInt(genericMatch[2]) + 1).toString();
  }
  return poNumber + '-2';
};

// Compute PO number for a specific bulk index
export const getCurrentBulkPONumber = (baseNumber: string, index: number): string => {
  let num = baseNumber;
  for (let i = 0; i < index; i++) {
    num = incrementPONumber(num);
  }
  return num;
};

// Format date for display
export const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Pull defaults (packing, brand, freezing) from the most recent order between a supplier+buyer pair
export const getLastOrderDefaults = (supplierName: string, buyerName: string, orders: Order[]) => {
  if (!supplierName || !buyerName) return null;
  const sLower = supplierName.toLowerCase();
  const bLower = buyerName.toLowerCase();

  const matchingOrders = orders
    .filter(o =>
      o.supplier?.toLowerCase().includes(sLower) &&
      o.company?.toLowerCase().includes(bLower)
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (matchingOrders.length === 0) return null;

  const lastOrder = matchingOrders[0];
  const lastLineItems = lastOrder.lineItems || [];

  const defaults: { packing: string; brand: string; freezing: string } = { packing: '', brand: '', freezing: '' };

  for (const item of lastLineItems) {
    if (!defaults.packing && item.packing && typeof item.packing === 'string') {
      defaults.packing = item.packing;
    }
    if (!defaults.brand && item.brand && typeof item.brand === 'string') {
      defaults.brand = item.brand;
    }
    if (!defaults.freezing && item.freezing && typeof item.freezing === 'string') {
      defaults.freezing = item.freezing;
    }
    if (defaults.packing && defaults.brand && defaults.freezing) break;
  }

  return defaults;
};

// Build the attachment metadata block shared by new PO and amendment flows
export const buildAttachmentMeta = (
  poData: any,
  lineItems: any[],
  totals: { totalCases: number; totalKilos: number; grandTotal: string }
) => ({
  pdfUrl: '',  // caller sets this
  supplier: poData.supplier,
  supplierAddress: poData.supplierAddress || '',
  supplierCountry: poData.supplierCountry || 'India',
  buyer: poData.buyer,
  buyerBank: poData.buyerBank || '',
  destination: poData.destination || '',
  deliveryTerms: poData.deliveryTerms || '',
  deliveryDate: poData.deliveryDate || '',
  commission: poData.commission || '',
  overseasCommission: poData.overseasCommission || '',
  overseasCommissionCompany: poData.overseasCommissionCompany || '',
  payment: poData.payment || '',
  shippingMarks: poData.shippingMarks || '',
  loteNumber: poData.loteNumber || '',
  date: poData.date,
  product: poData.product || '',
  totalCases: totals.totalCases,
  totalKilos: totals.totalKilos,
  grandTotal: totals.grandTotal,
  lineItems: lineItems.map(li => ({
    product: li.product, brand: li.brand || '', freezing: li.freezing || '',
    size: li.size || '', glaze: li.glaze || '', glazeMarked: li.glazeMarked || '',
    packing: li.packing || '', cases: li.cases || 0, kilos: li.kilos || 0,
    pricePerKg: li.pricePerKg || 0, currency: li.currency || 'USD', total: li.total || 0,
  })),
});

// Look up auto-destination from buyer company name
export const getAutoDestination = (buyerCompany: string): string => {
  const match = Object.entries(BUYER_DESTINATIONS).find(
    ([key]) => buyerCompany.toLowerCase().includes(key.toLowerCase())
  );
  return match?.[1] || '';
};
