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

  // AI-powered parser — calls Supabase Edge Function which uses Claude Haiku
  const [isParsingAI, setIsParsingAI] = useState(false);

  const parseNaturalLanguage = async (text: string) => {
    if (!text.trim()) {
      setNotification({ type: 'error', message: 'Please paste some text to parse.' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    setIsParsingAI(true);
    setNotification({ type: 'info', message: 'Parsing with AI...' });

    try {
      // Build supplier/buyer lists from contacts
      const suppliersList = Object.entries(contacts)
        .filter(([_, c]) => (c.role || '').toLowerCase().includes('supplier'))
        .map(([email, c]) => ({ company: c.company, email, address: c.address, country: c.country }));

      const buyersList = Object.entries(contacts)
        .filter(([_, c]) => {
          const r = (c.role || '').toLowerCase();
          return r.includes('buyer') || r.includes('compras') || r.includes('calidad');
        })
        .map(([email, c]) => ({ company: c.company, email, country: c.country }));

      // Call Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('parse-po', {
        body: { rawText: text, suppliers: suppliersList, buyers: buyersList },
      });

      if (error) {
        throw new Error(error.message || 'Failed to call AI parser');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      const { lineItems: parsedItems, detectedSupplier, detectedSupplierEmail, detectedBuyer } = data;

      if (!parsedItems || parsedItems.length === 0) {
        setNotification({ type: 'warning', message: 'AI could not extract products. Please fill in manually.' });
        setTimeout(() => setNotification(null), 4000);
        return;
      }

      // Post-process: recalculate cases and totals
      const processedItems = recalculateAllLineItems(parsedItems);
      setLineItems(processedItems);

      // Update PO data with detected supplier/buyer
      if (detectedSupplier || detectedBuyer) {
        const matchedSupplier = detectedSupplier
          ? suppliersList.find(s => s.company.toLowerCase() === detectedSupplier.toLowerCase())
          : null;

        setPOData(prev => ({
          ...prev,
          supplier: detectedSupplier || prev.supplier,
          supplierEmail: detectedSupplierEmail || prev.supplierEmail,
          supplierAddress: matchedSupplier?.address || prev.supplierAddress,
          supplierCountry: matchedSupplier?.country || prev.supplierCountry,
          buyer: detectedBuyer || prev.buyer,
        }));

        if (detectedSupplier) setSupplierSearch(detectedSupplier);
        if (detectedBuyer) setBuyerSearch(detectedBuyer);
      }

      // Build product description from unique products (case-insensitive dedup, include freezing + glaze)
      const seen = new Set<string>();
      const uniqueDescs: string[] = [];
      processedItems.forEach((item: any) => {
        const parts = [item.product];
        if (item.freezing) parts.push(item.freezing);
        if (item.glaze) parts.push(item.glaze);
        const desc = parts.filter(Boolean).join(' ');
        const key = desc.toLowerCase();
        if (desc && !seen.has(key)) {
          seen.add(key);
          uniqueDescs.push(desc);
        }
      });
      const productDesc = uniqueDescs.join(', ');
      if (productDesc) {
        setPOData(prev => ({ ...prev, product: productDesc }));
      }

      // Show success
      const parts = [`${processedItems.length} product(s)`];
      if (detectedSupplier) parts.push('supplier');
      if (detectedBuyer) parts.push('buyer');
      setNotification({ type: 'success', message: `AI extracted: ${parts.join(', ')}` });
      setShowParser(false);

    } catch (err: any) {
      console.error('AI parser error:', err);
      setNotification({ type: 'error', message: err.message || 'AI parsing failed. Please try again or fill in manually.' });
    } finally {
      setIsParsingAI(false);
      setTimeout(() => setNotification(null), 4000);
    }
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
          <div ref={poDocRef} className="px-6 py-3 mx-auto bg-white" style={{ fontSize: '12px', lineHeight: '1.35', maxWidth: '1000px' }}>
            {/* Header with Logo */}
            <div className="flex items-center justify-between mb-2 pb-1.5 border-b-2 border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-gray-800" style={{ marginBottom: '1px' }}>GANESH INTERNATIONAL</h2>
                <p className="text-gray-500" style={{ fontSize: '10px', lineHeight: '1.3' }}>Office no. 226, 2nd Floor, Arun Chambers, Tardeo Road, Mumbai 400034</p>
                <p className="text-gray-500" style={{ fontSize: '10px', lineHeight: '1.3' }}>Tel: +91 22 2351 2345 | Email: ganeshintnlmumbai@gmail.com</p>
              </div>
              <div className="ml-4 flex-shrink-0">
                <GILogo size={60} />
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
              <table className="w-full border-collapse border border-gray-300" style={{ fontSize: '10.5px', tableLayout: 'auto' }}>
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
                      <td className="border border-gray-300 px-2 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>{item.pricePerKg ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${Number(item.pricePerKg).toFixed(2)}` : '-'}</td>
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
                      disabled={isParsingAI}
                      className={`px-5 py-2.5 text-white rounded-xl flex items-center gap-2 font-medium ${isParsingAI ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                      {isParsingAI ? (
                        <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Parsing with AI...</>
                      ) : (
                        <><Icon name="Sparkles" size={16} /> AI Parse & Fill</>
                      )}
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
