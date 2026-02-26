// Printable PO document preview — the actual purchase order content
import { forwardRef } from 'react';
import { GILogo } from './Logos';
import { formatDate } from '../utils/poHelpers';

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

interface Props {
  poData: {
    supplier: string;
    supplierAddress: string;
    supplierCountry: string;
    buyer: string;
    buyerBank: string;
    destination: string;
    deliveryTerms: string;
    deliveryDate: string;
    commission: string;
    overseasCommission: string;
    overseasCommissionCompany: string;
    payment: string;
    loteNumber: string;
    shippingMarks: string;
    date: string;
  };
  lineItems: POLineItem[];
  grandTotal: string;
  totalKilos: number;
  totalCases: number;
  signatureData: string;
  status: string;
  currentPreviewPONumber: string;
  displayDate: string;  // already resolved for bulk mode
  isRevised?: boolean;
}

const PODocumentPreview = forwardRef<HTMLDivElement, Props>(({
  poData, lineItems, grandTotal, totalKilos, totalCases,
  signatureData, status, currentPreviewPONumber, displayDate, isRevised,
}, ref) => {
  // Determine which optional columns have data
  const hasBrand = lineItems.some(i => i.brand);
  const hasFreezing = lineItems.some(i => i.freezing);
  const hasSize = lineItems.some(i => i.size);
  const hasGlaze = lineItems.some(i => i.glaze);
  const hasPacking = lineItems.some(i => i.packing);
  const hasCases = lineItems.some(i => i.cases);

  // Build deduped product description for greeting
  const productGreeting = (() => {
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
    }).join('') || '______________________';
  })();

  return (
    <div ref={ref} className="px-6 py-3 mx-auto bg-white" style={{ fontSize: '12px', lineHeight: '1.35', maxWidth: '1000px' }}>
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
          <p className="font-medium text-gray-700">Date: <span className="text-gray-900">{formatDate(displayDate)}</span></p>
        </div>
        <div>
          <p className="font-medium text-gray-700">{isRevised ? 'Revised Purchase Order No' : 'Purchase Order No'}: <span className="text-gray-900 font-bold">{currentPreviewPONumber}</span></p>
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
          We are pleased to confirm our {isRevised ? 'Revised ' : ''}Purchase Order with you for the Export of{' '}
          <span className="font-medium">{productGreeting}</span>
          {' '}to our Principals namely <span className="font-medium">M/s.{poData.buyer || '______________________'}</span>
          {poData.destination && <>, <span className="font-medium">{poData.destination.toUpperCase()}</span></>}
          {' '}under the following terms & conditions.
        </p>
      </div>

      {/* Product Details Table */}
      <div className="mb-2">
        <table className="w-full border-collapse border border-gray-300" style={{ fontSize: '10px', tableLayout: 'auto' }}>
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-1.5 py-1 text-left" style={{ minWidth: '100px' }}>Product</th>
              {hasBrand && <th className="border border-gray-300 px-1.5 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Brand</th>}
              {hasFreezing && <th className="border border-gray-300 px-1.5 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Freezing</th>}
              {hasSize && <th className="border border-gray-300 px-1.5 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Size</th>}
              {hasGlaze && <th className="border border-gray-300 px-1.5 py-1 text-left">Glaze</th>}
              {hasPacking && <th className="border border-gray-300 px-1.5 py-1 text-left" style={{ whiteSpace: 'nowrap' }}>Packing</th>}
              {hasCases && <th className="border border-gray-300 px-1.5 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>Cases</th>}
              <th className="border border-gray-300 px-1.5 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>Kilos</th>
              <th className="border border-gray-300 px-1.5 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>Price/Kg<br/><span style={{ fontSize: '8px', fontWeight: 'normal' }}>{poData.deliveryTerms} {poData.destination || '___'}</span></th>
              <th className="border border-gray-300 px-1.5 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>
                {lineItems.some(i => i.currency && i.currency !== 'USD') ? 'Total' : 'Total (USD)'}
              </th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, idx) => (
              <tr key={idx}>
                <td className="border border-gray-300 px-1.5 py-1">{item.product || '-'}</td>
                {hasBrand && <td className="border border-gray-300 px-1.5 py-1" style={{ whiteSpace: 'nowrap' }}>{item.brand || '-'}</td>}
                {hasFreezing && <td className="border border-gray-300 px-1.5 py-1" style={{ whiteSpace: 'nowrap' }}>{item.freezing || '-'}</td>}
                {hasSize && <td className="border border-gray-300 px-1.5 py-1" style={{ whiteSpace: 'nowrap' }}>{item.size || '-'}</td>}
                {hasGlaze && <td className="border border-gray-300 px-1.5 py-1">{item.glaze && item.glazeMarked ? `${item.glaze} marked as ${item.glazeMarked}` : item.glaze || '-'}</td>}
                {hasPacking && <td className="border border-gray-300 px-1.5 py-1" style={{ whiteSpace: 'nowrap' }}>{item.packing || '-'}</td>}
                {hasCases && <td className="border border-gray-300 px-1.5 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>{item.cases || '-'}</td>}
                <td className="border border-gray-300 px-1.5 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>{item.kilos || '-'}</td>
                <td className="border border-gray-300 px-1.5 py-1 text-right" style={{ whiteSpace: 'nowrap' }}>{item.pricePerKg ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${Number(item.pricePerKg).toFixed(2)}` : '-'}</td>
                <td className="border border-gray-300 px-1.5 py-1 text-right font-medium" style={{ whiteSpace: 'nowrap' }}>{Number(item.total) > 0 ? `${(!item.currency || item.currency === 'USD') ? '$' : item.currency + ' '}${Number(item.total).toFixed(2)}` : '-'}</td>
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
  );
});

PODocumentPreview.displayName = 'PODocumentPreview';

export default PODocumentPreview;
