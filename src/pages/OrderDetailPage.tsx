import { useState } from 'react';
import html2pdf from 'html2pdf.js';
import Icon from '../components/Icon';
import { ORDER_STAGES } from '../data/constants';
import ExpandableEmailCard from '../components/ExpandableEmailCard';
import OrderProgressBar from '../components/OrderProgressBar';
import type { Order } from '../types';

interface Props {
  order: Order;
  onBack: () => void;
}

function OrderDetailPage({ order, onBack }: Props) {
  const [activeDocSection, setActiveDocSection] = useState<string | null>(null);
  const [pdfModal, setPdfModal] = useState<{ open: boolean; url: string; title: string; loading: boolean }>({
    open: false, url: '', title: '', loading: false,
  });

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
          <div className="space-y-4">
            {/* PO Header */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">PO Number</p>
                <p className="font-mono font-semibold text-gray-800">{order.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Date</p>
                <p className="text-sm text-gray-800">{order.date}</p>
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

            {/* Line Items Table */}
            {lineItems.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Products</p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                        {lineItems.some(i => i.size) && <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>}
                        {lineItems.some(i => i.freezing) && <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Freezing</th>}
                        {lineItems.some(i => i.packing) && <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Packing</th>}
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Kilos</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Price/Kg</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lineItems.filter(i => i.product).map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-medium text-gray-800">{String(item.product)}</td>
                          {lineItems.some(i => i.size) && <td className="px-3 py-2 text-gray-600">{String(item.size || '-')}</td>}
                          {lineItems.some(i => i.freezing) && <td className="px-3 py-2 text-gray-600">{String(item.freezing || '-')}</td>}
                          {lineItems.some(i => i.packing) && <td className="px-3 py-2 text-gray-600">{String(item.packing || '-')}</td>}
                          <td className="px-3 py-2 text-right text-gray-600">{Number(item.kilos || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-gray-600">${Number(item.pricePerKg || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800">${Number(item.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="flex justify-end gap-8 pt-2 border-t border-gray-100">
              {order.totalKilos && (
                <div className="text-right">
                  <p className="text-xs text-gray-500">Total Quantity</p>
                  <p className="font-semibold text-gray-800">{Number(order.totalKilos).toLocaleString()} Kg</p>
                </div>
              )}
              {order.totalValue && (
                <div className="text-right">
                  <p className="text-xs text-gray-500">Total Value</p>
                  <p className="font-semibold text-blue-700">USD {order.totalValue}</p>
                </div>
              )}
            </div>

            {/* View as PDF button */}
            <div className="pt-3 border-t border-gray-100">
              <button
                onClick={previewPOasPDF}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
              >
                <Icon name="FileText" size={16} />
                View Purchase Order as PDF
              </button>
            </div>

            {/* Attachments from stage 1 emails */}
            {renderAttachments(1)}
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

  // Render attachment list for a given stage
  const renderAttachments = (stage: number) => {
    const stageEmails = order.history.filter(h => h.stage === stage && h.hasAttachment && h.attachments?.length);
    const allAttachments = stageEmails.flatMap(h => (h.attachments || []).map(att => ({ name: att, date: h.timestamp })));
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

  // Build PO HTML for PDF generation
  const buildPOHtml = (): string => {
    const hasSize = lineItems.some((i: any) => i.size);
    const hasFreezing = lineItems.some((i: any) => i.freezing);
    const hasPacking = lineItems.some((i: any) => i.packing);

    const headerCols = [
      '<th style="padding:10px 12px;text-align:left;font-size:13px;">Product</th>',
      hasSize ? '<th style="padding:10px 12px;text-align:left;font-size:13px;">Size</th>' : '',
      hasFreezing ? '<th style="padding:10px 12px;text-align:left;font-size:13px;">Freezing</th>' : '',
      hasPacking ? '<th style="padding:10px 12px;text-align:left;font-size:13px;">Packing</th>' : '',
      '<th style="padding:10px 12px;text-align:right;font-size:13px;">Kilos</th>',
      '<th style="padding:10px 12px;text-align:right;font-size:13px;">Price/Kg</th>',
      '<th style="padding:10px 12px;text-align:right;font-size:13px;">Total</th>',
    ].filter(Boolean).join('');

    const rows = lineItems.filter((i: any) => i.product).map((item: any) => {
      const cells = [
        `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:500;">${String(item.product)}</td>`,
        hasSize ? `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${String(item.size || '-')}</td>` : '',
        hasFreezing ? `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${String(item.freezing || '-')}</td>` : '',
        hasPacking ? `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${String(item.packing || '-')}</td>` : '',
        `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.kilos || 0).toLocaleString()}</td>`,
        `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">$${Number(item.pricePerKg || 0).toFixed(2)}</td>`,
        `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">$${Number(item.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`,
      ].filter(Boolean).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div style="font-family:Arial,sans-serif;padding:40px;max-width:800px;margin:0 auto;">
        <div style="text-align:center;margin-bottom:30px;border-bottom:3px solid #1e40af;padding-bottom:20px;">
          <h1 style="color:#1e40af;font-size:28px;margin:0;">GANESH INTERNATIONAL</h1>
          <p style="color:#6b7280;margin:5px 0 0;font-size:14px;">Frozen Seafood Traders</p>
        </div>
        <h2 style="text-align:center;color:#1e40af;margin-bottom:25px;font-size:22px;">PURCHASE ORDER</h2>
        <table style="width:100%;margin-bottom:25px;"><tr>
          <td style="vertical-align:top;">
            <p style="color:#6b7280;font-size:11px;text-transform:uppercase;margin:0 0 4px;">PO Number</p>
            <p style="font-weight:700;font-size:16px;margin:0;">${order.id}</p>
          </td>
          <td style="text-align:right;vertical-align:top;">
            <p style="color:#6b7280;font-size:11px;text-transform:uppercase;margin:0 0 4px;">Date</p>
            <p style="font-weight:600;margin:0;">${order.date}</p>
          </td>
        </tr></table>
        <table style="width:100%;margin-bottom:25px;"><tr>
          <td style="width:48%;vertical-align:top;background:#f9fafb;padding:15px;border-radius:8px;">
            <p style="color:#6b7280;font-size:11px;text-transform:uppercase;margin:0 0 8px;">Supplier</p>
            <p style="font-weight:600;margin:0;">${order.supplier}</p>
            <p style="color:#6b7280;margin:4px 0 0;font-size:13px;">${order.from}</p>
          </td>
          <td style="width:4%;"></td>
          <td style="width:48%;vertical-align:top;background:#f9fafb;padding:15px;border-radius:8px;">
            <p style="color:#6b7280;font-size:11px;text-transform:uppercase;margin:0 0 8px;">Buyer</p>
            <p style="font-weight:600;margin:0;">${order.company}</p>
            ${order.brand ? `<p style="color:#7c3aed;margin:4px 0 0;font-size:13px;">${order.brand}</p>` : ''}
          </td>
        </tr></table>
        ${lineItems.length > 0 ? `
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <thead><tr style="background:#1e40af;color:white;">${headerCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>` : ''}
        <table style="width:100%;"><tr>
          <td style="text-align:right;background:#eff6ff;padding:15px;border-radius:8px;">
            ${order.totalKilos ? `<span style="color:#6b7280;font-size:12px;">Total Qty: </span><span style="font-weight:700;font-size:16px;margin-right:30px;">${Number(order.totalKilos).toLocaleString()} Kg</span>` : ''}
            ${order.totalValue ? `<span style="color:#6b7280;font-size:12px;">Total Value: </span><span style="font-weight:700;font-size:18px;color:#1e40af;">USD ${order.totalValue}</span>` : ''}
          </td>
        </tr></table>
      </div>
    `;
  };

  // Generate PO as PDF and show in modal
  const previewPOasPDF = async () => {
    setPdfModal({ open: true, url: '', title: `Purchase Order - ${order.id}`, loading: true });
    try {
      const html = buildPOHtml();
      const blob = await (html2pdf() as any).set({
        margin: [10, 10, 10, 10],
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
          <button onClick={onBack} className="p-2 hover:bg-gray-200 bg-gray-100 rounded-lg transition-colors z-20">
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
                  <p className="text-xs text-gray-500">PDF Preview</p>
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
                  <p className="text-sm text-gray-600 font-medium">Generating PDF preview...</p>
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
