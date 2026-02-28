import { useState, useMemo, useRef } from 'react';
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
import ArtworkCompare from '../components/ArtworkCompare';
import { apiCall } from '../utils/api';

interface Props {
  orders: Order[];
  contacts?: ContactsMap;
  products?: CatalogProduct[];
  orgId?: string | null;
  userId?: string;
  onUpdateStage?: (orderId: string, newStage: number, oldStage?: number) => Promise<void>;
  onUpdateOrder?: (orderId: string, updates: Partial<Order>) => Promise<void>;
  onDeleteOrder?: (orderId: string) => Promise<void>;
}

function OrderDetailPage({ orders, contacts, products, orgId, userId, onUpdateStage, onUpdateOrder, onDeleteOrder }: Props) {
  const { orderId: rawOrderId } = useParams<{ orderId: string }>();
  const orderId = rawOrderId ? decodeURIComponent(rawOrderId) : '';
  const navigate = useNavigate();
  const [activeDocSection, setActiveDocSection] = useState<string | null>(null);
  const [pdfModal, setPdfModal] = useState<{ open: boolean; url: string; title: string; loading: boolean }>({
    open: false, url: '', title: '', loading: false,
  });
  const [editModal, setEditModal] = useState(false);
  const [amendModal, setAmendModal] = useState(false);
  const [contactModal, setContactModal] = useState<string | null>(null);
  const [artworkCompareModal, setArtworkCompareModal] = useState<{ open: boolean; newUrl: string; newLabel: string; referenceUrl?: string; referenceLabel?: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ historyId: string; attName: string; stage: number; isDataSource: boolean } | null>(null);
  const [artworkUploading, setArtworkUploading] = useState(false);
  const [artworkPairPicker, setArtworkPairPicker] = useState<{ open: boolean; emailAttachments: { name: string; pdfUrl: string }[] } | null>(null);
  const [selectedPairTarget, setSelectedPairTarget] = useState<{ name: string; pdfUrl: string } | null>(null);
  const artworkFileRef = useRef<HTMLInputElement>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoverResult, setRecoverResult] = useState<string | null>(null);

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

  // Find the last approved artwork reference for the same product + buyer (+ brand if set)
  const artworkReference = useMemo(() => {
    const currentOrder = orders.find(o => o.id === orderId);
    if (!currentOrder) return null;
    // Check for manual override first
    if (currentOrder.metadata?.artworkReference) {
      return { url: currentOrder.metadata.artworkReference as string, orderId: currentOrder.id, date: currentOrder.date, name: 'Manual Reference', isManual: true };
    }
    const candidates = orders.filter(o =>
      o.id !== currentOrder.id &&
      o.product?.toLowerCase().trim() === currentOrder.product?.toLowerCase().trim() &&
      o.company?.toLowerCase().trim() === currentOrder.company?.toLowerCase().trim() &&
      (!currentOrder.brand || o.brand?.toLowerCase().trim() === currentOrder.brand?.toLowerCase().trim()) &&
      o.currentStage > 4 // Past artwork confirmed stage = artwork was approved
    );
    candidates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    for (const candidate of candidates) {
      // Search stage 2-3 history entries for artwork attachments (artwork emails sometimes land at stage 2)
      const withAttachments = candidate.history.filter(h => (h.stage === 2 || h.stage === 3) && h.hasAttachment && h.attachments?.length);
      for (const entry of withAttachments) {
        for (const att of entry.attachments || []) {
          const meta = getAttachmentMeta(att);
          if (meta?.pdfUrl) {
            return { url: meta.pdfUrl, orderId: candidate.id, date: candidate.date, name: getAttachmentName(att), isManual: false };
          }
        }
      }
    }
    return null;
  }, [orders, orderId]);

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
  const isCompleted = order.currentStage === 9;

  // Check which stages have history entries
  const hasStageData = (stage: number) => order.history.some(h => h.stage === stage);

  // Document sections mapped to stages
  const docSections = [
    { id: 'purchaseOrder', title: 'Purchase Order', icon: 'FileText', color: 'blue', stage: 1, available: hasStageData(1) },
    { id: 'proformaInvoice', title: 'Proforma Invoice', icon: 'FileText', color: 'indigo', stage: 2, available: hasStageData(2) || !!order.piNumber },
    { id: 'artwork', title: 'Artwork in Progress', icon: 'Image', color: 'purple', stage: 3, available: hasStageData(3) || order.artworkStatus === 'approved' },
    { id: 'artworkConfirmed', title: 'Artwork Confirmed', icon: 'CheckSquare', color: 'violet', stage: 4, available: hasStageData(4) },
    { id: 'inspection', title: 'Quality Check', icon: 'CheckCircle', color: 'pink', stage: 5, available: hasStageData(5) },
    { id: 'schedule', title: 'Schedule Confirmed', icon: 'Calendar', color: 'teal', stage: 6, available: hasStageData(6) },
    { id: 'draftDocuments', title: 'Draft Documents', icon: 'File', color: 'amber', stage: 7, available: hasStageData(7) },
    { id: 'finalDocuments', title: 'Final Documents', icon: 'FileCheck', color: 'green', stage: 8, available: hasStageData(8) },
    { id: 'dhlShipped', title: 'DHL Shipped', icon: 'Truck', color: 'emerald', stage: 9, available: hasStageData(9) },
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
        // Find stored PO document URL (from email attachment or app-generated PDF)
        const poUrl = (() => {
          // Check stage 1 history attachments first
          const stage1 = order.history.filter(h => h.stage === 1 && h.attachments?.length);
          for (const h of stage1) {
            for (const att of (h.attachments || [])) {
              const meta = getAttachmentMeta(att);
              if (meta?.pdfUrl) return { url: meta.pdfUrl, name: getAttachmentName(att) };
            }
          }
          // Fallback: check order metadata
          if (order.metadata?.pdfUrl) return { url: order.metadata.pdfUrl, name: `${order.id}.pdf` };
          return null;
        })();

        // Email-created orders show the original scan only — no generated/amended PO path
        const isEmailOrder = order.metadata?.created_by === 'email_sync_auto';

        if (isEmailOrder) {
          // Email orders: show scanned PO attachment only
          return (
            <div className="space-y-3">
              {poUrl && (
                <button
                  onClick={() => setPdfModal({ open: true, url: poUrl.url, title: `Original PO - ${order.id}`, loading: false })}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
                >
                  <Icon name="FileText" size={15} />
                  Original PO
                </button>
              )}
              {renderAttachments(1)}
            </div>
          );
        }

        // Check if a revised PO exists
        const revisedPdfUrl = order.metadata?.revisedPdfUrl;

        // App-created orders: show View PO (generated) + Revised PO (if exists) + Amend PO
        return (
          <div className="space-y-3">
            <div className="flex items-stretch gap-2">
              <button
                onClick={() => {
                  if (poUrl) {
                    setPdfModal({ open: true, url: poUrl.url, title: `Purchase Order - ${order.id}`, loading: false });
                  } else {
                    previewPOasPDF();
                  }
                }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
              >
                <Icon name="FileText" size={15} />
                View PO
              </button>
              {revisedPdfUrl && (
                <button
                  onClick={() => setPdfModal({ open: true, url: revisedPdfUrl, title: `Revised PO - ${order.id}`, loading: false })}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium shadow-sm whitespace-nowrap"
                >
                  <Icon name="FileText" size={15} />
                  Revised PO
                </button>
              )}
              <button
                onClick={() => {
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
                <span className="font-bold text-indigo-800">USD {Number(order.totalValue).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
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

      case 'artwork': {
        // Get current order's stage 3 artwork URL for comparison
        const currentArtworkUrl = (() => {
          const s3 = order.history.filter(h => h.stage === 3 && h.hasAttachment && h.attachments?.length);
          for (const entry of s3) {
            for (const att of entry.attachments || []) {
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
            {/* Upload Reference Artwork */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleStartReferenceUpload}
                disabled={artworkUploading}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${artworkUploading ? 'bg-gray-100 text-gray-400' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
              >
                <Icon name={artworkUploading ? 'Loader2' : 'Upload'} size={15} className={artworkUploading ? 'animate-spin' : ''} />
                {artworkUploading ? 'Uploading...' : 'Upload Reference Artwork'}
              </button>
              <input
                ref={artworkFileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={handleArtworkUpload}
              />
              <span className="text-xs text-gray-400">PDF, JPG, PNG</span>
            </div>
            {/* Pair picker modal */}
            {artworkPairPicker?.open && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <p className="text-sm font-medium text-purple-800 mb-3">Which email attachment is this reference for?</p>
                <div className="space-y-2">
                  {artworkPairPicker.emailAttachments.map((ea, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedPairTarget(ea);
                        setArtworkPairPicker(null);
                        setTimeout(() => artworkFileRef.current?.click(), 50);
                      }}
                      className="w-full flex items-center gap-2 text-sm bg-white hover:bg-purple-100 border border-purple-200 rounded-lg px-3 py-2.5 text-left transition-colors"
                    >
                      <Icon name="FileText" size={14} className="text-red-500 shrink-0" />
                      <span className="font-medium text-gray-700 truncate">{ea.name}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setArtworkPairPicker(null)} className="mt-2 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            )}
            {/* Artwork Reference & Comparison */}
            {artworkReference && currentArtworkUrl ? (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="GitCompare" size={16} className="text-purple-600" />
                    <p className="text-sm text-purple-800">
                      Reference from <span className="font-semibold">{artworkReference.orderId}</span>
                      <span className="text-purple-500 ml-1">({formatDate(artworkReference.date)})</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setArtworkCompareModal({ open: true, newUrl: currentArtworkUrl.url, newLabel: `${order.id} — ${currentArtworkUrl.name}` })}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <Icon name="Layers" size={14} />
                    Compare
                  </button>
                </div>
              </div>
            ) : artworkReference && !currentArtworkUrl ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm text-gray-500 flex items-center gap-2">
                  <Icon name="GitCompare" size={14} className="text-gray-400" />
                  Reference available from {artworkReference.orderId} — upload artwork to compare
                </p>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm text-gray-500 flex items-center gap-2">
                  <Icon name="Image" size={14} className="text-gray-400" />
                  No previous approved artwork found for this product
                </p>
              </div>
            )}
          </div>
        );
      }

      case 'artworkConfirmed':
        return (
          <div className="space-y-4">
            <div className="bg-violet-50 rounded-lg p-3">
              <p className="text-sm text-violet-700">Artwork has been approved by the buyer. Production can proceed with confirmed designs.</p>
            </div>
            {renderAttachments(4)}
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
            {renderAttachments(5)}
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
            {renderAttachments(6)}
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
            {renderAttachments(7)}
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
            {renderAttachments(8)}
          </div>
        );

      case 'dhlShipped': {
        const dhlHistory = order.history.filter(h => h.stage === 9);
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
                <p className="font-medium text-emerald-700">{order.currentStage >= 9 ? 'Shipped' : 'Pending'}</p>
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
            {renderAttachments(9)}
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

  // Handle setting an artwork as the reference
  const handleSetAsReference = async (url: string) => {
    if (!onUpdateOrder) return;
    try {
      await onUpdateOrder(order.id, { metadata: { ...(order.metadata || {}), artworkReference: url } } as any);
    } catch { /* ignore */ }
  };

  // Render attachment list for a given stage
  const renderAttachments = (stage: number) => {
    const stageEmails = order.history.filter(h => h.stage === stage && h.hasAttachment && h.attachments?.length);
    const allAttachments = stageEmails.flatMap(h => (h.attachments || []).map(att => {
      const meta = getAttachmentMeta(att);
      const isManualUpload = h.from === 'Manual Upload';
      return { name: getAttachmentName(att), date: h.timestamp, pdfUrl: meta?.pdfUrl || null, historyId: h.id || '', meta, isManualUpload };
    }));
    if (allAttachments.length === 0) return null;

    // For stage 3: build a map of email attachment URL → its paired reference
    const referencePairMap = new Map<string, { url: string; name: string }>();
    if (stage === 3) {
      for (const a of allAttachments) {
        if (a.isManualUpload && a.pdfUrl && a.meta?.pairedWith) {
          referencePairMap.set(a.meta.pairedWith, { url: a.pdfUrl!, name: a.name });
        }
      }
    }
    // No fallback — only show compare for explicitly paired files

    return (
      <div className="pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Attachments</p>
        <div className="space-y-1.5">
          {allAttachments.map((att, idx) => {
            const isPdf = att.name.toLowerCase().endsWith('.pdf');
            const isCurrentRef = stage === 3 && att.pdfUrl && order.metadata?.artworkReference === att.pdfUrl;
            // Check if this attachment is a data source (has lineItems or is the main PO used for extraction)
            const isDataSource = !!(att.meta?.lineItems?.length || (stage === 1 && att.pdfUrl && att.pdfUrl === order.metadata?.pdfUrl));
            // Color coding: uploaded references get purple tint, email attachments get default gray
            const bgColor = stage === 3 && att.isManualUpload
              ? 'bg-purple-50 hover:bg-purple-100 border border-purple-200'
              : 'bg-gray-50 hover:bg-blue-50';
            return (
              <div key={idx} className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (att.pdfUrl) {
                      setPdfModal({ open: true, url: att.pdfUrl, title: att.name, loading: false });
                    } else {
                      handleAttachmentClick(att.name, stage);
                    }
                  }}
                  className={`flex-1 flex items-center gap-2 text-sm rounded-lg px-3 py-2 transition-colors text-left group cursor-pointer min-w-0 ${bgColor}`}
                >
                  <Icon name={isPdf ? 'FileText' : 'Paperclip'} size={14} className={`shrink-0 ${isPdf ? 'text-red-500' : 'text-gray-400'}`} />
                  <span className="font-medium text-gray-700 truncate min-w-0 group-hover:text-blue-700 transition-colors" title={att.name}>{att.name}</span>
                  {stage === 3 && att.isManualUpload && <span className="shrink-0 text-[10px] font-semibold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full leading-none" title={att.meta?.pairedName ? `Reference for: ${att.meta.pairedName}` : 'Reference'}>Ref</span>}
                  {stage === 3 && !att.isManualUpload && <span className="shrink-0 text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full leading-none">Email</span>}
                  {isCurrentRef && <span className="shrink-0 text-[10px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full leading-none">Ref</span>}
                  <span className="shrink-0 text-[10px] text-gray-400">{formatDate(att.date)}</span>
                </button>
                {/* Compare button: for email artwork, compare against its paired reference */}
                {stage === 3 && !att.isManualUpload && att.pdfUrl && (() => {
                  const paired = referencePairMap.get(att.pdfUrl!) || null;
                  return paired ? (
                    <button
                      onClick={() => setArtworkCompareModal({
                        open: true,
                        newUrl: att.pdfUrl!,
                        newLabel: `Email — ${att.name}`,
                        referenceUrl: paired.url,
                        referenceLabel: `Reference — ${paired.name}`,
                      })}
                      title={`Compare with ${paired.name}`}
                      className="shrink-0 p-1.5 text-purple-500 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
                    >
                      <Icon name="GitCompare" size={13} />
                    </button>
                  ) : null;
                })()}
                {stage === 3 && att.pdfUrl && !isCurrentRef && onUpdateOrder && (
                  <button
                    onClick={() => handleSetAsReference(att.pdfUrl!)}
                    title="Set as reference for comparison"
                    className="shrink-0 p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                  >
                    <Icon name="Bookmark" size={13} />
                  </button>
                )}
                {onUpdateOrder && (
                  <button
                    onClick={() => setDeleteConfirm({ historyId: att.historyId, attName: att.name, stage, isDataSource })}
                    title="Delete attachment"
                    className="shrink-0 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Icon name="Trash2" size={13} />
                  </button>
                )}
              </div>
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

  // Step 1: User clicks "Upload Reference" → show picker to choose which email attachment to pair with
  const handleStartReferenceUpload = () => {
    const emailAtts = order.history
      .filter(h => h.stage === 3 && h.hasAttachment && h.attachments?.length && h.from !== 'Manual Upload')
      .flatMap(h => (h.attachments || []).map(att => {
        const meta = getAttachmentMeta(att);
        return { name: getAttachmentName(att), pdfUrl: meta?.pdfUrl || '' };
      }))
      .filter(a => a.pdfUrl);

    if (emailAtts.length === 0) {
      // No email attachments yet — just open file picker without pairing
      setSelectedPairTarget(null);
      artworkFileRef.current?.click();
    } else if (emailAtts.length === 1) {
      // Only one email attachment — auto-pair and open file picker
      setSelectedPairTarget(emailAtts[0]);
      setTimeout(() => artworkFileRef.current?.click(), 50);
    } else {
      // Multiple email attachments — show picker
      setArtworkPairPicker({ open: true, emailAttachments: emailAtts });
    }
  };

  // Step 2: After picking a pair target (or from picker), handle the file upload
  const handleArtworkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setArtworkUploading(true);
    setArtworkPairPicker(null);
    try {
      // 1. Look up DB UUID for this order
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .select('id')
        .eq('order_id', order.id)
        .single();
      if (orderErr || !orderRow) throw new Error(`Order lookup failed: ${orderErr?.message || 'not found'}`);

      // 2. Upload file to Supabase storage (flat path like PO uploads)
      const safePo = order.id.replace(/\//g, '_');
      const storagePath = `artwork_${safePo}_${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const { error: uploadErr } = await supabase.storage
        .from('po-documents')
        .upload(storagePath, file, { contentType: file.type, upsert: true });
      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // 3. Get public URL
      const { data: urlData } = supabase.storage.from('po-documents').getPublicUrl(storagePath);
      const publicUrl = urlData?.publicUrl || '';

      // 4. Create order_history entry at stage 3 with pairing info
      const metaObj: Record<string, any> = { pdfUrl: publicUrl };
      if (selectedPairTarget) {
        metaObj.pairedWith = selectedPairTarget.pdfUrl;
        metaObj.pairedName = selectedPairTarget.name;
      }
      const attachment = JSON.stringify({ name: file.name, meta: metaObj });
      const { error: histErr } = await supabase.from('order_history').insert({
        order_id: orderRow.id,
        stage: 3,
        timestamp: new Date().toISOString(),
        from_address: 'Manual Upload',
        to_address: '',
        subject: `Reference Artwork — ${file.name}${selectedPairTarget ? ` (for ${selectedPairTarget.name})` : ''}`,
        body: 'Reference artwork uploaded via order detail page.',
        has_attachment: true,
        attachments: [attachment],
      });
      if (histErr) throw new Error(`History insert failed: ${histErr.message}`);

      setSelectedPairTarget(null);
      // 5. Refresh to show new attachment
      window.location.reload();
    } catch (err: any) {
      console.error('Artwork upload failed:', err);
      alert(`Upload failed: ${err?.message || 'Unknown error'}`);
      setArtworkUploading(false);
      setSelectedPairTarget(null);
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

    // Fallback for older orders: generate from HTML and auto-save to storage
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

      // Auto-save the generated PDF to Supabase storage so it becomes the frozen version
      try {
        const filename = `${order.id.replace(/\//g, '_')}.pdf`;
        await supabase.storage.from('po-documents').upload(filename, blob, {
          contentType: 'application/pdf', upsert: true,
        });
        const { data: urlData } = supabase.storage.from('po-documents').getPublicUrl(filename);
        if (urlData?.publicUrl && onUpdateOrder) {
          await onUpdateOrder(order.id, {
            metadata: { ...(order.metadata || {}), pdfUrl: urlData.publicUrl },
          });
          console.log(`[PO] Auto-saved frozen PDF for ${order.id}`);
        }
      } catch (saveErr) {
        console.warn('[PO] Could not auto-save PDF to storage:', saveErr);
      }
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

  // Handle assigning an uploaded file as an attachment to a specific stage
  const handleAssignAttachment = async (historyEntryId: string, stage: number, file: File) => {
    // 1. Look up DB UUID for this order
    const { data: orderRow, error: orderErr } = await supabase
      .from('orders')
      .select('id')
      .eq('order_id', order.id)
      .single();
    if (orderErr || !orderRow) throw new Error(`Order lookup failed: ${orderErr?.message || 'not found'}`);

    // 2. Upload file to Supabase storage
    const safePo = order.id.replace(/\//g, '_');
    const storagePath = `doc_${safePo}_s${stage}_${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const { error: uploadErr } = await supabase.storage
      .from('po-documents')
      .upload(storagePath, file, { contentType: file.type, upsert: true });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    // 3. Get public URL
    const { data: urlData } = supabase.storage.from('po-documents').getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl || '';

    // 4. Build the attachment JSON
    const attachment = JSON.stringify({ name: file.name, meta: { pdfUrl: publicUrl } });

    // 5. Update the existing history entry: set stage, add attachment
    const entry = order.history.find(h => h.id === historyEntryId);
    const existingAtts = entry?.attachments || [];
    const { error: updateErr } = await supabase
      .from('order_history')
      .update({
        stage: stage,
        has_attachment: true,
        attachments: [...existingAtts.map(a => typeof a === 'string' ? a : JSON.stringify(a)), attachment],
      })
      .eq('id', historyEntryId);
    if (updateErr) throw new Error(`History update failed: ${updateErr.message}`);

    // 6. Refresh to show changes
    window.location.reload();
  };

  const handleRecoverData = async () => {
    if (!orgId || !userId) return;
    setRecovering(true);
    setRecoverResult(null);
    try {
      const { data, error } = await apiCall('/api/sync-emails', {
        organization_id: orgId,
        user_id: userId,
        mode: 'recover',
        order_po: order.id,
      });
      if (error) {
        setRecoverResult(`Error: ${error}`);
      } else if (data?.results?.[0]?.status === 'ok') {
        setRecoverResult(`Found ${data.results[0].lineItems || 0} line items! Refreshing...`);
        setTimeout(() => window.location.reload(), 1500);
      } else if (data?.results?.[0]?.status === 'partial') {
        setRecoverResult('Emails found and added to this order — scroll down to see them. No PO document could be auto-extracted, but you can assign attachments manually from the email cards below.');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setRecoverResult(data?.results?.[0]?.reason || data?.message || 'No matching emails found in Gmail.');
      }
    } catch (err: any) {
      setRecoverResult(`Error: ${err.message || 'Unknown error'}`);
    }
    setRecovering(false);
  };

  // Handle deleting a single attachment from a history entry
  const handleDeleteAttachment = async (historyId: string, attName: string) => {
    if (!onUpdateOrder) return;
    try {
      const entry = order.history.find(h => h.id === historyId);
      if (!entry || !entry.attachments) return;

      // Remove only this specific attachment from the history entry's attachments array
      const remainingAtts = entry.attachments.filter(att => getAttachmentName(att) !== attName);

      if (remainingAtts.length === 0) {
        // No attachments left — delete the entire history entry
        await supabase.from('order_history').delete().eq('id', historyId);
      } else {
        // Update the history entry with remaining attachments
        await supabase.from('order_history').update({
          attachments: remainingAtts.map(a => typeof a === 'string' ? a : JSON.stringify(a)),
          has_attachment: remainingAtts.length > 0,
        }).eq('id', historyId);
      }

      // If this was a revised PO, clear revisedPdfUrl from metadata
      if (attName.startsWith('REVISED_') && order.metadata?.revisedPdfUrl) {
        const { revisedPdfUrl, ...restMetadata } = order.metadata;
        await onUpdateOrder(order.id, { metadata: restMetadata } as any);
      }

      // Also try deleting the file from storage (best effort)
      const storageName = attName.replace(/\//g, '_');
      await supabase.storage.from('po-documents').remove([storageName]);

      window.location.reload();
    } catch (err) {
      console.error('Delete attachment failed:', err);
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
          {onUpdateStage && order.currentStage < 9 && (
            <button
              onClick={() => onUpdateStage(order.id, order.currentStage + 1, order.currentStage)}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Advance to next stage"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          )}
          {orgId && userId && (
            <button
              onClick={handleRecoverData}
              disabled={recovering}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
              title="Search Gmail for emails related to this order"
            >
              <Icon name={recovering ? 'Loader' : 'Search'} size={14} className={recovering ? 'animate-spin' : ''} />
              {recovering ? 'Searching...' : 'Recover'}
            </button>
          )}
          {onUpdateOrder && (
            <button
              onClick={() => {
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

      {/* Recover result banner */}
      {recoverResult && (
        <div className={`mb-4 rounded-xl px-4 py-3 flex items-center justify-between ${recoverResult.startsWith('Error') ? 'bg-red-50 border border-red-200' : recoverResult.includes('Found') ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <p className={`text-sm font-medium ${recoverResult.startsWith('Error') ? 'text-red-700' : recoverResult.includes('Found') ? 'text-green-700' : 'text-yellow-700'}`}>
            {recoverResult}
          </p>
          <button onClick={() => setRecoverResult(null)} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={14} />
          </button>
        </div>
      )}

      {/* Order Summary Card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Order Summary</h2>

        {/* Parties & Route Row */}
        <div className="grid grid-cols-3 gap-6 mb-6">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Buyer</p>
            <p className="font-medium text-blue-600 hover:text-blue-800 cursor-pointer" onClick={() => setContactModal(order.company)}>{order.company}</p>
            {order.brand && <span className="inline-block text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded mt-1">{order.brand}</span>}
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Supplier</p>
            <p className="font-medium text-blue-600 hover:text-blue-800 cursor-pointer" onClick={() => setContactModal(order.supplier)}>{order.supplier}</p>
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
            {recoverResult && (
              <p className={`text-sm mt-2 ${recoverResult.startsWith('Error') ? 'text-red-600' : recoverResult.includes('Found') ? 'text-green-600' : 'text-yellow-600'}`}>
                {recoverResult}
              </p>
            )}
          </div>
        )}

        {/* Progress Bar */}
        <div className="mt-6 pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Order Progress</p>
          <OrderProgressBar currentStage={order.currentStage} />
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
              <p className="font-semibold text-gray-800">USD {Number(order.totalValue).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
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
          <span className="text-sm text-gray-500">{order.history.filter(h => h.from !== 'System').length} emails</span>
        </div>
        <div className="space-y-3">
          {[...order.history].filter(h => h.from !== 'System').reverse().map((entry, idx) => (
            <ExpandableEmailCard
              key={entry.id || idx}
              entry={entry}
              defaultExpanded={false}
              orderId={order.id}
              allOrders={allOrderOptions}
              onReassign={handleReassignEmail}
              onRemove={handleRemoveEmail}
              onAttachmentClick={(name, url) => setPdfModal({ open: true, url, title: name, loading: false })}
              onAssignAttachment={handleAssignAttachment}
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
                  <p className="text-xs text-gray-500">{order.metadata?.created_by === 'email_sync_auto' ? 'Original Email Attachment' : (order.metadata?.pdfUrl || getPOMeta()?.pdfUrl) ? 'Saved Document' : 'Generated Preview'}</p>
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
                {order.metadata?.created_by !== 'email_sync_auto' && (
                  <button onClick={regeneratePDF} className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center gap-1.5 font-medium" title="Regenerate PDF from order data">
                    <Icon name="RefreshCw" size={14} />
                    Regenerate
                  </button>
                )}
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

      {/* Delete Attachment Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${deleteConfirm.isDataSource ? 'bg-amber-100' : 'bg-red-100'}`}>
                  <Icon name={deleteConfirm.isDataSource ? 'AlertTriangle' : 'Trash2'} size={20} className={deleteConfirm.isDataSource ? 'text-amber-600' : 'text-red-600'} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Delete Attachment</h3>
                  <p className="text-xs text-gray-500">{deleteConfirm.attName}</p>
                </div>
              </div>
              {deleteConfirm.isDataSource ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                  <p className="text-sm text-amber-800 font-medium mb-1">This attachment is used to pull order information</p>
                  <p className="text-xs text-amber-700">Deleting it may affect the order data (line items, supplier, buyer details). The order data itself will not be deleted, but the source document will no longer be available.</p>
                </div>
              ) : (
                <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete this attachment? This action cannot be undone.</p>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const { historyId, attName } = deleteConfirm;
                  setDeleteConfirm(null);
                  await handleDeleteAttachment(historyId, attName);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                {deleteConfirm.isDataSource ? 'Delete Anyway' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact Details Modal */}
      {contactModal && contacts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setContactModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                  {contactModal.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{contactModal}</h3>
                  <p className="text-xs text-gray-500">Contact Details</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setContactModal(null); navigate(`/contacts?search=${encodeURIComponent(contactModal)}`); }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  View all
                </button>
                <button onClick={() => setContactModal(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                  <Icon name="X" size={18} className="text-gray-400" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {(() => {
                // Normalize: strip all non-alphanumeric chars and lowercase for fuzzy company matching
                const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                const target = norm(contactModal);
                const companyContacts = Object.entries(contacts)
                  .filter(([, c]) => norm(c.company) === target || c.company === contactModal)
                  .map(([email, c]) => ({ email, ...c }));
                if (companyContacts.length === 0) {
                  return <p className="text-sm text-gray-500 text-center py-4">No contacts found for this company</p>;
                }
                return (
                  <div className="space-y-3">
                    {companyContacts.map((c: any) => (
                      <div key={c.email} className="p-3 bg-gray-50 rounded-xl">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`w-9 h-9 ${c.color || 'bg-blue-500'} rounded-full flex items-center justify-center text-white font-medium text-xs`}>
                            {c.initials || c.name?.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800 text-sm">{c.name}</p>
                            <p className="text-xs text-gray-500">{c.role}</p>
                          </div>
                        </div>
                        <div className="space-y-1 ml-12">
                          {c.email && !c.email.endsWith('@placeholder.local') && (
                            <a href={`mailto:${c.email}`} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1.5">
                              <Icon name="Mail" size={11} /> {c.email}
                            </a>
                          )}
                          {c.phone && (
                            <a href={`tel:${c.phone}`} className="text-xs text-gray-600 flex items-center gap-1.5">
                              <Icon name="Phone" size={11} /> {c.phone}
                            </a>
                          )}
                          {c.address && (
                            <p className="text-xs text-gray-500 flex items-start gap-1.5">
                              <Icon name="MapPin" size={11} className="mt-0.5 flex-shrink-0" /> {c.address}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Artwork Comparison Modal */}
      {artworkCompareModal?.open && (artworkCompareModal.referenceUrl || artworkReference) && (
        <ArtworkCompare
          referenceUrl={artworkCompareModal.referenceUrl || artworkReference!.url}
          referenceLabel={artworkCompareModal.referenceLabel || `${artworkReference!.orderId} — ${artworkReference!.name}`}
          newUrl={artworkCompareModal.newUrl}
          newLabel={artworkCompareModal.newLabel}
          onClose={() => setArtworkCompareModal(null)}
        />
      )}
    </div>
  );
}

export default OrderDetailPage;
