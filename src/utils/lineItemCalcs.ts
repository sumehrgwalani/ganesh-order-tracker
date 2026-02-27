// Line item calculation utilities — shared by POGeneratorPage and AmendPOModal

export const parsePackingKg = (packing: string): number | null => {
  if (!packing) return null;

  // Pattern: 6x1 kg, 6X1 kg, 6x1kg, 10x1 = multiplied (6*1=6, 10*1=10)
  const multiplyMatch = packing.match(/(\d+)\s*[xX]\s*(\d+)\s*(?:kg|kilo)?/i);
  if (multiplyMatch) {
    return parseInt(multiplyMatch[1]) * parseInt(multiplyMatch[2]);
  }

  // Pattern: 10 kg Bulk, 6 kilo = direct kg
  const directMatch = packing.match(/(\d+)\s*(?:kg|kilo)/i);
  if (directMatch) {
    return parseInt(directMatch[1]);
  }

  return null;
};

export const calculateLineItem = (item: any) => {
  const inputKilos = parseFloat(item.kilos) || 0;
  const price = parseFloat(item.pricePerKg) || 0;
  const kgPerCarton = parsePackingKg(item.packing);
  const inputCases = item.cases ? parseInt(item.cases as string) : 0;

  let cases = inputCases;
  let adjustedKilos = inputKilos;

  if (kgPerCarton && inputKilos > 0) {
    if (inputCases > 0) {
      // Cases already provided (e.g., from carton-based AI parsing) — use them directly
      cases = inputCases;
      adjustedKilos = cases * kgPerCarton;
    } else {
      // No cases provided — calculate from kilos
      cases = Math.ceil(inputKilos / kgPerCarton);
      adjustedKilos = cases * kgPerCarton;
    }
  }

  const total = (adjustedKilos * price).toFixed(2);

  return {
    cases: cases || '',
    adjustedKilos: adjustedKilos,
    total: total
  };
};

export const recalculateAllLineItems = (items: any[]) => {
  return items.map(item => {
    const calculated = calculateLineItem(item);
    const kgPerCarton = parsePackingKg(item.packing);
    return {
      ...item,
      cases: calculated.cases,
      kilos: kgPerCarton ? calculated.adjustedKilos : item.kilos,
      total: calculated.total
    };
  });
};

export const calcGrandTotal = (items: any[]) =>
  items.reduce((sum, item) => sum + parseFloat((item.total as string) || '0'), 0).toFixed(2);

export const calcTotalKilos = (items: any[]) =>
  items.reduce((sum, item) => sum + (parseFloat((item.kilos as string) || '0') || 0), 0);

export const calcTotalCases = (items: any[]) =>
  items.reduce((sum, item) => sum + (parseInt((item.cases as string) || '0') || 0), 0);
