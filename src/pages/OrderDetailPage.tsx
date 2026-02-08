import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import html2pdf from 'html2pdf.js';
import Icon from '../components/Icon';
import { ORDER_STAGES } from '../data/constants';
import ExpandableEmailCard from '../components/ExpandableEmailCard';
import OrderProgressBar from '../components/OrderProgressBar';
import type { Order, AttachmentEntry } from '../types';
import { getAttachmentName, getAttachmentMeta } from '../types';

interface Props {
  orders: Order[];
}

function OrderDetailPage({ orders }: Props) {
  const { orderId: rawOrderId } = useParams<{ orderId: string }>();
  const orderId = rawOrderId ? decodeURIComponent(rawOrderId) : '';
  const navigate = useNavigate();
  const [activeDocSection, setActiveDocSection] = useState<string | null>(null);
  const [pdfModal, setPdfModal] = useState<{ open: boolean; url: string; title: string; loading: boolean }>({
    open: false, url: '', title: '', loading: false,
  });

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
          <div>
            <button
              onClick={previewPOasPDF}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
            >
              <Icon name="FileText" size={16} />
              View Purchase Order as PDF
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

    const supplierName = meta?.supplier || order.supplier;
    const supplierAddress = meta?.supplierAddress || '';
    const supplierCountry = (meta?.supplierCountry || order.from || 'India').toUpperCase();
    const buyerName = meta?.buyer || order.company;
    const buyerBank = meta?.buyerBank || '';
    const destination = meta?.destination || order.to || '';
    const deliveryTerms = meta?.deliveryTerms || '';
    const deliveryDate = meta?.deliveryDate || '';
    const commission = meta?.commission || '';
    const overseasCommission = meta?.overseasCommission || '';
    const overseasCommissionCompany = meta?.overseasCommissionCompany || '';
    const payment = meta?.payment || '';
    const shippingMarks = meta?.shippingMarks || '';
    const loteNumber = meta?.loteNumber || '';
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
    const thStyle = 'border:1px solid #d1d5db;padding:4px 6px;text-align:left;font-size:12px;';
    const thStyleR = 'border:1px solid #d1d5db;padding:4px 6px;text-align:right;font-size:12px;';
    const tdStyle = 'border:1px solid #d1d5db;padding:3px 6px;font-size:12px;';
    const tdStyleR = 'border:1px solid #d1d5db;padding:3px 6px;font-size:12px;text-align:right;';

    const headerCells = [
      `<th style="${thStyle}">Product</th>`,
      hasBrand ? `<th style="${thStyle}">Brand</th>` : '',
      hasFreezing ? `<th style="${thStyle}">Freezing</th>` : '',
      hasSize ? `<th style="${thStyle}">Size</th>` : '',
      hasGlaze ? `<th style="${thStyle}">Glaze</th>` : '',
      hasPacking ? `<th style="${thStyle}">Packing</th>` : '',
      hasCases ? `<th style="${thStyleR}">Cases</th>` : '',
      `<th style="${thStyleR}">Kilos</th>`,
      `<th style="${thStyleR}">Price/Kg<br><span style="font-size:11px;font-weight:normal;">${deliveryTerms} ${destination || '___'}</span></th>`,
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
        hasGlaze ? `<td style="${tdStyle}">${item.glaze && item.glazeMarked ? `${item.glaze} marked as ${item.glazeMarked}` : item.glaze || '-'}</td>` : '',
        hasPacking ? `<td style="${tdStyle}">${item.packing || '-'}</td>` : '',
        hasCases ? `<td style="${tdStyleR}">${item.cases || '-'}</td>` : '',
        `<td style="${tdStyleR}">${item.kilos || '-'}</td>`,
        `<td style="${tdStyleR}">${item.pricePerKg ? `${cur}${item.pricePerKg}` : '-'}</td>`,
        `<td style="${tdStyleR}font-weight:600;">${Number(item.total) > 0 ? `${cur}${item.total}` : '-'}</td>`,
      ].filter(Boolean).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const totalRow = `<tr style="background:#f9fafb;font-weight:700;">
      <td style="${tdStyle}" colspan="${totalColSpan}">Total</td>
      ${hasCases ? `<td style="${tdStyleR}">${metaTotalCases}</td>` : ''}
      <td style="${tdStyleR}">${metaTotalKilos}</td>
      <td style="${tdStyleR}"></td>
      <td style="${tdStyleR}">U.S. $${grandTotal}</td>
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
        <div style="display:flex;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
          <div>
            <h2 style="font-size:16px;font-weight:700;color:#1f2937;margin:0;">GANESH INTERNATIONAL</h2>
            <p style="font-size:10px;color:#6b7280;margin:1px 0 0;line-height:1.3;">Office no. 226, 2nd Floor, Arun Chambers, Tardeo Road, Mumbai 400034</p>
            <p style="font-size:10px;color:#6b7280;margin:1px 0 0;line-height:1.3;">Tel: +91 22 2351 2345 | Email: ganeshintnlmumbai@gmail.com</p>
          </div>
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
        <table style="width:100%;border-collapse:collapse;margin-bottom:8px;page-break-inside:avoid;font-size:10.5px;">
          <thead><tr style="background:#f3f4f6;">${headerCells}</tr></thead>
          <tbody>${bodyRows}${totalRow}</tbody>
        </table>

        <!-- Terms -->
        <div style="line-height:1.35;margin-bottom:8px;">
          <p style="margin:0;"><strong>Total Value:</strong> U.S. $${grandTotal}</p>
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
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
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
      const html = buildPOHtml();
      const blob = await (html2pdf() as any).set({
        margin: [4, 5, 4, 5],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
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
          <span className={`px-4 py-2 rounded-full text-sm font-medium ${isCompleted ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
            {currentStageName}
          </span>
        </div>
      </div>

      {/* Order Summary Card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Order Summary</h2>
        <div className="grid grid-cols-4 gap-6">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Product</p>
            <p className="font-medium text-gray-800">{order.product}</p>
            <p className="text-sm text-gray-500">{order.specs}</p>
          </div>
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
    </div>
  );
}

export default OrderDetailPage;
