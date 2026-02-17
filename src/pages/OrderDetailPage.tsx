import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import html2pdf from 'html2pdf.js';
import Icon from '../components/Icon';
import { ORDER_STAGES } from '../data/constants';
import ExpandableEmailCard from '../components/ExpandableEmailCard';
import OrderProgressBar from '../components/OrderProgressBar';
import EditOrderModal from '../components/EditOrderModal';
import AmendPOModal from '../components/AmendPOModal';
import type { Order, AttachmentEntry, ContactsMap } from '../types';
import { getAttachmentName, getAttachmentMeta } from '../types';
import { supabase } from '../lib/supabase';
import { buildPOHtml, buildPIHtml, orderToPdfData } from '../utils/pdfBuilders';
import type { CatalogProduct } from '../hooks/useProducts';

interface Props {
  orders: Order[];
  contacts?: ContactsMap;
  products?: CatalogProduct[];
  onUpdateStage?: (orderId: string, newStage: number, oldStage?: number) => Promise<void>;
  onUpdateOrder?: (orderId: string, updates: Partial<Order>) => Promise<void>;
  onDeleteOrder?: (orderId: string) => Promise<void>;
}

function OrderDetailPage({ orders, contacts, products, onUpdateStage, onUpdateOrder, onDeleteOrder }: Props) {
  const { orderId: rawOrderId } = useParams<{ orderId: string }>();
  const orderId = rawOrderId ? decodeURIComponent(rawOrderId) : '';
  const navigate = useNavigate();
  const [activeDocSection, setActiveDocSection] = useState<string | null>(null);
  const [pdfModal, setPdfModal] = useState<{ open: boolean; url: string; title: string; loading: boolean }>({
    open: false, url: '', title: '', loading: false,
  });
  const [editModal, setEditModal] = useState(false);
  const [amendModal, setAmendModal] = useState(false);

  // Compute dropdown options from contacts and products
  const buyerOptions = useMemo(() => {
    if (!contacts) return [];
    return [...new Set(Object.values(contacts).filter(c => /buyer/i.test(c.role)).map(c => c.company))].filter(Boolean).sort();
  }, [contacts]);
  const supplierOptions = useMemo(() => {
    if (!contacts) return [];
    return [...new Set(Object.values(contacts).filter(c => /supplier/i.test(c.role)).map(c => c.company))].filter(Boolean).sort();
  }, [contacts]);
  const productOptions = useMemo(() => {
    if (!products) return [];
    return [...new Set(products.map(p => p.name))].filter(Boolean).sort();
  }, [products]);
  const brandOptions = useMemo(() => {
    if (!contacts) return [];
    return [...new Set(Object.values(contacts).map(c => c.default_brand))].filter(Boolean).sort();
  }, [contacts]);

  const order = orders.find(o => o.id === orderId);

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Icon name="AlertCircle" size={48} className="text-gray-300 mb-4" />
        <p className="font-medium text-gray-500 mb-2">Order not found</p>
        <p className="text-sm text-gray-400 mb-6">The order you're looking for doesn't exist.</p>
        <button
          onClick={() => navigate('/orders')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Back to Orders
        </button>
      </div>
    );
  }

  const currentStageName = ORDER_STAGES[order.currentStage - 1]?.name || 'Unknown';
  const isCompleted = order.currentStage === 8;

  // Check which stages have history entries
  const hasStageData = (stage: number) => order.history.some(h => h.stage === stage);

  // Document sections mapped to stages
  const docSections = [
    { id: 'purchaseOrder', title: 'Purchase Order', icon: 'FileText', color: 'blue', stage: 1, available: hasStageData(1) },
    { id: 'proformaInvoice', title: 'Proforma Invoice', icon: 'FileText', color: 'indigo', stage: 2, available: hasStageData(2) || !!order.piNumber },
    { id: 'artwork', title: 'Artwork / Labels', icon: 'Image', color: 'purple', stage: 3, available: hasStageData(3) || order.artworkStatus === 'approved' },
    { id: 'inspection', title: 'Quality Check', icon: 'CheckCircle', color: 'pink', stage: 4, available: hasStageData(4) },
    { id: 'schedule', title: 'Schedule Confirmed', icon: 'Calendar', color: 'teal', stage: 5, available: hasStageData(5) },
    { id: 'draftDocuments', title: 'Draft Documents', icon: 'File', color: 'amber', stage: 6, available: hasStageData(6) },
    { id: 'finalDocuments', title: 'Final Documents', icon: 'FileCheck', color: 'green', stage: 7, available: hasStageData(7) },
    { id: 'dhlShipped', title: 'DHL Shipped', icon: 'Truck', color: 'emerald', stage: 8, available: hasStageData(8) },
  ];

  const formatDate = (ts: string) => {
    try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return ts; }
  };

  // Get line items from order (they're stored as Record<string, string | number | boolean>[])
  const lineItems = order.lineItems || [];

  // Render document content based on section type
  const renderDocumentContent = (sectionId: string) => {
    switch (sectionId) {
      case 'purchaseOrder': {
        // Find PO document URL from order history (stored attachment from email)
        const poUrl = (() => {
          const stage1 = order.history.filter(h => h.stage === 1 && h.attachments?.length);
          for (const h of stage1) {
            for (const att of (h.attachments || [])) {
              const meta = getAttachmentMeta(att);
              if (meta?.pdfUrl) return { url: meta.pdfUrl, name: getAttachmentName(att) };
            }
          }
          return null;
        })();
        return (
          <div className="space-y-3">
            <div className="flex items-stretch gap-2">
              {poUrl && (
                <button
                  onClick={() => setPdfModal({ open: true, url: poUrl.url, title: `PO - ${order.id}`, loading: false })}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
                >
                  <Icon name="FileText" size={15} />
                  View PO
                </button>
              )}
              <button
                onClick={previewPOasPDF}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
              >
                <Icon name="FileText" size={15} />
                {poUrl ? 'Generated PO' : 'View as PDF'}
              </button>
              <button
                onClick={() => {
                  const meta = getPOMeta();
                  const items = meta?.lineItems || order.lineItems || [];
                  setAmendItems(items.map((li: any) => ({
                    product: li.product || '', brand: li.brand || '', freezing: li.freezing || '',
                    size: li.size || '', glaze: li.glaze || '', glazeMarked: li.glazeMarked || '',
                    packing: li.packing || '', cases: li.cases || '', kilos: li.kilos || '',
                    pricePerKg: li.pricePerKg || '', currency: li.currency || 'USD',
                    total: Number(li.total) || 0,
                  })));
                  setAmendModal(true);
                }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
              >
                <Icon name="Edit" size={15} />
                Amend PO
              </button>
            </div>
            {renderAttachments(1)}
          </div>
        );
      }

      case 'proformaInvoice': {
        // Find PI document URL from order history
        const piUrl = (() => {
          const stage2 = order.history.filter(h => h.stage === 2 && h.attachments?.length);
          for (const h of stage2) {
            for (const att of (h.attachments || [])) {
              const meta = getAttachmentMeta(att);
              if (meta?.pdfUrl) return { url: meta.pdfUrl, name: getAttachmentName(att) };
            }
          }
          return null;
        })();
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">PI Number</p>
                <p className="font-mono font-semibold text-gray-800">{order.piNumber || 'Pending'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Against PO</p>
                <p className="font-mono text-sm text-gray-800">{order.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Supplier</p>
                <p className="font-medium text-gray-800">{order.supplier}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Buyer</p>
                <p className="font-medium text-gray-800">{order.company}</p>
              </div>
            </div>
            {order.totalValue && (
              <div className="bg-indigo-50 rounded-lg p-3 flex items-center justify-between">
                <span className="text-sm text-indigo-700 font-medium">Invoice Value</span>
                <span className="font-bold text-indigo-800">USD {order.totalValue}</span>
              </div>
            )}
            <div className="flex items-stretch gap-2">
              {piUrl && (
                <button
                  onClick={() => setPdfModal({ open: true, url: piUrl.url, title: `PI - ${order.piNumber || order.id}`, loading: false })}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
                >
                  <Icon name="FileText" size={15} />
                  View PI
                </button>
              )}
              {lineItems.length > 0 && (
                <button
                  onClick={previewPIasPDF}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
                >
                  <Icon name="FilePlus" size={15} />
                  Generate PI
                </button>
              )}
            </div>
            {renderAttachments(2)}
          </div>
        );
      }

      case 'artwork':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-medium ${order.artworkStatus === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {order.artworkStatus ? order.artworkStatus.charAt(0).toUpperCase() + order.artworkStatus.slice(1) : 'Pending Review'}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Product</p>
                <p className="font-medium text-gray-800">{order.product}</p>
              </div>
              {order.brand && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Brand</p>
                  <p className="font-medium text-gray-800">{order.brand}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Buyer</p>
                <p className="font-medium text-gray-800">{order.company}</p>
              </div>
            </div>
            {renderAttachments(3)}
          </div>
        );

      case 'inspection':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Product</p>
                <p className="font-medium text-gray-800">{order.product}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Supplier</p>
                <p className="font-medium text-gray-800">{order.supplier}</p>
              </div>
            </div>
            <div className="bg-pink-50 rounded-lg p-3">
              <p className="text-sm text-pink-700">Quality check documentation and inspection reports for this order.</p>
            </div>
            {renderAttachments(4)}
          </div>
        );

      case 'schedule':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Route</p>
                <p className="font-medium text-gray-800">{order.from} → {order.to}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Quantity</p>
                <p className="font-medium text-gray-800">{order.totalKilos ? `${Number(order.totalKilos).toLocaleString()} Kg` : '-'}</p>
              </div>
            </div>
            {renderAttachments(5)}
          </div>
        );

      case 'draftDocuments':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">PO Number</p>
                <p className="font-mono font-semibold text-gray-800">{order.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <span className="inline-block text-xs px-2.5 py-1 rounded-full font-medium bg-amber-100 text-amber-700">Draft - Pending Review</span>
              </div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-sm text-amber-700">Draft shipping documents for review before finalization. Check all details match the PO and PI.</p>
            </div>
            {renderAttachments(6)}
          </div>
        );

      case 'finalDocuments':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">PO Number</p>
                <p className="font-mono font-semibold text-gray-800">{order.id}</p>
              </div>
              {order.awbNumber && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">AWB / Tracking</p>
                  <p className="font-mono font-semibold text-blue-600">{order.awbNumber}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Buyer</p>
                <p className="font-medium text-gray-800">{order.company}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Destination</p>
                <p className="font-medium text-gray-800">{order.to}</p>
              </div>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-sm text-green-700">Final shipping and export documents for this consignment.</p>
            </div>
            {renderAttachments(7)}
          </div>
        );

      case 'dhlShipped': {
        const dhlHistory = order.history.filter(h => h.stage === 8);
        const awb = order.awbNumber || dhlHistory.find(h => h.body?.match(/AWB\s*[\d]+/i))?.body?.match(/AWB\s*([\d]+)/i)?.[1] || '';
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {awb && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">AWB / Tracking Number</p>
                  <p className="font-mono font-semibold text-blue-600">{awb}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Destination</p>
                <p className="font-medium text-gray-800">{order.to || 'TBC'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <p className="font-medium text-emerald-700">{order.currentStage >= 8 ? 'Shipped' : 'Pending'}</p>
              </div>
            </div>
            {awb && (
              <a
                href={`https://www.dhl.com/en/express/tracking.html?AWB=${awb}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded-xl transition-colors"
              >
                <Icon name="ExternalLink" size={16} />
                Track on DHL
              </a>
            )}
            {renderAttachments(8)}
          </div>
        );
      }

      default:
        return null;
    }
  };

  // Extract PO metadata from stage 1 attachment (if stored as object with meta)
  const getPOMeta = (): Record<string, any> | null => {
    const stage1 = order.history.find(h => h.stage === 1 && h.attachments?.length);
    if (!stage1?.attachments) return null;
    for (const att of stage1.attachments) {
      const meta = getAttachmentMeta(att);
      if (meta) return meta;
    }
    return null;
  };

  // Render attachment list for a given stage
  const renderAttachments = (stage: number) => {
    const stageEmails = order.history.filter(h => h.stage === stage && h.hasAttachment && h.attachments?.length);
    const allAttachments = stageEmails.flatMap(h => (h.attachments || []).map(att => ({ name: getAttachmentName(att), date: h.timestamp })));
    if (allAttachments.length === 0) return null;
    return (
      <div className="pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Attachments</p>
        <div className="space-y-1.5">
          {allAttachments.map((att, idx) => {
            const isPdf = att.name.toLowerCase().endsWith('.pdf');
            return (
              <button
                key={idx}
                onClick={() => handleAttachmentClick(att.name, stage)}
                className="w-full flex items-center gap-2 text-sm bg-gray-50 hover:bg-blue-50 rounded-lg px-3 py-2.5 transition-colors text-left group cursor-pointer"
              >
                <Icon name={isPdf ? 'FileText' : 'Paperclip'} size={16} className={isPdf ? 'text-red-500' : 'text-gray-400'} />
                <span className="font-medium text-gray-700 flex-1 group-hover:text-blue-700 transition-colors">{att.name}</span>
                {isPdf && <span className="text-xs font-medium text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">Click to preview</span>}
                <span className="text-xs text-gray-400">{formatDate(att.date)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Helper: build PdfData from current order + metadata
  const getPdfData = () => orderToPdfData(order, getPOMeta(), lineItems);

  // Generate PI PDF and show in modal
  const previewPIasPDF = async () => {
    setPdfModal({ open: true, url: '', title: `Proforma Invoice - ${order.piNumber || order.id}`, loading: true });
    try {
      const html = buildPIHtml(getPdfData());
      const blob = await (html2pdf() as any).set({
        margin: [4, 5, 4, 5],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(html, 'string').output('blob');
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      setPdfModal(prev => ({ ...prev, url, loading: false }));
    } catch {
      setPdfModal(prev => ({ ...prev, loading: false }));
    }
  };

  // Show stored PDF in modal — loads directly from Supabase Storage
  // Falls back to on-the-fly generation only for old orders without a stored file
  const previewPOasPDF = async () => {
    setPdfModal({ open: true, url: '', title: `Purchase Order - ${order.id}`, loading: true });

    // Check for stored PDF URL (order metadata first, then attachment meta)
    const meta = getPOMeta();
    const storedUrl = order.metadata?.pdfUrl || meta?.pdfUrl;

    if (storedUrl) {
      setPdfModal(prev => ({ ...prev, url: storedUrl, loading: false }));
      return;
    }

    // Fallback for older orders: generate from HTML
    try {
      const html = buildPOHtml(getPdfData());
      const blob = await (html2pdf() as any).set({
        margin: [4, 5, 4, 5],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(html, 'string').output('blob');
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      setPdfModal(prev => ({ ...prev, url, loading: false }));
    } catch {
      setPdfModal(prev => ({ ...prev, loading: false }));
    }
  };

  // Force regenerate PDF from data (for when stored file isn't available)
  const regeneratePDF = async () => {
    setPdfModal(prev => ({ ...prev, loading: true }));
    try {
      const html = buildPOHtml(getPdfData());
      const blob = await (html2pdf() as any).set({
        margin: [4, 5, 4, 5],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(html, 'string').output('blob');
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      setPdfModal(prev => ({ ...prev, url, loading: false }));
    } catch {
      setPdfModal(prev => ({ ...prev, loading: false }));
    }
  };

  // Handle clicking an attachment
  const handleAttachmentClick = (name: string, stage: number) => {
    if (name.toLowerCase().endsWith('.pdf') && stage === 1) {
      previewPOasPDF();
      return;
    }
    // Look for pdfUrl in attachment metadata
    const stageHistory = order.history.filter(h => h.stage === stage && h.attachments?.length);
    for (const h of stageHistory) {
      for (const att of (h.attachments || [])) {
        const attName = getAttachmentName(att);
        const meta = getAttachmentMeta(att);
        if (attName === name && meta?.pdfUrl) {
          setPdfModal({ open: true, url: meta.pdfUrl, title: name, loading: false });
          return;
        }
      }
    }
    // Fallback — no URL available
    setPdfModal({ open: true, url: '', title: name, loading: false });
  };

  const closePdfModal = () => {
    if (pdfModal.url && pdfModal.url.startsWith('blob:')) URL.revokeObjectURL(pdfModal.url);
    setPdfModal({ open: false, url: '', title: '', loading: false });
  };

  // Build order options for the reassign dropdown
  const allOrderOptions = orders.map(o => ({
    id: o.id,
    poNumber: o.poNumber || o.id,
    company: o.company,
    product: o.product,
  }));

  // Handle reassigning an email to a different order
  const handleReassignEmail = async (historyEntryId: string, newOrderId: string, note: string) => {
    try {
      // Find the destination order's DB UUID
      const destOrder = orders.find(o => o.id === newOrderId);
      if (!destOrder) return;

      // Look up the DB UUID for the destination order
      const { data: destRow } = await supabase
        .from('orders')
        .select('id')
        .eq('order_id', newOrderId)
        .single();

      if (!destRow) return;

      // Move the order_history record to the new order
      await supabase
        .from('order_history')
        .update({ order_id: destRow.id })
        .eq('id', historyEntryId);

      // Record the correction in synced_emails (match by subject + from for this order)
      const entry = order.history.find(h => h.id === historyEntryId);
      if (entry) {
        await supabase
          .from('synced_emails')
          .update({
            corrected_order_id: newOrderId,
            correction_note: note || `Moved from ${order.id} to ${newOrderId}`,
            corrected_at: new Date().toISOString(),
          })
          .eq('subject', entry.subject)
          .eq('from_address', entry.from);
      }

      // Refresh orders data
      window.location.reload();
    } catch (err) {
      console.error('Reassign failed:', err);
    }
  };

  // Handle removing an email from this order (delete the history entry)
  const handleRemoveEmail = async (historyEntryId: string, note: string) => {
    try {
      await supabase
        .from('order_history')
        .delete()
        .eq('id', historyEntryId);

      // Record the correction
      const entry = order.history.find(h => h.id === historyEntryId);
      if (entry) {
        await supabase
          .from('synced_emails')
          .update({
            corrected_order_id: 'REMOVED',
            correction_note: note || `Removed from ${order.id}`,
            corrected_at: new Date().toISOString(),
          })
          .eq('subject', entry.subject)
          .eq('from_address', entry.from);
      }

      window.location.reload();
    } catch (err) {
      console.error('Remove failed:', err);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-200 bg-gray-100 rounded-lg transition-colors z-20">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{order.id}</h1>
            <p className="text-gray-500">{order.company} • {order.supplier}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onUpdateStage && order.currentStage > 1 && (
            <button
              onClick={() => onUpdateStage(order.id, order.currentStage - 1, order.currentStage)}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Move to previous stage"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
          <span className={`px-4 py-2 rounded-full text-sm font-medium ${isCompleted ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
            {currentStageName}
          </span>
          {onUpdateStage && order.currentStage < 8 && (
            <button
              onClick={() => onUpdateStage(order.id, order.currentStage + 1, order.currentStage)}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Advance to next stage"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          )}
          {onUpdateOrder && (
            <button
              onClick={() => {
                setEditForm({
                  company: order.company || '',
                  supplier: order.supplier || '',
                  product: order.product || '',
                  specs: order.specs || '',
                  from: order.from || '',
                  to: order.to || '',
                  brand: order.brand || '',
                  piNumber: order.piNumber || '',
                  awbNumber: order.awbNumber || '',
                  totalValue: order.totalValue || '',
                  totalKilos: order.totalKilos ? String(order.totalKilos) : '',
                });
                setEditModal(true);
              }}
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="Edit order details"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
          {onDeleteOrder && (
            <button
              onClick={() => { if (confirm('Archive this order? You can restore it later.')) onDeleteOrder(order.id); }}
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Archive order"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Order Summary Card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Order Summary</h2>

        {/* Parties & Route Row */}
        <div className="grid grid-cols-3 gap-6 mb-6">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Buyer</p>
            <p className="font-medium text-gray-800">{order.company}</p>
            {order.brand && <span className="inline-block text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded mt-1">{order.brand}</span>}
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Supplier</p>
            <p className="font-medium text-gray-800">{order.supplier}</p>
            <p className="text-sm text-gray-500">{order.from}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Route</p>
            <p className="font-medium text-gray-800">{order.from} → {order.to}</p>
            <p className="text-sm text-gray-500">{order.date}</p>
          </div>
        </div>

        {/* Line Items Table */}
        {lineItems.length > 0 ? (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Size</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Glaze</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Packing</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Cases</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Kilos</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Price/Kg</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lineItems.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{item.product || '-'}</p>
                      {(item.brand || item.freezing) && (
                        <div className="flex gap-1.5 mt-1">
                          {item.brand && <span className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">{item.brand}</span>}
                          {item.freezing && <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{item.freezing}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{item.size || '-'}</td>
                    <td className="px-3 py-3 text-gray-600 whitespace-nowrap">
                      {item.glaze || '-'}
                      {item.glazeMarked && item.glazeMarked !== item.glaze && (
                        <span className="block text-xs text-orange-500">Marked: {item.glazeMarked}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{item.packing || '-'}</td>
                    <td className="px-3 py-3 text-gray-700 text-right font-medium whitespace-nowrap">{item.cases || '-'}</td>
                    <td className="px-3 py-3 text-gray-700 text-right font-medium whitespace-nowrap">{item.kilos ? Number(item.kilos).toLocaleString() : '-'}</td>
                    <td className="px-3 py-3 text-gray-700 text-right whitespace-nowrap">{item.pricePerKg ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${Number(item.pricePerKg).toFixed(2)}` : '-'}</td>
                    <td className="px-4 py-3 text-gray-800 text-right font-semibold whitespace-nowrap">{Number(item.total) > 0 ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${Number(item.total).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-'}</td>
                  </tr>
                ))}
              </tbody>
              {lineItems.length > 1 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200">
                    <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-gray-700">Total</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-gray-700 text-right">{lineItems.reduce((sum: number, i: any) => sum + (Number(i.cases) || 0), 0) || '-'}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-gray-700 text-right">{lineItems.reduce((sum: number, i: any) => sum + (Number(i.kilos) || 0), 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5"></td>
                    <td className="px-4 py-2.5 text-sm font-bold text-blue-600 text-right">${lineItems.reduce((sum: number, i: any) => sum + (Number(i.total) || 0), 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="font-medium text-gray-800">{order.product}</p>
            <p className="text-sm text-gray-500 mt-1">{order.specs}</p>
          </div>
        )}

        {/* Progress Bar */}
        <div className="mt-6 pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Order Progress</p>
          <OrderProgressBar currentStage={order.currentStage} skippedStages={order.skippedStages} />
        </div>

        {/* Additional Info */}
        <div className="mt-6 pt-6 border-t border-gray-100 grid grid-cols-4 gap-6">
          {order.poNumber && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">PO Number</p>
              <p className="font-mono text-sm text-gray-800">{order.poNumber}</p>
            </div>
          )}
          {order.piNumber && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">PI Number</p>
              <p className="font-mono text-sm text-gray-800">{order.piNumber}</p>
            </div>
          )}
          {order.awbNumber && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">DHL AWB</p>
              <p className="font-mono text-sm text-blue-600">{order.awbNumber}</p>
            </div>
          )}
          {order.totalValue && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Value</p>
              <p className="font-semibold text-gray-800">USD {order.totalValue}</p>
            </div>
          )}
          {order.totalKilos && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Quantity</p>
              <p className="font-semibold text-gray-800">{Number(order.totalKilos).toLocaleString()} Kg</p>
            </div>
          )}
        </div>
      </div>

      {/* Documents Section */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Documents</h2>
        <div className="grid grid-cols-3 gap-4">
          {docSections.map(section => {
            const hasDocuments = section.available || order.currentStage >= section.stage;
            const isPast = order.currentStage > section.stage;
            const isCurrent = order.currentStage === section.stage;
            const bgColors: Record<string, string> = {
              blue: hasDocuments ? 'bg-blue-50 border-blue-200 hover:bg-blue-100' : 'bg-gray-50 border-gray-200',
              indigo: hasDocuments ? 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100' : 'bg-gray-50 border-gray-200',
              purple: hasDocuments ? 'bg-purple-50 border-purple-200 hover:bg-purple-100' : 'bg-gray-50 border-gray-200',
              pink: hasDocuments ? 'bg-pink-50 border-pink-200 hover:bg-pink-100' : 'bg-gray-50 border-gray-200',
              teal: hasDocuments ? 'bg-teal-50 border-teal-200 hover:bg-teal-100' : 'bg-gray-50 border-gray-200',
              amber: hasDocuments ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' : 'bg-gray-50 border-gray-200',
              green: hasDocuments ? 'bg-green-50 border-green-200 hover:bg-green-100' : 'bg-gray-50 border-gray-200',
              emerald: hasDocuments ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' : 'bg-gray-50 border-gray-200',
            };
            const textColors: Record<string, string> = {
              blue: hasDocuments ? 'text-blue-700' : 'text-gray-400',
              indigo: hasDocuments ? 'text-indigo-700' : 'text-gray-400',
              purple: hasDocuments ? 'text-purple-700' : 'text-gray-400',
              pink: hasDocuments ? 'text-pink-700' : 'text-gray-400',
              teal: hasDocuments ? 'text-teal-700' : 'text-gray-400',
              amber: hasDocuments ? 'text-amber-700' : 'text-gray-400',
              green: hasDocuments ? 'text-green-700' : 'text-gray-400',
              emerald: hasDocuments ? 'text-emerald-700' : 'text-gray-400',
            };
            const iconColors: Record<string, string> = {
              blue: hasDocuments ? 'text-blue-500' : 'text-gray-300',
              indigo: hasDocuments ? 'text-indigo-500' : 'text-gray-300',
              purple: hasDocuments ? 'text-purple-500' : 'text-gray-300',
              pink: hasDocuments ? 'text-pink-500' : 'text-gray-300',
              teal: hasDocuments ? 'text-teal-500' : 'text-gray-300',
              amber: hasDocuments ? 'text-amber-500' : 'text-gray-300',
              green: hasDocuments ? 'text-green-500' : 'text-gray-300',
              emerald: hasDocuments ? 'text-emerald-500' : 'text-gray-300',
            };

            return (
              <div key={section.id}>
                <button
                  onClick={() => hasDocuments && setActiveDocSection(activeDocSection === section.id ? null : section.id)}
                  disabled={!hasDocuments}
                  className={`w-full p-4 rounded-xl border-2 transition-all text-left ${bgColors[section.color]} ${!hasDocuments && 'cursor-not-allowed opacity-60'}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Icon name={section.icon as any} size={22} className={iconColors[section.color]} />
                      <div>
                        <p className={`font-medium text-sm ${textColors[section.color]}`}>{section.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {isPast ? 'Completed' : isCurrent ? 'Current stage' : hasDocuments ? 'Available' : 'Upcoming'}
                        </p>
                      </div>
                    </div>
                    {hasDocuments && (
                      <Icon name="ChevronDown" size={16} className={`${iconColors[section.color]} transition-transform ${activeDocSection === section.id ? 'rotate-180' : ''}`} />
                    )}
                  </div>
                </button>

                {/* Expanded Document Content */}
                {activeDocSection === section.id && hasDocuments && (
                  <div className="mt-2 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                    {renderDocumentContent(section.id)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Email History */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Email History</h2>
          <span className="text-sm text-gray-500">{order.history.length} emails</span>
        </div>
        <div className="space-y-3">
          {[...order.history].reverse().map((entry, idx) => (
            <ExpandableEmailCard
              key={entry.id || idx}
              entry={entry}
              defaultExpanded={idx === 0}
              orderId={order.id}
              allOrders={allOrderOptions}
              onReassign={handleReassignEmail}
              onRemove={handleRemoveEmail}
              onAttachmentClick={(name, url) => setPdfModal({ open: true, url, title: name, loading: false })}
            />
          ))}
        </div>
      </div>

      {/* Edit Order Modal */}
      {editModal && onUpdateOrder && (
        <EditOrderModal
          order={order}
          buyerOptions={buyerOptions}
          supplierOptions={supplierOptions}
          productOptions={productOptions}
          brandOptions={brandOptions}
          onSave={onUpdateOrder}
          onClose={() => setEditModal(false)}
        />
      )}

      {/* Amend PO Modal */}
      {amendModal && onUpdateOrder && (
        <AmendPOModal
          order={order}
          onUpdateOrder={onUpdateOrder}
          onClose={() => setAmendModal(false)}
        />
      )}

      {/* PDF Preview Modal */}
      {pdfModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closePdfModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-[90vw] h-[85vh] max-w-5xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center">
                  <Icon name="FileText" size={18} className="text-red-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 text-sm">{pdfModal.title}</h3>
                  <p className="text-xs text-gray-500">{(order.metadata?.pdfUrl || getPOMeta()?.pdfUrl) ? 'Stored Document' : 'Generated Preview'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {pdfModal.url && (
                  <a
                    href={pdfModal.url}
                    download={(() => {
                      const urlExt = pdfModal.url.split('?')[0].split('.').pop()?.toLowerCase();
                      const ext = urlExt && ['pdf','jpg','jpeg','png','gif','webp'].includes(urlExt) ? `.${urlExt}` : '.pdf';
                      return pdfModal.title.replace(/[^a-zA-Z0-9-_.]/g, '_') + ext;
                    })()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 font-medium"
                  >
                    <Icon name="Download" size={14} />
                    Download
                  </a>
                )}
                <button onClick={regeneratePDF} className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center gap-1.5 font-medium" title="Regenerate PDF from order data">
                  <Icon name="RefreshCw" size={14} />
                  Regenerate
                </button>
                <button onClick={closePdfModal} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                  <Icon name="X" size={20} className="text-gray-500" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 bg-gray-200 overflow-hidden">
              {pdfModal.loading ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-gray-600 font-medium">Loading document...</p>
                </div>
              ) : pdfModal.url ? (
                /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(pdfModal.url) ? (
                  <div className="w-full h-full flex items-center justify-center p-4 overflow-auto bg-gray-100">
                    <img
                      src={pdfModal.url}
                      alt={pdfModal.title}
                      className="max-w-full max-h-full object-contain rounded shadow-lg"
                    />
                  </div>
                ) : (
                  <iframe
                    src={pdfModal.url}
                    className="w-full h-full border-0"
                    title="PDF Preview"
                  />
                )
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
                  <div className="w-20 h-20 bg-gray-300 rounded-2xl flex items-center justify-center">
                    <Icon name="FileText" size={36} className="text-gray-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-700 mb-2">{pdfModal.title}</p>
                    <p className="text-sm text-gray-500 max-w-md">
                      This document was received via email. Preview will be available once file storage is connected.
                    </p>
                  </div>
                  {pdfModal.title.toLowerCase().includes('po') && (
                    <button
                      onClick={previewPOasPDF}
                      className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-2"
                    >
                      <Icon name="FileText" size={16} />
                      Generate PO Preview Instead
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrderDetailPage;
