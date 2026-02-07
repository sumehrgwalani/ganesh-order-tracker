import { useState, useEffect, useRef, ReactNode, Dispatch, SetStateAction } from 'react';
import Icon from '../components/Icon';
import { ORDER_STAGES, BUYER_CODES, GI_LOGO_URL } from '../data/constants';
import { CONTACTS } from '../data/contacts';
import { GILogo } from '../components/Logos';
import type { ContactsMap, Order, LineItem, POFormData } from '../types';

interface Props {
  onBack: () => void;
  contacts?: ContactsMap;
  orders?: Order[];
  setOrders?: Dispatch<SetStateAction<Order[]>>;
  onOrderCreated?: (order: Order) => void;
}

interface SupplierInfo {
  email: string;
  name: string;
  company: string;
  role: string;
}

interface BuyerInfo {
  email: string;
  company: string;
  role: string;
  country?: string;
}

interface POLineItem {
  product: string;
  size: string;
  glaze: string;
  glazeMarked: string;
  packing: string;
  brand: string;
  cases: string | number;
  kilos: string | number;
  pricePerKg: string | number;
  currency: string;
  total: string | number;
  [key: string]: string | number | boolean;
}

interface LineItemInternal extends LineItem {
  total: number | string;
}

interface PODataInternal extends POFormData {
  poNumber: string;
  date: string;
  supplier: string;
  supplierEmail: string;
  supplierAddress: string;
  supplierCountry: string;
  product: string;
  brand: string;
  buyer: string;
  buyerCode: string;
  destination: string;
  deliveryTerms: string;
  commission: string;
  overseasCommission: string;
  overseasCommissionCompany: string;
  payment: string;
  packing: string;
  deliveryDate: string;
  loteNumber: string;
  shippingMarks: string;
  buyerBank: string;
  notes: string;
}

interface Notification {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

function POGeneratorPage({ onBack, contacts = CONTACTS, orders = [], setOrders, onOrderCreated }: Props) {

  // Get next PO number for a specific buyer
  const getNextPONumber = (buyerName = '') => {
    const year = new Date().getFullYear();
    const nextYear = (year + 1).toString().slice(-2);
    const yearPrefix = `${year.toString().slice(-2)}-${nextYear}`;

    if (!buyerName) {
      // Generic next number based on all orders
      const allPONumbers = orders
        .map(o => {
          const match = o.id.match(/\/(\d+)$/);
          return match ? parseInt(match[1]) : 0;
        })
        .filter(n => n > 0);
      const maxNum = allPONumbers.length > 0 ? Math.max(...allPONumbers) : 3043;
      return `GI/PO/${yearPrefix}/${maxNum + 1}`;
    }

    // Buyer-specific numbering
    const buyerCode = BUYER_CODES[buyerName] || buyerName.substring(0, 2).toUpperCase();

    // Find existing orders for this buyer and get the max sequence
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

  const [poData, setPOData] = useState({
    poNumber: getNextPONumber(),
    date: new Date().toISOString().split('T')[0],
    supplier: '',
    supplierEmail: '',
    supplierAddress: '',
    supplierCountry: '',
    product: '',
    brand: '',
    buyer: '',
    buyerCode: '',
    destination: '',
    deliveryTerms: 'CFR',
    commission: 'USD 0.05 per Kg',
    overseasCommission: '',
    overseasCommissionCompany: '',
    payment: '',
    packing: '',
    deliveryDate: '',
    loteNumber: '',
    shippingMarks: '',
    buyerBank: '',
    notes: '',
  });

  const [lineItems, setLineItems] = useState<POLineItem[]>([
    { product: '', size: '', glaze: '', glazeMarked: '', packing: '', brand: '', cases: '', kilos: '', pricePerKg: '', currency: 'USD', total: 0 }
  ]);

  const [status, setStatus] = useState('draft'); // draft, pending_approval, approved, sent
  const [showPreview, setShowPreview] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [showParser, setShowParser] = useState(true);
  const [rawInput, setRawInput] = useState('');

  // Natural language parser function - handles Spanish, abbreviations, multi-product
  const parseNaturalLanguage = (text: string) => {
    if (!text.trim()) {
      setNotification({ type: 'error', message: 'Please paste some text to parse.' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
    const textLower = text.toLowerCase();

    // Buyer abbreviations mapping
    const buyerAbbreviations: Record<string, string> = {
      'eg': 'Pescados E Guillem',
      'pescados': 'Pescados E Guillem',
      'guillem': 'Pescados E Guillem',
      'seapeix': 'Seapeix',
      'noriberica': 'Noriberica',
      'ruggiero': 'Ruggiero Seafood',
      'fiorital': 'Fiorital',
      'ferrittica': 'Ferrittica',
      'compesca': 'Compesca',
      'soguima': 'Soguima',
      'mariberica': 'Mariberica',
    };

    // Supplier abbreviations mapping
    const supplierAbbreviations: Record<string, string> = {
      'silver': 'Silver Star',
      'nila': 'Nila',
      'raunaq': 'Raunaq/JJ',
      'jj': 'Raunaq/JJ',
      'abad': 'ABAD',
      'arsha': 'Arsha',
      'hainan': 'Hainan',
      'fivestar': 'Fivestar',
      'capithan': 'Capithan',
      'premier': 'Premier',
      'jinny': 'Jinny Marine',
    };

    // Spanish to English translations
    const translations: Record<string, string> = {
      'glaseo': 'Glaze',
      'granel': 'Bulk',
      'bolsa': 'Bag',
      'bolsa con rider': 'Bag with Rider',
      'con rider': 'with Rider',
      'talla': 'Size',
      'piezas': 'pieces',
      'pincho': 'skewer',
      'piezas por pincho': 'pcs/skewer',
      'kilo': 'kg',
      'sepia': 'Cuttlefish',
      'calamar': 'Squid',
      'pulpo': 'Octopus',
      'gamba': 'Shrimp',
      'langostino': 'Prawn',
      'wc': 'Whole Cleaned',
      'w/c': 'Whole Cleaned',
    };

    // Product name translations
    const productTranslations: Record<string, string> = {
      'cuttlefish wc': 'Cuttlefish Whole Cleaned',
      'cuttlefish squid mix': 'Cuttlefish Squid Mix',
      'skewers': 'Seafood Skewers',
      'squid whole': 'Squid Whole IQF',
      'squid rings': 'Squid Rings',
      'baby squid': 'Baby Squid',
      'vannamei pud': 'Vannamei PUD',
      'vannamei hlso': 'Vannamei HLSO',
    };

    // Parse multi-product blocks
    const productBlocks = [];
    let currentBlock = null;

    for (const line of lines) {
      const lineLower = line.toLowerCase();

      // Check if this line starts a new product (product names usually don't have numbers at start)
      const isProductLine = /^[a-zA-Z]/.test(line) &&
        !lineLower.includes('glaseo') &&
        !lineLower.includes('glaze') &&
        !lineLower.includes('granel') &&
        !lineLower.includes('bolsa') &&
        !lineLower.includes('marked as') &&
        !lineLower.match(/^\d+\s*[xX]\s*\d+/) &&
        !lineLower.match(/^\d+\s*mt\b/i) &&
        !lineLower.match(/^\d+\s*kilo/i) &&
        !lineLower.match(/^talla\b/i) &&
        !lineLower.match(/^\d+-\d+\s*piezas/i) &&
        line.length > 2;

      // Check for buyer/supplier line (usually at the end, short, has abbreviations)
      const isBuyerSupplierLine = line.split(/\s+/).every((word: string) => {
        const w = word.toLowerCase();
        return buyerAbbreviations[w] || supplierAbbreviations[w] || w.length <= 3;
      }) && line.length < 30;

      if (isProductLine && !isBuyerSupplierLine) {
        // Save previous block and start new one
        if (currentBlock) productBlocks.push(currentBlock);

        // Translate product name
        let productName = line;
        for (const [sp, en] of Object.entries(productTranslations)) {
          if (lineLower.includes(sp.toLowerCase())) {
            productName = en;
            break;
          }
        }
        // Handle WC abbreviation
        if (lineLower.includes(' wc')) {
          productName = productName.replace(/\s+wc/i, ' Whole Cleaned');
        }

        // Auto-add "Frozen" prefix for seafood and french fries (unless already present)
        const seafoodKeywords = ['cuttlefish', 'squid', 'octopus', 'shrimp', 'prawn', 'fish', 'seafood', 'vannamei', 'lobster', 'crab', 'mussel', 'clam', 'scallop', 'anchovy', 'sardine', 'tuna', 'salmon', 'cod', 'hake', 'sole', 'skewer'];
        const friesKeywords = ['fries', 'french fries', 'potato', 'wedges'];
        const productLower = productName.toLowerCase();
        const needsFrozen = [...seafoodKeywords, ...friesKeywords].some(kw => productLower.includes(kw));
        if (needsFrozen && !productLower.startsWith('frozen')) {
          productName = 'Frozen ' + productName;
        }

        currentBlock = {
          product: productName,
          size: '',
          glaze: '',
          glazeMarked: '',
          kilos: '',
          pricePerKg: '',
          packing: '',
          notes: ''
        };
      } else if (currentBlock) {
        // Parse details for current product

        // Glaze percentage (25% Glaseo)
        const glazeMatch = line.match(/(\d+)%\s*(?:glaseo|glaze)/i);
        if (glazeMatch) {
          currentBlock.glaze = glazeMatch[1] + '% Glaze';
        }

        // Marked/declared glaze (Marked as 20% or Marked as 20% glaze)
        const markedGlazeMatch = line.match(/marked\s*(?:as)?\s*(\d+)%/i);
        if (markedGlazeMatch) {
          currentBlock.glazeMarked = markedGlazeMatch[1] + '% Glaze';
        }

        // Quantity and price (4MT U/1 $6.10)
        const qtyPriceMatch = line.match(/(\d+)\s*MT\s+(U\/\d+|\d+\/\d+)?\s*\$?([\d.]+)?/i);
        if (qtyPriceMatch) {
          currentBlock.kilos = (parseFloat(qtyPriceMatch[1]) * 1000).toString(); // MT to kg
          if (qtyPriceMatch[2]) currentBlock.size = qtyPriceMatch[2];
          if (qtyPriceMatch[3]) currentBlock.pricePerKg = qtyPriceMatch[3];
        }

        // Just quantity in MT (6MT $3.60)
        const mtPriceMatch = line.match(/(\d+)\s*MT\s*\$?([\d.]+)/i);
        if (mtPriceMatch && !qtyPriceMatch) {
          currentBlock.kilos = (parseFloat(mtPriceMatch[1]) * 1000).toString();
          currentBlock.pricePerKg = mtPriceMatch[2];
        }

        // Size/Talla (Talla 20/40 or just 20/40)
        const sizeMatch = line.match(/(?:talla\s+)?(\d+\/\d+|U\/\d+|\d+\/UP)/i);
        if (sizeMatch && !currentBlock.size) {
          currentBlock.size = sizeMatch[1];
        }

        // Packing (6x1 kilo bolsa con rider, 10 kilo Granel)
        const packingMatch = line.match(/(\d+\s*[xX]\s*\d+\s*(?:kilo?|kg)?)\s*(.*)?/i);
        if (packingMatch) {
          let packing = packingMatch[1].replace(/kilo/i, 'kg');
          const extra = packingMatch[2] || '';
          // Translate Spanish packing terms
          if (extra.toLowerCase().includes('bolsa con rider') || extra.toLowerCase().includes('con rider')) {
            packing += ' Bag with Rider';
          } else if (extra.toLowerCase().includes('bolsa')) {
            packing += ' Bag';
          }
          currentBlock.packing = packing;
        }

        // Bulk packing (10 kilo Granel)
        const granelMatch = line.match(/(\d+)\s*kilo\s*granel/i);
        if (granelMatch) {
          currentBlock.packing = granelMatch[1] + ' kg Bulk';
        }

        // Pieces per skewer (4-5 piezas por pincho)
        const skewMatch = line.match(/(\d+-?\d*)\s*piezas?\s*(?:por\s*)?pincho/i);
        if (skewMatch) {
          currentBlock.notes = skewMatch[1] + ' pcs/skewer';
        }

        // Standalone price ($5.05)
        const priceMatch = line.match(/\$\s*([\d.]+)/);
        if (priceMatch && !currentBlock.pricePerKg) {
          currentBlock.pricePerKg = priceMatch[1];
        }

        // Standalone MT (10MT)
        const mtMatch = line.match(/^(\d+)\s*MT$/i);
        if (mtMatch && !currentBlock.kilos) {
          currentBlock.kilos = (parseFloat(mtMatch[1]) * 1000).toString();
        }
      }
    }

    // Don't forget the last block
    if (currentBlock) productBlocks.push(currentBlock);

    // Parse buyer and supplier from the text
    let detectedBuyer = '';
    let detectedSupplier = '';
    let detectedSupplierEmail = '';

    // Check for abbreviations anywhere in text
    const words = text.split(/[\s,]+/).map((w: string) => w.toLowerCase());
    for (const word of words) {
      if (buyerAbbreviations[word] && !detectedBuyer) {
        detectedBuyer = buyerAbbreviations[word];
      }
      if (supplierAbbreviations[word] && !detectedSupplier) {
        const companyName = supplierAbbreviations[word];
        const matchedSupplier = suppliers.find(s =>
          s.company.toLowerCase().includes(companyName.toLowerCase())
        );
        if (matchedSupplier) {
          detectedSupplier = matchedSupplier.company;
          detectedSupplierEmail = matchedSupplier.email;
        }
      }
    }

    // Build line items from product blocks
    const newLineItems = productBlocks.map(block => {
      const kilos = parseFloat(block.kilos) || 0;
      const price = parseFloat(block.pricePerKg) || 0;
      // Include notes in size if present, default to "Assorted" if no size specified
      let sizeStr = block.size || '';
      if (block.notes) sizeStr = sizeStr ? `${sizeStr} - ${block.notes}` : block.notes;
      if (!sizeStr) sizeStr = 'Assorted';

      return {
        product: block.product,
        size: sizeStr,
        glaze: block.glaze || '',
        glazeMarked: block.glazeMarked || '',
        brand: '',
        cases: '',
        kilos: block.kilos,
        pricePerKg: block.pricePerKg,
        currency: 'USD',
        packing: block.packing,
        total: (kilos * price).toFixed(2)
      };
    });

    // Update state with recalculated values (cases, adjusted kilos, totals)
    if (newLineItems.length > 0) {
      setLineItems(recalculateAllLineItems(newLineItems));
    }

    // Get combined product description
    const productDesc = productBlocks.map(b => b.product).join(', ');

    setPOData(prev => ({
      ...prev,
      product: productDesc || prev.product,
      buyer: detectedBuyer || prev.buyer,
      supplier: detectedSupplier || prev.supplier,
      supplierEmail: detectedSupplierEmail || prev.supplierEmail,
    }));

    // Show success notification
    const extracted = [];
    if (productBlocks.length) extracted.push(`${productBlocks.length} product(s)`);
    if (newLineItems.some(i => i.kilos)) extracted.push('quantities');
    if (newLineItems.some(i => i.pricePerKg)) extracted.push('prices');
    if (detectedBuyer) extracted.push('buyer');
    if (detectedSupplier) extracted.push('supplier');
    if (newLineItems.some(i => i.packing)) extracted.push('packing');

    if (extracted.length > 0) {
      setNotification({ type: 'success', message: `✓ Extracted: ${extracted.join(', ')}` });
      setShowParser(false);
    } else {
      setNotification({ type: 'warning', message: 'Could not extract specific data. Please fill in manually.' });
    }
    setTimeout(() => setNotification(null), 4000);
  };

  // Get suppliers from contacts
  const suppliers = Object.entries(contacts)
    .filter(([_, c]) => c.role === 'Supplier')
    .map(([email, c]) => ({ email, ...c }));

  // Get buyers from contacts
  const buyers = Object.entries(contacts)
    .filter(([_, c]) => c.role === 'Buyer')
    .map(([email, c]) => ({ email, ...c }));

  // Parse packing to extract kg per carton (e.g., "6x1 kg" = 6, "10 kg Bulk" = 10)
  const parsePackingKg = (packing: string) => {
    if (!packing) return null;
    const packingLower = packing.toLowerCase();

    // Pattern: 6x1 kg, 6X1 kg, 6x1kg, 10x1 = multiplied (6*1=6, 10*1=10)
    const multiplyMatch = packing.match(/(\d+)\s*[xX]\s*(\d+)\s*(?:kg|kilo)?/i);
    if (multiplyMatch) {
      return parseInt(multiplyMatch[1]) * parseInt(multiplyMatch[2]);
    }

    // Pattern: 10 kg Bulk, 6 kilo = direct kg
    const directMatch = packing.match(/(\d+)\s*(?:kg|kilo)/i);
    if (directMatch) {
      return parseInt(directMatch[1]);
    }

    return null;
  };

  // Calculate cases, adjusted kilos, and total
  const calculateLineItem = (item: any) => {
    const inputKilos = parseFloat(item.kilos) || 0;
    const price = parseFloat(item.pricePerKg) || 0;
    const kgPerCarton = parsePackingKg(item.packing);

    let cases = item.cases ? parseInt(item.cases as string) : 0;
    let adjustedKilos = inputKilos;

    // If we have packing info and kilos, calculate cases and adjust kilos
    if (kgPerCarton && inputKilos > 0) {
      // Calculate cases (round up to ensure we have enough)
      cases = Math.ceil(inputKilos / kgPerCarton);
      // Adjust kilos to match whole cartons
      adjustedKilos = cases * kgPerCarton;
    }

    // Calculate total (rounded to 2 decimal places)
    const total = (adjustedKilos * price).toFixed(2);

    return {
      cases: cases || '',
      adjustedKilos: adjustedKilos,
      total: total
    };
  };

  // Update line item with smart calculations
  const updateLineItem = (index: number, field: string, value: string | number) => {
    const updated = [...lineItems];
    updated[index][field] = value;

    // Recalculate when kilos, packing, or price changes
    if (field === 'kilos' || field === 'packing' || field === 'pricePerKg') {
      const calculated = calculateLineItem(updated[index]);
      updated[index].cases = calculated.cases;
      // Only adjust kilos if packing is set and we're not directly editing kilos
      if (field !== 'kilos' && parsePackingKg(updated[index].packing)) {
        updated[index].kilos = calculated.adjustedKilos;
      }
      updated[index].total = calculated.total;
    }

    // If cases is manually edited, recalculate kilos
    if (field === 'cases') {
      const cases = parseInt(value as string) || 0;
      const kgPerCarton = parsePackingKg(updated[index].packing as string);
      if (kgPerCarton && cases > 0) {
        updated[index].kilos = cases * kgPerCarton;
        const price = parseFloat(updated[index].pricePerKg as string) || 0;
        updated[index].total = ((cases * kgPerCarton) * price).toFixed(2);
      }
    }

    setLineItems(updated);
  };

  // Recalculate all line items (used after parsing)
  const recalculateAllLineItems = (items: any[]) => {
    return items.map(item => {
      const calculated = calculateLineItem(item);
      const kgPerCarton = parsePackingKg(item.packing);
      return {
        ...item,
        cases: calculated.cases,
        kilos: kgPerCarton ? calculated.adjustedKilos : item.kilos,
        total: calculated.total
      };
    });
  };

  // Add line item
  const addLineItem = () => {
    setLineItems([...lineItems, { product: '', size: '', glaze: '', glazeMarked: '', packing: '', brand: '', cases: '', kilos: '', pricePerKg: '', currency: 'USD', total: 0 }]);
  };

  // Remove line item
  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  // Calculate grand totals
  const grandTotal = lineItems.reduce((sum, item) => sum + parseFloat((item.total as string) || '0'), 0).toFixed(2);
  const totalKilos = lineItems.reduce((sum, item) => sum + (parseFloat((item.kilos as string) || '0') || 0), 0);
  const totalCases = lineItems.reduce((sum, item) => sum + (parseInt((item.cases as string) || '0') || 0), 0);

  // Handle supplier selection - auto-fill payment from previous orders
  const handleSupplierChange = (email: string) => {
    const supplier = suppliers.find(s => s.email === email);
    const supplierName = supplier?.name?.toLowerCase() || '';
    const buyerCompany = poData.buyer?.toLowerCase() || '';

    // Find last order with this supplier + buyer combo for payment terms
    let autoPayment = '';
    if (buyerCompany && supplierName) {
      const matchingOrders = orders.filter(o =>
        o.company?.toLowerCase().includes(buyerCompany) &&
        o.supplier?.toLowerCase().includes(supplierName)
      );
      // If we find matching orders, we'd pull payment terms from them
      // For now, common defaults based on supplier
      if (matchingOrders.length > 0) {
        autoPayment = 'LC at Sight'; // Default for most Indian seafood export
      }
    }

    setPOData({
      ...poData,
      supplierEmail: email,
      supplier: supplier ? supplier.company : '',
      supplierAddress: supplier?.address || '',
      supplierCountry: supplier?.country || '',
      payment: autoPayment || poData.payment,
    });
  };

  // Handle buyer selection - with auto-fill from previous orders
  const handleBuyerChange = (email: string) => {
    const buyer = buyers.find(b => b.email === email);
    const buyerCompany = buyer ? buyer.company : '';
    const buyerCode = BUYER_CODES[buyerCompany] || buyerCompany.substring(0, 2).toUpperCase();
    const newPONumber = getNextPONumber(buyerCompany);

    // Auto-fill destination based on known buyers
    const buyerDestinations: Record<string, string> = {
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
    const autoDestination = Object.entries(buyerDestinations).find(
      ([key]) => buyerCompany.toLowerCase().includes(key.toLowerCase())
    )?.[1] || '';

    // Auto-fill shipment date (25 days from today)
    const shipmentDate = new Date();
    shipmentDate.setDate(shipmentDate.getDate() + 25);
    const autoDeliveryDate = shipmentDate.toISOString().split('T')[0];

    // Auto-fill payment terms from last order to this buyer's supplier
    let autoPayment = '';
    if (poData.supplierEmail) {
      const supplierName = poData.supplier.split(' - ')[0]?.toLowerCase() || '';
      const matchingOrders = orders.filter(o =>
        o.company?.toLowerCase().includes(buyerCompany.toLowerCase()) &&
        o.supplier?.toLowerCase().includes(supplierName)
      );
      if (matchingOrders.length > 0) {
        // Look for payment info in the last matching order's history
        // For now use a sensible default
      }
    }

    setPOData({
      ...poData,
      buyer: buyerCompany,
      buyerCode: buyerCode,
      buyerBank: buyer?.country || '',
      poNumber: newPONumber,
      destination: autoDestination || poData.destination,
      deliveryDate: autoDeliveryDate,
      commission: poData.commission || 'USD 0.05 per Kg',
    });
  };

  // Submit for approval
  const submitForApproval = () => {
    if (!poData.supplier || !poData.buyer || lineItems.every(item => !item.product)) {
      setNotification({ type: 'error', message: 'Please fill in required fields: Supplier, Buyer, and at least one product line.' });
      setTimeout(() => setNotification(null), 4000);
      return;
    }
    setStatus('pending_approval');
    setShowPreview(true);
    setNotification({ type: 'info', message: '🔔 Purchase Order ready for your review and sign-off!' });
  };

  // Approve PO
  const approvePO = () => {
    setStatus('approved');
    setNotification({ type: 'success', message: '✅ Purchase Order approved! Ready to send to supplier.' });
    setTimeout(() => setNotification(null), 4000);
  };

  // Reject/Edit PO
  const rejectPO = () => {
    setStatus('draft');
    setShowPreview(false);
    setNotification({ type: 'warning', message: 'Returned to draft mode for editing.' });
    setTimeout(() => setNotification(null), 3000);
  };

  // Send PO to supplier
  const sendPO = () => {
    // Create new order from PO data
    const newOrder: Order = {
      id: poData.poNumber,
      poNumber: poData.poNumber.split('/').pop() || poData.poNumber, // e.g., "EG-001" or "3044"
      company: poData.buyer,
      product: poData.product || lineItems.map(i => i.product).filter(p => p).join(', '),
      specs: lineItems.map(i => `${i.size || ''} ${i.glaze ? `(${i.glaze})` : ''} ${i.packing || ''}`.trim()).filter(s => s).join(', '),
      from: 'India',
      to: poData.destination || poData.buyerBank || 'Spain',
      date: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
      currentStage: 1,
      supplier: poData.supplier.split(' - ')[0] || poData.supplier, // Just the name
      totalValue: grandTotal,
      totalKilos: totalKilos,
      lineItems: lineItems,
      history: [
        {
          stage: 1,
          timestamp: new Date().toISOString(),
          from: 'Ganesh International <ganeshintnlmumbai@gmail.com>',
          to: poData.supplierEmail,
          subject: `NEW PURCHASE ORDER - ${poData.poNumber} - ${poData.buyer}`,
          body: `Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached the Purchase Order for ${poData.product || 'Frozen Seafood'}.\n\nPO Number: ${poData.poNumber}\nBuyer: ${poData.buyer}\nTotal Value: USD ${grandTotal}\nTotal Quantity: ${totalKilos} Kg\n\nKindly confirm receipt and proceed at the earliest.\n\nThanking you,\nBest regards,\n\nSumehr Rajnish Gwalani\nGanesh International`,
          hasAttachment: true,
          attachments: [`${poData.poNumber.replace(/\//g, '_')}.pdf`]
        }
      ]
    };

    // Add to orders list
    if (setOrders) {
      setOrders(prevOrders => [newOrder, ...prevOrders]);
    }

    setStatus('sent');
    setNotification({ type: 'success', message: `📧 Purchase Order ${poData.poNumber} sent to ${poData.supplier}! New order created.` });

    // Callback to parent if provided
    if (onOrderCreated) {
      onOrderCreated(newOrder);
    }
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Status badge component
  const StatusBadge = ({ status }: { status: string }) => {
    const statusConfig: Record<string, { color: string; label: string }> = {
      draft: { color: 'bg-gray-100 text-gray-700', label: 'Draft' },
      pending_approval: { color: 'bg-yellow-100 text-yellow-700', label: 'Pending Sign-off' },
      approved: { color: 'bg-green-100 text-green-700', label: 'Approved' },
      sent: { color: 'bg-blue-100 text-blue-700', label: 'Sent to Supplier' },
    };
    const config = statusConfig[status] || statusConfig.draft;
    return <span className={`px-3 py-1 rounded-full text-sm font-medium ${config.color}`}>{config.label}</span>;
  };

  return (
    <div>
      {/* Notification Banner */}
      {notification && (
        <div className={`mb-4 p-4 rounded-xl flex items-center gap-3 ${
          notification.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' :
          notification.type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' :
          notification.type === 'warning' ? 'bg-yellow-50 border border-yellow-200 text-yellow-800' :
          'bg-blue-50 border border-blue-200 text-blue-800'
        }`}>
          <Icon name={notification.type === 'error' ? 'AlertCircle' : 'Bell'} size={20} />
          <span className="font-medium">{notification.message}</span>
          <button onClick={() => setNotification(null)} className="ml-auto">
            <Icon name="X" size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => showPreview ? setShowPreview(false) : onBack()} className="p-2 hover:bg-gray-200 bg-gray-100 rounded-lg transition-colors">
            <Icon name="ChevronRight" size={20} className="rotate-180 text-gray-500" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {showPreview ? 'Review Purchase Order' : 'Create Purchase Order'}
            </h1>
            <p className="text-gray-500">
              {showPreview ? 'Review and approve before sending' : 'Generate and send PO to supplier'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          {!showPreview && status === 'draft' && (
            <button onClick={() => setShowPreview(true)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2">
              <Icon name="Eye" size={16} /> Preview
            </button>
          )}
          {showPreview && status === 'draft' && (
            <button onClick={() => setShowPreview(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2">
              <Icon name="Edit" size={16} /> Edit
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      {showPreview ? (
        /* PO Preview/Document View */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Action Bar for Sign-off */}
          {status === 'pending_approval' && (
            <div className="bg-yellow-50 border-b border-yellow-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                  <Icon name="AlertCircle" size={20} className="text-yellow-600" />
                </div>
                <div>
                  <p className="font-medium text-yellow-800">Review Required</p>
                  <p className="text-sm text-yellow-600">Please review the Purchase Order below and sign off before sending.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={rejectPO} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2">
                  <Icon name="X" size={16} /> Edit
                </button>
                <button onClick={approvePO} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2">
                  <Icon name="CheckCircle" size={16} /> Approve & Sign
                </button>
              </div>
            </div>
          )}

          {status === 'approved' && (
            <div className="bg-green-50 border-b border-green-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Icon name="CheckCircle" size={20} className="text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-green-800">Purchase Order Approved</p>
                  <p className="text-sm text-green-600">Ready to send to {poData.supplier}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={rejectPO} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  Edit
                </button>
                <button onClick={sendPO} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                  <Icon name="Send" size={16} /> Send to Supplier
                </button>
              </div>
            </div>
          )}

          {status === 'sent' && (
            <div className="bg-blue-50 border-b border-blue-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Icon name="CheckCircle" size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-blue-800">Purchase Order Sent!</p>
                  <p className="text-sm text-blue-600">Sent to {poData.supplierEmail} on {formatDate(new Date().toISOString())}</p>
                </div>
              </div>
              <button className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2">
                <Icon name="Download" size={16} /> Download PDF
              </button>
            </div>
          )}

          {/* PO Document Preview */}
          <div className="p-8 max-w-4xl mx-auto">
            {/* Header with Logo */}
            <div className="flex items-center mb-8 pb-6 border-b-2 border-gray-200">
              <div className="mr-6">
                <GILogo size={80} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-800">GANESH INTERNATIONAL</h2>
                <p className="text-sm text-gray-500 mt-1">Office no. 226, 2nd Floor, Arun Chambers, Tardeo Road, Mumbai 400034</p>
                <p className="text-sm text-gray-500">Tel: +91 22 2351 2345 | Email: ganeshintnlmumbai@gmail.com</p>
              </div>
            </div>

            {/* Date and PO Number */}
            <div className="flex justify-between mb-6">
              <div className="text-sm">
                <p className="font-medium text-gray-700">Date: <span className="text-gray-900">{formatDate(poData.date)}</span></p>
              </div>
              <div className="text-sm">
                <p className="font-medium text-gray-700">Purchase Order No: <span className="text-gray-900 font-bold">{poData.poNumber}</span></p>
              </div>
            </div>

            {/* To Section */}
            <div className="mb-6">
              <p className="text-sm text-gray-600">To,</p>
              <p className="font-bold text-gray-800">{poData.supplier || '[EXPORTER NAME]'}</p>
              {poData.supplierAddress && <p className="text-gray-600">{poData.supplierAddress}</p>}
              <p className="text-gray-600">{poData.supplierCountry?.toUpperCase() || 'INDIA'}</p>
            </div>

            {/* Greeting */}
            <div className="mb-6">
              <p className="text-gray-700">Dear Sirs,</p>
              <p className="text-gray-700 mt-2">
                We are pleased to confirm our Purchase Order with you for the Export of{' '}
                <span className="font-medium">
                  {lineItems.filter(i => i.product).map((item, idx, arr) => {
                    let desc = item.product;
                    if (item.glaze && item.glazeMarked) {
                      desc += ` ${item.glaze} marked as ${item.glazeMarked}`;
                    } else if (item.glaze) {
                      desc += ` ${item.glaze}`;
                    }
                    if (idx < arr.length - 1) return desc + ', ';
                    return desc;
                  }).join('') || '______________________'}
                </span>
                {' '}to our Principals namely <span className="font-medium">M/s.{poData.buyer || '______________________'}</span>
                {poData.destination && <>, <span className="font-medium">{poData.destination.toUpperCase()}</span></>}
                {' '}under the following terms & conditions.
              </p>
            </div>

            {/* Product Details Table */}
            {(() => {
              const hasBrand = lineItems.some(i => i.brand);
              const hasSize = lineItems.some(i => i.size);
              const hasGlaze = lineItems.some(i => i.glaze);
              const hasPacking = lineItems.some(i => i.packing);
              const hasCases = lineItems.some(i => i.cases);
              const filledCols = [true, hasBrand, hasSize, hasGlaze, hasPacking, hasCases, true, true, true].filter(Boolean).length;
              const totalColSpan = filledCols - 4 + (hasCases ? 1 : 0); // columns before Cases/Kilos
              return (
            <div className="mb-6">
              <table className="w-full border-collapse border border-gray-300 text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-3 py-2 text-left">Product</th>
                    {hasBrand && <th className="border border-gray-300 px-3 py-2 text-left">Brand</th>}
                    {hasSize && <th className="border border-gray-300 px-3 py-2 text-left">Size</th>}
                    {hasGlaze && <th className="border border-gray-300 px-3 py-2 text-left">Glaze</th>}
                    {hasPacking && <th className="border border-gray-300 px-3 py-2 text-left">Packing</th>}
                    {hasCases && <th className="border border-gray-300 px-3 py-2 text-right">Cases</th>}
                    <th className="border border-gray-300 px-3 py-2 text-right">Kilos</th>
                    <th className="border border-gray-300 px-3 py-2 text-right">Price/Kg<br/><span className="text-xs">{poData.deliveryTerms} {poData.destination || '___'}</span></th>
                    <th className="border border-gray-300 px-3 py-2 text-right">
                      {lineItems.some(i => i.currency && i.currency !== 'USD') ? 'Total' : 'Total (USD)'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="border border-gray-300 px-3 py-2">{item.product || '-'}</td>
                      {hasBrand && <td className="border border-gray-300 px-3 py-2">{item.brand || '-'}</td>}
                      {hasSize && <td className="border border-gray-300 px-3 py-2">{item.size || '-'}</td>}
                      {hasGlaze && <td className="border border-gray-300 px-3 py-2">{item.glaze && item.glazeMarked ? `${item.glaze} marked as ${item.glazeMarked}` : item.glaze || '-'}</td>}
                      {hasPacking && <td className="border border-gray-300 px-3 py-2">{item.packing || '-'}</td>}
                      {hasCases && <td className="border border-gray-300 px-3 py-2 text-right">{item.cases || '-'}</td>}
                      <td className="border border-gray-300 px-3 py-2 text-right">{item.kilos || '-'}</td>
                      <td className="border border-gray-300 px-3 py-2 text-right">{item.pricePerKg ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${item.pricePerKg}` : '-'}</td>
                      <td className="border border-gray-300 px-3 py-2 text-right font-medium">{Number(item.total) > 0 ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${item.total}` : '-'}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td className="border border-gray-300 px-3 py-2" colSpan={1 + (hasBrand ? 1 : 0) + (hasSize ? 1 : 0) + (hasGlaze ? 1 : 0) + (hasPacking ? 1 : 0)}>Total</td>
                    {hasCases && <td className="border border-gray-300 px-3 py-2 text-right">{totalCases}</td>}
                    <td className="border border-gray-300 px-3 py-2 text-right">{totalKilos}</td>
                    <td className="border border-gray-300 px-3 py-2"></td>
                    <td className="border border-gray-300 px-3 py-2 text-right">U.S. ${grandTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
              );
            })()}

            {/* Terms Section */}
            <div className="space-y-2 text-sm text-gray-700 mb-6">
              <p><span className="font-medium">Total Value:</span> U.S. ${grandTotal}</p>
              {lineItems.some(i => i.packing) && (
                <>
                  <p><span className="font-medium">Packing:</span> {lineItems.map(i => i.packing).filter(p => p).join(', ')}</p>
                  <p className="text-xs text-gray-500 ml-4">*We need a quality control of photos before loading</p>
                  <p className="text-xs text-gray-500 ml-4">*Different colors Tapes for different products & Lots.</p>
                </>
              )}
              {(poData.deliveryTerms || poData.destination) && <p><span className="font-medium">Delivery Terms:</span> {poData.deliveryTerms} {poData.destination}</p>}
              {poData.deliveryDate && <p><span className="font-medium">Shipment Date:</span> {formatDate(poData.deliveryDate)}</p>}
              <p><span className="font-medium">Commission:</span> {poData.commission || '___________________'} + 18% GST</p>
              {poData.overseasCommission && <p><span className="font-medium">Overseas Commission:</span> {poData.overseasCommission}{poData.overseasCommissionCompany ? `, payable to ${poData.overseasCommissionCompany}` : ''}</p>}
              {poData.payment && <p><span className="font-medium">Payment:</span> {poData.payment}</p>}
              <p><span className="font-medium">Variation:</span> +/- 5% in Quantity & Value</p>
              <p><span className="font-medium">Labelling Details:</span> As per previous. (pls send for approval)</p>
              {poData.loteNumber && <p><span className="font-medium">Lote number:</span> {poData.loteNumber}</p>}
            </div>

            {/* Important Notes */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm mb-6">
              <p className="font-medium text-yellow-800 mb-2">Important Notes:</p>
              <ul className="text-yellow-700 space-y-1 list-disc list-inside">
                <li>Should be minimum 5 days free Dem/ Det/ Plug in on the B/L or on the shipping line's letterhead.</li>
                <li>Please send us Loading chart alongwith the docs & it should be mentioned the lot/code number.</li>
                <li>Please make plastic certificate.</li>
                <li>REQUIRED CERTIFICATE OF QUALITY OR FOOD SECURITY CERTIFICATE SUCH AS BRC, GLOBAL GAP ETC.</li>
                <li>Please use different color carton's tapes for different code.</li>
                <li>No Damaged boxes to be shipped.</li>
              </ul>
            </div>

            {/* Shipping Marks */}
            {poData.shippingMarks && <p className="text-sm mb-4"><span className="font-medium">Shipping Marks:</span> {poData.shippingMarks}</p>}

            {/* Please Note Section */}
            <div className="text-sm text-gray-600 mb-6">
              <p className="font-medium mb-2">Please Note:</p>
              {poData.buyerBank && <p>After the documents are negotiated, please send us the Courier Airway Bill no for the documents send by your Bank to buyers bank in {poData.buyerBank}.</p>}
              <p className="mt-2">While emailing us the shipment details, Please mention Exporter, Product, B/Ups, Packing, B/L No, Seal No, Container No, Vessel Name, ETD/ETA, Port Of Shipment / Destination and the Transfer of the Letter of Credit in whose Favour.</p>
              <p className="mt-2">Any Claim on Quality, Grading, Packing and Short weight for this particular consignment will be borne entirely by you and will be your sole responsibility.</p>
            </div>

            {/* Closing */}
            <div className="text-sm text-gray-700 mb-8">
              <p>Hope you find the above terms & conditions in order. Please put your Seal and Signature and send it to us as a token of your confirmation.</p>
              <p className="mt-4">Thanking You,</p>
            </div>

            {/* Signature */}
            <div className="mt-8">
              <p className="font-bold text-gray-800">Sumehr Rajnish Gwalani</p>
              <p className="text-gray-600">GANESH INTERNATIONAL</p>
              {status === 'approved' || status === 'sent' ? (
                <div className="mt-2 inline-block px-3 py-1 bg-green-100 text-green-700 rounded text-sm">
                  ✓ Signed & Approved
                </div>
              ) : null}
            </div>

            {/* Footer Note */}
            <div className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500">
              <p>FOOTNOTE: SUGGEST USE OF DATA LOGGER IN REFER CONTAINER USEFUL IN CASE OF TEMP. FLUCTUATION ON BOARD</p>
            </div>
          </div>

          {/* Bottom Action Bar */}
          <div className="p-6 border-t border-gray-200 bg-gray-50">
            {status === 'draft' && (
              <div className="flex items-center justify-between">
                <button onClick={() => setShowPreview(false)} className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 flex items-center gap-2">
                  <Icon name="Edit" size={16} /> Back to Edit
                </button>
                <button onClick={submitForApproval} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium shadow-sm">
                  <Icon name="CheckCircle" size={16} /> Submit for Sign-off
                </button>
              </div>
            )}
            {status === 'pending_approval' && (
              <div className="flex items-center justify-between">
                <button onClick={rejectPO} className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 flex items-center gap-2">
                  <Icon name="Edit" size={16} /> Back to Edit
                </button>
                <button onClick={approvePO} className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 font-medium shadow-sm">
                  <Icon name="CheckCircle" size={16} /> Approve & Sign
                </button>
              </div>
            )}
            {status === 'approved' && (
              <div className="flex items-center justify-between">
                <button onClick={rejectPO} className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 flex items-center gap-2">
                  <Icon name="Edit" size={16} /> Back to Edit
                </button>
                <button onClick={sendPO} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium shadow-sm">
                  <Icon name="Send" size={16} /> Send to Supplier
                </button>
              </div>
            )}
            {status === 'sent' && (
              <div className="flex items-center justify-center">
                <div className="px-6 py-2.5 bg-green-100 text-green-700 rounded-lg flex items-center gap-2 font-medium">
                  <Icon name="CheckCircle" size={16} /> Purchase Order Sent Successfully
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Form View */
        <div className="grid grid-cols-3 gap-6">
          {/* Left Column - Basic Details */}
          <div className="col-span-2 space-y-6">
            {/* Natural Language Parser */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl shadow-sm border border-blue-200 overflow-hidden">
              <button
                onClick={() => setShowParser(!showParser)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-100/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                    <Icon name="Mail" size={20} className="text-white" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold text-blue-800">Quick Fill from Email/Message</h3>
                    <p className="text-sm text-blue-600">Paste inquiry text to auto-extract product details</p>
                  </div>
                </div>
                <Icon name="ChevronDown" size={20} className={`text-blue-600 transition-transform ${showParser ? 'rotate-180' : ''}`} />
              </button>
              {showParser && (
                <div className="px-6 pb-6 space-y-4">
                  <textarea
                    value={rawInput}
                    onChange={(e) => setRawInput(e.target.value)}
                    placeholder="Paste email or message here...

Example:
'We need Product A U/3 - 2900 Kgs @ 7.9 USD and 3/6 - 2160 Kgs @ 7.2 USD CFR Destination. Packing 6x1 kg.'

The parser will extract: products, sizes, quantities, prices, buyer, supplier, destination, and packing information."
                    className="w-full h-36 px-4 py-3 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-none bg-white"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => parseNaturalLanguage(rawInput)}
                      className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 flex items-center gap-2 font-medium"
                    >
                      <Icon name="RefreshCw" size={16} /> Parse & Fill
                    </button>
                    <button
                      onClick={() => setRawInput('')}
                      className="px-4 py-2.5 bg-white text-gray-600 rounded-xl hover:bg-gray-100 border border-gray-200"
                    >
                      Clear
                    </button>
                    <span className="text-xs text-blue-600 ml-2">
                      Extracts: products, sizes (U/3, 20/40), quantities (kg/tons), prices ($USD), buyers, suppliers, packing
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Order Info Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Icon name="FileText" size={20} className="text-blue-600" />
                Order Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PO Number</label>
                  <input type="text" value={poData.poNumber} onChange={(e) => setPOData({...poData, poNumber: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={poData.date} onChange={(e) => setPOData({...poData, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
                  <select value={poData.supplierEmail} onChange={(e) => handleSupplierChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option value="">Select Supplier</option>
                    {suppliers.map(s => (
                      <option key={s.email} value={s.email}>{s.company}{s.country ? ` (${s.country})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Buyer / Principal *</label>
                  <select value={poData.buyer} onChange={(e) => { const buyer = buyers.find(b => b.company === e.target.value); handleBuyerChange(buyer?.email || ''); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option value="">Select Buyer</option>
                    {[...new Set(buyers.map(b => b.company))].map(company => (
                      <option key={company} value={company}>{company}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Description</label>
                  <input type="text" value={poData.product} onChange={(e) => setPOData({...poData, product: e.target.value})} placeholder="Product description" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>
            </div>

            {/* Product Line Items */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Icon name="Package" size={20} className="text-blue-600" />
                  Product Line Items
                </h3>
                <button onClick={addLineItem} className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-sm flex items-center gap-1">
                  <Icon name="Plus" size={14} /> Add Item
                </button>
              </div>
              <div className="overflow-x-auto">
                <div className="space-y-4">
                  {lineItems.map((item, idx) => (
                    <div key={idx} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-1 rounded-full">Product {idx + 1}</span>
                        {lineItems.length > 1 && (
                          <button onClick={() => removeLineItem(idx)} className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 rounded">
                            <Icon name="Trash2" size={18} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-4 mb-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Product Name</label>
                          <input type="text" value={item.product} onChange={(e) => updateLineItem(idx, 'product', e.target.value)} placeholder="Product name" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-medium" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Brand</label>
                          <input type="text" value={item.brand || ''} onChange={(e) => updateLineItem(idx, 'brand', e.target.value)} placeholder="Brand name" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
                          <input type="text" value={item.size} onChange={(e) => updateLineItem(idx, 'size', e.target.value)} placeholder="Size" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Glaze (Actual)</label>
                          <input type="text" value={item.glaze} onChange={(e) => updateLineItem(idx, 'glaze', e.target.value)} placeholder="e.g. 25%" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm" />
                          {/* Marked glaze row below */}
                          <label className="block text-xs font-medium text-orange-500 mb-1 mt-2">Marked As</label>
                          <input type="text" value={item.glazeMarked || ''} onChange={(e) => updateLineItem(idx, 'glazeMarked', e.target.value)} placeholder="e.g. 20%" className="w-full px-3 py-2.5 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-400 focus:border-orange-400 text-sm bg-orange-50" />
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Packing</label>
                          <input type="text" value={item.packing || ''} onChange={(e) => updateLineItem(idx, 'packing', e.target.value)} placeholder="Packing" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Cases</label>
                          <input type="number" value={item.cases || ''} onChange={(e) => updateLineItem(idx, 'cases', e.target.value)} placeholder="Auto" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-right font-medium bg-blue-50" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Total Kg</label>
                          <input type="number" value={item.kilos} onChange={(e) => updateLineItem(idx, 'kilos', e.target.value)} placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-right font-medium" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Price/Kg</label>
                          <div className="flex items-center w-full border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 bg-white overflow-hidden">
                            <select value={item.currency || 'USD'} onChange={(e) => updateLineItem(idx, 'currency', e.target.value)} className="pl-2.5 pr-0 py-2.5 text-sm text-gray-500 bg-transparent border-none focus:ring-0 focus:outline-none cursor-pointer font-medium" style={{width: '30px', WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none'}}>
                              <option value="USD">$</option>
                              <option value="EUR">€</option>
                              <option value="GBP">£</option>
                            </select>
                            <input type="number" step="0.01" value={item.pricePerKg} onChange={(e) => updateLineItem(idx, 'pricePerKg', e.target.value)} placeholder="0.00" className="w-full min-w-0 px-1 py-2.5 bg-transparent border-none focus:ring-0 focus:outline-none text-sm text-right" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Line Total</label>
                          <div className="w-full px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-right font-bold text-green-700">
                            {(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}{item.total || '0.00'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-4 bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl text-white">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-lg">Grand Total</span>
                    <div className="text-right">
                      <div className="text-blue-200 text-sm">{totalCases} Cases | {totalKilos} Kg</div>
                      <div className="text-2xl font-bold">${grandTotal}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Shipping & Terms */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Icon name="Package" size={20} className="text-blue-600" />
                Shipping & Terms
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
                  <input type="text" value={poData.destination} onChange={(e) => setPOData({...poData, destination: e.target.value})} placeholder="Destination" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Terms</label>
                  <select value={poData.deliveryTerms} onChange={(e) => setPOData({...poData, deliveryTerms: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="CFR">CFR (Cost & Freight)</option>
                    <option value="CIF">CIF (Cost, Insurance & Freight)</option>
                    <option value="FOB">FOB (Free on Board)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delivery / Shipment Date</label>
                  <input type="date" value={poData.deliveryDate} onChange={(e) => setPOData({...poData, deliveryDate: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Commission</label>
                  <input type="text" value={poData.commission} onChange={(e) => setPOData({...poData, commission: e.target.value})} placeholder="Commission" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Overseas Commission</label>
                  <input type="text" value={poData.overseasCommission} onChange={(e) => setPOData({...poData, overseasCommission: e.target.value})} placeholder="Leave blank if N/A" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                {poData.overseasCommission && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payable To (Company)</label>
                  <input type="text" value={poData.overseasCommissionCompany} onChange={(e) => setPOData({...poData, overseasCommissionCompany: e.target.value})} placeholder="Company name for payment" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                  <input type="text" value={poData.payment} onChange={(e) => setPOData({...poData, payment: e.target.value})} placeholder="Payment terms" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lote Number</label>
                  <input type="text" value={poData.loteNumber} onChange={(e) => setPOData({...poData, loteNumber: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Marks</label>
                  <input type="text" value={poData.shippingMarks} onChange={(e) => setPOData({...poData, shippingMarks: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Buyer's Bank Location</label>
                  <input type="text" value={poData.buyerBank} onChange={(e) => setPOData({...poData, buyerBank: e.target.value})} placeholder="Bank location" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Summary & Actions */}
          <div className="space-y-6">
            {/* Summary Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Order Summary</h3>

              {/* PO Number with Buyer Code */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">Purchase Order Number</div>
                <div className="text-lg font-bold text-gray-800 font-mono">{poData.poNumber}</div>
                {poData.buyerCode && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                      Series: {poData.buyerCode}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({poData.buyer})
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Supplier</span>
                  <span className="font-medium text-right max-w-32 truncate">{poData.supplier || '-'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Buyer</span>
                  <span className="font-medium">{poData.buyer || '-'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Line Items</span>
                  <span className="font-medium">{lineItems.filter(i => i.product).length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Cases</span>
                  <span className="font-medium">{totalCases}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Kilos</span>
                  <span className="font-medium">{totalKilos} Kg</span>
                </div>
                <div className="border-t border-gray-100 pt-3 flex justify-between">
                  <span className="font-medium text-gray-700">Total Value</span>
                  <span className="font-bold text-lg text-blue-600">${grandTotal}</span>
                </div>
              </div>
            </div>

            {/* Actions Card */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 border border-blue-200">
              <h3 className="text-lg font-semibold text-blue-800 mb-4">Actions</h3>
              <div className="space-y-3">
                <button onClick={() => setShowPreview(true)} className="w-full px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 border border-blue-200 flex items-center justify-center gap-2">
                  <Icon name="Eye" size={16} /> Preview PO
                </button>
                <button onClick={submitForApproval} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2">
                  <Icon name="CheckCircle" size={16} /> Submit for Sign-off
                </button>
              </div>
            </div>

            {/* Quick Info */}
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Workflow</h4>
              <ol className="text-xs text-gray-600 space-y-1">
                <li className={`flex items-center gap-2 ${status === 'draft' ? 'text-blue-600 font-medium' : ''}`}>
                  <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs">1</span>
                  Fill in details
                </li>
                <li className={`flex items-center gap-2 ${status === 'pending_approval' ? 'text-blue-600 font-medium' : ''}`}>
                  <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs">2</span>
                  Review & sign-off
                </li>
                <li className={`flex items-center gap-2 ${status === 'approved' ? 'text-blue-600 font-medium' : ''}`}>
                  <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs">3</span>
                  Approve
                </li>
                <li className={`flex items-center gap-2 ${status === 'sent' ? 'text-blue-600 font-medium' : ''}`}>
                  <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs">4</span>
                  Send to supplier
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default POGeneratorPage;
