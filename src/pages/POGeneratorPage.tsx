import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import html2pdf from 'html2pdf.js';
import Icon from '../components/Icon';
import SignaturePad from '../components/SignaturePad';
import PODocumentPreview from '../components/PODocumentPreview';
import { ORDER_STAGES, BUYER_CODES } from '../data/constants';
import { supabase } from '../lib/supabase';
import { apiCall } from '../utils/api';
import type { ContactsMap, Order, LineItem, POFormData, OrganizationSettings } from '../types';
import { parsePackingKg, calculateLineItem, recalculateAllLineItems, calcGrandTotal, calcTotalKilos, calcTotalCases } from '../utils/lineItemCalcs';
import {
  getNextPONumber, getNextLoteNumber, incrementPONumber, getCurrentBulkPONumber,
  formatDate, getLastOrderDefaults, getAutoDestination, buildAttachmentMeta,
} from '../utils/poHelpers';

interface Props {
  contacts?: ContactsMap;
  orders?: Order[];
  setOrders?: (updater: (prev: Order[]) => Order[]) => void;
  onOrderCreated?: (order: Order) => void;
  orgId?: string | null;
  orgSettings?: OrganizationSettings | null;
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

interface Notification {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

function POGeneratorPage({ contacts = {}, orders = [], setOrders, onOrderCreated, orgId, orgSettings }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const amendmentOrder = (location.state as any)?.amendmentOrder as Order | undefined;
  const isAmendment = !!amendmentOrder;

  const [poData, setPOData] = useState({
    poNumber: getNextPONumber('', orders, BUYER_CODES),
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

  const [status, setStatus] = useState('draft');
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
  const [bulkDates, setBulkDates] = useState<string[]>([]);
  const [signatureData, setSignatureData] = useState<string>('');
  const [isParsingAI, setIsParsingAI] = useState(false);
  const poDocRef = useRef<HTMLDivElement>(null);
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

  // Sync bulkDates array when bulk mode or count changes
  useEffect(() => {
    if (bulkCreate && bulkCount > 0) {
      setBulkDates(prev => {
        const newDates = Array.from({ length: bulkCount }, (_, i) => prev[i] || poData.date);
        return newDates;
      });
    }
  }, [bulkCreate, bulkCount, poData.date]);

  // Pre-fill form when amending an existing PO
  useEffect(() => {
    if (!amendmentOrder) return;
    const stage1 = amendmentOrder.history?.find((h: any) => h.stage === 1 && h.attachments?.length);
    const meta = stage1?.attachments?.[0]?.meta || (typeof stage1?.attachments?.[0] === 'object' ? stage1.attachments[0] : null);
    const m = (meta && typeof meta === 'object' && 'supplier' in meta) ? meta as Record<string, any> : null;

    setPOData({
      poNumber: amendmentOrder.id || '',
      date: m?.date || amendmentOrder.date || new Date().toISOString().split('T')[0],
      supplier: m?.supplier || amendmentOrder.supplier || '',
      supplierEmail: m?.supplierEmail || '',
      supplierAddress: m?.supplierAddress || '',
      supplierCountry: m?.supplierCountry || 'India',
      product: m?.product || amendmentOrder.product || '',
      brand: amendmentOrder.brand || '',
      buyer: m?.buyer || amendmentOrder.company || '',
      buyerCode: '',
      destination: m?.destination || amendmentOrder.to || '',
      deliveryTerms: m?.deliveryTerms || 'CFR',
      commission: m?.commission || 'USD 0.05 per Kg',
      overseasCommission: m?.overseasCommission || '',
      overseasCommissionCompany: m?.overseasCommissionCompany || '',
      payment: m?.payment || '',
      packing: '',
      deliveryDate: m?.deliveryDate || '',
      loteNumber: m?.loteNumber || '',
      shippingMarks: m?.shippingMarks || '',
      buyerBank: m?.buyerBank || '',
      notes: '',
    });

    const existingItems = amendmentOrder.lineItems || m?.lineItems || [];
    if (existingItems.length > 0) {
      setLineItems(existingItems.map((li: any) => ({
        product: li.product || '',
        size: li.size || '',
        glaze: li.glaze || '',
        glazeMarked: li.glazeMarked || '',
        packing: li.packing || '',
        brand: li.brand || '',
        freezing: li.freezing || '',
        cases: li.cases || '',
        kilos: li.kilos || '',
        pricePerKg: li.pricePerKg ? Number(li.pricePerKg).toFixed(2) : '',
        currency: li.currency || 'USD',
        total: li.total ? Number(li.total).toFixed(2) : 0,
      })));
    }

    setBulkCreate(false);
    setShowParser(false);
  }, []);

  // ── Contact lists ──────────────────────────────────────────────
  const suppliers = Object.entries(contacts)
    .filter(([_, c]) => (c.role || '').toLowerCase().includes('supplier'))
    .map(([email, c]) => ({ email, ...c }));

  const buyers = Object.entries(contacts)
    .filter(([_, c]) => {
      const r = (c.role || '').toLowerCase();
      return r.includes('buyer') || r.includes('compras') || r.includes('calidad');
    })
    .map(([email, c]) => ({ email, ...c }));

  // ── Line item management ────────────────────────────────────────
  const updateLineItem = (index: number, field: string, value: string | number) => {
    const updated = [...lineItems];
    updated[index][field] = value;

    if (field === 'kilos' || field === 'packing' || field === 'pricePerKg') {
      const calculated = calculateLineItem(updated[index]);
      updated[index].cases = calculated.cases;
      if (field !== 'kilos' && parsePackingKg(updated[index].packing as string)) {
        updated[index].kilos = calculated.adjustedKilos;
      }
      updated[index].total = calculated.total;
    }

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

  const addLineItem = () => {
    const currentBuyer = buyers.find(b => b.company === poData.buyer);
    const defaultBrand = currentBuyer?.default_brand || '';
    setLineItems([...lineItems, { product: '', size: '', glaze: '', glazeMarked: '', packing: '', brand: defaultBrand, freezing: '', cases: '', kilos: '', pricePerKg: '', currency: 'USD', total: 0 }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  // ── Totals ──────────────────────────────────────────────────────
  const grandTotal = calcGrandTotal(lineItems);
  const totalKilos = calcTotalKilos(lineItems);
  const totalCases = calcTotalCases(lineItems);

  // ── AI Parser ───────────────────────────────────────────────────
  const parseNaturalLanguage = async (text: string) => {
    if (!text.trim()) {
      setNotification({ type: 'error', message: 'Please paste some text to parse.' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    setIsParsingAI(true);
    setNotification({ type: 'info', message: 'Parsing with AI...' });

    try {
      const suppliersList = Object.entries(contacts)
        .filter(([_, c]) => (c.role || '').toLowerCase().includes('supplier'))
        .map(([email, c]) => ({ company: c.company, email, address: c.address, country: c.country }));

      const buyersList = Object.entries(contacts)
        .filter(([_, c]) => {
          const r = (c.role || '').toLowerCase();
          return r.includes('buyer') || r.includes('compras') || r.includes('calidad');
        })
        .map(([email, c]) => ({ company: c.company, email, country: c.country }));

      const { data, error } = await apiCall('/api/parse-po', { rawText: text, suppliers: suppliersList, buyers: buyersList, organization_id: orgId });

      if (error) throw new Error(error.message || 'Failed to call AI parser');
      if (data?.error) throw new Error(data.error);

      const { lineItems: parsedItems, detectedSupplier, detectedSupplierEmail, detectedBuyer } = data;

      if (!parsedItems || parsedItems.length === 0) {
        setNotification({ type: 'warning', message: 'AI could not extract products. Please fill in manually.' });
        setTimeout(() => setNotification(null), 4000);
        return;
      }

      const processedItems = recalculateAllLineItems(parsedItems).map((item: any) => ({
        ...item,
        pricePerKg: item.pricePerKg ? Number(item.pricePerKg).toFixed(2) : '',
      }));
      setLineItems(processedItems);

      if (detectedSupplier || detectedBuyer) {
        const matchedSupplier = detectedSupplier
          ? suppliersList.find(s => s.company.toLowerCase() === detectedSupplier.toLowerCase())
          : null;

        setPOData(prev => ({
          ...prev,
          supplier: detectedSupplier || prev.supplier,
          supplierEmail: detectedSupplierEmail || prev.supplierEmail,
          supplierAddress: (matchedSupplier?.address && matchedSupplier.address !== 'EMPTY') ? matchedSupplier.address : prev.supplierAddress,
          supplierCountry: matchedSupplier?.country || prev.supplierCountry,
          buyer: detectedBuyer || prev.buyer,
        }));

        if (detectedSupplier) setSupplierSearch(detectedSupplier);
        if (detectedBuyer) setBuyerSearch(detectedBuyer);
      }

      // Build product description from unique products
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

  // ── Supplier / Buyer handlers ───────────────────────────────────
  const handleSupplierChange = (email: string) => {
    const supplier = suppliers.find(s => s.email === email) || (contacts[email] ? { email, ...contacts[email] } : null);
    const supplierName = supplier?.name?.toLowerCase() || '';
    const buyerCompany = poData.buyer?.toLowerCase() || '';

    let autoPayment = '';
    if (buyerCompany && supplierName) {
      const matchingOrders = orders.filter(o =>
        o.company?.toLowerCase().includes(buyerCompany) &&
        o.supplier?.toLowerCase().includes(supplierName)
      );
      if (matchingOrders.length > 0) autoPayment = 'LC at Sight';
    }

    const supplierCompany = supplier ? supplier.company : '';
    let supplierAddr = (supplier?.address && supplier.address !== 'EMPTY') ? supplier.address : '';
    if (!supplierAddr && supplierCompany) {
      const sameCompany = Object.values(contacts).find(c =>
        c.company.toLowerCase() === supplierCompany.toLowerCase() && c.address && c.address !== 'EMPTY'
      );
      if (sameCompany) supplierAddr = sameCompany.address;
    }
    setPOData({
      ...poData,
      supplierEmail: email,
      supplier: supplierCompany,
      supplierAddress: supplierAddr,
      supplierCountry: supplier?.country || '',
      payment: autoPayment || poData.payment,
    });

    if (supplierCompany && poData.buyer) {
      const defaults = getLastOrderDefaults(supplierCompany, poData.buyer, orders);
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

  const handleBuyerChange = (email: string) => {
    const buyer = buyers.find(b => b.email === email);
    const buyerCompany = buyer ? buyer.company : '';
    const buyerCode = BUYER_CODES[buyerCompany] || buyerCompany.substring(0, 2).toUpperCase();
    const newPONumber = getNextPONumber(buyerCompany, orders, BUYER_CODES);

    const autoDestination = getAutoDestination(buyerCompany);

    const shipmentDate = new Date();
    shipmentDate.setDate(shipmentDate.getDate() + 25);
    const autoDeliveryDate = shipmentDate.toISOString().split('T')[0];

    setPOData({
      ...poData,
      buyer: buyerCompany,
      buyerCode: buyerCode,
      buyerBank: buyer?.country || '',
      poNumber: newPONumber,
      loteNumber: (buyer as any)?.lote_format || getNextLoteNumber(buyerCompany, orders),
      destination: autoDestination || poData.destination,
      deliveryDate: autoDeliveryDate,
      commission: poData.commission || 'USD 0.05 per Kg',
    });

    const buyerDefaultBrand = buyer?.default_brand || '';

    if (poData.supplier && buyerCompany) {
      const defaults = getLastOrderDefaults(poData.supplier, buyerCompany, orders);
      setLineItems(prev => prev.map(item => ({
        ...item,
        packing: item.packing || defaults?.packing || '',
        brand: buyerDefaultBrand || item.brand || defaults?.brand || '',
        freezing: item.freezing || defaults?.freezing || '',
      })));
    } else if (buyerDefaultBrand) {
      setLineItems(prev => prev.map(item => ({
        ...item,
        brand: item.brand || buyerDefaultBrand,
      })));
    }
  };

  // ── Submit / Approve / Reject ───────────────────────────────────
  const submitForApproval = () => {
    if (!poData.supplier || !poData.buyer || lineItems.every(item => !item.product)) {
      setNotification({ type: 'error', message: 'Please fill in required fields: Supplier, Buyer, and at least one product line.' });
      setTimeout(() => setNotification(null), 4000);
      return;
    }
    const missingBrand = lineItems.filter(item => item.product && !item.brand);
    if (missingBrand.length > 0) {
      setNotification({ type: 'error', message: `Brand is required for all products. ${missingBrand.length} item(s) missing brand.` });
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

  const approvePO = () => {
    setStatus('approved');
    setNotification({ type: 'success', message: '✅ Purchase Order approved! Ready to send to supplier.' });
    setTimeout(() => setNotification(null), 4000);
  };

  const rejectPO = () => {
    setStatus('draft');
    setShowPreview(false);
    setShowSignOff(false);
    setNotification({ type: 'warning', message: 'Returned to draft mode for editing.' });
    setTimeout(() => setNotification(null), 3000);
  };

  // ── PDF Download ────────────────────────────────────────────────
  const currentPreviewPONumber = bulkCreate
    ? getCurrentBulkPONumber(poData.poNumber, bulkPreviewIndex)
    : poData.poNumber;

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
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(poDocRef.current).save();
      setNotification({ type: 'success', message: `PDF downloaded as ${filename}` });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      setNotification({ type: 'error', message: 'Failed to generate PDF. Please try again.' });
      setTimeout(() => setNotification(null), 4000);
    }
    setGeneratingPdf(false);
  };

  // ── Email sending ───────────────────────────────────────────────
  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const sendEmailWithPdf = async (recipient: string, cc: string, subject: string, body: string, pdfBlob: Blob | null, filename: string) => {
    if (!orgId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const recipients = [recipient];
      if (cc) cc.split(',').map(e => e.trim()).filter(e => e).forEach(e => recipients.push(e));

      const attachments: Array<{ filename: string; data: string; mimeType: string }> = [];
      if (pdfBlob) {
        attachments.push({ filename, data: await blobToBase64(pdfBlob), mimeType: 'application/pdf' });
      }

      const { data, error: sendErr } = await apiCall('/api/send-email', { organization_id: orgId, user_id: user.id, recipients, subject, body, attachments });
      if (sendErr) throw sendErr;
      if (data?.error) throw new Error(data.error);
    } catch (err: any) {
      console.error('Email send failed:', err);
      alert('Order saved but email failed to send: ' + (err.message || 'Unknown error'));
    }
  };

  // ── Send PO (new + amendment) ───────────────────────────────────
  const sendPO = async () => {
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

    const totals = { totalCases, totalKilos, grandTotal };

    // ── Amendment flow ──
    if (isAmendment && amendmentOrder) {
      const meta = buildAttachmentMeta(poData, lineItems, totals);
      meta.pdfUrl = primaryPdfUrl;

      const updatedOrder: Order = {
        ...amendmentOrder,
        company: poData.buyer,
        product: poData.product || lineItems.map(li => li.product).filter(p => p).join(', '),
        specs: lineItems.map(li => `${li.size || ''} ${li.glaze ? `(${li.glaze})` : ''} ${li.packing || ''}`.trim()).filter(s => s).join(', '),
        to: poData.destination || poData.buyerBank || amendmentOrder.to,
        supplier: poData.supplier.split(' - ')[0] || poData.supplier,
        brand: poData.brand || amendmentOrder.brand,
        totalValue: grandTotal,
        totalKilos: totalKilos,
        lineItems: lineItems,
        metadata: { pdfUrl: primaryPdfUrl },
        history: [
          ...(amendmentOrder.history || []),
          {
            stage: 1,
            timestamp: new Date().toISOString(),
            from: `${orgSettings?.company_name || 'Trading Company'} <${orgSettings?.smtp_from_email || 'info@example.com'}>`,
            to: sendTo || poData.supplierEmail,
            subject: `AMENDED PO ${poData.poNumber}`,
            body: `Purchase Order ${poData.poNumber} has been amended.\n\nUpdated Total Value: USD ${grandTotal}\nUpdated Total Quantity: ${totalKilos} Kg\n\nAmended on: ${new Date().toLocaleString()}`,
            hasAttachment: true,
            attachments: [{ name: `${poData.poNumber.replace(/\//g, '_')}.pdf`, meta }]
          }
        ]
      };

      setStatus('sent');
      setNotification({ type: 'success', message: `Purchase Order ${poData.poNumber} amended successfully!` });

      if (onOrderCreated) onOrderCreated(updatedOrder);

      if (pdfBlob) {
        try {
          await supabase.storage.from('po-documents').upload(primaryFilename, pdfBlob, { contentType: 'application/pdf', upsert: true });
        } catch { alert('PDF upload failed, but order was saved.'); }
      }

      const amendRecipient = sendTo || poData.supplierEmail;
      if (amendRecipient) {
        await sendEmailWithPdf(
          amendRecipient, ccEmails,
          `AMENDED PO ${poData.poNumber}`,
          `Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached the Amended Purchase Order.\n\nPO Number: ${poData.poNumber}\nBuyer: ${poData.buyer}\nUpdated Total Value: USD ${grandTotal}\nUpdated Total Quantity: ${totalKilos} Kg\n\nKindly confirm receipt and proceed at the earliest.\n\nThanking you,\nBest regards,\n\n${orgSettings?.contact_name || 'Manager'}\n${orgSettings?.company_name || 'Trading Company'}`,
          pdfBlob, primaryFilename
        );
      }
      return;
    }

    // ── New PO flow ──
    const count = bulkCreate ? bulkCount : 1;
    const newOrders: Order[] = [];

    for (let i = 0; i < count; i++) {
      const currentPONumber = getCurrentBulkPONumber(poData.poNumber, i);
      const filename = `${currentPONumber.replace(/\//g, '_')}.pdf`;
      const pdfUrl = supabase.storage.from('po-documents').getPublicUrl(filename).data.publicUrl;
      const orderDateStr = (bulkCreate && bulkDates[i]) ? bulkDates[i] : poData.date;
      const orderDateFormatted = new Date(orderDateStr + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

      const meta = buildAttachmentMeta(poData, lineItems, totals);
      meta.pdfUrl = pdfUrl;
      meta.date = orderDateStr;

      const newOrder: Order = {
        id: currentPONumber,
        poNumber: currentPONumber.split('/').pop() || currentPONumber,
        company: poData.buyer,
        product: poData.product || lineItems.map(li => li.product).filter(p => p).join(', '),
        specs: lineItems.map(li => `${li.size || ''} ${li.glaze ? `(${li.glaze})` : ''} ${li.packing || ''}`.trim()).filter(s => s).join(', '),
        from: 'India',
        to: poData.destination || poData.buyerBank || 'Spain',
        date: orderDateFormatted,
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
            from: `${orgSettings?.company_name || 'Trading Company'} <${orgSettings?.smtp_from_email || 'info@example.com'}>`,
            to: sendTo || poData.supplierEmail,
            subject: `NEW PO ${currentPONumber}`,
            body: `Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached the Purchase Order for ${poData.product || 'Frozen Seafood'}.\n\nPO Number: ${currentPONumber}\nBuyer: ${poData.buyer}\nTotal Value: USD ${grandTotal}\nTotal Quantity: ${totalKilos} Kg\n\nKindly confirm receipt and proceed at the earliest.\n\nThanking you,\nBest regards,\n\n${orgSettings?.contact_name || 'Manager'}\n${orgSettings?.company_name || 'Trading Company'}`,
            hasAttachment: true,
            attachments: [{ name: `${currentPONumber.replace(/\//g, '_')}.pdf`, meta }]
          }
        ]
      };

      newOrders.push(newOrder);
    }

    if (setOrders) setOrders(prevOrders => [...newOrders, ...prevOrders]);

    setStatus('sent');
    if (count > 1) {
      const lastPO = newOrders[newOrders.length - 1].id;
      setNotification({ type: 'success', message: `📧 ${count} Purchase Orders created (${poData.poNumber} to ${lastPO}) for ${poData.supplier}!` });
    } else {
      setNotification({ type: 'success', message: `📧 Purchase Order ${poData.poNumber} sent to ${poData.supplier}! New order created.` });
    }

    if (onOrderCreated) {
      for (const order of newOrders) onOrderCreated(order);
    }

    if (pdfBlob) {
      try {
        await supabase.storage.from('po-documents').upload(primaryFilename, pdfBlob, { contentType: 'application/pdf', upsert: true });
      } catch { alert('PDF upload failed, but order was saved.'); }
    }

    const recipient = sendTo || poData.supplierEmail;
    if (recipient) {
      for (const order of newOrders) {
        const poNum = order.id;
        const filename = `${poNum.replace(/\//g, '_')}.pdf`;
        await sendEmailWithPdf(
          recipient, ccEmails,
          `NEW PO ${poNum}`,
          `Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached the Purchase Order for ${poData.product || 'Frozen Seafood'}.\n\nPO Number: ${poNum}\nBuyer: ${poData.buyer}\nTotal Value: USD ${grandTotal}\nTotal Quantity: ${totalKilos} Kg\n\nKindly confirm receipt and proceed at the earliest.\n\nThanking you,\nBest regards,\n\n${orgSettings?.contact_name || 'Manager'}\n${orgSettings?.company_name || 'Trading Company'}`,
          pdfBlob, filename
        );
      }
    }
  };

  // ── Notification helper ─────────────────────────────────────────
  const showNotification = (n: Notification) => {
    setNotification(n);
    setTimeout(() => setNotification(null), 3000);
  };

  // ── RENDER ──────────────────────────────────────────────────────
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
              {showPreview ? 'Review Purchase Order' : isAmendment ? 'Amend Purchase Order' : 'Create Purchase Order'}
            </h1>
            <p className="text-gray-500">
              {showPreview ? 'Review and approve before sending' : isAmendment ? `Editing ${amendmentOrder?.id} — changes will update the existing order` : 'Generate and send PO to supplier'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
                  <div className="flex items-center gap-2 mt-1.5 justify-center">
                    <label className="text-xs text-gray-500">Date:</label>
                    <input
                      type="date"
                      value={bulkDates[bulkPreviewIndex] || poData.date}
                      onChange={(e) => {
                        setBulkDates(prev => {
                          const updated = [...prev];
                          updated[bulkPreviewIndex] = e.target.value;
                          return updated;
                        });
                      }}
                      className="px-2 py-0.5 border border-blue-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
                <button
                  onClick={() => setBulkPreviewIndex(Math.min(bulkCount - 1, bulkPreviewIndex + 1))}
                  disabled={bulkPreviewIndex === bulkCount - 1}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Next <Icon name="ChevronRight" size={16} />
                </button>
              </div>
              {!showSignOff && status === 'draft' && (
                <div className="flex justify-center mt-3 pt-3 border-t border-blue-200">
                  <button onClick={submitForApproval} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium shadow-sm text-sm">
                    <Icon name="CheckCircle" size={16} /> Submit All {bulkCount} POs for Sign-off
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PO Document Preview — extracted component */}
          <PODocumentPreview
            ref={poDocRef}
            poData={poData}
            lineItems={lineItems}
            grandTotal={grandTotal}
            totalKilos={totalKilos}
            totalCases={totalCases}
            signatureData={signatureData}
            status={status}
            currentPreviewPONumber={currentPreviewPONumber}
            displayDate={(bulkCreate && bulkDates[bulkPreviewIndex]) ? bulkDates[bulkPreviewIndex] : poData.date}
            orgSettings={orgSettings}
          />

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

                  {/* Digital Signature — extracted component */}
                  <SignaturePad
                    signatureData={signatureData}
                    onSignatureChange={setSignatureData}
                    onNotification={(n) => { setNotification(n); setTimeout(() => setNotification(null), 3000); }}
                  />

                  {/* Bulk Email List */}
                  {bulkCreate && bulkCount > 1 && (
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Emails to be sent ({bulkCount} separate emails)</span>
                      </div>
                      <div className="max-h-40 overflow-y-auto divide-y divide-gray-100">
                        {Array.from({ length: bulkCount }, (_, i) => {
                          const poNum = getCurrentBulkPONumber(poData.poNumber, i);
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

                  {/* Subject */}
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
            {/* Order Info Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Icon name="FileText" size={20} className="text-blue-600" />
                Order Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PO Number</label>
                  <input type="text" value={poData.poNumber} onChange={(e) => setPOData({...poData, poNumber: e.target.value})} readOnly={isAmendment} className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${isAmendment ? 'bg-gray-100 cursor-not-allowed' : ''}`} />
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Address</label>
                  <input type="text" value={poData.supplierAddress} onChange={(e) => setPOData({...poData, supplierAddress: e.target.value})} placeholder="Supplier full address (auto-fills from contacts)" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
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
                          <label className="block text-xs font-medium text-gray-500 mb-1">Brand *</label>
                          <input type="text" value={item.brand || ''} onChange={(e) => updateLineItem(idx, 'brand', e.target.value)} placeholder="Brand name (required)" className={`w-full px-3 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm ${item.product && !item.brand ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
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
                            <input type="number" step="0.01" value={item.pricePerKg} onChange={(e) => updateLineItem(idx, 'pricePerKg', e.target.value)} onBlur={(e) => { if (e.target.value) updateLineItem(idx, 'pricePerKg', Number(e.target.value).toFixed(2)); }} placeholder="0.00" className="w-full min-w-0 px-1 py-2.5 bg-transparent border-none focus:ring-0 focus:outline-none text-sm text-right" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Line Total</label>
                          <div className="w-full px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-right font-bold text-green-700">
                            {(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}{Number(item.total || 0).toFixed(2)}
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
            {/* Quick Fill Card */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl shadow-sm border border-blue-200 overflow-hidden">
              <button
                onClick={() => setShowParser(!showParser)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-blue-100/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
                    <Icon name="Mail" size={18} className="text-white" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold text-blue-800 text-sm">Quick Fill from Email</h3>
                    <p className="text-xs text-blue-600">Paste text to auto-extract details</p>
                  </div>
                </div>
                <Icon name="ChevronDown" size={18} className={`text-blue-600 transition-transform ${showParser ? 'rotate-180' : ''}`} />
              </button>
              {showParser && (
                <div className="px-6 pb-5 space-y-3 border-t border-blue-200">
                  <textarea
                    value={rawInput}
                    onChange={(e) => setRawInput(e.target.value)}
                    placeholder="Paste email or message here...

Example: 'We need Product A U/3 - 2900 Kgs @ 7.9 USD and 3/6 - 2160 Kgs @ 7.2 USD CFR Destination. Packing 6x1 kg.'"
                    className="w-full h-28 px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-none mt-3"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => parseNaturalLanguage(rawInput)}
                      disabled={isParsingAI}
                      className={`px-4 py-2 text-white rounded-lg flex items-center gap-2 text-sm font-medium ${isParsingAI ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                      {isParsingAI ? (
                        <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Parsing...</>
                      ) : (
                        <><Icon name="Sparkles" size={14} /> AI Parse & Fill</>
                      )}
                    </button>
                    <button
                      onClick={() => setRawInput('')}
                      className="px-3 py-2 bg-white text-gray-600 rounded-lg hover:bg-gray-50 border border-gray-200 text-sm"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Summary Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Order Summary</h3>

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
                <button onClick={() => { setShowPreview(true); setBulkPreviewIndex(0); }} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2">
                  <Icon name="Eye" size={16} /> Preview PO
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default POGeneratorPage;
