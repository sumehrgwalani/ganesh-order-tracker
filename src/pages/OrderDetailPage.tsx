import { useState } from 'react';
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
          {allAttachments.map((att, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
              <Icon name="Paperclip" size={14} className="text-gray-400" />
              <span className="font-medium text-gray-700 flex-1">{att.name}</span>
              <span className="text-xs text-gray-400">{formatDate(att.date)}</span>
            </div>
          ))}
        </div>
      </div>
    );
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
    </div>
  );
}

export default OrderDetailPage;
