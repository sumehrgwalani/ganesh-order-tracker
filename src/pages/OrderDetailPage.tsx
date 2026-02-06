import { useState } from 'react';
import Icon from '../components/Icon';
import { ORDER_STAGES } from '../data/constants';
import { getContactInfo } from '../utils/helpers';
import ContactAvatar from '../components/ContactAvatar';
import ExpandableEmailCard from '../components/ExpandableEmailCard';
import OrderProgressBar from '../components/OrderProgressBar';
import type { Order } from '../types';

interface Props {
  order: Order;
  onBack: () => void;
}

function OrderDetailPage({ order, onBack }: Props) {
  const [activeDocSection, setActiveDocSection] = useState<string | null>(null);

  // Helper to categorize emails and attachments
  const categorizeDocuments = () => {
    const docs: any = {
      purchaseOrder: [],
      proformaInvoice: [],
      artwork: [],
      inspection: [],
      draftDocuments: [],
      finalDocuments: [],
    };

    order.history.forEach((entry, idx) => {
      const subjectLower = entry.subject.toLowerCase();
      const hasAttachment = entry.hasAttachment && entry.attachments?.length! > 0;

      // Purchase Order - stage 1 or PO in subject
      if (entry.stage === 1 || subjectLower.includes('purchase order') || subjectLower.includes('new po')) {
        if (hasAttachment) {
          entry.attachments?.forEach(att => {
            if (att.toLowerCase().includes('po')) {
              docs.purchaseOrder.push({ ...entry, attachment: att, emailIndex: idx });
            }
          });
        }
        if (docs.purchaseOrder.length === 0 && entry.stage === 1) {
          docs.purchaseOrder.push({ ...entry, emailIndex: idx });
        }
      }

      // Proforma Invoice - stage 2 or PI in subject
      if (entry.stage === 2 || subjectLower.includes('proforma') || subjectLower.includes(' pi ') || subjectLower.includes('pi-')) {
        if (hasAttachment) {
          entry.attachments?.forEach(att => {
            if (att.toLowerCase().includes('pi')) {
              docs.proformaInvoice.push({ ...entry, attachment: att, emailIndex: idx });
            }
          });
        }
        if (docs.proformaInvoice.length === 0 && entry.stage === 2) {
          docs.proformaInvoice.push({ ...entry, emailIndex: idx });
        }
      }

      // Artwork - stage 3 or artwork in subject
      if (entry.stage === 3 || subjectLower.includes('artwork') || subjectLower.includes('label')) {
        docs.artwork.push({ ...entry, emailIndex: idx });
      }

      // Inspection - stage 4 or inspection/QC in subject
      if (entry.stage === 4 || subjectLower.includes('inspection') || subjectLower.includes('qc') || subjectLower.includes('quality')) {
        docs.inspection.push({ ...entry, emailIndex: idx });
      }

      // Draft Documents - stage 6 or draft in subject
      if (entry.stage === 6 || subjectLower.includes('draft document') || subjectLower.includes('draft doc')) {
        docs.draftDocuments.push({ ...entry, emailIndex: idx });
      }

      // Final Documents - stage 7 or final copies in subject
      if (entry.stage === 7 || subjectLower.includes('final cop') || subjectLower.includes('== document ==')) {
        docs.finalDocuments.push({ ...entry, emailIndex: idx });
        if (hasAttachment) {
          entry.attachments?.forEach(att => {
            if (!docs.finalDocuments.find((d: any) => d.attachment === att)) {
              docs.finalDocuments.push({ ...entry, attachment: att, emailIndex: idx });
            }
          });
        }
      }
    });

    return docs;
  };

  const documents = categorizeDocuments();
  const currentStageName = ORDER_STAGES[order.currentStage - 1]?.name || 'Unknown';
  const isCompleted = order.currentStage === 8;

  // Document sections configuration
  const docSections = [
    { id: 'purchaseOrder', title: 'Purchase Order', icon: 'FileText', color: 'blue', docs: documents.purchaseOrder },
    { id: 'proformaInvoice', title: 'Proforma Invoice', icon: 'FileText', color: 'indigo', docs: documents.proformaInvoice },
    { id: 'artwork', title: 'Artwork / Labels', icon: 'FileText', color: 'purple', docs: documents.artwork },
    { id: 'inspection', title: 'Inspection Photos', icon: 'FileText', color: 'pink', docs: documents.inspection },
    { id: 'draftDocuments', title: 'Draft Documents', icon: 'FileText', color: 'amber', docs: documents.draftDocuments },
    { id: 'finalDocuments', title: 'Final Document Copies', icon: 'FileText', color: 'green', docs: documents.finalDocuments },
  ];

  const formatDate = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

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
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Emails</p>
            <p className="font-medium text-gray-800">{order.history.length} emails</p>
          </div>
        </div>
      </div>

      {/* Documents Section */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Documents & Attachments</h2>
        <div className="grid grid-cols-3 gap-4">
          {docSections.map(section => {
            const hasDocuments = section.docs.length > 0;
            const bgColors: any = {
              blue: hasDocuments ? 'bg-blue-50 border-blue-200 hover:bg-blue-100' : 'bg-gray-50 border-gray-200',
              indigo: hasDocuments ? 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100' : 'bg-gray-50 border-gray-200',
              purple: hasDocuments ? 'bg-purple-50 border-purple-200 hover:bg-purple-100' : 'bg-gray-50 border-gray-200',
              pink: hasDocuments ? 'bg-pink-50 border-pink-200 hover:bg-pink-100' : 'bg-gray-50 border-gray-200',
              amber: hasDocuments ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' : 'bg-gray-50 border-gray-200',
              green: hasDocuments ? 'bg-green-50 border-green-200 hover:bg-green-100' : 'bg-gray-50 border-gray-200',
            };
            const textColors: any = {
              blue: hasDocuments ? 'text-blue-700' : 'text-gray-400',
              indigo: hasDocuments ? 'text-indigo-700' : 'text-gray-400',
              purple: hasDocuments ? 'text-purple-700' : 'text-gray-400',
              pink: hasDocuments ? 'text-pink-700' : 'text-gray-400',
              amber: hasDocuments ? 'text-amber-700' : 'text-gray-400',
              green: hasDocuments ? 'text-green-700' : 'text-gray-400',
            };
            const iconColors: any = {
              blue: hasDocuments ? 'text-blue-500' : 'text-gray-300',
              indigo: hasDocuments ? 'text-indigo-500' : 'text-gray-300',
              purple: hasDocuments ? 'text-purple-500' : 'text-gray-300',
              pink: hasDocuments ? 'text-pink-500' : 'text-gray-300',
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
                      <Icon name={section.icon as any} size={24} className={iconColors[section.color]} />
                      <div>
                        <p className={`font-medium ${textColors[section.color]}`}>{section.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {hasDocuments ? `${section.docs.length} item${section.docs.length > 1 ? 's' : ''}` : 'Not available'}
                        </p>
                      </div>
                    </div>
                    {hasDocuments && (
                      <Icon name="ChevronDown" size={16} className={`${iconColors[section.color]} transition-transform ${activeDocSection === section.id ? 'rotate-180' : ''}`} />
                    )}
                  </div>
                </button>

                {/* Expanded Document List */}
                {activeDocSection === section.id && hasDocuments && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-xl space-y-2">
                    {section.docs.map((doc: any, idx: number) => {
                      const contact = getContactInfo(doc.from);
                      return (
                        <div key={idx} className="bg-white p-3 rounded-lg border border-gray-200">
                          <div className="flex items-start gap-3">
                            <ContactAvatar email={doc.from} size="sm" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{doc.subject}</p>
                              <p className="text-xs text-gray-500">{contact.name} • {formatDate(doc.timestamp)}</p>
                              {doc.attachment && (
                                <div className="flex items-center gap-1 mt-2 text-xs text-blue-600">
                                  <Icon name="Paperclip" size={12} />
                                  <span>{doc.attachment}</span>
                                </div>
                              )}
                              {!doc.attachment && doc.hasAttachment && doc.attachments && (
                                <div className="mt-2 space-y-1">
                                  {doc.attachments.map((att: string, attIdx: number) => (
                                    <div key={attIdx} className="flex items-center gap-1 text-xs text-blue-600">
                                      <Icon name="Paperclip" size={12} />
                                      <span>{att}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <a href="#" className="text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap">
                              View Email →
                            </a>
                          </div>
                        </div>
                      );
                    })}
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
