-- Ganesh Order Tracker - Seed Data
-- Complete seed data for With The Tide organization

DO $$
DECLARE
  org_id uuid;
  nila_contact_id uuid;
  raunaq_contact_id uuid;
  silverstar_contact_id uuid;
  jj_contact_id uuid;
  order_uuid uuid;
BEGIN

  -- ============================================================================
  -- CREATE ORGANIZATION
  -- ============================================================================
  INSERT INTO organizations (name, slug)
  VALUES ('With The Tide', 'with-the-tide')
  RETURNING id INTO org_id;

  -- ============================================================================
  -- INSERT CONTACTS - INDIAN SUPPLIERS (31)
  -- ============================================================================
  INSERT INTO contacts (organization_id, email, name, company, role, initials, color, phone, notes, country)
  VALUES
  (org_id, 'info@silverseafoodindia.com', 'Dharmesh Jungi', 'Silver Star', 'Supplier', 'DJ', 'bg-slate-500', '9824498350', 'Generous, Chatty, Average Quality, Regular Business', 'India'),
  (org_id, 'krseafoods@gmail.com', 'Rajesh Chamadia', 'KR Seafoods', 'Supplier', 'RC', 'bg-blue-500', '9825221121', 'Whatsapp Only, Direct, Easier to negotiate on Phone, Average Quality Decent Price', 'India'),
  (org_id, 'arshaseafoods2017@gmail.com', 'Arif Adeni', 'Arsha', 'Supplier', 'AA', 'bg-green-500', '9884894229', 'Generous, Chatty, Negotiable, Good Quality, Good Price', 'India'),
  (org_id, 'davikpaul@gmail.com', 'David Paul', 'Premier', 'Supplier', 'DP', 'bg-indigo-500', '9847095621', 'Negotiable, Direct, Good Quality, Market Price', 'India'),
  (org_id, 'sheraz@abad.in', 'Sheraz Anwar', 'ABAD', 'Supplier', 'SA', 'bg-purple-500', '9846044411', 'Great to work with, Great Quality', 'India'),
  (org_id, 'rohitkhetalpar@gmail.com', 'Rohit Khetalpar', 'Raunaq/JJ', 'Supplier', 'RK', 'bg-amber-500', '9879580340', 'Direct, Great Quality, High Price', 'India') RETURNING id INTO raunaq_contact_id,
  (org_id, 'imroz310@gmail.com', 'Imroz', 'Siddiq Seafoods', 'Supplier', 'IM', 'bg-teal-500', '8128896286', 'New Packer, Driven, Good Quality', 'India'),
  (org_id, 'ssintereu@gmail.com', 'Upendra Kumar', 'S.S. International', 'Supplier', 'UK', 'bg-cyan-500', '8511975602', 'New Packer Good Quality', 'India'),
  (org_id, 'capithan@capithansgroup.com', 'Peter Austin', 'Capithan', 'Supplier', 'PA', 'bg-rose-500', '9847183101', 'Good Person, Average Quality, Good Price', 'India'),
  (org_id, 'slsexportsindia@gmail.com', 'Hari', 'SLS', 'Supplier', 'HA', 'bg-emerald-500', '9447776046', 'Good Quality, Decent Guy', 'India'),
  (org_id, 'nelson@penverproducts.com', 'Nelson George', 'Penver', 'Supplier', 'NG', 'bg-violet-500', '9847330025', 'New Products', 'India'),
  (org_id, 'info@nilaseafoods.com', 'Selwin Prabhu', 'Nila', 'Supplier', 'SP', 'bg-green-600', '9894317420', 'Good Products', 'India') RETURNING id INTO nila_contact_id,
  (org_id, 'sunexports1156@gmail.com', 'Krishnakumar Nair', 'Sun Exports', 'Supplier', 'KN', 'bg-orange-500', '98460555290', 'Average Product, Good Price', 'India'),
  (org_id, 'deepmalafoods@hotmail.com', 'Varma', 'Deepmala', 'Supplier', 'VA', 'bg-red-500', '9227750200', 'Good Product, High Price, Direct', 'India'),
  (org_id, 'sales@castlerock.in', 'Bharat Mahtani', 'Castlerock', 'Supplier', 'BM', 'bg-gray-600', '9821033794', 'Average Product, Flaky, Good Price', 'India'),
  (org_id, 'vivek@kaykayexports.com', 'Vivek Vijayakumar', 'Kay Kay', 'Supplier', 'VV', 'bg-blue-600', '9995674477', 'Average Product', 'India'),
  (org_id, 'susanth@mangalagroup.com', 'Susant Mangala', 'Mangala', 'Supplier', 'SM', 'bg-indigo-600', '9846022888', 'Good Product, High Price, Doesn''t offer to Italy', 'India'),
  (org_id, 'vanita1995@gmail.com', 'Nitin', 'Vanita', 'Supplier', 'NI', 'bg-pink-500', '9824844413', 'Average Product, High Price', 'India'),
  (org_id, 'jinnymarine@gmail.com', 'Kenny Thomas', 'Jinny Marine', 'Supplier', 'KT', 'bg-teal-600', '9825221981', 'Good Product, Chatty, Good price, Doesn''t offer to Italy', 'India'),
  (org_id, 'shakeel@abad.in', 'Shakeel', 'CAP Seafood', 'Supplier', 'SH', 'bg-purple-600', '9846052355', 'Good Product, Average Price', 'India'),
  (org_id, 'faheem@backwaterglobal.com', 'Faheem Puduserry', 'RF Exports', 'Supplier', 'FP', 'bg-cyan-600', '9526009990', 'New Packer', 'India'),
  (org_id, 'sales.ambarfrozenfoods@gmail.com', 'Mohin Hala', 'Ambar Frozen', 'Supplier', 'MH', 'bg-amber-600', '7802986606', 'New Packer', 'India'),
  (org_id, 'dhanani.frozenfoods@gmail.com', 'Altafbhai Dhanani', 'Dhanani', 'Supplier', 'AD', 'bg-lime-600', '9824287631', 'New Packer', 'India'),
  (org_id, 'info@jeelanimarine.com', 'Thanveer', 'Jeelani', 'Supplier', 'TH', 'bg-emerald-600', '7020817053', 'New Packer', 'India'),
  (org_id, 'realexportsvrl@gmail.com', 'Dhansukh Pitthar', 'Real Exports', 'Supplier', 'DP', 'bg-stone-500', '9898100901', 'Average Product', 'India'),
  (org_id, 'kingsndk@gmail.com', 'Achu John', 'Kings Seafood', 'Supplier', 'AJ', 'bg-red-600', '9995411117', 'Terrible to work with', 'India'),
  (org_id, 'bdm@profandvayalat.in', 'Venugopalan', 'Profand Vayalat', 'Supplier', 'VE', 'bg-sky-500', '9388616765', 'Okay Quality, New packer', 'India'),
  (org_id, 'jiju@forstarfoods.com', 'Jiju Nair', 'Forstar', 'Supplier', 'JN', 'bg-fuchsia-500', '9821216619', 'Snake, Average Product', 'India') RETURNING id INTO jj_contact_id,
  (org_id, 'saletseafoods@saletgroup.com', 'Sumit Salet', 'Salet', 'Supplier', 'SS', 'bg-blue-700', '9825234233', 'Average Quality Good guy', 'India'),
  (org_id, 'naikocean@gmail.com', 'Zoya Naik', 'Naik', 'Supplier', 'ZN', 'bg-rose-600', '9821211444', 'Good Quality Good Person', 'India'),
  (org_id, 'subbusan2002@gmail.com', 'Krishna Menan', 'Subu Seafoods', 'Supplier', 'KM', 'bg-violet-600', '8296772550', 'New Supplier', 'India');

  -- ============================================================================
  -- INSERT CONTACTS - CHINESE SUPPLIERS (9)
  -- ============================================================================
  INSERT INTO contacts (organization_id, email, name, company, role, initials, color, phone, notes, country)
  VALUES
  (org_id, 'littleprincess1127@163.com', 'Yummy Liu', 'Hainan', 'Supplier', 'YL', 'bg-red-500', '8613118927688', 'Regular Supplier', 'China'),
  (org_id, 'sales1@fs-food.com', 'Natalie Li', 'Fivestar', 'Supplier', 'NL', 'bg-yellow-600', '8613685450380', 'Regular Supplier, Average Prices', 'China'),
  (org_id, 'patty@jiatengfoods.cn', 'Patty Sun', 'Jiateng', 'Supplier', 'PS', 'bg-orange-600', '8615065080098', 'Regular Supplier, Good Prices', 'China'),
  (org_id, 'angel@hellofishs.com', 'Angel Geng', 'Dalian Hongsheng', 'Supplier', 'AG', 'bg-pink-600', '8613842878966', 'Regular Supplier, Flaky', 'China'),
  (org_id, 'dalianathena5@163.com', 'Tina Wang', 'Dalian Athena', 'Supplier', 'TW', 'bg-purple-700', '8615940917487', 'Medium Supplier, Good prices', 'China'),
  (org_id, 'liming@yonming-food.com', 'Becky', 'Dalian Yonming', 'Supplier', 'BE', 'bg-indigo-700', '8641183898517', 'Medium Supplier, Good prices', 'China'),
  (org_id, 'sales7@ocean-treasure.com', 'Filipe Espinosa', 'Ocean Treasure', 'Supplier', 'FE', 'bg-teal-700', '8618606131632', 'New Supplier', 'China'),
  (org_id, 'coco@makefood-international.com', 'Liu Yan', 'Makefood International', 'Supplier', 'LY', 'bg-cyan-700', '8618669701180', 'New Supplier', 'China'),
  (org_id, 'sherry@jindeseafood.com', 'Sherry Yang', 'Yantai Jinde Foodstuff', 'Supplier', 'SY', 'bg-emerald-700', '8613385353368', 'New Supplier, Squids', 'China');

  -- ============================================================================
  -- INSERT CONTACTS - BUYERS (14)
  -- ============================================================================
  INSERT INTO contacts (organization_id, email, name, company, role, initials, color, phone, notes, country)
  VALUES
  (org_id, 'oscar@eguillem.com', 'Oscar Garcia', 'Pescados E Guillem', 'Buyer', 'OG', 'bg-blue-500', '0034 687026678', 'Heavy negotiators, difficult client, moody', 'Spain'),
  (org_id, 'eguillem@eguillem.com', 'Salvador Olmos', 'Pescados E Guillem', 'Buyer', 'SO', 'bg-blue-600', '0034 687270900', 'Heavy negotiators, difficult client', 'Spain'),
  (org_id, 'mounir@eguillem.com', 'Mounir Hocine Bey', 'Pescados E Guillem', 'Buyer', 'MH', 'bg-blue-700', '0034 687021882', 'Heavy negotiators, easier to play, moody', 'Spain'),
  (org_id, 'pepe.alonso@seapeix.com', 'Pepe Alonso', 'Seapeix', 'Buyer', 'PA', 'bg-green-700', '0034 653671393', 'Very heavy negotiator', 'Spain'),
  (org_id, 'import@noriberica.com', 'Fransisco Alvarez', 'Noriberica', 'Buyer', 'FA', 'bg-purple-500', '0034 689682801', 'Erratic, Good to work with', 'Spain'),
  (org_id, 'noelia.urgal@mar-iberica.pt', 'Noelia Urgal', 'Mariberica', 'Buyer', 'NU', 'bg-rose-500', '0034 670756713', 'Erratic, lower prices', 'Portugal'),
  (org_id, 'martasoriano@dagustin.com', 'Marta Soriano', 'Dagustin', 'Buyer', 'MS', 'bg-amber-500', '0034 639619776', 'Old Buyer', 'Spain'),
  (org_id, 'joan@easyfish.net', 'Joan Gimbernat', 'Easy Fish', 'Buyer', 'JG', 'bg-teal-500', '0034 666977999', 'New buyer, Works with Jinny Marine Directly', 'Spain'),
  (org_id, 'sales@argyronisos.gr', 'Maria', 'Argyronisos', 'Buyer', 'MA', 'bg-cyan-500', '0030 6942841505', 'Small Buyer', 'Greece'),
  (org_id, 'frank@ruggieroseafood.com', 'Frank Ruggiero', 'Ruggiero Seafood', 'Buyer', 'FR', 'bg-red-700', '001 7327707121', 'Old Buyer', 'USA'),
  (org_id, 'ahernandez@compesca.com', 'Andres Garcia', 'Compesca', 'Buyer', 'AG', 'bg-indigo-500', '0034 678803044', 'New Buyer', 'Spain'),
  (org_id, 'hugoferreira@soguima.com', 'Hugo Ferreira', 'Soguima', 'Buyer', 'HF', 'bg-emerald-500', '00351 912544910', 'New Buyer', 'Portugal'),
  (org_id, 'giuseppe.depinto@fioritalgelo.com', 'Guiseppe Dal Pinto', 'Fiorital', 'Buyer', 'GD', 'bg-orange-700', '0039 3666134009', 'New Buyer', 'Italy'),
  (org_id, 'lucio@ferrittica.it', 'Lucio Ferrera', 'Ferrittica', 'Buyer', 'LF', 'bg-lime-500', '0039 3485812163', 'Old Buyer Dad''s Friend', 'Italy');

  -- ============================================================================
  -- INSERT CONTACTS - INTERNAL (4)
  -- ============================================================================
  INSERT INTO contacts (organization_id, email, name, company, role, initials, color, phone, notes, country)
  VALUES
  (org_id, 'ganeshintnlmumbai@gmail.com', 'Santosh Laxman Satope', 'With The Tide', 'Operations', 'SS', 'bg-orange-500', NULL, NULL, 'India'),
  (org_id, 'hanselfernandez@hotmail.com', 'Hansel Fernandez', 'Independent Inspector', 'QC Inspector', 'HF', 'bg-red-500', NULL, NULL, 'India'),
  (org_id, 'jbbvrl@jbbodamail.com', 'J B Boda Veraval', 'J B Boda Group', 'Marine Surveyors', 'JB', 'bg-teal-500', NULL, NULL, 'India'),
  (org_id, 'jbbpor@jbbodamail.com', 'J B Boda Porbandar', 'J B Boda Group', 'Marine Surveyors', 'JP', 'bg-teal-600', NULL, NULL, 'India');

  -- ============================================================================
  -- INSERT BUYER SETTINGS (12)
  -- ============================================================================
  INSERT INTO buyer_settings (organization_id, buyer_company, buyer_code, default_destination)
  VALUES
  (org_id, 'Pescados E Guillem', 'EG', 'Valencia, Spain'),
  (org_id, 'Seapeix', 'SP', 'Barcelona, Spain'),
  (org_id, 'Noriberica', 'NB', 'Portugal'),
  (org_id, 'Mariberica', 'MB', 'Portugal'),
  (org_id, 'Dagustin', 'DG', 'Spain'),
  (org_id, 'Easy Fish', 'EF', 'Spain'),
  (org_id, 'Argyronisos', 'AR', 'Greece'),
  (org_id, 'Ruggiero Seafood', 'RG', 'USA'),
  (org_id, 'Compesca', 'CP', 'Spain'),
  (org_id, 'Soguima', 'SG', 'Portugal'),
  (org_id, 'Fiorital', 'FI', 'Italy'),
  (org_id, 'Ferrittica', 'FE', 'Italy');

  -- ============================================================================
  -- INSERT PRODUCTS (8)
  -- ============================================================================
  INSERT INTO products (organization_id, name, category, specs, is_active)
  VALUES
  (org_id, 'Squid Whole IQF', 'squid', 'Multiple sizes', true),
  (org_id, 'Cuttlefish Whole Cleaned', 'cuttlefish', 'IQF', true),
  (org_id, 'Baby Squid', 'squid', 'Finger Laid', true),
  (org_id, 'Vannamei HLSO', 'shrimp', 'Various counts', true),
  (org_id, 'Vannamei PUD Blanched', 'shrimp', 'Various counts', true),
  (org_id, 'Squid Rings', 'squid', 'IQF', true),
  (org_id, 'Calamar Troceado', 'squid', 'Chopped Squid', true),
  (org_id, 'Seafood Skewers', 'mixed', 'Pincho varieties', true);

  -- ============================================================================
  -- INSERT ORDERS AND ORDER HISTORY
  -- ============================================================================

  -- ORDER 1: GI/PO/25-26/3043
  INSERT INTO orders (organization_id, order_id, po_number, company, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3043', 'PO 3043', 'Pescados E Guillem', 'Frozen Seafood', 'India', 'Spain', '2026-02-05', 1, 'Rohit Khetalpar')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES (order_uuid, 1, '2026-02-05 09:00:00+00', 'Rohit Khetalpar <rohit@vendor.com>', 'Ganesh International', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3043', true, ARRAY['PO_3043.pdf']);

  -- ORDER 2: GI/PO/25-26/3042
  INSERT INTO orders (organization_id, order_id, po_number, company, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3042', 'PO 3042', 'Pescados E Guillem', 'Squid Whole IQF', 'India', 'Spain', '2026-02-04', 2, 'Nila Exports')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-02-01 08:00:00+00', 'Ganesh International', 'Nila Exports', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3042 - PESCADOS 8TH CONTAINER', true, ARRAY['PO_3042.pdf']),
  (order_uuid, 2, '2026-02-04 10:30:00+00', 'Nila Exports', 'Ganesh International', 'RE: PO GI/PO/25-26/3042 - PESCADOS 8TH CONTAINER - Proforma Invoice', true, ARRAY['PI_3000250128.pdf']);

  -- ORDER 3: GI/PO/25-26/3039
  INSERT INTO orders (organization_id, order_id, po_number, pi_number, company, brand, product, from_location, to_location, order_date, current_stage, supplier, artwork_status)
  VALUES (org_id, 'GI/PO/25-26/3039', 'PO 3039', 'GI/PI/25-26/I02048', 'Pescados E Guillem', 'MORALES', 'Calamar Troceado', 'India', 'Spain', '2026-02-03', 3, 'JJ SEAFOODS', 'needs_correction')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-28 08:00:00+00', 'Ganesh International', 'JJ SEAFOODS', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3039', true, ARRAY['PO_3039.pdf']),
  (order_uuid, 2, '2026-01-30 11:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: PO 3039 - PI GI/PI/25-26/I02048', true, ARRAY['PI_I02048.pdf']),
  (order_uuid, 3, '2026-02-03 15:45:00+00', 'Mª Carmen Martínez', 'Ganesh International', 'RE: NEED ARTWORK APPROVAL - PI GI/PI/25-26/I02048 - PO 3039 - JJ SEAFOODS', false, NULL, 'artwork NEEDS CORRECTION');

  -- ORDER 4: GI/PO/25-26/3037
  INSERT INTO orders (organization_id, order_id, po_number, pi_number, company, brand, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3037', 'PO 3037', 'GI/PI/25-26/I02046', 'Pescados E Guillem', 'EGUILLEM', 'Baby Squid Finger Laid', 'India', 'Valencia, Spain', '2026-02-03', 2, 'RAUNAQ')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-29 09:00:00+00', 'Ganesh International', 'RAUNAQ', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3037 - Baby Squid Finger Laid', true, ARRAY['PO_3037.pdf']),
  (order_uuid, 2, '2026-02-01 14:30:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: PO 3037 - BABY SQUID FINGER LAID - PI GI/PI/25-26/I02046', true, ARRAY['PI_I02046.pdf']);

  -- ORDER 5: GI/PO/25-26/3038
  INSERT INTO orders (organization_id, order_id, po_number, pi_number, company, brand, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3038', 'PO 3038', 'GI/PI/25-26/I02047', 'Pescados E Guillem', 'EGUILLEM', 'Calamar Troceado', 'India', 'Valencia, Spain', '2026-02-04', 3, 'RAUNAQ')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-28 10:00:00+00', 'Ganesh International', 'RAUNAQ Supplier', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3038', true, ARRAY['PO_3038.pdf']),
  (order_uuid, 2, '2026-01-30 14:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: NEW PURCHASE ORDER - PI GI/PI/25-26/I02047 - PO 3038', true, ARRAY['PI_I02047.pdf']),
  (order_uuid, 3, '2026-02-04 17:15:00+00', 'Mª Carmen Martínez', 'Ganesh International', 'RE: NEED ARTWORK APPROVAL - PI GI/PI/25-26/I02047 - PO 3038 - RAUNAQ', false, NULL, 'artworks are OK');

  -- ORDER 6: GI/PO/25-26/3035
  INSERT INTO orders (organization_id, order_id, po_number, pi_number, company, brand, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3035', 'PO 3035', 'GI/PI/25-26/I02044', 'Pescados E Guillem', 'MORALES', 'Frozen Squid Whole', 'India', 'Valencia, Spain', '2026-02-04', 3, 'RAUNAQ')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-25 09:00:00+00', 'Ganesh International', 'RAUNAQ', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3035', true, ARRAY['PO_3035.pdf']),
  (order_uuid, 2, '2026-01-27 11:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: NEW PURCHASE ORDER - PI GI/PI/25-26/I02044 - PO 3035', true, ARRAY['PI_I02044.pdf']),
  (order_uuid, 3, '2026-02-04 16:22:00+00', 'Mª Carmen Martínez', 'Ganesh International', 'RE: NEED ARTWORK APPROVAL - PI- GI/PI/25-26/I02044 - PO 3035 - RAUNAQ', false, NULL, 'artworks are OK');

  -- ORDER 7: GI/PO/25-26/3026
  INSERT INTO orders (organization_id, order_id, po_number, company, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3026', 'PO 3026', 'Pescados E Guillem', 'Squid Whole IQF', 'Cochin, India', 'Spain', '2026-02-03', 8, 'Nila Exports')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-10 08:00:00+00', 'Ganesh International', 'Nila Exports', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3026', true, ARRAY['PO_3026.pdf']),
  (order_uuid, 2, '2026-01-12 10:00:00+00', 'Nila Exports', 'Ganesh International', 'RE: PO GI/PO/25-26/3026 - Proforma Invoice', true, ARRAY['PI_3000250117.pdf']),
  (order_uuid, 3, '2026-01-15 14:00:00+00', 'Ganesh International', 'PESCADOS E.GUILLEM', 'RE: ARTWORK APPROVAL - PO 3026', false, NULL),
  (order_uuid, 4, '2026-01-18 09:00:00+00', 'Hansel Fernandez', 'Ganesh International', 'INSPECTION REPORT - PO 3026 - Invoice 3000250117', true, ARRAY['Inspection_Report_3026.pdf', 'Photos_3026.zip'], 'APPROVED'),
  (order_uuid, 5, '2026-01-22 11:00:00+00', 'Ganesh International', 'All Parties', 'VESSEL SCHEDULE == GI/PO/25-26/3026', false, NULL, 'Vessel MSC ROSA M Voyage 123N ETD 25-JAN-2026 ETA 10-FEB-2026'),
  (order_uuid, 6, '2026-01-28 15:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: DRAFT DOCUMENT == GI/PO/25-26/3026', false, NULL, 'Documents OK'),
  (order_uuid, 7, '2026-01-31 10:00:00+00', 'Ganesh International', 'All Parties', '== DOCUMENT == GI/PO/25-26/3026 == FINAL COPIES', true, ARRAY['BL_MEDUWP096292.pdf', 'Invoice_3000250117.pdf', 'PackingList.pdf', 'COO.pdf', 'HealthCert.pdf']),
  (order_uuid, 8, '2026-02-03 18:08:00+00', 'Ganesh International', 'All Parties', 'RE: PESCADOS 04tH CONTAINER', true, ARRAY['TelexRelease_MEDUWP096292.pdf'], 'Telex Release confirmed');

  -- ORDER 8: GI/PO/25-26/3027
  INSERT INTO orders (organization_id, order_id, po_number, company, product, from_location, to_location, order_date, current_stage, supplier, awb_number)
  VALUES (org_id, 'GI/PO/25-26/3027', 'PO 3027', 'Pescados E Guillem', 'Vannamei PUD Blanched', 'India', 'Spain', '2026-02-02', 8, 'Nila Exports', '1016613850')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-08 07:00:00+00', 'Ganesh International', 'Nila Exports', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3027', true, ARRAY['PO_3027.pdf']),
  (order_uuid, 2, '2026-01-10 09:00:00+00', 'Nila Exports', 'Ganesh International', 'RE: PO 3027 - Proforma Invoice', true, ARRAY['PI_3000250122.pdf']),
  (order_uuid, 3, '2026-01-13 12:00:00+00', 'Ganesh International', 'Nila Exports', 'RE: ARTWORK - PO 3027', false, NULL, 'Artworks OK'),
  (order_uuid, 4, '2026-01-16 08:00:00+00', 'J B Boda', 'Ganesh International', 'INSPECTION REPORT - PO 3027', true, ARRAY['JBBoda_Report_3027.pdf', 'Inspection_Photos.zip'], 'PASSED'),
  (order_uuid, 5, '2026-01-20 14:00:00+00', 'Ganesh International', 'All Parties', 'VESSEL SCHEDULE == PO 3027', false, NULL, 'Vessel MAERSK SELETAR Voyage 205E'),
  (order_uuid, 6, '2026-01-25 16:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: DRAFT DOCUMENT == PO 3027', false, NULL, 'Documents OK'),
  (order_uuid, 7, '2026-01-29 10:00:00+00', 'Ganesh International', 'All Parties', '== DOCUMENT == PO 3027 == FINAL COPIES', true, ARRAY['BL_3027.pdf', 'Invoice_3027.pdf', 'PL_3027.pdf']),
  (order_uuid, 8, '2026-02-02 18:25:00+00', 'Ganesh International', 'All Parties', 'DHL AWB: 1016613850', true, ARRAY['DHL_Receipt_1016613850.pdf']);

  -- ORDER 9: GI/PO/25-26/3034
  INSERT INTO orders (organization_id, order_id, po_number, pi_number, company, brand, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3034', 'PO 3034', 'GI/PI/25-26/I02043', 'Pescados E Guillem', 'MORALES', 'Calamar Troceado', 'India', 'Spain', '2026-02-03', 2, 'JJ SEAFOOD')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-30 08:00:00+00', 'Ganesh International', 'JJ SEAFOOD', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3034', true, ARRAY['PO_3034.pdf']),
  (order_uuid, 2, '2026-02-01 10:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: PO 3034 - CALAMAR TROCEADO - PI GI/PI/25-26/I02043', true, ARRAY['PI_I02043.pdf']);

  -- ORDER 10: GI/PO/25-26/3029
  INSERT INTO orders (organization_id, order_id, po_number, company, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3029', 'PO 3029', 'Pescados E Guillem', 'Squid Whole IQF', 'India', 'Spain', '2026-02-01', 6, 'Nila Exports')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-15 08:00:00+00', 'Ganesh International', 'Nila Exports', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3029', true, ARRAY['PO_3029.pdf']),
  (order_uuid, 2, '2026-01-17 10:00:00+00', 'Nila Exports', 'Ganesh International', 'RE: PO 3029 - PI 3000250120', true, ARRAY['PI_3000250120.pdf']),
  (order_uuid, 3, '2026-01-19 14:00:00+00', 'Ganesh International', 'Nila Exports', 'RE: ARTWORK - PO 3029', false, NULL, 'Artworks OK'),
  (order_uuid, 4, '2026-01-22 09:00:00+00', 'Hansel Fernandez', 'Ganesh International', 'INSPECTION REPORT - PO 3029', true, ARRAY['QC_Report_3029.pdf'], 'APPROVED'),
  (order_uuid, 5, '2026-01-25 11:00:00+00', 'Ganesh International', 'All Parties', 'VESSEL SCHEDULE == PO 3029', false, NULL, 'MSC ANNA ETD 28-JAN-2026 ETA 12-FEB-2026'),
  (order_uuid, 6, '2026-02-01 15:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: DRAFT DOCUMENT == GI/PO/25-26/3029', false, NULL, 'DOCUMENTS OK');

  -- ORDER 11: GI/PO/25-26/3028
  INSERT INTO orders (organization_id, order_id, po_number, company, product, from_location, to_location, order_date, current_stage, supplier)
  VALUES (org_id, 'GI/PO/25-26/3028', 'PO 3028', 'Pescados E Guillem', 'Vannamei HLSO', 'India', 'Spain', '2026-01-31', 7, 'Nila Exports')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2026-01-10 08:00:00+00', 'Ganesh International', 'Nila Exports', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3028', true, ARRAY['PO_3028.pdf']),
  (order_uuid, 2, '2026-01-12 10:00:00+00', 'Nila Exports', 'Ganesh International', 'RE: PO 3028 - PI 3000250118', true, ARRAY['PI_3000250118.pdf']),
  (order_uuid, 3, '2026-01-14 14:00:00+00', 'Ganesh International', 'Nila Exports', 'RE: ARTWORK - PO 3028', false, NULL, 'Artworks OK'),
  (order_uuid, 4, '2026-01-17 09:00:00+00', 'J B Boda', 'Ganesh International', 'QC REPORT - PO 3028', true, ARRAY['JBBoda_3028.pdf'], 'PASSED'),
  (order_uuid, 5, '2026-01-20 11:00:00+00', 'Ganesh International', 'All Parties', 'VESSEL SCHEDULE == PO 3028', false, NULL, 'MAERSK SELETAR ETD 23-JAN-2026'),
  (order_uuid, 6, '2026-01-26 15:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: DRAFT DOCUMENT == PO 3028', false, NULL, 'Documents OK'),
  (order_uuid, 7, '2026-01-31 10:00:00+00', 'Ganesh International', 'All Parties', '== DOCUMENT == GI/PO/25-26/3028 == FINAL COPIES', true, ARRAY['BL_MEDUWP096305.pdf', 'Invoice_3028.pdf', 'PackingList_3028.pdf', 'COO_3028.pdf', 'HealthCert_3028.pdf']);

  -- ORDER 12: GI/PO/25-26/3015
  INSERT INTO orders (organization_id, order_id, po_number, company, product, from_location, to_location, order_date, current_stage, supplier, awb_number)
  VALUES (org_id, 'GI/PO/25-26/3015', 'PO 3015', 'Pescados E Guillem', 'Squid Rings', 'Porbandar, India', 'Spain', '2025-12-15', 8, 'Silver Sea Foods', '1016612890')
  RETURNING id INTO order_uuid;

  INSERT INTO order_history (order_id, stage, timestamp, from_address, to_address, subject, has_attachment, attachments)
  VALUES
  (order_uuid, 1, '2025-11-20 08:00:00+00', 'Ganesh International', 'Silver Sea Foods', 'NEW PURCHASE ORDER - PO GI/PO/25-26/3015', true, ARRAY['PO_3015.pdf']),
  (order_uuid, 2, '2025-11-22 10:00:00+00', 'Silver Sea Foods', 'Ganesh International', 'RE: PO 3015 - Proforma Invoice', true, ARRAY['PI_3015.pdf']),
  (order_uuid, 3, '2025-11-25 14:00:00+00', 'Ganesh International', 'Silver Sea Foods', 'RE: ARTWORK - PO 3015', false, NULL, 'Artworks OK'),
  (order_uuid, 4, '2025-11-28 09:00:00+00', 'J B Boda Porbandar', 'Ganesh International', 'INSPECTION REPORT - PO 3015', true, ARRAY['JBBoda_Porbandar_3015.pdf', 'Inspection_Photos_3015.zip'], 'APPROVED'),
  (order_uuid, 5, '2025-12-01 11:00:00+00', 'Ganesh International', 'All Parties', 'VESSEL SCHEDULE == PO 3015', false, NULL, 'ETD 05-DEC-2025 ETA 20-DEC-2025'),
  (order_uuid, 6, '2025-12-08 15:00:00+00', 'Oscar | PESCADOS E.GUILLEM', 'Ganesh International', 'RE: DRAFT DOCUMENT == PO 3015', false, NULL, 'Documents OK'),
  (order_uuid, 7, '2025-12-12 10:00:00+00', 'Ganesh International', 'All Parties', '== DOCUMENT == PO 3015 == FINAL COPIES', true, ARRAY['BL_3015.pdf', 'Invoice_3015.pdf', 'PL_3015.pdf']),
  (order_uuid, 8, '2025-12-15 17:00:00+00', 'Ganesh International', 'All Parties', 'DHL DETAILS == PO 3015 == AWB 1016612890', true, ARRAY['DHL_Receipt_1016612890.pdf']);

  -- ============================================================================
  -- INSERT PRODUCT INQUIRIES (3)
  -- ============================================================================
  INSERT INTO product_inquiries (organization_id, product, sizes, total, from_company, brand, status)
  VALUES
  (org_id, 'Calamar Troceado 20/40', ARRAY['6X1 20% ESTRELLA POLAR - 10 tons'], '10 tons', 'Pescados E Guillem', 'ESTRELLA POLAR', 'open'),
  (org_id, 'Puntilla Lavada y Congelada', NULL, '8 tons', 'Pescados E Guillem', 'ESTRELLA POLAR', 'open'),
  (org_id, 'Squid Whole IQF', ARRAY['U/3 - 2900 Kgs @ 7.9 USD', '3/6 - 2160 Kgs @ 7.2 USD'], '6340 Kgs', 'Ocean Fresh GmbH', NULL, 'open');

END $$;
