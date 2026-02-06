// Order data - this will be replaced with database queries when DB is added
// Each function returns data in the same shape, making the DB swap seamless

export const initialOrders = [
  {
    id: 'GI/PO/25-26/3043',
    poNumber: 'PO 3043',
    company: 'PESCADOS E.GUILLEM',
    product: 'Frozen Seafood',
    specs: 'New Order',
    from: 'India',
    to: 'Spain',
    date: '5th Feb 2026',
    currentStage: 1,
    supplier: 'Rohit Khetalpar',
    history: [
      { stage: 1, timestamp: '2026-02-05T09:00:00Z', from: '"Rohit Khetalpar" <rohit@vendor.com>', to: 'Ganesh International', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3043', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached the new Purchase Order.\n\nPO Number: GI/PO/25-26/3043\n\nKindly confirm receipt and process at the earliest.\n\nThanking you,\nBest regards,\nRohit Khetalpar', hasAttachment: true, attachments: ['PO_3043.pdf'] }
    ]
  },
  {
    id: 'GI/PO/25-26/3042',
    poNumber: 'PO 3042',
    company: 'PESCADOS E.GUILLEM',
    product: 'Squid Whole IQF',
    specs: '8th Container - Nila',
    from: 'India',
    to: 'Spain',
    date: '4th Feb 2026',
    currentStage: 2,
    supplier: 'Nila Exports',
    history: [
      { stage: 1, timestamp: '2026-02-01T08:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'Nila Exports', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3042 - PESCADOS 8TH CONTAINER', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached the PO for the 8th container shipment to Pescados.\n\nPO Number: GI/PO/25-26/3042\n\nKindly confirm and proceed.\n\nThanking you,\nBest regards,\nSANTOSH LAXMAN SATOPE\nGanesh International', hasAttachment: true, attachments: ['PO_3042.pdf'] },
      { stage: 2, timestamp: '2026-02-04T10:30:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'RE: PO GI/PO/25-26/3042 - PESCADOS 8TH CONTAINER - Proforma Invoice', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached the Proforma Invoice for the 8th container.\n\nInvoice No: 3000250128\nReference: PO GI/PO/25-26/3042\n\nKindly confirm and proceed with artwork.\n\nThanking you,\nNila Exports\nNila Seafoods Pvt Ltd', hasAttachment: true, attachments: ['PI_3000250128.pdf'] }
    ]
  },
  {
    id: 'GI/PO/25-26/3039',
    poNumber: 'PO 3039',
    piNumber: 'GI/PI/25-26/I02048',
    company: 'PESCADOS E.GUILLEM',
    brand: 'MORALES',
    product: 'Calamar Troceado',
    specs: 'Printed bag - JJ SEAFOODS',
    from: 'India',
    to: 'Spain',
    date: '3rd Feb 2026',
    currentStage: 3,
    supplier: 'JJ SEAFOODS',
    artworkStatus: 'needs_correction',
    history: [
      { stage: 1, timestamp: '2026-01-28T08:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'JJ SEAFOODS', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3039', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached PO for Calamar Troceado.\n\nPO Number: GI/PO/25-26/3039\n\nKindly confirm.\n\nThanking you,\nSANTOSH LAXMAN SATOPE', hasAttachment: true, attachments: ['PO_3039.pdf'] },
      { stage: 2, timestamp: '2026-01-30T11:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: PO 3039 - PI GI/PI/25-26/I02048', body: 'Dear Sumehr,\n\nPI attached for your reference.\n\nPI Number: GI/PI/25-26/I02048\n\nBest regards,\nOscar García\nPESCADOS E.GUILLEM S.A.', hasAttachment: true, attachments: ['PI_I02048.pdf'] },
      { stage: 3, timestamp: '2026-02-03T15:45:00Z', from: '"Mª Carmen Martínez" <calidad@eguillem.com>', to: '"Ganesh International" <ganeshintnlmumbai@gmail.com>', subject: 'RE: NEED ARTWORK APPROVAL - PI GI/PI/25-26/I02048 - PO 3039 - JJ SEAFOODS', body: 'Dear Santosh,\n\nThe artwork NEEDS CORRECTION.\n\nPlease check the following and resend:\n- Label positioning needs adjustment\n- Font size on ingredients list\n- Barcode placement\n\nBest regards.\n\nMª Carmen Martínez\nDpto. Calidad\nwww.eguillem.com\nT 961 218 844', hasAttachment: false }
    ]
  },
  {
    id: 'GI/PO/25-26/3037',
    poNumber: 'PO 3037',
    piNumber: 'GI/PI/25-26/I02046',
    company: 'PESCADOS E.GUILLEM',
    brand: 'EGUILLEM',
    product: 'Baby Squid Finger Laid',
    specs: '200/300 - RAUNAQ',
    from: 'India',
    to: 'Valencia, Spain',
    date: '3rd Feb 2026',
    currentStage: 2,
    supplier: 'RAUNAQ',
    history: [
      { stage: 1, timestamp: '2026-01-29T09:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'RAUNAQ', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3037 - Baby Squid Finger Laid', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached PO for Baby Squid Finger Laid 200/300.\n\nPO Number: GI/PO/25-26/3037\n\nKindly confirm.\n\nThanking you,\nSANTOSH LAXMAN SATOPE\nGanesh International', hasAttachment: true, attachments: ['PO_3037.pdf'] },
      { stage: 2, timestamp: '2026-02-01T14:30:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: PO 3037 - BABY SQUID FINGER LAID - PI GI/PI/25-26/I02046', body: 'Dear Sumehr,\n\nPlease find attached Proforma Invoice.\n\nPI Number: GI/PI/25-26/I02046\nProduct: Baby Squid Finger Laid 200/300\n\nBest regards,\nOscar García\nPESCADOS E.GUILLEM S.A.\nDpto. Compras', hasAttachment: true, attachments: ['PI_I02046.pdf'] }
    ]
  },
  {
    id: 'GI/PO/25-26/3038',
    poNumber: 'PO 3038',
    piNumber: 'GI/PI/25-26/I02047',
    company: 'PESCADOS E.GUILLEM',
    brand: 'EGUILLEM',
    product: 'Calamar Troceado',
    specs: '20/40 6X1 20% - RAUNAQ',
    from: 'India',
    to: 'Valencia, Spain',
    date: '4th Feb 2026',
    currentStage: 3,
    supplier: 'RAUNAQ',
    history: [
      { stage: 1, timestamp: '2026-01-28T10:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'RAUNAQ Supplier', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3038', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached the Purchase Order for Calamar Troceado 20/40 6X1 20%.\n\nPO Number: GI/PO/25-26/3038\nProduct: Calamar Troceado\nQuantity: As per attached PO\nDelivery: As per schedule\n\nKindly confirm receipt and send PI at the earliest.\n\nThanking you,\nBest regards,\n\nSANTOSH LAXMAN SATOPE\nGanesh International\nOffice no. 226, 2nd Floor, Arun Chambers\nTardeo Road, Mumbai 400034', hasAttachment: true, attachments: ['PO_3038.pdf'] },
      { stage: 2, timestamp: '2026-01-30T14:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: NEW PURCHASE ORDER - PI GI/PI/25-26/I02047 - PO 3038', body: 'Dear Sumehr,\n\nPlease find attached the Proforma Invoice for your order.\n\nPI Number: GI/PI/25-26/I02047\nReference: PO 3038\nProduct: Calamar Troceado 20/40 6X1 20%\n\nPlease confirm and proceed with artwork submission.\n\nBest regards,\nOscar García\nPESCADOS E.GUILLEM S.A.\nDpto. Compras', hasAttachment: true, attachments: ['PI_I02047.pdf'] },
      { stage: 3, timestamp: '2026-02-04T17:15:00Z', from: '"Mª Carmen Martínez" <calidad@eguillem.com>', to: '"Ganesh International" <ganeshintnlmumbai@gmail.com>', subject: 'RE: NEED ARTWORK APPROVAL - PI GI/PI/25-26/I02047 - PO 3038 - RAUNAQ', body: 'Dear Santosh,\n\nThe artworks of EGUILLEM BRAND are OK.\n\nREMINDER: send us artworks of OLIVER BRAND and BAUTISMAR BRAND with changes to recheck before printing.\n\nBest regards.\n\nMª Carmen Martínez\nDpto. Calidad\nwww.eguillem.com\nT 961 218 844\nF 961 218 888\nE-MAIL: calidad@eguillem.com\n\nEste correo electrónico procede de PESCADOS E.GUILLEM S.A.', hasAttachment: false }
    ]
  },
  {
    id: 'GI/PO/25-26/3035',
    poNumber: 'PO 3035',
    piNumber: 'GI/PI/25-26/I02044',
    company: 'PESCADOS E.GUILLEM',
    brand: 'MORALES',
    product: 'Frozen Squid Whole',
    specs: '100/UP - RAUNAQ',
    from: 'India',
    to: 'Valencia, Spain',
    date: '4th Feb 2026',
    currentStage: 3,
    supplier: 'RAUNAQ',
    history: [
      { stage: 1, timestamp: '2026-01-25T09:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'RAUNAQ', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3035', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached Purchase Order for Frozen Squid Whole 100/UP.\n\nPO Number: GI/PO/25-26/3035\n\nKindly confirm.\n\nThanking you,\nBest regards,\nSANTOSH LAXMAN SATOPE\nGanesh International', hasAttachment: true, attachments: ['PO_3035.pdf'] },
      { stage: 2, timestamp: '2026-01-27T11:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: NEW PURCHASE ORDER - PI GI/PI/25-26/I02044 - PO 3035', body: 'Dear Sumehr,\n\nPlease find attached the Proforma Invoice.\n\nPI Number: GI/PI/25-26/I02044\nReference: PO 3035\n\nBest regards,\nOscar García\nPESCADOS E.GUILLEM S.A.', hasAttachment: true, attachments: ['PI_I02044.pdf'] },
      { stage: 3, timestamp: '2026-02-04T16:22:00Z', from: '"Mª Carmen Martínez" <calidad@eguillem.com>', to: '"Ganesh International" <ganeshintnlmumbai@gmail.com>', subject: 'RE: NEED ARTWORK APPROVAL - PI- GI/PI/25-26/I02044 - PO 3035 - RAUNAQ', body: 'Dear Santosh,\n\nThe artworks are OK.\n\nBest regards.\n\nMª Carmen Martínez\nDpto. Calidad\nwww.eguillem.com\nT 961 218 844\nF 961 218 888\nE-MAIL: calidad@eguillem.com', hasAttachment: false }
    ]
  },
  {
    id: 'GI/PO/25-26/3026',
    poNumber: 'PO 3026',
    company: 'PESCADOS E.GUILLEM',
    product: 'Squid Whole IQF',
    specs: 'Invoice 3000250117',
    from: 'Cochin, India',
    to: 'Spain',
    date: '3rd Feb 2026',
    currentStage: 8,
    supplier: 'Nila Exports',
    awbNumber: null,
    history: [
      { stage: 1, timestamp: '2026-01-10T08:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'Nila Exports', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3026', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached PO for Squid Whole IQF.\n\nPO Number: GI/PO/25-26/3026\n\nKindly confirm.\n\nThanking you,\nBest regards,\nSANTOSH LAXMAN SATOPE\nGanesh International', hasAttachment: true, attachments: ['PO_3026.pdf'] },
      { stage: 2, timestamp: '2026-01-12T10:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'RE: PO GI/PO/25-26/3026 - Proforma Invoice', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached Proforma Invoice for your order.\n\nInvoice No: 3000250117\nReference: PO GI/PO/25-26/3026\n\nKindly confirm and proceed.\n\nThanking you,\nNila Exports\nNila Seafoods Pvt Ltd', hasAttachment: true, attachments: ['PI_3000250117.pdf'] },
      { stage: 3, timestamp: '2026-01-15T14:00:00Z', from: '"Mª Carmen Martínez" <calidad@eguillem.com>', to: 'Ganesh International', subject: 'RE: ARTWORK APPROVAL - PO 3026', body: 'Dear Santosh,\n\nThe artworks are OK.\n\nBest regards.\n\nMª Carmen Martínez\nDpto. Calidad', hasAttachment: false },
      { stage: 4, timestamp: '2026-01-18T09:00:00Z', from: 'Hansel Fernandez <hanselfernandez@hotmail.com>', to: 'Ganesh International, Nila Exports', subject: 'INSPECTION REPORT - PO 3026 - Invoice 3000250117', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached the inspection photos and report for:\n\nPO: GI/PO/25-26/3026\nInvoice: 3000250117\nProduct: Squid Whole IQF\n\nInspection Result: APPROVED\n\nAll parameters within acceptable limits. Quality approved for shipment.\n\nBest regards,\nHansel Fernandez\nQC Inspector', hasAttachment: true, attachments: ['Inspection_Report_3026.pdf', 'Photos_3026.zip'] },
      { stage: 5, timestamp: '2026-01-22T11:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'VESSEL SCHEDULE == GI/PO/25-26/3026 == SHIPMENT DETAILS', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPlease find below vessel schedule details:\n\nVessel: MSC ROSA M\nVoyage: 123N\nETD Cochin: 25-JAN-2026\nETA Valencia: 10-FEB-2026\n\nContainer: MSCU1234567\nSeal: AB123456\n\nKindly confirm.\n\nThanking you,\nNila Exports', hasAttachment: false },
      { stage: 6, timestamp: '2026-01-28T15:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: DRAFT DOCUMENT == GI/PO/25-26/3026', body: 'Dear Sumehr,\n\nDocuments OK.\n\nPlease proceed with final copies.\n\nBest regards,\nOscar García\nPESCADOS E.GUILLEM S.A.', hasAttachment: false },
      { stage: 7, timestamp: '2026-01-31T10:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: '== DOCUMENT == GI/PO/25-26/3026 == FINAL COPIES', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached final documents:\n\n1. Bill of Lading - MEDUWP096292\n2. Commercial Invoice\n3. Packing List\n4. Certificate of Origin\n5. Health Certificate\n\nKindly check and confirm.\n\nThanking you,\nNila Exports', hasAttachment: true, attachments: ['BL_MEDUWP096292.pdf', 'Invoice_3000250117.pdf', 'PackingList.pdf', 'COO.pdf', 'HealthCert.pdf'] },
      { stage: 8, timestamp: '2026-02-03T18:08:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: '"Ganesh International" <ganeshintnlmumbai@gmail.com>', subject: 'RE: PESCADOS 04tH CONTAINER INS PHOTOS AND REPORT == 3000250117 == SHIPMENT DETAILS == GI/PO/25-26/3026 == DRAFT DOCUMENT = DOCUMENT == DHL DETAILS == TELEX RELEASE', body: 'Dear Sir/Madam,\n\nGood day!\n\nPlease find below the telex release message received from the liner for your reference.\n\n//QUOTE//\n\nGood day,\n\nWe confirmed, Telex Release for B/L MEDUWP096292 has been arranged.\n\nThe cargo can be released at destination port without presentation of original Bill of Lading.\n\n//UNQUOTE//\n\nThis is for your kind information.\n\nThanking you,\nBest regards,\nNila Exports\nNila Seafoods Pvt Ltd', hasAttachment: true, attachments: ['TelexRelease_MEDUWP096292.pdf'] }
    ]
  },
  {
    id: 'GI/PO/25-26/3027',
    poNumber: 'PO 3027',
    company: 'PESCADOS E.GUILLEM',
    product: 'Vannamei PUD Blanched',
    specs: '31/40 - 6340 Kgs',
    from: 'India',
    to: 'Spain',
    date: '2nd Feb 2026',
    currentStage: 8,
    supplier: 'Nila Exports',
    awbNumber: '1016613850',
    history: [
      { stage: 1, timestamp: '2026-01-08T07:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'Nila Exports', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3027', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached PO for Vannamei PUD Blanched 31/40.\n\nPO Number: GI/PO/25-26/3027\nQuantity: 6340 Kgs\n\nKindly confirm.\n\nThanking you,\nBest regards,\nSANTOSH LAXMAN SATOPE', hasAttachment: true, attachments: ['PO_3027.pdf'] },
      { stage: 2, timestamp: '2026-01-10T09:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'RE: PO 3027 - Proforma Invoice', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPI attached for your reference.\n\nInvoice No: 3000250122\n\nThanking you,\nNila Exports', hasAttachment: true, attachments: ['PI_3000250122.pdf'] },
      { stage: 3, timestamp: '2026-01-13T12:00:00Z', from: '"Mª Carmen Martínez" <calidad@eguillem.com>', to: 'Ganesh International', subject: 'RE: ARTWORK - PO 3027', body: 'Dear Santosh,\n\nArtworks are OK.\n\nBest regards.\nMª Carmen Martínez\nDpto. Calidad', hasAttachment: false },
      { stage: 4, timestamp: '2026-01-16T08:00:00Z', from: 'J B Boda <jbbvrl@jbbodamail.com>', to: 'Ganesh International, Nila Exports', subject: 'INSPECTION REPORT - PO 3027 - Invoice 3000250122', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached inspection report and photos.\n\nPO: GI/PO/25-26/3027\nProduct: Vannamei PUD Blanched 31/40\nQuantity: 6340 Kgs\n\nInspection Result: PASSED\n\nAll quality parameters satisfactory.\n\nBest regards,\nJ B Boda & Co\nMarine Surveyors & Loss Assessors', hasAttachment: true, attachments: ['JBBoda_Report_3027.pdf', 'Inspection_Photos.zip'] },
      { stage: 5, timestamp: '2026-01-20T14:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'VESSEL SCHEDULE == PO 3027 == SHIPMENT DETAILS', body: 'Dear Sir/Madam,\n\nVessel booking confirmed.\n\nVessel: MAERSK SELETAR\nVoyage: 205E\nETD: 23-JAN-2026\nETA: 08-FEB-2026\n\nThanking you,\nNila Exports', hasAttachment: false },
      { stage: 6, timestamp: '2026-01-25T16:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: DRAFT DOCUMENT == PO 3027', body: 'Dear Sumehr,\n\nDocuments OK.\n\nBest regards,\nOscar García', hasAttachment: false },
      { stage: 7, timestamp: '2026-01-29T10:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: '== DOCUMENT == PO 3027 == FINAL COPIES', body: 'Dear Sir/Madam,\n\nFinal documents attached.\n\n1. Bill of Lading\n2. Commercial Invoice\n3. Packing List\n\nThanking you,\nNila Exports', hasAttachment: true, attachments: ['BL_3027.pdf', 'Invoice_3027.pdf', 'PL_3027.pdf'] },
      { stage: 8, timestamp: '2026-02-02T18:25:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: '"Ganesh International" <ganeshintnlmumbai@gmail.com>', subject: 'RE: NEW PURCHASE ORDER - PO GI/PO/25-26/3027 - PO 3027 == VESSEL SCHEDULE == SHIPMENT DTAILS == 3000250122 == DRAFT DOCUMENT == DOCUMENT == DHL DETAILS', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPlease find below DHL courier AWB details:\n\nDIRECT TO BUYER: 1016613850\nDate: 31.01.2026\n\nDocuments sent:\n- Original Bill of Lading (3 sets)\n- Commercial Invoice\n- Packing List\n- Certificate of Origin\n- Health Certificate\n\nThis is for your kind information.\n\nThanking you,\nBest regards,\nNila Exports\nNila Seafoods Pvt Ltd', hasAttachment: true, attachments: ['DHL_Receipt_1016613850.pdf'] }
    ]
  },
  {
    id: 'GI/PO/25-26/3034',
    poNumber: 'PO 3034',
    piNumber: 'GI/PI/25-26/I02043',
    company: 'PESCADOS E.GUILLEM',
    brand: 'MORALES',
    product: 'Calamar Troceado',
    specs: 'Printed bag - JJ SEAFOOD',
    from: 'India',
    to: 'Spain',
    date: '3rd Feb 2026',
    currentStage: 2,
    supplier: 'JJ SEAFOOD',
    history: [
      { stage: 1, timestamp: '2026-01-30T08:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'JJ SEAFOOD', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3034', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached PO for Calamar Troceado printed bag.\n\nPO Number: GI/PO/25-26/3034\n\nKindly confirm.\n\nThanking you,\nBest regards,\nSANTOSH LAXMAN SATOPE\nGanesh International', hasAttachment: true, attachments: ['PO_3034.pdf'] },
      { stage: 2, timestamp: '2026-02-01T10:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: PO 3034 - CALAMAR TROCEADO - PI GI/PI/25-26/I02043', body: 'Dear Sumehr,\n\nCALAMAR TROCEADO is with printed bag, not with rider.\n\nPlease find PI attached.\n\nPI Number: GI/PI/25-26/I02043\n\nBest regards,\nOscar García\nPESCADOS E.GUILLEM S.A.\nDpto. Compras', hasAttachment: true, attachments: ['PI_I02043.pdf'] }
    ]
  },
  {
    id: 'GI/PO/25-26/3029',
    poNumber: 'PO 3029',
    company: 'PESCADOS E.GUILLEM',
    product: 'Squid Whole IQF',
    specs: '6th Container',
    from: 'India',
    to: 'Spain',
    date: '1st Feb 2026',
    currentStage: 6,
    supplier: 'Nila Exports',
    history: [
      { stage: 1, timestamp: '2026-01-15T08:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'Nila Exports', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3029', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPO attached for 6th container.\n\nPO Number: GI/PO/25-26/3029\n\nThanking you,\nSANTOSH LAXMAN SATOPE', hasAttachment: true, attachments: ['PO_3029.pdf'] },
      { stage: 2, timestamp: '2026-01-17T10:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'RE: PO 3029 - PI 3000250120', body: 'Dear Sir/Madam,\n\nPI attached.\n\nInvoice No: 3000250120\n\nThanking you,\nNila Exports', hasAttachment: true, attachments: ['PI_3000250120.pdf'] },
      { stage: 3, timestamp: '2026-01-19T14:00:00Z', from: '"Mª Carmen Martínez" <calidad@eguillem.com>', to: 'Ganesh International', subject: 'RE: ARTWORK - PO 3029', body: 'Dear Santosh,\n\nArtworks OK.\n\nBest regards.\nMª Carmen Martínez', hasAttachment: false },
      { stage: 4, timestamp: '2026-01-22T09:00:00Z', from: 'Hansel Fernandez <hanselfernandez@hotmail.com>', to: 'Ganesh International', subject: 'INSPECTION REPORT - PO 3029', body: 'Dear Sir,\n\nInspection completed. APPROVED.\n\nBest regards,\nHansel Fernandez\nQC Inspector', hasAttachment: true, attachments: ['QC_Report_3029.pdf'] },
      { stage: 5, timestamp: '2026-01-25T11:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'VESSEL SCHEDULE == PO 3029', body: 'Dear Sir/Madam,\n\nVessel booking confirmed.\n\nVessel: MSC ANNA\nETD: 28-JAN-2026\nETA: 12-FEB-2026\n\nThanking you,\nNila Exports', hasAttachment: false },
      { stage: 6, timestamp: '2026-02-01T15:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: DRAFT DOCUMENT == GI/PO/25-26/3029', body: 'Dear Sumehr,\n\nDraft documents received and reviewed.\n\nDOCUMENTS OK.\n\nPlease proceed with final copies.\n\nBest regards,\nOscar García\nPESCADOS E.GUILLEM S.A.', hasAttachment: false }
    ]
  },
  {
    id: 'GI/PO/25-26/3028',
    poNumber: 'PO 3028',
    company: 'PESCADOS E.GUILLEM',
    product: 'Vannamei HLSO',
    specs: '16/20 - 5500 Kgs',
    from: 'India',
    to: 'Spain',
    date: '31st Jan 2026',
    currentStage: 7,
    supplier: 'Nila Exports',
    history: [
      { stage: 1, timestamp: '2026-01-10T08:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'Nila Exports', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3028', body: 'Dear Sir/Madam,\n\nPO for Vannamei HLSO 16/20.\n\nPO Number: GI/PO/25-26/3028\nQuantity: 5500 Kgs\n\nThanking you,\nSANTOSH LAXMAN SATOPE', hasAttachment: true, attachments: ['PO_3028.pdf'] },
      { stage: 2, timestamp: '2026-01-12T10:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'RE: PO 3028 - PI 3000250118', body: 'Dear Sir/Madam,\n\nPI attached.\n\nThanking you,\nNila Exports', hasAttachment: true, attachments: ['PI_3000250118.pdf'] },
      { stage: 3, timestamp: '2026-01-14T14:00:00Z', from: '"Mª Carmen Martínez" <calidad@eguillem.com>', to: 'Ganesh International', subject: 'RE: ARTWORK - PO 3028', body: 'Artworks OK.\n\nMª Carmen Martínez', hasAttachment: false },
      { stage: 4, timestamp: '2026-01-17T09:00:00Z', from: 'J B Boda <jbbvrl@jbbodamail.com>', to: 'Ganesh International', subject: 'QC REPORT - PO 3028', body: 'Dear Sir,\n\nInspection PASSED. Report attached.\n\nJ B Boda & Co', hasAttachment: true, attachments: ['JBBoda_3028.pdf'] },
      { stage: 5, timestamp: '2026-01-20T11:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: 'Ganesh International', subject: 'VESSEL SCHEDULE == PO 3028', body: 'Vessel confirmed.\n\nVessel: MAERSK SELETAR\nETD: 23-JAN-2026\n\nNila Exports', hasAttachment: false },
      { stage: 6, timestamp: '2026-01-26T15:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: DRAFT DOCUMENT == PO 3028', body: 'Documents OK.\n\nOscar García', hasAttachment: false },
      { stage: 7, timestamp: '2026-01-31T10:00:00Z', from: 'Nila Exports <nilaexport@nilaseafoods.com>', to: '"Ganesh International" <ganeshintnlmumbai@gmail.com>', subject: '== DOCUMENT == GI/PO/25-26/3028 == FINAL COPIES', body: 'Dear Sir/Madam,\n\nGood Day!\n\nPlease find attached final documents:\n\n1. Bill of Lading - MEDUWP096305\n2. Commercial Invoice\n3. Packing List\n4. Certificate of Origin\n5. Health Certificate\n\nKindly check and confirm.\n\nThanking you,\nNila Exports\nNila Seafoods Pvt Ltd', hasAttachment: true, attachments: ['BL_MEDUWP096305.pdf', 'Invoice_3028.pdf', 'PackingList_3028.pdf', 'COO_3028.pdf', 'HealthCert_3028.pdf'] }
    ]
  },
  {
    id: 'GI/PO/25-26/3015',
    poNumber: 'PO 3015',
    company: 'PESCADOS E.GUILLEM',
    product: 'Squid Rings',
    specs: '40/60 - Silver Sea',
    from: 'Porbandar, India',
    to: 'Spain',
    date: '15th Dec 2025',
    currentStage: 8,
    supplier: 'Silver Sea Foods',
    awbNumber: '1016612890',
    history: [
      { stage: 1, timestamp: '2025-11-20T08:00:00Z', from: 'Ganesh International <ganeshintnlmumbai@gmail.com>', to: 'Silver Sea Foods', subject: 'NEW PURCHASE ORDER - PO GI/PO/25-26/3015', body: 'Dear Sir,\n\nPO for Squid Rings 40/60.\n\nPO Number: GI/PO/25-26/3015\n\nThanking you,\nSANTOSH LAXMAN SATOPE', hasAttachment: true, attachments: ['PO_3015.pdf'] },
      { stage: 2, timestamp: '2025-11-22T10:00:00Z', from: 'Silver Sea Foods <silversea@gmail.com>', to: 'Ganesh International', subject: 'RE: PO 3015 - Proforma Invoice', body: 'Dear Sir,\n\nPI attached.\n\nSilver Sea Foods', hasAttachment: true, attachments: ['PI_3015.pdf'] },
      { stage: 3, timestamp: '2025-11-25T14:00:00Z', from: '"Mª Carmen Martínez" <calidad@eguillem.com>', to: 'Ganesh International', subject: 'RE: ARTWORK - PO 3015', body: 'Artworks OK.\n\nMª Carmen Martínez', hasAttachment: false },
      { stage: 4, timestamp: '2025-11-28T09:00:00Z', from: 'J B Boda Porbandar <jbbpor@jbbodamail.com>', to: 'Ganesh International', subject: 'INSPECTION REPORT - PO 3015 - J B BODA PORBANDAR', body: 'Dear Sir,\n\nGood day!\n\nPlease find attached QC report from J B Boda Porbandar office.\n\nProduct: Squid Rings 40/60\nInspection Result: APPROVED\n\nBest regards,\nJ B Boda & Co\nPorbandar Office', hasAttachment: true, attachments: ['JBBoda_Porbandar_3015.pdf', 'Inspection_Photos_3015.zip'] },
      { stage: 5, timestamp: '2025-12-01T11:00:00Z', from: 'Silver Sea Foods <silversea@gmail.com>', to: 'Ganesh International', subject: 'VESSEL SCHEDULE == PO 3015', body: 'Vessel confirmed.\n\nETD: 05-DEC-2025\nETA: 20-DEC-2025\n\nSilver Sea Foods', hasAttachment: false },
      { stage: 6, timestamp: '2025-12-08T15:00:00Z', from: '"Oscar | PESCADOS E.GUILLEM" <oscargarcia@eguillem.com>', to: 'Ganesh International', subject: 'RE: DRAFT DOCUMENT == PO 3015', body: 'Documents OK.\n\nOscar García', hasAttachment: false },
      { stage: 7, timestamp: '2025-12-12T10:00:00Z', from: 'Silver Sea Foods <silversea@gmail.com>', to: 'Ganesh International', subject: '== DOCUMENT == PO 3015 == FINAL COPIES', body: 'Final documents attached.\n\nSilver Sea Foods', hasAttachment: true, attachments: ['BL_3015.pdf', 'Invoice_3015.pdf', 'PL_3015.pdf'] },
      { stage: 8, timestamp: '2025-12-15T17:00:00Z', from: 'Silver Sea Foods <silversea@gmail.com>', to: '"Ganesh International" <ganeshintnlmumbai@gmail.com>', subject: 'DHL DETAILS == PO 3015 == AWB 1016612890', body: 'Dear Sir,\n\nGood Day!\n\nDHL courier dispatched.\n\nAWB Number: 1016612890\nDate: 15-DEC-2025\n\nDocuments sent:\n- Original Bill of Lading (3 sets)\n- Commercial Invoice\n- Packing List\n- Certificate of Origin\n- Health Certificate\n\nThanking you,\nSilver Sea Foods', hasAttachment: true, attachments: ['DHL_Receipt_1016612890.pdf'] }
    ]
  }
];

// Product inquiries
export const productInquiries = [
  { product: 'Calamar Troceado 20/40', sizes: ['6X1 20% ESTRELLA POLAR - 10 tons'], total: '10 tons', from: 'PESCADOS E.GUILLEM', brand: 'ESTRELLA POLAR' },
  { product: 'Puntilla Lavada y Congelada', total: '8 tons', from: 'PESCADOS E.GUILLEM', brand: 'ESTRELLA POLAR' },
  { product: 'Squid Whole IQF', sizes: ['U/3 - 2900 Kgs @ 7.9 USD', '3/6 - 2160 Kgs @ 7.2 USD'], total: '6340 Kgs', from: 'Ocean Fresh GmbH' }
];
