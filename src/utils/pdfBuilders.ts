// PDF HTML template builders — used by OrderDetailPage and AmendPOModal
import { GI_LOGO_URL } from '../data/constants';

// Shared table cell styles
const thStyle = 'border:1px solid #d1d5db;padding:4px 6px;text-align:left;font-size:10px;white-space:nowrap;background:#f3f4f6;';
const thStyleWrap = 'border:1px solid #d1d5db;padding:4px 6px;text-align:left;font-size:10px;background:#f3f4f6;';
const thStyleR = 'border:1px solid #d1d5db;padding:4px 6px;text-align:right;font-size:10px;white-space:nowrap;background:#f3f4f6;';
const tdStyle = 'border:1px solid #d1d5db;padding:4px 6px;font-size:10px;white-space:nowrap;';
const tdStyleWrap = 'border:1px solid #d1d5db;padding:4px 6px;font-size:10px;';
const tdStyleR = 'border:1px solid #d1d5db;padding:4px 6px;font-size:10px;text-align:right;white-space:nowrap;';

// Load signature image from localStorage
function getSignatureHtml(): string {
  try {
    const sig = localStorage.getItem('gi_signature');
    if (sig) return `<div style="margin-bottom:8px;"><img src="${sig}" style="height:60px;max-width:200px;object-fit:contain;" /></div>`;
  } catch { /* ignore */ }
  return '';
}

// Build deduplicated product description text
function buildProductDesc(items: any[], fallback: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const item of items.filter((i: any) => i.product)) {
    const key = `${item.product}|${item.freezing || ''}|${item.glaze || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      let desc = String(item.product);
      if (item.freezing && !desc.toLowerCase().includes(String(item.freezing).toLowerCase())) desc += ` ${item.freezing}`;
      if (item.glaze && item.glazeMarked) desc += ` ${item.glaze} marked as ${item.glazeMarked}`;
      else if (item.glaze) desc += ` ${item.glaze}`;
      parts.push(desc);
    }
  }
  return parts.join(', ') || fallback;
}

// Detect which optional columns have data
function detectColumns(items: any[]) {
  return {
    hasBrand: items.some((i: any) => i.brand),
    hasFreezing: items.some((i: any) => i.freezing),
    hasSize: items.some((i: any) => i.size),
    hasGlaze: items.some((i: any) => i.glaze),
    hasPacking: items.some((i: any) => i.packing),
    hasCases: items.some((i: any) => i.cases),
  };
}

// Build table header row
function buildHeaderCells(cols: ReturnType<typeof detectColumns>, deliveryTerms: string, destination: string, items: any[]): string {
  return [
    `<th style="${thStyle}">Product</th>`,
    cols.hasBrand ? `<th style="${thStyle}">Brand</th>` : '',
    cols.hasFreezing ? `<th style="${thStyle}">Freezing</th>` : '',
    cols.hasSize ? `<th style="${thStyle}">Size</th>` : '',
    cols.hasGlaze ? `<th style="${thStyleWrap}">Glaze</th>` : '',
    cols.hasPacking ? `<th style="${thStyle}">Packing</th>` : '',
    cols.hasCases ? `<th style="${thStyleR}">Cases</th>` : '',
    `<th style="${thStyleR}">Kilos</th>`,
    `<th style="${thStyleR}">Price/Kg<br><span style="font-size:8px;font-weight:normal;">${deliveryTerms} ${destination || '___'}</span></th>`,
    `<th style="${thStyleR}">${items.some((i: any) => i.currency && i.currency !== 'USD') ? 'Total' : 'Total (USD)'}</th>`,
  ].filter(Boolean).join('');
}

// Build table body rows
function buildBodyRows(items: any[], cols: ReturnType<typeof detectColumns>): string {
  return items.filter((i: any) => i.product).map((item: any) => {
    const cur = (!item.currency || item.currency === 'USD') ? '$' : item.currency + ' ';
    const cells = [
      `<td style="${tdStyle}">${item.product || '-'}</td>`,
      cols.hasBrand ? `<td style="${tdStyle}">${item.brand || '-'}</td>` : '',
      cols.hasFreezing ? `<td style="${tdStyle}">${item.freezing || '-'}</td>` : '',
      cols.hasSize ? `<td style="${tdStyle}">${item.size || '-'}</td>` : '',
      cols.hasGlaze ? `<td style="${tdStyleWrap}">${item.glaze && item.glazeMarked ? `${item.glaze} marked as ${item.glazeMarked}` : item.glaze || '-'}</td>` : '',
      cols.hasPacking ? `<td style="${tdStyle}">${item.packing || '-'}</td>` : '',
      cols.hasCases ? `<td style="${tdStyleR}">${item.cases || '-'}</td>` : '',
      `<td style="${tdStyleR}">${item.kilos || '-'}</td>`,
      `<td style="${tdStyleR}">${item.pricePerKg ? `${cur}${Number(item.pricePerKg).toFixed(2)}` : '-'}</td>`,
      `<td style="${tdStyleR};font-weight:600;">${Number(item.total) > 0 ? `${cur}${Number(item.total).toFixed(2)}` : '-'}</td>`,
    ].filter(Boolean).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
}

// Build total row
function buildTotalRow(cols: ReturnType<typeof detectColumns>, totalCases: number, totalKilos: number, grandTotal: string | number): string {
  const totalColSpan = 1 + (cols.hasBrand ? 1 : 0) + (cols.hasFreezing ? 1 : 0) + (cols.hasSize ? 1 : 0) + (cols.hasGlaze ? 1 : 0) + (cols.hasPacking ? 1 : 0);
  return `<tr style="background:#f9fafb;font-weight:700;">
    <td style="${tdStyle}" colspan="${totalColSpan}">Total</td>
    ${cols.hasCases ? `<td style="${tdStyleR}">${totalCases}</td>` : ''}
    <td style="${tdStyleR}">${totalKilos}</td>
    <td style="${tdStyleR}"></td>
    <td style="${tdStyleR}">U.S. $${Number(grandTotal).toFixed(2)}</td>
  </tr>`;
}

// Company header block (shared between PO and PI)
function companyHeader(): string {
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
    <div>
      <h2 style="font-size:16px;font-weight:700;color:#1f2937;margin:0;">GANESH INTERNATIONAL</h2>
      <p style="font-size:10px;color:#6b7280;margin:1px 0 0;line-height:1.3;">Office no. 226, 2nd Floor, Arun Chambers, Tardeo Road, Mumbai 400034</p>
      <p style="font-size:10px;color:#6b7280;margin:1px 0 0;line-height:1.3;">Tel: +91 22 2351 2345 | Email: ganeshintnlmumbai@gmail.com</p>
    </div>
    <img src="${GI_LOGO_URL}" alt="Ganesh International" style="width:60px;height:60px;object-fit:contain;" crossorigin="anonymous" />
  </div>`;
}

// Signature block (shared between PO and PI)
function signatureBlock(): string {
  return `<div style="margin-top:6px;page-break-inside:avoid;">
    ${getSignatureHtml()}
    <p style="font-weight:700;margin:0;color:#1f2937;font-size:11px;">Sumehr Rajnish Gwalani</p>
    <p style="color:#4b5563;margin:1px 0 0;font-size:11px;">GANESH INTERNATIONAL</p>
    <div style="margin-top:2px;display:inline-block;padding:2px 6px;background:#dcfce7;color:#15803d;border-radius:4px;font-size:9px;">&#10003; Digitally Signed &amp; Approved</div>
  </div>`;
}

// ========================================
// PUBLIC API
// ========================================

export interface PdfData {
  items: any[];
  orderId: string;
  orderProduct: string;
  supplierName: string;
  supplierAddress?: string;
  supplierCountry: string;
  buyerName: string;
  buyerBank?: string;
  destination: string;
  deliveryTerms: string;
  deliveryDate?: string;
  commission?: string;
  overseasCommission?: string;
  overseasCommissionCompany?: string;
  payment?: string;
  shippingMarks?: string;
  loteNumber?: string;
  poDate: string;
  grandTotal: string | number;
  totalKilos: number;
  totalCases: number;
  piNumber?: string;
}

export function buildPOHtml(d: PdfData): string {
  const cols = detectColumns(d.items);
  const productDesc = buildProductDesc(d.items, d.orderProduct);
  const headerCells = buildHeaderCells(cols, d.deliveryTerms, d.destination, d.items);
  const bodyRows = buildBodyRows(d.items, cols);
  const totalRow = buildTotalRow(cols, d.totalCases, d.totalKilos, d.grandTotal);

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;padding:12px 20px;max-width:800px;margin:0 auto;color:#1f2937;font-size:11px;line-height:1.35;">
      ${companyHeader()}

      <!-- Date and PO Number -->
      <table style="width:100%;margin-bottom:8px;"><tr>
        <td><strong>Date:</strong> ${d.poDate}</td>
        <td style="text-align:right;"><strong>Purchase Order No:</strong> <span style="font-weight:700;">${d.orderId}</span></td>
      </tr></table>

      <!-- To Section -->
      <div style="margin-bottom:6px;line-height:1.3;">
        <p style="color:#6b7280;margin:0;">To,</p>
        <p style="font-weight:700;margin:1px 0;">${d.supplierName || '[EXPORTER NAME]'}</p>
        ${d.supplierAddress ? `<p style="margin:0;color:#4b5563;">${d.supplierAddress}</p>` : ''}
        <p style="font-weight:500;margin:0;color:#4b5563;">${d.supplierCountry}</p>
      </div>

      <!-- Greeting -->
      <div style="margin-bottom:8px;line-height:1.35;">
        <p style="margin:0;">Dear Sirs,</p>
        <p style="margin:2px 0 0;">We are pleased to confirm our Purchase Order with you for the Export of <strong>${productDesc}</strong> to our Principals namely <strong>M/s.${d.buyerName}</strong>${d.destination ? `, <strong>${d.destination.toUpperCase()}</strong>` : ''} under the following terms &amp; conditions.</p>
      </div>

      <!-- Product Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
        <thead><tr style="background:#f3f4f6;">${headerCells}</tr></thead>
        <tbody>${bodyRows}${totalRow}</tbody>
      </table>

      <!-- Terms -->
      <div style="line-height:1.35;margin-bottom:8px;">
        <p style="margin:0;"><strong>Total Value:</strong> U.S. $${Number(d.grandTotal).toFixed(2)}</p>
        <p style="font-size:9px;color:#6b7280;margin:1px 0 1px 14px;">*We need a quality control of photos before loading</p>
        <p style="font-size:9px;color:#6b7280;margin:0 0 2px 14px;">*Different colors Tapes for different products &amp; Lots.</p>
        ${d.deliveryTerms || d.destination ? `<p style="margin:0;"><strong>Delivery Terms:</strong> ${d.deliveryTerms} ${d.destination}</p>` : ''}
        ${d.deliveryDate ? `<p style="margin:0;"><strong>Shipment Date:</strong> ${d.deliveryDate}</p>` : ''}
        <p style="margin:0;"><strong>Commission:</strong> ${d.commission || '___________________'} + 18% GST</p>
        ${d.overseasCommission ? `<p style="margin:0;"><strong>Overseas Commission:</strong> ${d.overseasCommission}${d.overseasCommissionCompany ? `, payable to ${d.overseasCommissionCompany}` : ''}</p>` : ''}
        ${d.payment ? `<p style="margin:0;"><strong>Payment:</strong> ${d.payment}</p>` : ''}
        <p style="margin:0;"><strong>Variation:</strong> +/- 5% in Quantity &amp; Value</p>
        <p style="margin:0;"><strong>Labelling Details:</strong> As per previous. (pls send for approval)</p>
        ${d.loteNumber ? `<p style="margin:0;"><strong>Lote number:</strong> ${d.loteNumber}</p>` : ''}
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

      ${d.shippingMarks ? `<p style="margin-bottom:6px;"><strong>Shipping Marks:</strong> ${d.shippingMarks}</p>` : ''}

      <!-- Please Note -->
      <div style="color:#4b5563;margin-bottom:6px;line-height:1.3;page-break-inside:avoid;font-size:10.5px;">
        <p style="font-weight:600;margin:0 0 2px;">Please Note:</p>
        ${d.buyerBank ? `<p style="margin:0 0 2px;">After the documents are negotiated, please send us the Courier Airway Bill no for the documents send by your Bank to buyers bank in ${d.buyerBank}.</p>` : ''}
        <p style="margin:0 0 2px;">While emailing us the shipment details, Please mention Exporter, Product, B/Ups, Packing, B/L No, Seal No, Container No, Vessel Name, ETD/ETA, Port Of Shipment / Destination and the Transfer of the Letter of Credit in whose Favour.</p>
        <p style="margin:0;">Any Claim on Quality, Grading, Packing and Short weight for this particular consignment will be borne entirely by you and will be your sole responsibility.</p>
      </div>

      <!-- Closing -->
      <div style="color:#374151;margin-bottom:4px;font-size:10.5px;line-height:1.3;">
        <p style="margin:0;">Hope you find the above terms &amp; conditions in order. Please put your Seal and Signature and send it to us as a token of your confirmation.</p>
        <p style="margin:4px 0 0;">Thanking You,</p>
      </div>

      ${signatureBlock()}

      <!-- Footer -->
      <div style="margin-top:8px;padding-top:4px;border-top:1px solid #e5e7eb;font-size:8px;color:#9ca3af;">
        <p style="margin:0;">FOOTNOTE: SUGGEST USE OF DATA LOGGER IN REFER CONTAINER USEFUL IN CASE OF TEMP. FLUCTUATION ON BOARD</p>
      </div>
    </div>
  `;
}

export function buildPIHtml(d: PdfData): string {
  const cols = detectColumns(d.items);
  const productDesc = buildProductDesc(d.items, d.orderProduct);
  const headerCells = buildHeaderCells(cols, d.deliveryTerms, d.destination, d.items);
  const bodyRows = buildBodyRows(d.items, cols);
  const totalRow = buildTotalRow(cols, d.totalCases, d.totalKilos, d.grandTotal);
  const piNumber = d.piNumber || 'PENDING';
  const piDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;padding:12px 20px;max-width:800px;margin:0 auto;color:#1f2937;font-size:11px;line-height:1.35;">
      ${companyHeader()}

      <!-- Title -->
      <div style="text-align:center;margin-bottom:10px;">
        <h3 style="font-size:14px;font-weight:700;color:#1f2937;margin:0;text-decoration:underline;">PROFORMA INVOICE</h3>
      </div>

      <!-- PI Number, Date, Against PO -->
      <table style="width:100%;margin-bottom:8px;"><tr>
        <td><strong>Proforma Invoice No:</strong> <span style="font-weight:700;">${piNumber}</span></td>
        <td style="text-align:right;"><strong>Date:</strong> ${piDate}</td>
      </tr><tr>
        <td><strong>Against Purchase Order:</strong> ${d.orderId}</td>
        <td></td>
      </tr></table>

      <!-- Supplier (Exporter) -->
      <div style="margin-bottom:6px;line-height:1.3;">
        <p style="color:#6b7280;margin:0;">Exporter:</p>
        <p style="font-weight:700;margin:1px 0;">${d.supplierName || '[EXPORTER NAME]'}</p>
        ${d.supplierAddress ? `<p style="margin:0;color:#4b5563;">${d.supplierAddress}</p>` : ''}
        <p style="font-weight:500;margin:0;color:#4b5563;">${d.supplierCountry}</p>
      </div>

      <!-- Buyer (Importer) -->
      <div style="margin-bottom:8px;line-height:1.3;">
        <p style="color:#6b7280;margin:0;">Importer:</p>
        <p style="font-weight:700;margin:1px 0;">M/s. ${d.buyerName}</p>
        ${d.destination ? `<p style="margin:0;color:#4b5563;">${d.destination.toUpperCase()}</p>` : ''}
      </div>

      <!-- Greeting -->
      <div style="margin-bottom:8px;line-height:1.35;">
        <p style="margin:0;">Dear Sirs,</p>
        <p style="margin:2px 0 0;">We are pleased to issue our Proforma Invoice for the shipment of <strong>${productDesc}</strong> as per the following terms &amp; conditions.</p>
      </div>

      <!-- Product Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
        <thead><tr style="background:#f3f4f6;">${headerCells}</tr></thead>
        <tbody>${bodyRows}${totalRow}</tbody>
      </table>

      <!-- Terms -->
      <div style="line-height:1.35;margin-bottom:8px;">
        <p style="margin:0;"><strong>Total Value:</strong> U.S. $${Number(d.grandTotal).toFixed(2)}</p>
        ${d.deliveryTerms || d.destination ? `<p style="margin:0;"><strong>Delivery Terms:</strong> ${d.deliveryTerms} ${d.destination}</p>` : ''}
        ${d.deliveryDate ? `<p style="margin:0;"><strong>Shipment Date:</strong> ${d.deliveryDate}</p>` : ''}
        ${d.payment ? `<p style="margin:0;"><strong>Payment:</strong> ${d.payment}</p>` : ''}
        <p style="margin:0;"><strong>Variation:</strong> +/- 5% in Quantity &amp; Value</p>
      </div>

      <!-- Closing -->
      <div style="color:#374151;margin-bottom:4px;font-size:10.5px;line-height:1.3;">
        <p style="margin:0;">Hope you find the above in order.</p>
        <p style="margin:4px 0 0;">Thanking You,</p>
      </div>

      ${signatureBlock()}

      <!-- Footer -->
      <div style="margin-top:8px;padding-top:4px;border-top:1px solid #e5e7eb;font-size:8px;color:#9ca3af;">
        <p style="margin:0;">This is a computer generated Proforma Invoice.</p>
      </div>
    </div>
  `;
}

// Helper to extract PdfData from order + metadata
export function orderToPdfData(order: any, meta: Record<string, any> | null, lineItems: any[]): PdfData {
  const items = meta?.lineItems || lineItems;
  return {
    items,
    orderId: order.id,
    orderProduct: order.product,
    supplierName: meta?.supplier || order.supplier,
    supplierAddress: meta?.supplierAddress || '',
    supplierCountry: (meta?.supplierCountry || order.from || 'India').toUpperCase(),
    buyerName: meta?.buyer || order.company,
    buyerBank: meta?.buyerBank || '',
    destination: meta?.destination || order.to || '',
    deliveryTerms: meta?.deliveryTerms || '',
    deliveryDate: meta?.deliveryDate || '',
    commission: meta?.commission || '',
    overseasCommission: meta?.overseasCommission || '',
    overseasCommissionCompany: meta?.overseasCommissionCompany || '',
    payment: meta?.payment || '',
    shippingMarks: meta?.shippingMarks || '',
    loteNumber: meta?.loteNumber || '',
    poDate: meta?.date || order.date,
    grandTotal: meta?.grandTotal || order.totalValue || '',
    totalKilos: meta?.totalKilos || order.totalKilos || 0,
    totalCases: meta?.totalCases || 0,
    piNumber: order.piNumber,
  };
}
