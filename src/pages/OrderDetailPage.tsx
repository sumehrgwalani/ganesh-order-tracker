import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import html2pdf from 'html2pdf.js';
import Icon from '../components/Icon';
import ComposeEmailModal from '../components/ComposeEmailModal';
import { ORDER_STAGES, GI_LOGO_URL } from '../data/constants';
import ExpandableEmailCard from '../components/ExpandableEmailCard';
import OrderProgressBar from '../components/OrderProgressBar';
import type { Order, AttachmentEntry, ContactsMap } from '../types';
import { getAttachmentName, getAttachmentMeta } from '../types';
import { supabase } from '../lib/supabase';

interface Props {
  orders: Order[];
  orgId?: string | null;
  contacts?: ContactsMap;
  onUpdateStage?: (orderId: string, newStage: number, oldStage?: number) => Promise<void>;
  onUpdateOrder?: (orderId: string, updates: Partial<Order>) => Promise<void>;
  onDeleteOrder?: (orderId: string) => Promise<void>;
}

// Sanitize strings for safe HTML insertion (prevents XSS)
function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function OrderDetailPage({ orders, orgId, contacts, onUpdateStage, onUpdateOrder, onDeleteOrder }: Props) {
  const { orderId: rawOrderId } = useParams<{ orderId: string }>();
  const orderId = rawOrderId ? decodeURIComponent(rawOrderId) : '';
  const navigate = useNavigate();
  const [activeDocSection, setActiveDocSection] = useState<string | null>(null);
  const [pdfModal, setPdfModal] = useState<{ open: boolean; url: string; title: string; loading: boolean }>({
    open: false, url: '', title: '', loading: false,
  });
  const [editModal, setEditModal] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [amendModal, setAmendModal] = useState(false);
  const [amendItems, setAmendItems] = useState<any[]>([]);
  const [amendSaving, setAmendSaving] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [poBlob, setPoBlob] = useState<Blob | null>(null);

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
      case 'purchaseOrder':
        return (
          <div className="flex items-center gap-3">
            <button
              onClick={previewPOasPDF}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
            >
              <Icon name="FileText" size={16} />
              View Purchase Order as PDF
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
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium shadow-sm"
            >
              <Icon name="Edit" size={16} />
              Amend PO
            </button>
            <button
              onClick={async () => {
                // Generate PO blob if not already available
                if (!poBlob) {
                  try {
                    const html = buildPOHtml();
                    const blob = await (html2pdf() as any).set({
                      margin: [4, 5, 4, 5],
                      image: { type: 'jpeg', quality: 0.98 },
                      html2canvas: { scale: 2, useCORS: true },
                      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
                    }).from(html, 'string').output('blob');
                    const pdfBlob = new Blob([blob], { type: 'application/pdf' });
                    setPoBlob(pdfBlob);
                    setComposeOpen(true);
                  } catch { setComposeOpen(true); }
                } else {
                  setComposeOpen(true);
                }
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium shadow-sm"
            >
              <Icon name="Send" size={16} />
              Email PO
            </button>
          </div>
        );

      case 'proformaInvoice':
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
            {renderAttachments(2)}
          </div>
        );

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

  // Build PO HTML for PDF generation — matches the actual PO preview layout
  const buildPOHtml = (): string => {
    // Try to get rich metadata from the attachment; fall back to basic order data
    const meta = getPOMeta();
    const items: any[] = meta?.lineItems || lineItems;
    const hasBrand = items.some((i: any) => i.brand);
    const hasFreezing = items.some((i: any) => i.freezing);
    const hasSize = items.some((i: any) => i.size);
    const hasGlaze = items.some((i: any) => i.glaze);
    const hasPacking = items.some((i: any) => i.packing);
    const hasCases = items.some((i: any) => i.cases);

    // Sanitize all user-controlled values to prevent XSS
    const supplierName = escapeHtml(meta?.supplier || order.supplier);
    const supplierAddress = escapeHtml(meta?.supplierAddress || '');
    const supplierCountry = escapeHtml((meta?.supplierCountry || order.from || 'India').toUpperCase());
    const buyerName = escapeHtml(meta?.buyer || order.company);
    const buyerBank = escapeHtml(meta?.buyerBank || '');
    const destination = escapeHtml(meta?.destination || order.to || '');
    const deliveryTerms = escapeHtml(meta?.deliveryTerms || '');
    const deliveryDate = escapeHtml(meta?.deliveryDate || '');
    const commission = escapeHtml(meta?.commission || '');
    const overseasCommission = escapeHtml(meta?.overseasCommission || '');
    const overseasCommissionCompany = escapeHtml(meta?.overseasCommissionCompany || '');
    const payment = escapeHtml(meta?.payment || '');
    const shippingMarks = escapeHtml(meta?.shippingMarks || '');
    const loteNumber = escapeHtml(meta?.loteNumber || '');
    const poDate = meta?.date || order.date;
    const grandTotal = meta?.grandTotal || order.totalValue || '';
    const metaTotalKilos = meta?.totalKilos || order.totalKilos || 0;
    const metaTotalCases = meta?.totalCases || 0;

    // Build product description for intro paragraph (deduplicated)
    const seen = new Set<string>();
    const productDescParts: string[] = [];
    for (const item of items.filter((i: any) => i.product)) {
      const key = `${item.product}|${item.freezing || ''}|${item.glaze || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        let desc = String(item.product);
        if (item.freezing && !desc.toLowerCase().includes(String(item.freezing).toLowerCase())) desc += ` ${item.freezing}`;
        if (item.glaze && item.glazeMarked) desc += ` ${item.glaze} marked as ${item.glazeMarked}`;
        else if (item.glaze) desc += ` ${item.glaze}`;
        productDescParts.push(desc);
      }
    }
    const productDesc = productDescParts.join(', ') || order.product;

    // Table header columns — compact for single-page fit
    const thStyle = 'border:1px solid #d1d5db;padding:4px 6px;text-align:left;font-size:10px;white-space:nowrap;background:#f3f4f6;';
    const thStyleWrap = 'border:1px solid #d1d5db;padding:4px 6px;text-align:left;font-size:10px;background:#f3f4f6;';
    const thStyleR = 'border:1px solid #d1d5db;padding:4px 6px;text-align:right;font-size:10px;white-space:nowrap;background:#f3f4f6;';
    const tdStyle = 'border:1px solid #d1d5db;padding:4px 6px;font-size:10px;white-space:nowrap;';
    const tdStyleWrap = 'border:1px solid #d1d5db;padding:4px 6px;font-size:10px;';
    const tdStyleR = 'border:1px solid #d1d5db;padding:4px 6px;font-size:10px;text-align:right;white-space:nowrap;';

    const headerCells = [
      `<th style="${thStyle}">Product</th>`,
      hasBrand ? `<th style="${thStyle}">Brand</th>` : '',
      hasFreezing ? `<th style="${thStyle}">Freezing</th>` : '',
      hasSize ? `<th style="${thStyle}">Size</th>` : '',
      hasGlaze ? `<th style="${thStyleWrap}">Glaze</th>` : '',
      hasPacking ? `<th style="${thStyle}">Packing</th>` : '',
      hasCases ? `<th style="${thStyleR}">Cases</th>` : '',
      `<th style="${thStyleR}">Kilos</th>`,
      `<th style="${thStyleR}">Price/Kg<br><span style="font-size:8px;font-weight:normal;">${deliveryTerms} ${destination || '___'}</span></th>`,
      `<th style="${thStyleR}">${items.some((i: any) => i.currency && i.currency !== 'USD') ? 'Total' : 'Total (USD)'}</th>`,
    ].filter(Boolean).join('');

    const totalColSpan = 1 + (hasBrand ? 1 : 0) + (hasFreezing ? 1 : 0) + (hasSize ? 1 : 0) + (hasGlaze ? 1 : 0) + (hasPacking ? 1 : 0);

    const bodyRows = items.filter((i: any) => i.product).map((item: any) => {
      const cur = (!item.currency || item.currency === 'USD') ? '$' : item.currency + ' ';
      const cells = [
        `<td style="${tdStyle}">${item.product || '-'}</td>`,
        hasBrand ? `<td style="${tdStyle}">${item.brand || '-'}</td>` : '',
        hasFreezing ? `<td style="${tdStyle}">${item.freezing || '-'}</td>` : '',
        hasSize ? `<td style="${tdStyle}">${item.size || '-'}</td>` : '',
        hasGlaze ? `<td style="${tdStyleWrap}">${item.glaze && item.glazeMarked ? `${item.glaze} marked as ${item.glazeMarked}` : item.glaze || '-'}</td>` : '',
        hasPacking ? `<td style="${tdStyle}">${item.packing || '-'}</td>` : '',
        hasCases ? `<td style="${tdStyleR}">${item.cases || '-'}</td>` : '',
        `<td style="${tdStyleR}">${item.kilos || '-'}</td>`,
        `<td style="${tdStyleR}">${item.pricePerKg ? `${cur}${Number(item.pricePerKg).toFixed(2)}` : '-'}</td>`,
        `<td style="${tdStyleR}font-weight:600;">${Number(item.total) > 0 ? `${cur}${Number(item.total).toFixed(2)}` : '-'}</td>`,
      ].filter(Boolean).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const totalRow = `<tr style="background:#f9fafb;font-weight:700;">
      <td style="${tdStyle}" colspan="${totalColSpan}">Total</td>
      ${hasCases ? `<td style="${tdStyleR}">${metaTotalCases}</td>` : ''}
      <td style="${tdStyleR}">${metaTotalKilos}</td>
      <td style="${tdStyleR}"></td>
      <td style="${tdStyleR}">U.S. $${Number(grandTotal).toFixed(2)}</td>
    </tr>`;

    // Try to load signature from localStorage
    let signatureImg = '';
    try {
      const sig = localStorage.getItem('gi_signature');
      if (sig) signatureImg = `<div style="margin-bottom:8px;"><img src="${sig}" style="height:60px;max-width:200px;object-fit:contain;" /></div>`;
    } catch { /* ignore */ }

    return `
      <div style="font-family:Arial,Helvetica,sans-serif;padding:12px 20px;max-width:800px;margin:0 auto;color:#1f2937;font-size:11px;line-height:1.35;">
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
          <div>
            <h2 style="font-size:16px;font-weight:700;color:#1f2937;margin:0;">GANESH INTERNATIONAL</h2>
            <p style="font-size:10px;color:#6b7280;margin:1px 0 0;line-height:1.3;">Office no. 226, 2nd Floor, Arun Chambers, Tardeo Road, Mumbai 400034</p>
            <p style="font-size:10px;color:#6b7280;margin:1px 0 0;line-height:1.3;">Tel: +91 22 2351 2345 | Email: ganeshintnlmumbai@gmail.com</p>
          </div>
          <img src="${GI_LOGO_URL}" alt="Ganesh International" style="width:60px;height:60px;object-fit:contain;" crossorigin="anonymous" />
        </div>

        <!-- Date and PO Number -->
        <table style="width:100%;margin-bottom:8px;"><tr>
          <td><strong>Date:</strong> ${poDate}</td>
          <td style="text-align:right;"><strong>Purchase Order No:</strong> <span style="font-weight:700;">${order.id}</span></td>
        </tr></table>

        <!-- To Section -->
        <div style="margin-bottom:6px;line-height:1.3;">
          <p style="color:#6b7280;margin:0;">To,</p>
          <p style="font-weight:700;margin:1px 0;">${supplierName || '[EXPORTER NAME]'}</p>
          ${supplierAddress ? `<p style="margin:0;color:#4b5563;">${supplierAddress}</p>` : ''}
          <p style="font-weight:500;margin:0;color:#4b5563;">${supplierCountry}</p>
        </div>

        <!-- Greeting -->
        <div style="margin-bottom:8px;line-height:1.35;">
          <p style="margin:0;">Dear Sirs,</p>
          <p style="margin:2px 0 0;">We are pleased to confirm our Purchase Order with you for the Export of <strong>${productDesc}</strong> to our Principals namely <strong>M/s.${buyerName}</strong>${destination ? `, <strong>${destination.toUpperCase()}</strong>` : ''} under the following terms &amp; conditions.</p>
        </div>

        <!-- Product Table -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
          <thead><tr style="background:#f3f4f6;">${headerCells}</tr></thead>
          <tbody>${bodyRows}${totalRow}</tbody>
        </table>

        <!-- Terms -->
        <div style="line-height:1.35;margin-bottom:8px;">
          <p style="margin:0;"><strong>Total Value:</strong> U.S. $${Number(grandTotal).toFixed(2)}</p>
          <p style="font-size:9px;color:#6b7280;margin:1px 0 1px 14px;">*We need a quality control of photos before loading</p>
          <p style="font-size:9px;color:#6b7280;margin:0 0 2px 14px;">*Different colors Tapes for different products &amp; Lots.</p>
          ${deliveryTerms || destination ? `<p style="margin:0;"><strong>Delivery Terms:</strong> ${deliveryTerms} ${destination}</p>` : ''}
          ${deliveryDate ? `<p style="margin:0;"><strong>Shipment Date:</strong> ${deliveryDate}</p>` : ''}
          <p style="margin:0;"><strong>Commission:</strong> ${commission || '___________________'} + 18% GST</p>
          ${overseasCommission ? `<p style="margin:0;"><strong>Overseas Commission:</strong> ${overseasCommission}${overseasCommissionCompany ? `, payable to ${overseasCommissionCompany}` : ''}</p>` : ''}
          ${payment ? `<p style="margin:0;"><strong>Payment:</strong> ${payment}</p>` : ''}
          <p style="margin:0;"><strong>Variation:</strong> +/- 5% in Quantity &amp; Value</p>
          <p style="margin:0;"><strong>Labelling Details:</strong> As per previous. (pls send for approval)</p>
          ${loteNumber ? `<p style="margin:0;"><strong>Lote number:</strong> ${loteNumber}</p>` : ''}
        </div>

        <!-- Important Notes -->
        <div style="background:#fefce8;border:1px solid #fde68a;border-radius:4px;padding:6px 8px;margin-bottom:8px;page-break-inside:avoid;">
          <p style="font-weight:600;color:#92400e;margin:0 0 2px;font-size:11px;">Important Notes:</p>
          <ul style="color:#a16207;margin:0;padding-left:16px;line-height:1.3;font-size:10px;">
            <li>Should be minimum 5 days free Dem/ Det/ Plug in on the B/L or on the shipping line's letterhead.</li>
            <li>Please send us Loading chart alongwith the docs &amp; it should be mentioned the lot/code number.</li>
            <li>Please make plastic certificate.</li>
            <li>REQUIRED CERTIFICATE OF QUALITY OR FOOD SECURITY CERTIFICATE SUCH AS BRC, GLOBAL GAP ETC.</li>
            <li>Please use different color carton's tapes for different code.</li>
            <li>No Damaged boxes to be shipped.</li>
          </ul>
        </div>

        ${shippingMarks ? `<p style="margin-bottom:6px;"><strong>Shipping Marks:</strong> ${shippingMarks}</p>` : ''}

        <!-- Please Note -->
        <div style="color:#4b5563;margin-bottom:6px;line-height:1.3;page-break-inside:avoid;font-size:10.5px;">
          <p style="font-weight:600;margin:0 0 2px;">Please Note:</p>
          ${buyerBank ? `<p style="margin:0 0 2px;">After the documents are negotiated, please send us the Courier Airway Bill no for the documents send by your Bank to buyers bank in ${buyerBank}.</p>` : ''}
          <p style="margin:0 0 2px;">While emailing us the shipment details, Please mention Exporter, Product, B/Ups, Packing, B/L No, Seal No, Container No, Vessel Name, ETD/ETA, Port Of Shipment / Destination and the Transfer of the Letter of Credit in whose Favour.</p>
          <p style="margin:0;">Any Claim on Quality, Grading, Packing and Short weight for this particular consignment will be borne entirely by you and will be your sole responsibility.</p>
        </div>

        <!-- Closing -->
        <div style="color:#374151;margin-bottom:4px;font-size:10.5px;line-height:1.3;">
          <p style="margin:0;">Hope you find the above terms &amp; conditions in order. Please put your Seal and Signature and send it to us as a token of your confirmation.</p>
          <p style="margin:4px 0 0;">Thanking You,</p>
        </div>

        <!-- Signature -->
        <div style="margin-top:6px;page-break-inside:avoid;">
          ${signatureImg}
          <p style="font-weight:700;margin:0;color:#1f2937;font-size:11px;">Sumehr Rajnish Gwalani</p>
          <p style="color:#4b5563;margin:1px 0 0;font-size:11px;">GANESH INTERNATIONAL</p>
          <div style="margin-top:2px;display:inline-block;padding:2px 6px;background:#dcfce7;color:#15803d;border-radius:4px;font-size:9px;">&#10003; Digitally Signed &amp; Approved</div>
        </div>

        <!-- Footer -->
        <div style="margin-top:8px;padding-top:4px;border-top:1px solid #e5e7eb;font-size:8px;color:#9ca3af;">
          <p style="margin:0;">FOOTNOTE: SUGGEST USE OF DATA LOGGER IN REFER CONTAINER USEFUL IN CASE OF TEMP. FLUCTUATION ON BOARD</p>
        </div>
      </div>
    `;
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
      const html = buildPOHtml();
      const blob = await (html2pdf() as any).set({
        margin: [4, 5, 4, 5],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(html, 'string').output('blob');
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      setPoBlob(pdfBlob);
      const url = URL.createObjectURL(pdfBlob);
      setPdfModal(prev => ({ ...prev, url, loading: false }));
    } catch {
      setPdfModal(prev => ({ ...prev, loading: false }));
    }
  };

  // Force regenerate PDF from data (for when stored file isn't available)
  const regeneratePDF = async () => {
    setPdfModal(prev => ({ ...prev, loading: true }));
    try {
      const html = buildPOHtml();
      const blob = await (html2pdf() as any).set({
        margin: [4, 5, 4, 5],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(html, 'string').output('blob');
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      setPoBlob(pdfBlob);
      const url = URL.createObjectURL(pdfBlob);
      setPdfModal(prev => ({ ...prev, url, loading: false }));
    } catch {
      setPdfModal(prev => ({ ...prev, loading: false }));
    }
  };

  // Handle clicking an attachment
  const handleAttachmentClick = (name: string, stage: number) => {
    if (name.toLowerCase().endsWith('.pdf') && stage === 1) {
      previewPOasPDF();
    } else {
      // For other files — show placeholder modal
      setPdfModal({ open: true, url: '', title: name, loading: false });
    }
  };

  const closePdfModal = () => {
    if (pdfModal.url) URL.revokeObjectURL(pdfModal.url);
    setPdfModal({ open: false, url: '', title: '', loading: false });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/orders')} className="p-2 hover:bg-gray-200 bg-gray-100 rounded-lg transition-colors z-20">
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
            };
            const textColors: Record<string, string> = {
              blue: hasDocuments ? 'text-blue-700' : 'text-gray-400',
              indigo: hasDocuments ? 'text-indigo-700' : 'text-gray-400',
              purple: hasDocuments ? 'text-purple-700' : 'text-gray-400',
              pink: hasDocuments ? 'text-pink-700' : 'text-gray-400',
              teal: hasDocuments ? 'text-teal-700' : 'text-gray-400',
              amber: hasDocuments ? 'text-amber-700' : 'text-gray-400',
              green: hasDocuments ? 'text-green-700' : 'text-gray-400',
            };
            const iconColors: Record<string, string> = {
              blue: hasDocuments ? 'text-blue-500' : 'text-gray-300',
              indigo: hasDocuments ? 'text-indigo-500' : 'text-gray-300',
              purple: hasDocuments ? 'text-purple-500' : 'text-gray-300',
              pink: hasDocuments ? 'text-pink-500' : 'text-gray-300',
              teal: hasDocuments ? 'text-teal-500' : 'text-gray-300',
              amber: hasDocuments ? 'text-amber-500' : 'text-gray-300',
              green: hasDocuments ? 'text-green-500' : 'text-gray-300',
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
            <ExpandableEmailCard key={idx} entry={entry} defaultExpanded={idx === 0} />
          ))}
        </div>
      </div>

      {/* Edit Order Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setEditModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-2xl flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Edit Order Details</h3>
              <button onClick={() => setEditModal(false)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                <Icon name="X" size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'company', label: 'Buyer' },
                  { key: 'supplier', label: 'Supplier' },
                  { key: 'product', label: 'Product' },
                  { key: 'brand', label: 'Brand' },
                  { key: 'from', label: 'Origin' },
                  { key: 'to', label: 'Destination' },
                  { key: 'piNumber', label: 'PI Number' },
                  { key: 'awbNumber', label: 'AWB / Tracking' },
                  { key: 'totalValue', label: 'Total Value (USD)' },
                  { key: 'totalKilos', label: 'Total Kilos' },
                ].map(field => (
                  <div key={field.key}>
                    <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{field.label}</label>
                    <input
                      type="text"
                      value={editForm[field.key] || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Specs / Description</label>
                <textarea
                  value={editForm.specs || ''}
                  onChange={e => setEditForm(prev => ({ ...prev, specs: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
              <button onClick={() => setEditModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                disabled={saving}
                onClick={async () => {
                  if (!onUpdateOrder) return;
                  setSaving(true);
                  try {
                    await onUpdateOrder(order.id, {
                      company: editForm.company,
                      supplier: editForm.supplier,
                      product: editForm.product,
                      specs: editForm.specs,
                      from: editForm.from,
                      to: editForm.to,
                      brand: editForm.brand,
                      piNumber: editForm.piNumber,
                      awbNumber: editForm.awbNumber,
                      totalValue: editForm.totalValue,
                      totalKilos: editForm.totalKilos ? Number(editForm.totalKilos) : undefined,
                    });
                    setEditModal(false);
                  } catch { /* error handled by parent */ }
                  finally { setSaving(false); }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Amend PO Modal */}
      {amendModal && (() => {
        const hasBrand = amendItems.some(i => i.brand);
        const hasSize = amendItems.some(i => i.size);
        const hasGlaze = amendItems.some(i => i.glaze);
        const hasPacking = amendItems.some(i => i.packing);

        const updateItem = (idx: number, field: string, value: string) => {
          setAmendItems(prev => prev.map((item, i) => {
            if (i !== idx) return item;
            const updated = { ...item, [field]: value };
            if (['cases', 'kilos', 'pricePerKg'].includes(field)) {
              const kilos = parseFloat(updated.kilos) || 0;
              const price = parseFloat(updated.pricePerKg) || 0;
              updated.total = Math.round(kilos * price * 100) / 100;
            }
            return updated;
          }));
        };

        const removeItem = (idx: number) => {
          setAmendItems(prev => prev.filter((_, i) => i !== idx));
        };

        const addItem = () => {
          setAmendItems(prev => [...prev, {
            product: '', brand: '', freezing: '', size: '', glaze: '', glazeMarked: '',
            packing: '', cases: '', kilos: '', pricePerKg: '', currency: 'USD', total: 0,
          }]);
        };

        const amendGrandTotal = amendItems.reduce((sum, i) => sum + (Number(i.total) || 0), 0);
        const amendTotalKilos = amendItems.reduce((sum, i) => sum + (parseFloat(i.kilos) || 0), 0);
        const amendTotalCases = amendItems.reduce((sum, i) => sum + (parseInt(i.cases) || 0), 0);

        const handleAmendSave = async () => {
          if (!onUpdateOrder) return;
          setAmendSaving(true);
          try {
            const meta = getPOMeta();
            const updatedHistory = {
              stage: 1,
              timestamp: new Date().toISOString(),
              from: 'Ganesh International <ganeshintnlmumbai@gmail.com>',
              to: '',
              subject: `AMENDED PO ${order.id}`,
              body: `Purchase Order ${order.id} amended.\nUpdated Total: USD ${amendGrandTotal.toFixed(2)}\nUpdated Qty: ${amendTotalKilos} Kg`,
              hasAttachment: true,
              attachments: [{
                name: `${order.id.replace(/\//g, '_')}.pdf`,
                meta: {
                  ...(meta || {}),
                  totalCases: amendTotalCases,
                  totalKilos: amendTotalKilos,
                  grandTotal: amendGrandTotal,
                  lineItems: amendItems.map(li => ({
                    product: li.product, brand: li.brand || '', freezing: li.freezing || '',
                    size: li.size || '', glaze: li.glaze || '', glazeMarked: li.glazeMarked || '',
                    packing: li.packing || '', cases: li.cases || 0, kilos: li.kilos || 0,
                    pricePerKg: li.pricePerKg || 0, currency: li.currency || 'USD', total: li.total || 0,
                  })),
                }
              }]
            };

            await onUpdateOrder(order.id, {
              product: amendItems.map(li => li.product).filter(Boolean).join(', '),
              specs: amendItems.map(li => `${li.size || ''} ${li.glaze ? `(${li.glaze})` : ''} ${li.packing || ''}`.trim()).filter(Boolean).join(', '),
              totalValue: String(amendGrandTotal),
              totalKilos: amendTotalKilos,
              lineItems: amendItems,
              metadata: { pdfUrl: meta?.pdfUrl || order.metadata?.pdfUrl || '' },
              history: [...(order.history || []), updatedHistory],
            });

            // Re-upload PDF
            try {
              const filename = `${order.id.replace(/\//g, '_')}.pdf`;
              const container = document.createElement('div');
              container.innerHTML = buildPOHtml();
              container.style.position = 'absolute';
              container.style.left = '-9999px';
              document.body.appendChild(container);
              const blob = await (html2pdf() as any).set({
                margin: [4, 5, 4, 5],
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
              }).from(container).output('blob');
              document.body.removeChild(container);
              await supabase.storage.from('po-documents').upload(filename, blob, {
                contentType: 'application/pdf', upsert: true,
              });
            } catch { /* PDF upload failed silently */ }

            setAmendModal(false);
          } catch { /* error handled by parent */ }
          finally { setAmendSaving(false); }
        };

        const inputClass = 'w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setAmendModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-2xl flex items-center justify-between shrink-0">
                <div>
                  <h3 className="font-semibold text-gray-800">Amend Purchase Order</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{order.id} &bull; {order.supplier} &rarr; {order.company}</p>
                </div>
                <button onClick={() => setAmendModal(false)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                  <Icon name="X" size={20} className="text-gray-500" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-auto p-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                        {hasBrand && <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Brand</th>}
                        {hasSize && <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>}
                        {hasGlaze && <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Glaze</th>}
                        {hasPacking && <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Packing</th>}
                        <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Cases</th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Kilos</th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Price/Kg</th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                        <th className="px-2 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {amendItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-2 py-2 text-gray-400 text-xs">{idx + 1}</td>
                          <td className="px-2 py-2" style={{ minWidth: 140 }}>
                            <input value={item.product} onChange={e => updateItem(idx, 'product', e.target.value)} className={inputClass} />
                          </td>
                          {hasBrand && <td className="px-2 py-2" style={{ minWidth: 90 }}>
                            <input value={item.brand} onChange={e => updateItem(idx, 'brand', e.target.value)} className={inputClass} />
                          </td>}
                          {hasSize && <td className="px-2 py-2" style={{ minWidth: 70 }}>
                            <input value={item.size} onChange={e => updateItem(idx, 'size', e.target.value)} className={inputClass} />
                          </td>}
                          {hasGlaze && <td className="px-2 py-2" style={{ minWidth: 80 }}>
                            <input value={item.glaze} onChange={e => updateItem(idx, 'glaze', e.target.value)} className={inputClass} />
                          </td>}
                          {hasPacking && <td className="px-2 py-2" style={{ minWidth: 80 }}>
                            <input value={item.packing} onChange={e => updateItem(idx, 'packing', e.target.value)} className={inputClass} />
                          </td>}
                          <td className="px-2 py-2" style={{ minWidth: 70 }}>
                            <input type="number" value={item.cases} onChange={e => updateItem(idx, 'cases', e.target.value)} className={`${inputClass} text-right`} />
                          </td>
                          <td className="px-2 py-2" style={{ minWidth: 80 }}>
                            <input type="number" value={item.kilos} onChange={e => updateItem(idx, 'kilos', e.target.value)} className={`${inputClass} text-right`} />
                          </td>
                          <td className="px-2 py-2" style={{ minWidth: 100 }}>
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400 text-sm">{item.currency === 'USD' ? '$' : item.currency}</span>
                              <input type="text" inputMode="decimal" value={Number(item.pricePerKg).toFixed(2)} onChange={e => updateItem(idx, 'pricePerKg', e.target.value)} className={`${inputClass} text-right`} />
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right font-medium text-gray-800 whitespace-nowrap" style={{ minWidth: 100 }}>
                            ${Number(item.total).toFixed(2)}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {amendItems.length > 1 && (
                              <button onClick={() => removeItem(idx)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                                <Icon name="Trash2" size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button onClick={addItem} className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                  <Icon name="Plus" size={14} /> Add Line Item
                </button>

                {/* Totals bar */}
                <div className="mt-4 p-4 bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl text-white flex items-center justify-between">
                  <div className="flex gap-6">
                    <div><span className="text-blue-200 text-xs uppercase">Cases</span><p className="font-semibold">{amendTotalCases.toLocaleString()}</p></div>
                    <div><span className="text-blue-200 text-xs uppercase">Kilos</span><p className="font-semibold">{amendTotalKilos.toLocaleString()}</p></div>
                  </div>
                  <div className="text-right">
                    <span className="text-blue-200 text-xs uppercase">Grand Total</span>
                    <p className="text-xl font-bold">${amendGrandTotal.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex justify-end gap-3 shrink-0">
                <button onClick={() => setAmendModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  disabled={amendSaving}
                  onClick={handleAmendSave}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {amendSaving ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</>
                  ) : (
                    <><Icon name="Check" size={16} /> Save Changes</>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
                    download={pdfModal.title.replace(/[^a-zA-Z0-9-_.]/g, '_') + '.pdf'}
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
                <iframe
                  src={pdfModal.url}
                  className="w-full h-full border-0"
                  title="PDF Preview"
                />
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

      {/* Email PO Compose Modal */}
      <ComposeEmailModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        orgId={orgId || null}
        contacts={contacts}
        prefillTo={(() => {
          if (!contacts || !order) return undefined;
          // Find supplier email from contacts by company name
          const supplierEmail = Object.entries(contacts).find(([_, c]) =>
            c.company.toLowerCase() === order.supplier.toLowerCase() && c.role.toLowerCase().includes('supplier')
          );
          return supplierEmail ? [supplierEmail[0]] : undefined;
        })()}
        prefillSubject={'Purchase Order ' + (order?.id || '')}
        attachmentBlobs={poBlob ? [{ filename: 'PO_' + (order?.id || '').replace(/\//g, '-') + '.pdf', blob: poBlob, mimeType: 'application/pdf' }] : undefined}
      />
    </div>
  );
}

export default OrderDetailPage;
