import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import html2pdf from 'html2pdf.js';
import Icon from '../components/Icon';
import { ORDER_STAGES, BUYER_CODES, GI_LOGO_URL } from '../data/constants';
import { GILogo } from '../components/Logos';
import { supabase } from '../lib/supabase';
import type { ContactsMap, Order, LineItem, POFormData } from '../types';

interface Props {
  contacts?: ContactsMap;
  orders?: Order[];
  setOrders?: (updater: (prev: Order[]) => Order[]) => void;
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
  freezing: string;
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

function POGeneratorPage({ contacts = {}, orders = [], setOrders, onOrderCreated }: Props) {
  const navigate = useNavigate();

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
    { product: '', size: '', glaze: '', glazeMarked: '', packing: '', brand: '', freezing: '', cases: '', kilos: '', pricePerKg: '', currency: 'USD', total: 0 }
  ]);

  const [status, setStatus] = useState('draft'); // draft, pending_approval, approved, sent
  const [showPreview, setShowPreview] = useState(false);
  const [showSignOff, setShowSignOff] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [showParser, setShowParser] = useState(true);
  const [rawInput, setRawInput] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [ccEmails, setCcEmails] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [buyerSearch, setBuyerSearch] = useState('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [showBuyerDropdown, setShowBuyerDropdown] = useState(false);
  const [bulkCreate, setBulkCreate] = useState(false);
  const [bulkCount, setBulkCount] = useState(2);
  const [bulkPreviewIndex, setBulkPreviewIndex] = useState(0);
  const [signatureData, setSignatureData] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const poDocRef = useRef<HTMLDivElement>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);
  const buyerDropdownRef = useRef<HTMLDivElement>(null);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) {
        setShowSupplierDropdown(false);
      }
      if (buyerDropdownRef.current && !buyerDropdownRef.current.contains(e.target as Node)) {
        setShowBuyerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load saved signature from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('gi_signature');
    if (saved) setSignatureData(saved);
  }, []);

  // Signature drawing helpers
  const initCanvas = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getCanvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const saveSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    setSignatureData(dataUrl);
    localStorage.setItem('gi_signature', dataUrl);
    setShowSignaturePad(false);
    setNotification({ type: 'success', message: 'Signature saved! It will appear on your POs.' });
    setTimeout(() => setNotification(null), 3000);
  };

  const clearCanvas = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotification({ type: 'error', message: 'Please upload an image file (PNG, JPG).' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setSignatureData(dataUrl);
      localStorage.setItem('gi_signature', dataUrl);
      setShowSignaturePad(false);
      setNotification({ type: 'success', message: 'Signature uploaded and saved!' });
      setTimeout(() => setNotification(null), 3000);
    };
    reader.readAsDataURL(file);
  };

  const removeSignature = () => {
    setSignatureData('');
    localStorage.removeItem('gi_signature');
    setNotification({ type: 'info', message: 'Signature removed.' });
    setTimeout(() => setNotification(null), 3000);
  };

  // Natural language parser function - handles Spanish, abbreviations, multi-product
  const parseNaturalLanguage = (text: string) => {
    if (!text.trim()) {
      setNotification({ type: 'error', message: 'Please paste some text to parse.' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Pre-process: normalize input for consistent parsing
    const rawLines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
    const lines = rawLines.map((l: string) => {
      let s = l;
      // Normalize dashes: em-dash, en-dash → hyphen
      s = s.replace(/[–—]/g, '-');
      // Remove trailing periods/dots (common in informal input)
      s = s.replace(/\.\s*$/, '');
      // Normalize multiple spaces
      s = s.replace(/\s{2,}/g, ' ');
      // Strip line numbering (1., 2., a), b), etc.)
      s = s.replace(/^\d+[.)]\s+/, '');
      s = s.replace(/^[a-z][.)]\s+/i, '');
      // Normalize kgs/kilos → kg
      s = s.replace(/\bkgs\b/gi, 'kg');
      s = s.replace(/\bkilos?\b/gi, 'kg');
      // Normalize "metric ton(s)" → "MT"
      s = s.replace(/\bmetric\s+tons?\b/gi, 'MT');
      return s.trim();
    }).filter((s: string) => s.length > 0);
    const textLower = text.toLowerCase();

    // Build buyer abbreviations dynamically from contacts (always synced with DB)
    const buyerAbbreviations: Record<string, string> = {};
    const buyerContacts = Object.entries(contacts)
      .filter(([_, c]) => (c.role || '').toLowerCase().includes('buyer'))
      .map(([email, c]) => ({ email, ...c }));
    for (const b of buyerContacts) {
      const company = b.company;
      buyerAbbreviations[company.toLowerCase()] = company;
      const words = company.split(/[\s/.\-]+/).filter((w: string) => w.length > 1);
      for (const word of words) {
        if (!buyerAbbreviations[word.toLowerCase()]) {
          buyerAbbreviations[word.toLowerCase()] = company;
        }
      }
    }
    // Custom buyer shortcuts (resolve against actual contacts)
    const customBuyerCodes: Record<string, string> = { 'eg': 'guillem', 'dagustin': 'dagustin' };
    for (const [code, searchTerm] of Object.entries(customBuyerCodes)) {
      if (!buyerAbbreviations[code]) {
        const match = buyerContacts.find(b => b.company.toLowerCase().includes(searchTerm));
        if (match) buyerAbbreviations[code] = match.company;
      }
    }

    // Build supplier abbreviations dynamically from contacts (always synced with DB)
    const supplierAbbreviations: Record<string, string> = {};
    const supplierContacts = Object.entries(contacts)
      .filter(([_, c]) => (c.role || '').toLowerCase().includes('supplier'))
      .map(([email, c]) => ({ email, ...c }));
    for (const s of supplierContacts) {
      const company = s.company;
      supplierAbbreviations[company.toLowerCase()] = company;
      const words = company.split(/[\s/.\-]+/).filter((w: string) => w.length > 1);
      for (const word of words) {
        if (!supplierAbbreviations[word.toLowerCase()]) {
          supplierAbbreviations[word.toLowerCase()] = company;
        }
      }
    }
    // Custom supplier shortcuts (resolve against actual contacts)
    const customSupplierCodes: Record<string, string> = { 'jj': 'raunaq' };
    for (const [code, searchTerm] of Object.entries(customSupplierCodes)) {
      if (!supplierAbbreviations[code]) {
        const match = supplierContacts.find(s => s.company.toLowerCase().includes(searchTerm));
        if (match) supplierAbbreviations[code] = match.company;
      }
    }

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
      'cuttlefish whole cleaned': 'Cuttlefish Whole Cleaned',
      'cuttlefish squid mix': 'Cuttlefish Squid Mix',
      'skewers': 'Seafood Skewers',
      'squid whole cleaned': 'Squid Whole Cleaned',
      'squid whole': 'Squid Whole',
      'squid rings': 'Squid Rings',
      'squid ring': 'Squid Rings',
      'squid tube': 'Squid Tubes',
      'squid tubes': 'Squid Tubes',
      'squid tentacle': 'Squid Tentacles',
      'squid tentacles': 'Squid Tentacles',
      'baby squid': 'Baby Squid',
      'baby octopus': 'Baby Octopus',
      'vannamei pud': 'Vannamei PUD',
      'vannamei hlso': 'Vannamei HLSO',
      'vannamei pd': 'Vannamei PD',
      'vannamei hoso': 'Vannamei HOSO',
      'calamar troceado': 'Cut Squid',
      'calamar entero': 'Whole Squid',
      'sepia entera': 'Whole Cuttlefish',
      'sepia troceada': 'Cut Cuttlefish',
      'sepia limpia': 'Cuttlefish Whole Cleaned',
      'cut squid skin on': 'Cut Squid Skin On',
      'cut squid skinon': 'Cut Squid Skin On',
      'cut squid skin off': 'Cut Squid Skin Off',
      'cut cuttlefish': 'Cut Cuttlefish',
      'whole cuttlefish': 'Whole Cuttlefish',
      'whole squid': 'Whole Squid',
      'octopus whole': 'Octopus Whole',
      'whole octopus': 'Whole Octopus',
      'french fries': 'French Fries',
      'potato wedges': 'Potato Wedges',
    };

    // Product abbreviation map
    const productAbbreviations: Record<string, string> = {
      'cfwc': 'Cuttlefish Whole Cleaned',
      'cf': 'Cuttlefish',
      'sqwc': 'Squid Whole Cleaned',
      'sq': 'Squid',
      'oct': 'Octopus',
      'bsq': 'Baby Squid',
      'vn': 'Vannamei',
      'cskinon': 'Cut Squid Skin On',
      'cskinoff': 'Cut Squid Skin Off',
    };

    // Seafood keywords for auto-adding "Frozen" prefix and product detection
    const seafoodKeywords = ['cuttlefish', 'squid', 'octopus', 'shrimp', 'prawn', 'fish', 'seafood', 'vannamei', 'lobster', 'crab', 'mussel', 'clam', 'scallop', 'anchovy', 'sardine', 'tuna', 'salmon', 'cod', 'hake', 'sole', 'skewer', 'roe', 'surimi', 'pangasius', 'tilapia', 'mackerel', 'swordfish', 'monkfish', 'seabass', 'seabream', 'grouper', 'snapper', 'pomfret', 'ribbon', 'croaker', 'threadfin', 'cuttle'];
    const friesKeywords = ['fries', 'french fries', 'potato', 'wedges'];
    // Words that strongly indicate a product line (beyond seafood keywords)
    const productIndicatorWords = ['cut', 'baby', 'ring', 'rings', 'tube', 'tubes', 'tentacle', 'tentacles', 'whole', 'frozen', 'cleaned', 'skinon', 'skinoff', 'skin', 'fillet', 'steak', 'portion', 'loin'];

    // Helper: resolve product name from abbreviations and translations, add Frozen prefix
    const resolveProductName = (rawName: string): string => {
      let productName = rawName;
      const nameLower = rawName.toLowerCase();

      // Check product translations first
      for (const [sp, en] of Object.entries(productTranslations)) {
        if (nameLower.includes(sp.toLowerCase())) {
          productName = en;
          break;
        }
      }

      // Check abbreviations (e.g. CFWC → Cuttlefish Whole Cleaned)
      if (productName === rawName) {
        const words = rawName.split(/\s+/);
        const firstWordLower = words[0].toLowerCase();
        if (productAbbreviations[firstWordLower]) {
          const rest = words.slice(1).filter(w => w.toLowerCase() !== 'iqf' && !w.match(/^\d/)).join(' ');
          productName = productAbbreviations[firstWordLower] + (rest ? ' ' + rest : '');
        }
      }

      // Handle WC abbreviation anywhere
      if (productName.toLowerCase().includes(' wc')) {
        productName = productName.replace(/\s+wc/i, ' Whole Cleaned');
      }

      // Remove freezing method keywords from product name (these go in the separate Freezing field)
      productName = productName.replace(/\s+(?:semi\s*)?iqf\b/gi, '').replace(/\s+blast\b/gi, '').replace(/\s+block\b/gi, '').replace(/\s+plate\b/gi, '').trim();

      // Preserve processing styles (PBO, PND, HLSO, etc.) from the original name
      const processingStylesSet = ['pbo', 'pnd', 'pd', 'hlso', 'hoso', 'pud', 'pdto', 'cpto', 'pto', 'ezp', 'butterfly'];
      for (const ps of processingStylesSet) {
        const psRegex = new RegExp(`\\b${ps}\\b`, 'i');
        if (psRegex.test(rawName) && !psRegex.test(productName)) {
          productName += ' ' + ps.toUpperCase();
        }
      }

      // Auto-add "Frozen" prefix
      const productLower = productName.toLowerCase();
      const needsFrozen = [...seafoodKeywords, ...friesKeywords].some(kw => productLower.includes(kw));
      if (needsFrozen && !productLower.startsWith('frozen')) {
        productName = 'Frozen ' + productName;
      }
      return productName;
    };

    // Helper: extract packing from a line (e.g. "6kg Bulk", "6x1kg", "6 x 1 kg bags")
    const extractPacking = (text: string): string => {
      const tl = text.toLowerCase();
      const bulkMatch = text.match(/(\d+)\s*kg\s*(?:bulk|granel)/i);
      if (bulkMatch) return bulkMatch[1] + ' kg Bulk';
      const multiMatch = text.match(/(\d+)\s*[xX]\s*(\d+)\s*kg/i);
      if (multiMatch) {
        let packing = multiMatch[1] + 'x' + multiMatch[2] + ' kg';
        if (tl.includes('printed bag') || tl.includes('bolsa imprimida') || tl.includes('imprimida')) packing += ' Printed Bag';
        else if (tl.includes('bolsa con rider') || tl.includes('con rider')) packing += ' Bag with Rider';
        else if (tl.includes('bag') || tl.includes('bolsa')) packing += ' Bag';
        else if (tl.includes('carton') || tl.includes('ctn')) packing += ' Carton';
        else if (tl.includes('bulk') || tl.includes('granel')) packing += ' Bulk';
        return packing;
      }
      const directMatch = text.match(/(\d+)\s*kg/i);
      if (directMatch && (tl.includes('bulk') || tl.includes('granel'))) return directMatch[1] + ' kg Bulk';
      return '';
    };

    // Helper: extract packing descriptor from a line that has packing type info
    const extractPackingDescriptor = (text: string): string => {
      const tl = text.toLowerCase();
      if (tl.includes('printed bag') || tl.includes('printed bags')) return 'Printed Bag';
      if (tl.includes('bolsa con rider') || tl.includes('con rider')) return 'Bag with Rider';
      if (tl.includes('bolsa imprimida') || tl.includes('imprimida')) return 'Printed Bag';
      if (tl.includes('bag') || tl.includes('bolsa')) return 'Bag';
      if (tl.includes('carton') || tl.includes('ctn') || tl.includes('cartons')) return 'Carton';
      if (tl.includes('bulk') || tl.includes('granel')) return 'Bulk';
      return '';
    };

    // Helper: detect currency from text (returns 'USD' or 'EUR')
    const detectCurrency = (text: string): string => {
      if (/€|eur\b/i.test(text)) return 'EUR';
      return 'USD';
    };

    // Helper: extract price from a line (handles $, €, USD, EUR, bare numbers near keywords)
    const extractPrice = (text: string): { price: string; currency: string } | null => {
      // $4.50 or 4.50$ or €4.50 or 4.50€
      const currSymbol = text.match(/[\$€]\s*([\d.]+)/) || text.match(/([\d.]+)\s*[\$€]/);
      if (currSymbol) {
        return { price: currSymbol[1], currency: /€/.test(text) ? 'EUR' : 'USD' };
      }
      // USD 4.50 or 4.50 USD or EUR 4.50 or 4.50 EUR
      const currWord = text.match(/(?:USD|EUR)\s*([\d.]+)/i) || text.match(/([\d.]+)\s*(?:USD|EUR)/i);
      if (currWord) {
        return { price: currWord[1], currency: /eur/i.test(text) ? 'EUR' : 'USD' };
      }
      // "per kg" pattern: 4.50/kg or 4.50 per kg
      const perKg = text.match(/([\d.]+)\s*(?:\/kg|per\s*kg)/i);
      if (perKg) {
        return { price: perKg[1], currency: detectCurrency(text) };
      }
      return null;
    };

    // Helper: check if a word is a known buyer or supplier abbreviation
    const isKnownAbbreviation = (word: string): boolean => {
      const w = word.toLowerCase();
      return !!(buyerAbbreviations[w] || supplierAbbreviations[w]);
    };

    // Helper: score a line for how likely it is a product line
    const scoreAsProduct = (line: string): number => {
      const ll = line.toLowerCase();
      let score = 0;
      // Contains seafood/product keyword: strong signal
      if ([...seafoodKeywords, ...friesKeywords].some(kw => ll.includes(kw))) score += 3;
      // Contains product indicator word
      if (productIndicatorWords.some(kw => new RegExp(`\\b${kw}\\b`).test(ll))) score += 2;
      // Starts with a letter (not a number)
      if (/^[a-zA-Z]/.test(line)) score += 1;
      // Matches a known product abbreviation
      const firstWord = ll.split(/[\s,./]+/)[0];
      if (productAbbreviations[firstWord]) score += 4;
      // Matches a known product translation
      for (const key of Object.keys(productTranslations)) {
        if (ll.includes(key)) { score += 3; break; }
      }
      // Negative signals: contains price, MT/ton, percentage, or known buyer/supplier abbreviation
      if (/[\$€]/.test(line) || /\b(?:MT|tons?)\b/i.test(line)) score -= 2;
      if (/\d+%/.test(line)) score -= 1;
      if (/\d+\s*[xX]\s*\d+\s*kg/i.test(line)) score -= 2; // packing line
      if (ll.includes('glaze') || ll.includes('glaseo')) score -= 2;
      if (ll.includes('packing') || ll.includes('granel') || ll.includes('bolsa')) score -= 2;
      if (ll.includes('marked as') || ll.includes('marked ')) score -= 2;
      // If it's ONLY a buyer/supplier abbreviation (like "EG JJ"), it's not a product
      const words = ll.split(/[\s,]+/).filter((w: string) => w.length > 0);
      const allAbbreviations = words.every((w: string) => isKnownAbbreviation(w) || w.length <= 1);
      if (allAbbreviations && words.length <= 4) score -= 5;
      return score;
    };

    // Helper: extract brand from parentheses like "(Marca Oliver)", "( PBO )", "(Marca Bautismar)"
    // Processing styles that go in the product name, NOT as a brand
    const processingStyles = ['pbo', 'pnd', 'pd', 'hlso', 'hoso', 'pud', 'pdto', 'cpto', 'pto', 'ezp', 'butterfly'];

    const extractBrand = (text: string): { brand: string; cleaned: string; spec: string } => {
      // 1) Check for parenthesized brands: (Marca Oliver), (Bautismar), etc.
      const brandMatch = text.match(/\(\s*(?:Marca\s+)?(.+?)\s*\)/i);
      if (brandMatch) {
        const inner = brandMatch[1].trim();
        // If it's a processing style, keep it in the product name, not as a brand
        if (processingStyles.some(ps => inner.toLowerCase() === ps.toLowerCase())) {
          // Processing style found in parens — remove parens, keep style in name
          const cleanedText = text.replace(/\s*\(.*?\)\s*/g, ' ' + inner + ' ').trim();
          // Still check for a standalone brand outside the parens, e.g. "BABY SQUID IQF ( PBO ) EG brand"
          const standaloneBrand = cleanedText.match(/\b(\w+)\s+brand\b/i);
          if (standaloneBrand) {
            const brandName = standaloneBrand[1].trim();
            const finalCleaned = cleanedText.replace(/\s*\b\w+\s+brand\b/i, '').trim();
            return { brand: brandName, cleaned: finalCleaned, spec: inner.toUpperCase() };
          }
          return { brand: '', cleaned: cleanedText, spec: inner.toUpperCase() };
        }
        return { brand: inner, cleaned: text.replace(/\s*\(.*?\)\s*/g, ' ').trim(), spec: '' };
      }
      // 2) Check for standalone brand pattern: "EG Brand", "Oliver brand", etc. (no parentheses)
      const standaloneBrand = text.match(/\b(\w+)\s+brand\b/i);
      if (standaloneBrand) {
        const brandName = standaloneBrand[1].trim();
        const cleaned = text.replace(/\s*\b\w+\s+brand\b/i, '').trim();
        return { brand: brandName, cleaned, spec: '' };
      }
      return { brand: '', cleaned: text, spec: '' };
    };

    // Helper: detect freezing method from text (IQF, Semi IQF, Blast, Block, Plate)
    const detectFreezing = (text: string): string => {
      const t = text.toLowerCase();
      if (/\bsemi[\s-]*iqf\b/i.test(t)) return 'Semi IQF';
      if (/\biqf\b/i.test(t) || /\bindividually\s+quick\s*frozen\b/i.test(t)) return 'IQF';
      if (/\bair[\s-]*blast\b/i.test(t) || /\bblast[\s-]*(?:frozen|freeze|freezing)?\b/i.test(t)) return 'Blast';
      if (/\bblock[\s-]*(?:frozen|freeze|freezing)?\b/i.test(t)) return 'Block';
      if (/\bplate[\s-]*(?:frozen|freeze|freezing)?\b/i.test(t)) return 'Plate';
      return '';
    };

    // Parse multi-product blocks
    const productBlocks: any[] = [];
    let currentBlock: any = null;
    // Template for header-with-subrows format (stores shared product/packing/glaze)
    let headerTemplate: any = null;
    // Global packing/glaze that applies to all products (e.g. "6x1kg printed bags for all products")
    let globalPacking = '';
    let globalGlaze = '';
    // Buyer/supplier detection (declared early so inline detection can set them)
    let detectedBuyer = '';
    let detectedSupplier = '';
    let detectedSupplierEmail = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();

      // Skip TOTAL lines and Container labels
      if (lineLower.match(/^total\b/i)) continue;
      if (lineLower.match(/^container\s*\d+/i)) continue;

      // Skip instruction/comment lines (e.g. "please only prepare as they might add...")
      const isInstructionLine = (
        lineLower.includes('please only prepare') || lineLower.includes('please prepare') ||
        lineLower.includes('might add') || lineLower.includes('they may add') ||
        lineLower.startsWith('note:') || lineLower.startsWith('notes:') ||
        lineLower.startsWith('special request') || lineLower.startsWith('important:') ||
        lineLower.startsWith('attention:') || lineLower.startsWith('reminder:') ||
        lineLower.startsWith('fyi') || lineLower.startsWith('ps:') || lineLower.startsWith('p.s') ||
        (lineLower.includes('please') && lineLower.includes('confirm')) ||
        (lineLower.includes('let me know') || lineLower.includes('let us know')) ||
        lineLower.startsWith('thank') || lineLower.startsWith('regards') || lineLower.startsWith('best,')
      );
      if (isInstructionLine) continue;

      // === GLOBAL PACKING: "6x1kg printed bags for all products" or "packing for all: 6x1kg bag" ===
      if (lineLower.includes('for all') || lineLower.includes('all products') || lineLower.includes('all items')) {
        const packMatch = line.match(/(\d+\s*[xX]\s*\d+\s*(?:kilo?|kg)?)/i);
        if (packMatch) {
          let packing = packMatch[1].replace(/kilo/i, 'kg');
          if (lineLower.includes('printed bag') || lineLower.includes('bolsa imprimida') || lineLower.includes('imprimida')) {
            packing += ' Printed Bag';
          } else if (lineLower.includes('bolsa con rider') || lineLower.includes('con rider')) {
            packing += ' Bag with Rider';
          } else if (lineLower.includes('bag') || lineLower.includes('bolsa')) {
            packing += ' Bag';
          } else if (lineLower.includes('bulk') || lineLower.includes('granel')) {
            packing += ' Bulk';
          }
          globalPacking = packing;
        }
        const bulkMatch = line.match(/(\d+)\s*(?:kg|kilo)\s*(?:bulk|granel)/i);
        if (bulkMatch && !packMatch) {
          globalPacking = bulkMatch[1] + ' kg Bulk';
        }
        // Check for glaze in the same line
        const glazeMatch = line.match(/(\d+)%\s*(?:glaseo|glaze)/i);
        if (glazeMatch) {
          globalGlaze = glazeMatch[1] + '% Glaze';
        }
        // Apply to current block if it exists
        if (currentBlock && !currentBlock.packing) currentBlock.packing = globalPacking;
        if (currentBlock && !currentBlock.glaze && globalGlaze) currentBlock.glaze = globalGlaze;
        continue;
      }

      // === FORMAT 3: "PACKING - 6 X 1 KG BAG 25% GLAZE" line (belongs to previous product block) ===
      const isPackingLine = lineLower.match(/^packing\s*[-–:]/i);
      if (isPackingLine && currentBlock) {
        // Extract packing from this line
        const packMatch = line.match(/(\d+\s*[xX]\s*\d+\s*(?:kg|kilo)?)/i);
        if (packMatch) {
          let packing = packMatch[1].replace(/kilo/i, 'kg');
          if (lineLower.includes('bag') || lineLower.includes('bolsa')) {
            packing += ' Bag';
          } else if (lineLower.includes('bulk') || lineLower.includes('granel')) {
            packing += ' Bulk';
          }
          currentBlock.packing = packing;
        }
        const bulkPackMatch = line.match(/(\d+)\s*(?:kg|kilo)\s*(?:bulk|granel)/i);
        if (bulkPackMatch && !packMatch) {
          currentBlock.packing = bulkPackMatch[1] + ' kg Bulk';
        }
        // Extract glaze from same line
        const glazeMatch = line.match(/(\d+)%\s*(?:glaseo|glaze)/i);
        if (glazeMatch) {
          currentBlock.glaze = glazeMatch[1] + '% Glaze';
        }
        continue;
      }

      // === FORMAT 4: Compact size+MT+price line: "40/60  07 MT  3.30 $" or "10/20 7MT$5.80" ===
      // Also handles "20/40 10MT $4.60", "80/UP  04 MT  2.65 $", "20-40 = 5 ton 4.50 $"
      const compactSizeMtPrice = line.match(/^(\d+[-/]\d+|U[-/]\d+|\d+[-/](?:UP|up))\s+(\d+)\s*(?:MT|tons?)\s*\$?\s*([\d.]+)\s*\$?/i);
      if (compactSizeMtPrice) {
        if (currentBlock) {
          // If current block already has a size, save it as a separate product and create a new one
          if (currentBlock.size && currentBlock.kilos) {
            productBlocks.push(currentBlock);
            currentBlock = {
              ...currentBlock,
              size: compactSizeMtPrice[1],
              kilos: (parseFloat(compactSizeMtPrice[2]) * 1000).toString(),
              pricePerKg: compactSizeMtPrice[3],
              cases: '',
              notes: ''
            };
          } else {
            currentBlock.size = compactSizeMtPrice[1];
            currentBlock.kilos = (parseFloat(compactSizeMtPrice[2]) * 1000).toString();
            currentBlock.pricePerKg = compactSizeMtPrice[3];
          }
        } else {
          // Standalone compact line — inherit product from previous block if possible
          const prevBlock = productBlocks.length > 0 ? productBlocks[productBlocks.length - 1] : null;
          currentBlock = {
            product: prevBlock?.product || '',
            size: compactSizeMtPrice[1],
            glaze: prevBlock?.glaze || '',
            glazeMarked: '',
            freezing: prevBlock?.freezing || '',
            kilos: (parseFloat(compactSizeMtPrice[2]) * 1000).toString(),
            pricePerKg: compactSizeMtPrice[3],
            packing: prevBlock?.packing || '',
            brand: prevBlock?.brand || '',
            cases: '',
            notes: ''
          };
        }
        continue;
      }

      // === FORMAT 4b: "Size = Qty ton(s) Price $" (e.g. "20-40 = 5 ton 4.50 $") ===
      const sizeEqualsQtyPrice = line.match(/^(\d+[-/]\d+|U[-/]\d+|\d+[-/](?:UP|up))\s*=\s*(\d+)\s*(?:MT|tons?)\s*\$?\s*([\d.]+)\s*\$?/i);
      if (sizeEqualsQtyPrice && currentBlock) {
        const newSize = sizeEqualsQtyPrice[1].replace(/-/g, '/');
        const newKilos = (parseFloat(sizeEqualsQtyPrice[2]) * 1000).toString();
        const newPrice = sizeEqualsQtyPrice[3];
        if (currentBlock.size && currentBlock.kilos) {
          productBlocks.push(currentBlock);
          currentBlock = {
            ...currentBlock,
            size: newSize,
            kilos: newKilos,
            pricePerKg: newPrice,
            cases: '',
            notes: ''
          };
        } else {
          currentBlock.size = newSize;
          currentBlock.kilos = newKilos;
          currentBlock.pricePerKg = newPrice;
        }
        continue;
      }

      // === FORMAT 5: Compact "Product-QuantityMT $Price" or "Product-Size QuantityMT $Price" ===
      // Handles: "Cut Squid-3MT $3.90", "Cut Squid 20MT $3.90", "Cut Squid-20/40 3MT $3.90"
      const productSizeMtMatch = line.match(/^([a-zA-Z][a-zA-Z\s]+?)\s*[-–]?\s*(\d+[-/]\d+|U[-/]\d+|\d+[-/](?:UP|up))?\s*(\d+)\s*(?:MT|tons?)\s*\$?\s*([\d.]+)\s*\$?/i);
      if (productSizeMtMatch && !isPackingLine && !lineLower.match(/^packing/i)) {
        const possibleProduct = productSizeMtMatch[1].trim();
        const isProductName = scoreAsProduct(possibleProduct) >= 2;

        if (isProductName) {
          if (currentBlock) productBlocks.push(currentBlock);
          const productName = resolveProductName(possibleProduct);
          currentBlock = {
            product: productName,
            size: productSizeMtMatch[2] || '',
            glaze: '',
            glazeMarked: '',
            freezing: detectFreezing(possibleProduct),
            kilos: (parseFloat(productSizeMtMatch[3]) * 1000).toString(),
            pricePerKg: productSizeMtMatch[4],
            packing: '',
            brand: '',
            cases: '',
            notes: ''
          };
          continue;
        }
      }

      // === FORMAT 2: Header with inline packing+glaze, followed by size/cases/price sub-rows ===
      // Detect header like "CFWC IQF 6kg Bulk with 20% Glaze"
      const isHeaderWithDetails = /^[a-zA-Z]/.test(line) &&
        (lineLower.includes('glaze') || lineLower.includes('glaseo')) &&
        lineLower.match(/\d+\s*(?:kg|kilo)/i) &&
        !isPackingLine &&
        line.length > 10;

      // Detect sub-row like "U/1  150c/s  7.30$/kg" or "Large  200c/s  5.60$/kg"
      const casesRowMatch = line.match(/^(\S+(?:\s+\S+)?)\s+(\d+)\s*c\/s\s+(?:\$?\s*)?(\d+\.?\d*)\s*(?:\$\/kg)?/i);

      if (isHeaderWithDetails) {
        // Save any pending block from previous product
        if (currentBlock) productBlocks.push(currentBlock);
        currentBlock = null;

        // Parse the header line
        // Extract glaze
        const glazeMatch = lineLower.match(/(\d+)%\s*(?:glaseo|glaze)/i);
        const glaze = glazeMatch ? glazeMatch[1] + '% Glaze' : '';

        // Extract marked glaze
        const markedMatch = lineLower.match(/marked\s*(?:as)?\s*(\d+)%/i);
        const glazeMarked = markedMatch ? markedMatch[1] + '% Glaze' : '';

        // Extract packing from the header
        const packing = extractPacking(line);

        // Extract product name: everything before packing/glaze numbers
        let rawProductName = line.replace(/\s+(?:with\s+)?\d+%\s*(?:glaseo|glaze).*/i, '')
                                 .replace(/\s+\d+\s*(?:kg|kilo).*$/i, '')
                                 .replace(/\s+\d+\s*[xX]\s*\d+.*$/i, '')
                                 .trim();

        const productName = resolveProductName(rawProductName);

        const freezing = detectFreezing(line);
        headerTemplate = { product: productName, glaze, glazeMarked, packing, freezing };
        continue;
      }

      if (casesRowMatch && headerTemplate) {
        // This is a sub-row under a header — create a line item variant
        const size = casesRowMatch[1].trim();
        const cases = casesRowMatch[2];
        const price = casesRowMatch[3];

        // Calculate kilos from cases * packing kg per carton
        const packingKgMatch = headerTemplate.packing.match(/(\d+)\s*[xX]\s*(\d+)/);
        const bulkKgMatch = headerTemplate.packing.match(/^(\d+)\s*kg/i);
        let kgPerCase = 0;
        if (packingKgMatch) {
          kgPerCase = parseInt(packingKgMatch[1]) * parseInt(packingKgMatch[2]);
        } else if (bulkKgMatch) {
          kgPerCase = parseInt(bulkKgMatch[1]);
        }
        const kilos = kgPerCase > 0 ? (parseInt(cases) * kgPerCase).toString() : '';

        productBlocks.push({
          product: headerTemplate.product,
          size,
          glaze: headerTemplate.glaze,
          glazeMarked: headerTemplate.glazeMarked,
          freezing: headerTemplate.freezing || '',
          kilos,
          cases,
          pricePerKg: price,
          packing: headerTemplate.packing,
          brand: '',
          notes: ''
        });
        continue;
      }

      // If we hit a non-cases line while in header mode, close the template
      if (headerTemplate && /^[a-zA-Z]/.test(line) && !casesRowMatch) {
        headerTemplate = null;
      }

      // === Buyer/Supplier abbreviation + packing description line ===
      // e.g. "EG printed bags / cartons", "JJ cartons", "eg cartons"
      const lineWordsSplit = lineLower.split(/[\s,./]+/).filter((w: string) => w.length > 0);
      const firstWordLowerTrimmed = lineWordsSplit[0] || '';
      const hasPackingKeyword = lineLower.includes('bag') || lineLower.includes('carton') || lineLower.includes('ctn') || lineLower.includes('printed') || lineLower.includes('bulk') || lineLower.includes('bolsa') || lineLower.includes('granel');
      const firstWordIsBuyerOrSupplier = !!(buyerAbbreviations[firstWordLowerTrimmed] || supplierAbbreviations[firstWordLowerTrimmed]);
      const isBuyerPackingLine = firstWordIsBuyerOrSupplier && hasPackingKeyword;
      if (isBuyerPackingLine) {
        // Detect buyer/supplier
        if (buyerAbbreviations[firstWordLowerTrimmed]) detectedBuyer = buyerAbbreviations[firstWordLowerTrimmed];
        if (supplierAbbreviations[firstWordLowerTrimmed]) detectedSupplier = supplierAbbreviations[firstWordLowerTrimmed];
        // Also check for a second buyer/supplier abbreviation on same line (e.g. "EG JJ cartons")
        for (const w of lineWordsSplit.slice(1)) {
          if (buyerAbbreviations[w] && !detectedBuyer) detectedBuyer = buyerAbbreviations[w];
          if (supplierAbbreviations[w] && !detectedSupplier) detectedSupplier = supplierAbbreviations[w];
        }
        // Extract packing descriptor and apply to current block
        const packDesc = extractPackingDescriptor(line);
        if (currentBlock) {
          if (currentBlock.packing && packDesc && !currentBlock.packing.includes(packDesc)) {
            currentBlock.packing += ' ' + packDesc;
          } else if (!currentBlock.packing && packDesc) {
            // Try to extract full packing (with quantities) from this line
            const fullPack = extractPacking(line);
            currentBlock.packing = fullPack || packDesc;
          }
        }
        continue;
      }

      // === FORMAT 1: Original line-by-line format ===
      // Use score-based product detection instead of rigid negative checks
      const productScore = scoreAsProduct(line);
      const isProductLine = productScore >= 2 && /^[a-zA-Z]/.test(line) && line.length > 2;

      // Check for buyer/supplier-only line (e.g. "EG JJ", "Raunaq EG")
      const isBuyerSupplierLine = (() => {
        // Check if all meaningful words are buyer/supplier abbreviations
        const allAbbreviations = lineWordsSplit.every((w: string) =>
          buyerAbbreviations[w] || supplierAbbreviations[w] || w.length <= 1
        );
        if (allAbbreviations && lineWordsSplit.length >= 1 && lineWordsSplit.length <= 4 && line.length < 30) return true;
        // Also check lines that mention names + instruction words
        const hasAbbrev = lineWordsSplit.some((w: string) => buyerAbbreviations[w] || supplierAbbreviations[w]);
        const hasInstruction = lineLower.includes('please') || lineLower.includes('prepare') || lineLower.includes('only');
        return hasAbbrev && hasInstruction;
      })();

      // If it's a buyer/supplier line, extract buyer and supplier from it
      if (isBuyerSupplierLine) {
        for (const w of lineWordsSplit) {
          if (buyerAbbreviations[w] && !detectedBuyer) detectedBuyer = buyerAbbreviations[w];
          if (supplierAbbreviations[w] && !detectedSupplier) detectedSupplier = supplierAbbreviations[w];
        }
        continue;
      }

      if (isProductLine && !headerTemplate) {
        if (currentBlock) productBlocks.push(currentBlock);

        // Extract brand from parentheses (Marca Oliver, etc.) — processing styles (PBO) stay in product name
        const { brand, cleaned } = extractBrand(line);
        const productName = resolveProductName(cleaned);

        // Multi-info: extract packing, glaze, freezing from the same product line
        const inlinePacking = extractPacking(line);
        const inlineGlazeMatch = line.match(/(\d+)%\s*(?:glaseo|glaze)/i) || (line.match(/(\d+)%/) && !line.match(/\d+%\s*(?:MT|tons?)/i) ? line.match(/(\d+)%/) : null);
        const inlineGlaze = inlineGlazeMatch ? inlineGlazeMatch[1] + '% Glaze' : '';
        // Extract inline price if present on same line
        const inlinePrice = extractPrice(line);

        currentBlock = {
          product: productName,
          size: '',
          glaze: inlineGlaze,
          glazeMarked: '',
          freezing: detectFreezing(line),
          kilos: '',
          pricePerKg: inlinePrice?.price || '',
          currency: inlinePrice?.currency || '',
          packing: inlinePacking,
          brand: brand,
          cases: '',
          notes: ''
        };
      } else if (currentBlock) {
        // Parse details for current product

        // Glaze percentage (25% Glaseo, 25% Glaze, or bare 25%)
        const glazeMatch = line.match(/(\d+)%\s*(?:glaseo|glaze)/i);
        if (glazeMatch) {
          currentBlock.glaze = glazeMatch[1] + '% Glaze';
        } else if (!currentBlock.glaze) {
          const barePercentMatch = line.match(/(\d+)%/);
          if (barePercentMatch) {
            currentBlock.glaze = barePercentMatch[1] + '% Glaze';
          }
        }

        // Marked/declared glaze (Marked as 20% or Marked as 20% glaze)
        const markedGlazeMatch = line.match(/marked\s*(?:as)?\s*(\d+)%/i);
        if (markedGlazeMatch) {
          currentBlock.glazeMarked = markedGlazeMatch[1] + '% Glaze';
        }

        // Quantity and price with size (4MT U/1 $6.10) or (U/1 4MT $6.10)
        const qtyPriceMatch = line.match(/(\d+)\s*(?:MT|tons?)\s+(U[-/]\d+|\d+[-/]\d+)?\s*\$?([\d.]+)?/i);
        if (qtyPriceMatch) {
          currentBlock.kilos = (parseFloat(qtyPriceMatch[1]) * 1000).toString();
          if (qtyPriceMatch[2]) currentBlock.size = qtyPriceMatch[2].replace(/-/g, '/');
          if (qtyPriceMatch[3]) currentBlock.pricePerKg = qtyPriceMatch[3];
        }

        // Size + MT/tons + Price with $ at end: "40/60  07 MT  3.30 $" or "20-40 5 ton 3.90$"
        const sizeMtPriceDollarEnd = line.match(/(U[-/]\d+|\d+[-/]\d+|\d+[-/](?:UP|up))\s+(\d+)\s*(?:MT|tons?)\s+([\d.]+)\s*\$/i);
        if (sizeMtPriceDollarEnd && !qtyPriceMatch) {
          currentBlock.size = sizeMtPriceDollarEnd[1].replace(/-/g, '/');
          currentBlock.kilos = (parseFloat(sizeMtPriceDollarEnd[2]) * 1000).toString();
          currentBlock.pricePerKg = sizeMtPriceDollarEnd[3];
        }

        // Just quantity in MT/tons (6MT $3.60, 5 ton 4.50$)
        const mtPriceMatch = line.match(/(\d+)\s*(?:MT|tons?)\s*\$?\s*([\d.]+)/i);
        if (mtPriceMatch && !qtyPriceMatch && !sizeMtPriceDollarEnd) {
          currentBlock.kilos = (parseFloat(mtPriceMatch[1]) * 1000).toString();
          currentBlock.pricePerKg = mtPriceMatch[2];
        }

        // Size/Talla (Talla 20/40, just 20/40, or 20-40)
        const sizeMatch = line.match(/(?:talla\s+)?(\d+[-/]\d+|U[-/]\d+|\d+[-/](?:UP|up))/i);
        if (sizeMatch && !currentBlock.size) {
          currentBlock.size = sizeMatch[1].replace(/-/g, '/');
        }

        // Packing (6x1 kilo bolsa con rider, 10 kilo Granel, 6 X 1 KG BAG)
        const packingMatch = line.match(/(\d+\s*[xX]\s*\d+\s*(?:kilo?|kg)?)\s*(.*)?/i);
        if (packingMatch) {
          let packing = packingMatch[1].replace(/kilo/i, 'kg');
          const extra = packingMatch[2] || '';
          if (extra.toLowerCase().includes('bolsa con rider') || extra.toLowerCase().includes('con rider')) {
            packing += ' Bag with Rider';
          } else if (extra.toLowerCase().includes('bolsa imprimida') || extra.toLowerCase().includes('printed bag') || extra.toLowerCase().includes('imprimida')) {
            packing += ' Printed Bag';
          } else if (extra.toLowerCase().includes('bolsa') || extra.toLowerCase().includes('bag')) {
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

        // Standalone price ($5.05 or 3.90 $ or €4.50 or 4.50 EUR)
        if (!currentBlock.pricePerKg) {
          const priceExtracted = extractPrice(line);
          if (priceExtracted) {
            currentBlock.pricePerKg = priceExtracted.price;
            currentBlock.currency = priceExtracted.currency;
          }
        }

        // Standalone MT/tons (10MT, 5 ton, 5 tons)
        const mtMatch = line.match(/^(\d+)\s*(?:MT|tons?)$/i);
        if (mtMatch && !currentBlock.kilos) {
          currentBlock.kilos = (parseFloat(mtMatch[1]) * 1000).toString();
        }

        // Multi-info extraction: if this line has buyer/supplier abbreviations, capture them
        for (const w of lineLower.split(/[\s,./]+/).filter((w: string) => w.length > 0)) {
          if (buyerAbbreviations[w] && !detectedBuyer) detectedBuyer = buyerAbbreviations[w];
          if (supplierAbbreviations[w] && !detectedSupplier) detectedSupplier = supplierAbbreviations[w];
        }

        // If this detail line also has packing descriptor and current block has packing without descriptor
        if (currentBlock.packing && !currentBlock.packing.includes('Bag') && !currentBlock.packing.includes('Bulk') && !currentBlock.packing.includes('Carton')) {
          const desc = extractPackingDescriptor(line);
          if (desc) currentBlock.packing += ' ' + desc;
        }
      }
    }

    // Don't forget the last block
    if (currentBlock) productBlocks.push(currentBlock);

    // Apply global packing/glaze to all blocks that don't have their own
    if (globalPacking || globalGlaze) {
      for (const block of productBlocks) {
        if (!block.packing && globalPacking) block.packing = globalPacking;
        if (!block.glaze && globalGlaze) block.glaze = globalGlaze;
      }
    }

    // Parse buyer and supplier from the text (may already be partially detected from inline parsing above)

    // Check for abbreviations anywhere in text — split on spaces, commas, slashes, periods
    const allWords = text.split(/[\s,./]+/).map((w: string) => w.toLowerCase()).filter((w: string) => w.length > 0);
    for (const word of allWords) {
      if (buyerAbbreviations[word] && !detectedBuyer) {
        detectedBuyer = buyerAbbreviations[word];
      }
      if (supplierAbbreviations[word] && !detectedSupplier) {
        const companyName = supplierAbbreviations[word];
        detectedSupplier = companyName;
        // Try to match with contacts to get email
        const matchedSupplier = suppliers.find(s =>
          s.company.toLowerCase().includes(companyName.toLowerCase()) ||
          companyName.toLowerCase().includes(s.company.toLowerCase())
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

      // Default freezing to IQF; leave kilos empty if not specified (don't invent data)
      const finalFreezing = block.freezing || 'IQF';
      const finalKilos = block.kilos || '';
      const finalKilosNum = parseFloat(finalKilos) || 0;
      const finalTotal = (finalKilosNum * price).toFixed(2);

      return {
        product: block.product,
        size: sizeStr,
        glaze: block.glaze || '',
        glazeMarked: block.glazeMarked || '',
        brand: block.brand || '',
        freezing: finalFreezing,
        cases: block.cases || '',
        kilos: finalKilos,
        pricePerKg: block.pricePerKg,
        currency: block.currency || 'USD',
        packing: block.packing,
        total: finalTotal
      };
    });

    // Fill in missing packing/brand from the last order between this supplier+buyer
    const currentSupplier = detectedSupplier || poData.supplier;
    const currentBuyer = detectedBuyer || poData.buyer;
    if (currentSupplier && currentBuyer) {
      const defaults = getLastOrderDefaults(currentSupplier, currentBuyer);
      if (defaults) {
        for (const item of newLineItems) {
          if (!item.packing && defaults.packing) item.packing = defaults.packing;
          if (!item.brand && defaults.brand) item.brand = defaults.brand;
          if (!item.freezing && defaults.freezing) item.freezing = defaults.freezing;
        }
      }
    }

    // Update state with recalculated values (cases, adjusted kilos, totals)
    if (newLineItems.length > 0) {
      setLineItems(recalculateAllLineItems(newLineItems));
    }

    // Get combined product description (deduplicated)
    const seenProducts = new Set<string>();
    const uniqueProducts: string[] = [];
    for (const b of productBlocks) {
      const key = `${b.product}|${b.freezing || ''}|${b.glaze || ''}`;
      if (!seenProducts.has(key)) {
        seenProducts.add(key);
        let desc = b.product;
        if (b.freezing && !desc.toLowerCase().includes(b.freezing.toLowerCase())) desc += ` ${b.freezing}`;
        if (b.glaze) desc += ` ${b.glaze}`;
        uniqueProducts.push(desc);
      }
    }
    const productDesc = uniqueProducts.join(', ');

    // Look up full supplier details (address, country) from contacts
    const matchedS = detectedSupplier ? suppliers.find(s => s.company === detectedSupplier) : null;

    setPOData(prev => ({
      ...prev,
      product: productDesc || prev.product,
      buyer: detectedBuyer || prev.buyer,
      supplier: detectedSupplier || prev.supplier,
      supplierEmail: detectedSupplierEmail || prev.supplierEmail,
      supplierAddress: matchedS?.address || prev.supplierAddress,
      supplierCountry: matchedS?.country || prev.supplierCountry,
    }));

    // Sync search fields with parser-detected values
    if (detectedSupplier) {
      setSupplierSearch(detectedSupplier + (matchedS?.country ? ` (${matchedS.country})` : ''));
    }
    if (detectedBuyer) {
      setBuyerSearch(detectedBuyer);
    }

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

  // Get suppliers from contacts — flexible match (handles 'Supplier', 'Suppliers', 'suppliers', etc.)
  const suppliers = Object.entries(contacts)
    .filter(([_, c]) => {
      const r = (c.role || '').toLowerCase();
      return r.includes('supplier');
    })
    .map(([email, c]) => ({ email, ...c }));

  // Get buyers from contacts — flexible match
  const buyers = Object.entries(contacts)
    .filter(([_, c]) => {
      const r = (c.role || '').toLowerCase();
      return r.includes('buyer') || r.includes('compras') || r.includes('calidad');
    })
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
    setLineItems([...lineItems, { product: '', size: '', glaze: '', glazeMarked: '', packing: '', brand: '', freezing: '', cases: '', kilos: '', pricePerKg: '', currency: 'USD', total: 0 }]);
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
    // Look in suppliers first, then fall back to full contacts map
    const supplier = suppliers.find(s => s.email === email) || (contacts[email] ? { email, ...contacts[email] } : null);
    const supplierName = supplier?.name?.toLowerCase() || '';
    const buyerCompany = poData.buyer?.toLowerCase() || '';

    // Find last order with this supplier + buyer combo for payment terms
    let autoPayment = '';
    if (buyerCompany && supplierName) {
      const matchingOrders = orders.filter(o =>
        o.company?.toLowerCase().includes(buyerCompany) &&
        o.supplier?.toLowerCase().includes(supplierName)
      );
      if (matchingOrders.length > 0) {
        autoPayment = 'LC at Sight';
      }
    }

    const supplierCompany = supplier ? supplier.company : '';
    setPOData({
      ...poData,
      supplierEmail: email,
      supplier: supplierCompany,
      supplierAddress: supplier?.address || '',
      supplierCountry: supplier?.country || '',
      payment: autoPayment || poData.payment,
    });

    // Auto-fill packing/brand on existing line items from last order
    if (supplierCompany && poData.buyer) {
      const defaults = getLastOrderDefaults(supplierCompany, poData.buyer);
      if (defaults) {
        setLineItems(prev => prev.map(item => ({
          ...item,
          packing: item.packing || defaults.packing || '',
          brand: item.brand || defaults.brand || '',
          freezing: item.freezing || defaults.freezing || '',
        })));
      }
    }
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

    // Auto-fill packing/brand on existing line items from last order
    if (poData.supplier && buyerCompany) {
      const defaults = getLastOrderDefaults(poData.supplier, buyerCompany);
      if (defaults) {
        setLineItems(prev => prev.map(item => ({
          ...item,
          packing: item.packing || defaults.packing || '',
          brand: item.brand || defaults.brand || '',
          freezing: item.freezing || defaults.freezing || '',
        })));
      }
    }
  };

  // Pull defaults (packing, brand) from the most recent order between a supplier+buyer pair
  const getLastOrderDefaults = (supplierName: string, buyerName: string) => {
    if (!supplierName || !buyerName) return null;
    const sLower = supplierName.toLowerCase();
    const bLower = buyerName.toLowerCase();

    // Find matching orders, sorted by date descending (most recent first)
    const matchingOrders = orders
      .filter(o =>
        o.supplier?.toLowerCase().includes(sLower) &&
        o.company?.toLowerCase().includes(bLower)
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (matchingOrders.length === 0) return null;

    const lastOrder = matchingOrders[0];
    const lastLineItems = lastOrder.lineItems || [];

    // Extract defaults from the last order's line items
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

  // Submit for approval — go to sign-off page
  const submitForApproval = () => {
    if (!poData.supplier || !poData.buyer || lineItems.every(item => !item.product)) {
      setNotification({ type: 'error', message: 'Please fill in required fields: Supplier, Buyer, and at least one product line.' });
      setTimeout(() => setNotification(null), 4000);
      return;
    }
    setSendTo(poData.supplierEmail || '');
    setEmailSubject(`NEW PO ${poData.poNumber}`);
    setStatus('pending_approval');
    setShowPreview(true);
    setShowSignOff(true);
    setBulkPreviewIndex(0);
  };

  // Approve PO
  const approvePO = () => {
    setStatus('approved');
    setNotification({ type: 'success', message: '✅ Purchase Order approved! Ready to send to supplier.' });
    setTimeout(() => setNotification(null), 4000);
  };

  // Reject/Edit PO — back to form
  const rejectPO = () => {
    setStatus('draft');
    setShowPreview(false);
    setShowSignOff(false);
    setNotification({ type: 'warning', message: 'Returned to draft mode for editing.' });
    setTimeout(() => setNotification(null), 3000);
  };

  // Download PO as PDF
  const downloadPDF = async () => {
    if (!poDocRef.current) return;
    setGeneratingPdf(true);
    try {
      const filename = `${currentPreviewPONumber.replace(/\//g, '_')}.pdf`;
      await html2pdf().set({
        margin: [4, 5, 4, 5],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(poDocRef.current).save();
      setNotification({ type: 'success', message: `PDF downloaded as ${filename}` });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      setNotification({ type: 'error', message: 'Failed to generate PDF. Please try again.' });
      setTimeout(() => setNotification(null), 4000);
    }
    setGeneratingPdf(false);
  };

  // Increment a PO number's sequence: "GI/PO/25-26/EG-001" → "GI/PO/25-26/EG-002"
  const incrementPONumber = (poNumber: string): string => {
    // Try buyer-code format: .../XX-001
    const buyerMatch = poNumber.match(/^(.*\/)([A-Z]+-?)(\d+)$/);
    if (buyerMatch) {
      const nextNum = (parseInt(buyerMatch[3]) + 1).toString().padStart(buyerMatch[3].length, '0');
      return buyerMatch[1] + buyerMatch[2] + nextNum;
    }
    // Try generic format: .../3044
    const genericMatch = poNumber.match(/^(.*\/)(\d+)$/);
    if (genericMatch) {
      return genericMatch[1] + (parseInt(genericMatch[2]) + 1).toString();
    }
    return poNumber + '-2';
  };

  // Compute the current PO number for bulk preview navigation
  const getCurrentBulkPONumber = (index: number): string => {
    let num = poData.poNumber;
    for (let i = 0; i < index; i++) {
      num = incrementPONumber(num);
    }
    return num;
  };

  const currentPreviewPONumber = bulkCreate
    ? getCurrentBulkPONumber(bulkPreviewIndex)
    : poData.poNumber;

  // Send PO to supplier (supports bulk creation)
  const sendPO = async () => {
    // Step 1: Capture PDF blob from the live preview BEFORE any state changes
    let pdfBlob: Blob | null = null;
    const primaryFilename = `${poData.poNumber.replace(/\//g, '_')}.pdf`;
    const primaryPdfUrl = supabase.storage.from('po-documents').getPublicUrl(primaryFilename).data.publicUrl;

    if (poDocRef.current) {
      try {
        pdfBlob = await (html2pdf() as any).set({
          margin: [4, 5, 4, 5],
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        }).from(poDocRef.current).output('blob');
      } catch (err) {
        console.error('PDF capture failed:', err);
      }
    }

    // Step 2: Build order objects
    const count = bulkCreate ? bulkCount : 1;
    const newOrders: Order[] = [];

    for (let i = 0; i < count; i++) {
      let currentPONumber = poData.poNumber;
      for (let j = 0; j < i; j++) {
        currentPONumber = incrementPONumber(currentPONumber);
      }

      const filename = `${currentPONumber.replace(/\//g, '_')}.pdf`;
      const pdfUrl = supabase.storage.from('po-documents').getPublicUrl(filename).data.publicUrl;

      const newOrder: Order = {
        id: currentPONumber,
        poNumber: currentPONumber.split('/').pop() || currentPONumber,
        company: poData.buyer,
        product: poData.product || lineItems.map(li => li.product).filter(p => p).join(', '),
        specs: lineItems.map(li => `${li.size || ''} ${li.glaze ? `(${li.glaze})` : ''} ${li.packing || ''}`.trim()).filter(s => s).join(', '),
        from: 'India',
        to: poData.destination || poData.buyerBank || 'Spain',
        date: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
        currentStage: 1,
        supplier: poData.supplier.split(' - ')[0] || poData.supplier,
        totalValue: grandTotal,
        totalKilos: totalKilos,
        lineItems: lineItems,
        metadata: { pdfUrl },
        history: [
          {
            stage: 1,
            timestamp: new Date().toISOString(),
            from: 'Ganesh International <ganeshintnlmumbai@gmail.com>',
            to: sendTo || poData.supplierEmail,
            subject: `NEW PO ${currentPONumber}`,
            body: `Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached the Purchase Order for ${poData.product || 'Frozen Seafood'}.\n\nPO Number: ${currentPONumber}\nBuyer: ${poData.buyer}\nTotal Value: USD ${grandTotal}\nTotal Quantity: ${totalKilos} Kg\n\nKindly confirm receipt and proceed at the earliest.\n\nThanking you,\nBest regards,\n\nSumehr Rajnish Gwalani\nGanesh International`,
            hasAttachment: true,
            attachments: [{
              name: `${currentPONumber.replace(/\//g, '_')}.pdf`,
              meta: {
                pdfUrl,
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
                totalCases: totalCases,
                totalKilos: totalKilos,
                grandTotal: grandTotal,
                lineItems: lineItems.map(li => ({
                  product: li.product, brand: li.brand || '', freezing: li.freezing || '',
                  size: li.size || '', glaze: li.glaze || '', glazeMarked: li.glazeMarked || '',
                  packing: li.packing || '', cases: li.cases || 0, kilos: li.kilos || 0,
                  pricePerKg: li.pricePerKg || 0, currency: li.currency || 'USD', total: li.total || 0,
                })),
              }
            }]
          }
        ]
      };

      newOrders.push(newOrder);
    }

    // Step 3: Add orders to state + notify
    if (setOrders) {
      setOrders(prevOrders => [...newOrders, ...prevOrders]);
    }

    setStatus('sent');
    if (count > 1) {
      const lastPO = newOrders[newOrders.length - 1].id;
      setNotification({ type: 'success', message: `📧 ${count} Purchase Orders created (${poData.poNumber} to ${lastPO}) for ${poData.supplier}!` });
    } else {
      setNotification({ type: 'success', message: `📧 Purchase Order ${poData.poNumber} sent to ${poData.supplier}! New order created.` });
    }

    // Callback to parent for each order (saves to Supabase)
    if (onOrderCreated) {
      for (const order of newOrders) {
        onOrderCreated(order);
      }
    }

    // Step 4: Upload captured PDF blob to Supabase Storage
    if (pdfBlob) {
      try {
        await supabase.storage.from('po-documents').upload(primaryFilename, pdfBlob, {
          contentType: 'application/pdf',
          upsert: true,
        });
      } catch {
        // PDF storage upload failed silently
      }
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
          <button onClick={() => showPreview ? setShowPreview(false) : navigate('/')} className="p-2 hover:bg-gray-200 bg-gray-100 rounded-lg transition-colors">
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
            <button onClick={() => { setShowPreview(true); setBulkPreviewIndex(0); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2">
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
          {/* Status Banner */}
          {showSignOff && status !== 'sent' && (
            <div className="bg-blue-50 border-b border-blue-200 p-3 text-center">
              <p className="text-sm font-medium text-blue-700">Review the Purchase Order below, then scroll down to sign off and send.</p>
            </div>
          )}

          {/* Bulk Preview Navigation */}
          {bulkCreate && bulkCount > 1 && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-200 px-6 py-3">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setBulkPreviewIndex(Math.max(0, bulkPreviewIndex - 1))}
                  disabled={bulkPreviewIndex === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <Icon name="ChevronLeft" size={16} /> Previous
                </button>
                <div className="text-center">
                  <span className="text-sm font-bold text-blue-700">
                    PO {bulkPreviewIndex + 1} of {bulkCount}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5 font-mono">
                    {currentPreviewPONumber}
                  </span>
                </div>
                <button
                  onClick={() => setBulkPreviewIndex(Math.min(bulkCount - 1, bulkPreviewIndex + 1))}
                  disabled={bulkPreviewIndex === bulkCount - 1}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Next <Icon name="ChevronRight" size={16} />
                </button>
              </div>
              {/* Submit for Sign-off button inside navigation bar */}
              {!showSignOff && status === 'draft' && (
                <div className="flex justify-center mt-3 pt-3 border-t border-blue-200">
                  <button onClick={submitForApproval} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium shadow-sm text-sm">
                    <Icon name="CheckCircle" size={16} /> Submit All {bulkCount} POs for Sign-off
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PO Document Preview */}
          <div ref={poDocRef} className="px-6 py-3 max-w-4xl mx-auto bg-white" style={{ fontSize: '12px', lineHeight: '1.35' }}>
            {/* Header with Logo */}
            <div className="flex items-center mb-2 pb-1.5 border-b-2 border-gray-200">
              <div className="mr-3">
                <GILogo size={50} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-800" style={{ marginBottom: '1px' }}>GANESH INTERNATIONAL</h2>
                <p className="text-gray-500" style={{ fontSize: '10px', lineHeight: '1.3' }}>Office no. 226, 2nd Floor, Arun Chambers, Tardeo Road, Mumbai 400034</p>
                <p className="text-gray-500" style={{ fontSize: '10px', lineHeight: '1.3' }}>Tel: +91 22 2351 2345 | Email: ganeshintnlmumbai@gmail.com</p>
              </div>
            </div>

            {/* Date and PO Number */}
            <div className="flex justify-between mb-2">
              <div>
                <p className="font-medium text-gray-700">Date: <span className="text-gray-900">{formatDate(poData.date)}</span></p>
              </div>
              <div>
                <p className="font-medium text-gray-700">Purchase Order No: <span className="text-gray-900 font-bold">{currentPreviewPONumber}</span></p>
              </div>
            </div>

            {/* To Section */}
            <div className="mb-1.5 max-w-xs" style={{ lineHeight: '1.3' }}>
              <p className="text-gray-500">To,</p>
              <p className="font-bold text-gray-800">{poData.supplier || '[EXPORTER NAME]'}</p>
              {poData.supplierAddress && <p className="text-gray-600">{poData.supplierAddress}</p>}
              <p className="text-gray-600 font-medium">{poData.supplierCountry?.toUpperCase() || 'INDIA'}</p>
            </div>

            {/* Greeting */}
            <div className="mb-2">
              <p className="text-gray-700">Dear Sirs,</p>
              <p className="text-gray-700 mt-0.5">
                We are pleased to confirm our Purchase Order with you for the Export of{' '}
                <span className="font-medium">
                  {(() => {
                    // Deduplicate by product + freezing + glaze combo
                    const seen = new Set<string>();
                    const unique: typeof lineItems = [];
                    for (const item of lineItems.filter(i => i.product)) {
                      const key = `${item.product}|${item.freezing || ''}|${item.glaze || ''}|${item.glazeMarked || ''}`;
                      if (!seen.has(key)) {
                        seen.add(key);
                        unique.push(item);
                      }
                    }
                    return unique.map((item, idx, arr) => {
                      let desc = item.product;
                      if (item.freezing && !desc.toLowerCase().includes(item.freezing.toLowerCase())) {
                        desc += ` ${item.freezing}`;
                      }
                      if (item.glaze && item.glazeMarked) {
                        desc += ` ${item.glaze} marked as ${item.glazeMarked}`;
                      } else if (item.glaze) {
                        desc += ` ${item.glaze}`;
                      }
                      if (idx < arr.length - 1) return desc + ', ';
                      return desc;
                    }).join('');
                  })() || '______________________'}
                </span>
                {' '}to our Principals namely <span className="font-medium">M/s.{poData.buyer || '______________________'}</span>
                {poData.destination && <>, <span className="font-medium">{poData.destination.toUpperCase()}</span></>}
                {' '}under the following terms & conditions.
              </p>
            </div>

            {/* Product Details Table */}
            {(() => {
              const hasBrand = lineItems.some(i => i.brand);
              const hasFreezing = lineItems.some(i => i.freezing);
              const hasSize = lineItems.some(i => i.size);
              const hasGlaze = lineItems.some(i => i.glaze);
              const hasPacking = lineItems.some(i => i.packing);
              const hasCases = lineItems.some(i => i.cases);
              const filledCols = [true, hasBrand, hasFreezing, hasSize, hasGlaze, hasPacking, hasCases, true, true, true].filter(Boolean).length;
              const totalColSpan = filledCols - 4 + (hasCases ? 1 : 0); // columns before Cases/Kilos
              return (
            <div className="mb-2" style={{ pageBreakInside: 'avoid' }}>
              <table className="w-full border-collapse border border-gray-300" style={{ fontSize: '11px', tableLayout: 'auto' }}>
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-2 py-1 text-left" style={{ minWidth: '130px' }}>Product</th>
                    {hasBrand && <th className="border border-gray-300 px-2 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Brand</th>}
                    {hasFreezing && <th className="border border-gray-300 px-2 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Freezing</th>}
                    {hasSize && <th className="border border-gray-300 px-2 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Size</th>}
                    {hasGlaze && <th className="border border-gray-300 px-2 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Glaze</th>}
                    {hasPacking && <th className="border border-gray-300 px-2 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Packing</th>}
                    {hasCases && <th className="border border-gray-300 px-2 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>Cases</th>}
                    <th className="border border-gray-300 px-2 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>Kilos</th>
                    <th className="border border-gray-300 px-2 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>Price/Kg<br/><span style={{ fontSize: '9px', fontWeight: 'normal' }}>{poData.deliveryTerms} {poData.destination || '___'}</span></th>
                    <th className="border border-gray-300 px-2 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>
                      {lineItems.some(i => i.currency && i.currency !== 'USD') ? 'Total' : 'Total (USD)'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="border border-gray-300 px-2 py-1">{item.product || '-'}</td>
                      {hasBrand && <td className="border border-gray-300 px-2 py-1" style={{ whiteSpace: 'nowrap' }}>{item.brand || '-'}</td>}
                      {hasFreezing && <td className="border border-gray-300 px-2 py-1" style={{ whiteSpace: 'nowrap' }}>{item.freezing || '-'}</td>}
                      {hasSize && <td className="border border-gray-300 px-2 py-1" style={{ whiteSpace: 'nowrap' }}>{item.size || '-'}</td>}
                      {hasGlaze && <td className="border border-gray-300 px-2 py-1" style={{ whiteSpace: 'nowrap' }}>{item.glaze && item.glazeMarked ? `${item.glaze} marked as ${item.glazeMarked}` : item.glaze || '-'}</td>}
                      {hasPacking && <td className="border border-gray-300 px-2 py-1" style={{ whiteSpace: 'nowrap' }}>{item.packing || '-'}</td>}
                      {hasCases && <td className="border border-gray-300 px-2 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>{item.cases || '-'}</td>}
                      <td className="border border-gray-300 px-2 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>{item.kilos || '-'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>{item.pricePerKg ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${item.pricePerKg}` : '-'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-medium" style={{ whiteSpace: 'nowrap' }}>{Number(item.total) > 0 ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${item.total}` : '-'}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td className="border border-gray-300 px-1.5 py-1" colSpan={1 + (hasBrand ? 1 : 0) + (hasFreezing ? 1 : 0) + (hasSize ? 1 : 0) + (hasGlaze ? 1 : 0) + (hasPacking ? 1 : 0)}>Total</td>
                    {hasCases && <td className="border border-gray-300 px-1.5 py-1 text-right">{totalCases}</td>}
                    <td className="border border-gray-300 px-1.5 py-1 text-right">{totalKilos}</td>
                    <td className="border border-gray-300 px-1.5 py-1"></td>
                    <td className="border border-gray-300 px-1.5 py-1 text-right">U.S. ${grandTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
              );
            })()}

            {/* Terms Section */}
            <div className="text-gray-700 mb-2" style={{ lineHeight: '1.35' }}>
              <p><span className="font-medium">Total Value:</span> U.S. ${grandTotal}</p>
              <p className="text-gray-500 ml-4" style={{ fontSize: '10px' }}>*We need a quality control of photos before loading</p>
              <p className="text-gray-500 ml-4" style={{ fontSize: '10px' }}>*Different colors Tapes for different products & Lots.</p>
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
            <div className="bg-yellow-50 border border-yellow-200 rounded px-2.5 py-1.5 mb-2" style={{ pageBreakInside: 'avoid', fontSize: '10.5px', lineHeight: '1.3' }}>
              <p className="font-medium text-yellow-800 mb-0.5" style={{ fontSize: '11px' }}>Important Notes:</p>
              <ul className="text-yellow-700 space-y-0 list-disc list-inside">
                <li>Should be minimum 5 days free Dem/ Det/ Plug in on the B/L or on the shipping line's letterhead.</li>
                <li>Please send us Loading chart alongwith the docs & it should be mentioned the lot/code number.</li>
                <li>Please make plastic certificate.</li>
                <li>REQUIRED CERTIFICATE OF QUALITY OR FOOD SECURITY CERTIFICATE SUCH AS BRC, GLOBAL GAP ETC.</li>
                <li>Please use different color carton's tapes for different code.</li>
                <li>No Damaged boxes to be shipped.</li>
              </ul>
            </div>

            {/* Shipping Marks */}
            {poData.shippingMarks && <p className="mb-1.5"><span className="font-medium">Shipping Marks:</span> {poData.shippingMarks}</p>}

            {/* Please Note Section */}
            <div className="text-gray-600 mb-2" style={{ pageBreakInside: 'avoid', fontSize: '11px', lineHeight: '1.3' }}>
              <p className="font-medium mb-0.5">Please Note:</p>
              {poData.buyerBank && <p>After the documents are negotiated, please send us the Courier Airway Bill no for the documents send by your Bank to buyers bank in {poData.buyerBank}.</p>}
              <p className="mt-0.5">While emailing us the shipment details, Please mention Exporter, Product, B/Ups, Packing, B/L No, Seal No, Container No, Vessel Name, ETD/ETA, Port Of Shipment / Destination and the Transfer of the Letter of Credit in whose Favour.</p>
              <p className="mt-0.5">Any Claim on Quality, Grading, Packing and Short weight for this particular consignment will be borne entirely by you and will be your sole responsibility.</p>
            </div>

            {/* Closing */}
            <div className="text-gray-700 mb-1" style={{ fontSize: '11px', lineHeight: '1.3' }}>
              <p>Hope you find the above terms & conditions in order. Please put your Seal and Signature and send it to us as a token of your confirmation.</p>
              <p className="mt-1">Thanking You,</p>
            </div>

            {/* Signature */}
            <div className="mt-2" style={{ pageBreakInside: 'avoid' }}>
              {signatureData && (status === 'pending_approval' || status === 'approved' || status === 'sent') && (
                <div className="mb-0.5">
                  <img src={signatureData} alt="Signature" className="h-10 object-contain" style={{ maxWidth: '150px' }} />
                </div>
              )}
              <p className="font-bold text-gray-800" style={{ fontSize: '11px' }}>Sumehr Rajnish Gwalani</p>
              <p className="text-gray-600" style={{ fontSize: '11px' }}>GANESH INTERNATIONAL</p>
              {(status === 'approved' || status === 'sent') && signatureData ? (
                <div className="mt-0.5 inline-block px-1.5 py-0.5 bg-green-100 text-green-700 rounded" style={{ fontSize: '10px' }}>
                  ✓ Digitally Signed & Approved
                </div>
              ) : (status === 'approved' || status === 'sent') ? (
                <div className="mt-0.5 inline-block px-1.5 py-0.5 bg-green-100 text-green-700 rounded" style={{ fontSize: '10px' }}>
                  ✓ Approved
                </div>
              ) : null}
            </div>

            {/* Footer Note */}
            <div className="mt-2 pt-1 border-t border-gray-200 text-gray-500" style={{ fontSize: '9px' }}>
              <p>FOOTNOTE: SUGGEST USE OF DATA LOGGER IN REFER CONTAINER USEFUL IN CASE OF TEMP. FLUCTUATION ON BOARD</p>
            </div>
          </div>

          {/* Bottom Action Bar */}
          {!showSignOff ? (
            <div className="p-6 border-t border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <button onClick={() => setShowPreview(false)} className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 flex items-center gap-2">
                  <Icon name="Edit" size={16} /> Back to Edit
                </button>
                <button onClick={submitForApproval} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium shadow-sm">
                  <Icon name="CheckCircle" size={16} /> {bulkCreate ? `Submit All ${bulkCount} POs for Sign-off` : 'Submit for Sign-off'}
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t-2 border-blue-200 bg-gradient-to-b from-blue-50 to-white p-6">
              {status !== 'sent' ? (
                <div className="max-w-2xl mx-auto space-y-5">
                  <div className="text-center mb-2">
                    <h3 className="text-lg font-bold text-gray-800">Sign-off & Send</h3>
                    <p className="text-sm text-gray-500">
                      {bulkCreate
                        ? `${bulkCount} separate emails will be sent — one for each PO.`
                        : 'Review the PO above, download the PDF, and send to the supplier.'}
                    </p>
                  </div>

                  {/* Download PDF */}
                  <div className="flex justify-center">
                    <button onClick={downloadPDF} disabled={generatingPdf} className="px-5 py-2.5 bg-white border-2 border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 flex items-center gap-2 font-medium disabled:opacity-50">
                      <Icon name="Download" size={16} /> {generatingPdf ? 'Generating PDF...' : 'Download PDF'}
                    </button>
                  </div>

                  {/* Digital Signature */}
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-medium text-gray-700">Digital Signature</label>
                      {signatureData && !showSignaturePad && (
                        <div className="flex gap-2">
                          <button onClick={() => { setShowSignaturePad(true); setTimeout(initCanvas, 100); }} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Change</button>
                          <button onClick={removeSignature} className="text-xs text-red-500 hover:text-red-700 font-medium">Remove</button>
                        </div>
                      )}
                    </div>

                    {signatureData && !showSignaturePad ? (
                      <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <img src={signatureData} alt="Your signature" className="h-12 object-contain" style={{ maxWidth: '180px' }} />
                        <span className="text-sm text-green-700 font-medium flex items-center gap-1">
                          <Icon name="CheckCircle" size={14} /> Signature ready
                        </span>
                      </div>
                    ) : !showSignaturePad ? (
                      <div className="flex gap-3">
                        <button
                          onClick={() => { setShowSignaturePad(true); setTimeout(initCanvas, 100); }}
                          className="flex-1 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all text-sm text-gray-600 flex flex-col items-center gap-1"
                        >
                          <Icon name="Edit" size={20} />
                          <span>Draw Signature</span>
                        </button>
                        <label className="flex-1 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all text-sm text-gray-600 flex flex-col items-center gap-1 cursor-pointer">
                          <Icon name="Upload" size={20} />
                          <span>Upload Image</span>
                          <input type="file" accept="image/*" onChange={handleSignatureUpload} className="hidden" />
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Tabs: Draw / Upload */}
                        <div className="flex gap-2 border-b border-gray-200 pb-2">
                          <span className="text-sm font-medium text-blue-600 border-b-2 border-blue-600 pb-1 px-1">Draw</span>
                          <label className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer pb-1 px-1">
                            Upload instead
                            <input type="file" accept="image/*" onChange={handleSignatureUpload} className="hidden" />
                          </label>
                        </div>
                        {/* Canvas */}
                        <div className="border-2 border-gray-300 rounded-lg bg-white relative" style={{ touchAction: 'none' }}>
                          <canvas
                            ref={signatureCanvasRef}
                            width={400}
                            height={150}
                            className="w-full cursor-crosshair"
                            onMouseDown={startDrawing}
                            onMouseMove={draw}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={draw}
                            onTouchEnd={stopDrawing}
                          />
                          <div className="absolute bottom-2 left-3 right-3 border-t border-gray-300" />
                        </div>
                        <p className="text-xs text-gray-400 text-center">Sign above the line using your mouse or finger</p>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setShowSignaturePad(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                          <button onClick={clearCanvas} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg">Clear</button>
                          <button onClick={saveSignature} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save Signature</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bulk Email List - show each PO's subject */}
                  {bulkCreate && bulkCount > 1 && (
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Emails to be sent ({bulkCount} separate emails)</span>
                      </div>
                      <div className="max-h-40 overflow-y-auto divide-y divide-gray-100">
                        {Array.from({ length: bulkCount }, (_, i) => {
                          const poNum = getCurrentBulkPONumber(i);
                          return (
                            <div key={i} className={`px-4 py-2 flex items-center gap-3 text-sm ${i === bulkPreviewIndex ? 'bg-blue-50' : ''}`}>
                              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-800 truncate">NEW PO {poNum}</p>
                                <p className="text-xs text-gray-500 truncate">To: {sendTo || poData.supplierEmail || 'supplier@company.com'}</p>
                              </div>
                              <button
                                onClick={() => setBulkPreviewIndex(i)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium flex-shrink-0"
                              >
                                View
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Subject - shows current PO subject for single mode, or note for bulk */}
                  {!bulkCreate && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  )}

                  {/* Send To */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Send To *{bulkCreate ? ' (same for all POs)' : ''}</label>
                    <input
                      type="email"
                      value={sendTo}
                      onChange={(e) => setSendTo(e.target.value)}
                      placeholder="supplier@company.com"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {/* CC */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">CC{bulkCreate ? ' (same for all POs)' : ''} <span className="text-gray-400 font-normal">(separate multiple with commas)</span></label>
                    <input
                      type="text"
                      value={ccEmails}
                      onChange={(e) => setCcEmails(e.target.value)}
                      placeholder="buyer@company.com, colleague@company.com"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center justify-between pt-2">
                    <button onClick={rejectPO} className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 flex items-center gap-2">
                      <Icon name="Edit" size={16} /> Back to Edit
                    </button>
                    <button
                      onClick={() => { approvePO(); sendPO(); setShowSignOff(false); }}
                      disabled={!sendTo}
                      className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Icon name="Send" size={16} /> {bulkCreate ? `Approve & Send ${bulkCount} POs` : 'Approve & Send PO'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <div className="inline-flex items-center gap-2 px-6 py-3 bg-green-100 text-green-700 rounded-xl font-medium text-lg">
                    <Icon name="CheckCircle" size={20} /> {bulkCreate ? `${bulkCount} Purchase Orders Sent Successfully` : 'Purchase Order Sent Successfully'}
                  </div>
                  <p className="text-sm text-gray-500">
                    {bulkCreate
                      ? `${bulkCount} separate emails sent to ${sendTo}${ccEmails ? `, CC: ${ccEmails}` : ''}`
                      : `Sent to ${sendTo}${ccEmails ? `, CC: ${ccEmails}` : ''}`}
                  </p>
                  <button onClick={downloadPDF} disabled={generatingPdf} className="px-5 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2 mx-auto mt-2">
                    <Icon name="Download" size={16} /> {generatingPdf ? 'Generating...' : 'Download PDF'}
                  </button>
                </div>
              )}
            </div>
          )}
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
                  <div className="flex items-center gap-3 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={bulkCreate}
                        onChange={(e) => setBulkCreate(e.target.checked)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      Bulk Create
                    </label>
                    {bulkCreate && (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={bulkCount}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            setBulkCount(val === '' ? ('' as any) : parseInt(val));
                          }}
                          onBlur={() => {
                            const clamped = Math.max(2, Math.min(50, bulkCount || 2));
                            setBulkCount(clamped);
                          }}
                          className="w-16 px-2 py-1 border border-blue-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <span className="text-xs text-gray-500">POs</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="relative" ref={supplierDropdownRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
                  <input
                    type="text"
                    value={supplierSearch}
                    onChange={(e) => { setSupplierSearch(e.target.value); setShowSupplierDropdown(true); }}
                    onFocus={() => setShowSupplierDropdown(true)}
                    placeholder="Type to search or select..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {showSupplierDropdown && (() => {
                    const search = supplierSearch.toLowerCase();
                    const filteredSuppliers = suppliers.filter(s =>
                      s.company.toLowerCase().includes(search) ||
                      s.name.toLowerCase().includes(search) ||
                      (s.country || '').toLowerCase().includes(search)
                    );
                    // Also search ALL contacts as fallback (those not tagged as supplier)
                    const allContacts = Object.entries(contacts).map(([email, c]) => ({ email, ...c }));
                    const otherMatches = allContacts.filter(c => {
                      const r = (c.role || '').toLowerCase();
                      const isSupplier = r.includes('supplier');
                      const matchesSearch = c.company.toLowerCase().includes(search) ||
                        c.name.toLowerCase().includes(search) ||
                        (c.country || '').toLowerCase().includes(search);
                      return !isSupplier && matchesSearch && search.length > 0;
                    });
                    return (filteredSuppliers.length > 0 || otherMatches.length > 0) ? (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filteredSuppliers.map(s => (
                          <button key={s.email} type="button" onClick={() => { handleSupplierChange(s.email); setSupplierSearch(s.company + (s.country ? ` (${s.country})` : '')); setShowSupplierDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex justify-between items-center">
                            <span className="font-medium">{s.company}</span>
                            {s.country && <span className="text-xs text-gray-400">{s.country}</span>}
                          </button>
                        ))}
                        {otherMatches.length > 0 && filteredSuppliers.length > 0 && (
                          <div className="px-3 py-1 bg-gray-50 border-t border-gray-200">
                            <span className="text-xs text-gray-500 font-medium">Other contacts</span>
                          </div>
                        )}
                        {otherMatches.map(c => (
                          <button key={c.email} type="button" onClick={() => { handleSupplierChange(c.email); setSupplierSearch(c.company + (c.country ? ` (${c.country})` : '')); setShowSupplierDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex justify-between items-center">
                            <span className="font-medium">{c.company}</span>
                            <span className="text-xs text-gray-400">{c.role || 'No role'}{c.country ? ` · ${c.country}` : ''}</span>
                          </button>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>
                <div className="relative" ref={buyerDropdownRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Buyer / Principal *</label>
                  <input
                    type="text"
                    value={buyerSearch}
                    onChange={(e) => { setBuyerSearch(e.target.value); setShowBuyerDropdown(true); }}
                    onFocus={() => setShowBuyerDropdown(true)}
                    placeholder="Type to search or select..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {showBuyerDropdown && (() => {
                    const uniqueBuyers = [...new Set(buyers.map(b => b.company))];
                    const filtered = uniqueBuyers.filter(company =>
                      company.toLowerCase().includes(buyerSearch.toLowerCase())
                    );
                    return filtered.length > 0 ? (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filtered.map(company => {
                          const buyer = buyers.find(b => b.company === company);
                          return (
                            <button key={company} type="button" onClick={() => { handleBuyerChange(buyer?.email || ''); setBuyerSearch(company); setShowBuyerDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex justify-between items-center">
                              <span className="font-medium">{company}</span>
                              {buyer?.country && <span className="text-xs text-gray-400">{buyer.country}</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : null;
                  })()}
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
                      <div className="grid grid-cols-5 gap-4 mb-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Product Name</label>
                          <input type="text" value={item.product} onChange={(e) => updateLineItem(idx, 'product', e.target.value)} placeholder="Product name" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-medium" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Brand</label>
                          <input type="text" value={item.brand || ''} onChange={(e) => updateLineItem(idx, 'brand', e.target.value)} placeholder="Brand name" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Freezing</label>
                          <select value={item.freezing || ''} onChange={(e) => updateLineItem(idx, 'freezing', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm">
                            <option value="">Select...</option>
                            <option value="IQF">IQF</option>
                            <option value="Semi IQF">Semi IQF</option>
                            <option value="Blast">Blast</option>
                            <option value="Block">Block</option>
                            <option value="Plate">Plate</option>
                          </select>
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
                <button onClick={() => { setShowPreview(true); setBulkPreviewIndex(0); }} className="w-full px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 border border-blue-200 flex items-center justify-center gap-2">
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
