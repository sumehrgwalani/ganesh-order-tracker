import { useState } from 'react';
import html2pdf from 'html2pdf.js';
import Icon from './Icon';
import { buildPOHtml, orderToPdfData } from '../utils/pdfBuilders';
import { getAttachmentMeta } from '../types';
import { supabase } from '../lib/supabase';
import type { Order } from '../types';

interface Props {
  order: Order;
  onUpdateOrder: (orderId: string, updates: Partial<Order>) => Promise<void>;
  onClose: () => void;
}

export default function AmendPOModal({ order, onUpdateOrder, onClose }: Props) {
  const lineItems = order.lineItems || [];
  const initialItems = lineItems.length > 0
    ? lineItems.map((li: any) => ({ ...li }))
    : [{ product: '', brand: '', freezing: '', size: '', glaze: '', glazeMarked: '', packing: '', cases: '', kilos: '', pricePerKg: '', currency: 'USD', total: 0 }];

  const [amendItems, setAmendItems] = useState<any[]>(initialItems);
  const [saving, setSaving] = useState(false);

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

  // Extract PO metadata from stage 1 attachment
  const getPOMeta = (): Record<string, any> | null => {
    const stage1 = order.history.find(h => h.stage === 1 && h.attachments?.length);
    if (!stage1?.attachments) return null;
    for (const att of stage1.attachments) {
      const meta = getAttachmentMeta(att);
      if (meta) return meta;
    }
    return null;
  };

  const handleSave = async () => {
    setSaving(true);
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
        const pdfData = orderToPdfData(order, { ...(meta || {}), totalCases: amendTotalCases, totalKilos: amendTotalKilos, grandTotal: amendGrandTotal, lineItems: amendItems }, amendItems);
        const html = buildPOHtml(pdfData);
        const container = document.createElement('div');
        container.innerHTML = html;
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
      } catch { alert('PO PDF could not be regenerated, but the order was saved.'); }

      onClose();
    } catch { alert('Failed to save amended order.'); }
    finally { setSaving(false); }
  };

  const inputClass = 'w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-2xl flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-semibold text-gray-800">Amend Purchase Order</h3>
            <p className="text-xs text-gray-500 mt-0.5">{order.id} &bull; {order.supplier} &rarr; {order.company}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
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
                    <td className="px-2 py-2" style={{ minWidth: 80 }}>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400 text-xs">{item.currency === 'USD' ? '$' : item.currency}</span>
                        <input type="number" step="0.01" value={item.pricePerKg} onChange={e => updateItem(idx, 'pricePerKg', e.target.value)} className={`${inputClass} text-right`} />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-medium text-gray-800" style={{ minWidth: 90 }}>
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
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</>
            ) : (
              <><Icon name="Check" size={16} /> Save Changes</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
