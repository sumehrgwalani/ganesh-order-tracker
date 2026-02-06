import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Icon from './Icon';

// The contact fields users can map to
const CONTACT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'email', label: 'Email', required: true },
  { key: 'company', label: 'Company', required: false },
  { key: 'role', label: 'Role', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'address', label: 'Address', required: false },
  { key: 'country', label: 'Country', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const;

type FieldKey = typeof CONTACT_FIELDS[number]['key'];

// Common header names → our field keys
const HEADER_ALIASES: Record<string, FieldKey> = {
  name: 'name', 'full name': 'name', 'contact name': 'name', 'nombre': 'name',
  'first name': 'name', 'firstname': 'name',
  email: 'email', 'e-mail': 'email', 'email address': 'email', 'mail': 'email', 'correo': 'email',
  company: 'company', 'company name': 'company', 'organisation': 'company', 'organization': 'company', 'empresa': 'company', 'firm': 'company',
  role: 'role', 'type': 'role', 'category': 'role', 'position': 'role', 'title': 'role', 'job title': 'role',
  phone: 'phone', 'telephone': 'phone', 'tel': 'phone', 'mobile': 'phone', 'cell': 'phone', 'phone number': 'phone', 'telefono': 'phone',
  country: 'country', 'location': 'country', 'region': 'country', 'pais': 'country',
  notes: 'notes', 'note': 'notes', 'comments': 'notes', 'description': 'notes', 'remarks': 'notes', 'notas': 'notes',
  address: 'address', 'street': 'address', 'city': 'address', 'location address': 'address', 'direccion': 'address',
  surname: 'name', 'last name': 'name', 'lastname': 'name', // will be handled specially
};

// Keywords that identify a header row
const HEADER_KEYWORDS = ['first name', 'firstname', 'surname', 'last name', 'lastname', 'email', 'e-mail', 'phone', 'telephone', 'company', 'name'];

// Known country names for section detection
const KNOWN_COUNTRIES = [
  'india', 'china', 'vietnam', 'thailand', 'indonesia', 'spain', 'portugal', 'italy',
  'usa', 'greece', 'bangladesh', 'ecuador', 'pakistan', 'myanmar', 'sri lanka',
  'japan', 'korea', 'turkey', 'mexico', 'brazil', 'chile', 'argentina', 'peru',
  'morocco', 'senegal', 'mauritania', 'norway', 'iceland', 'denmark', 'sweden',
  'uk', 'united kingdom', 'france', 'germany', 'netherlands', 'belgium', 'canada',
  'australia', 'new zealand', 'south africa', 'egypt', 'oman', 'uae', 'saudi arabia',
  'philippines', 'taiwan', 'malaysia', 'singapore', 'russia', 'ukraine', 'poland',
];

interface MappedContact {
  name: string;
  email: string;
  company: string;
  role: string;
  phone: string;
  address: string;
  country: string;
  notes: string;
}

interface Props {
  existingEmails: Set<string>;
  onImport: (contacts: MappedContact[]) => Promise<{ inserted: number; updated: number }>;
  onClose: () => void;
}

type Step = 'upload' | 'mapping' | 'preview';

// Check if a row looks like a header row (contains multiple known header keywords)
function isHeaderRow(row: string[]): boolean {
  const normalized = row.map(c => String(c || '').toLowerCase().trim());
  const matchCount = normalized.filter(c => HEADER_KEYWORDS.some(kw => c === kw || c.includes(kw))).length;
  return matchCount >= 2;
}

// Check if a row is a country section header (single non-empty cell matching a known country)
function detectCountry(row: string[]): string | null {
  const nonEmpty = row.map(c => String(c || '').trim()).filter(c => c !== '' && c !== 'NaN' && c !== 'undefined');
  if (nonEmpty.length === 1) {
    const val = nonEmpty[0].toLowerCase();
    if (KNOWN_COUNTRIES.includes(val)) return nonEmpty[0];
  }
  return null;
}

// Build column index map from a header row
function buildColumnMap(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((cell, idx) => {
    const normalized = String(cell || '').toLowerCase().trim();
    if (normalized) map[normalized] = idx;
  });
  return map;
}

// Smart parse: detect multi-section files with country headers and repeated column headers
function smartParse(allRows: string[][]): { contacts: MappedContact[]; detected: boolean } {
  // Find all header rows
  const headerRowIndices: number[] = [];
  for (let i = 0; i < allRows.length; i++) {
    if (isHeaderRow(allRows[i])) headerRowIndices.push(i);
  }
  if (headerRowIndices.length === 0) return { contacts: [], detected: false };

  // For each header row, look backwards for a country label
  const sections: { headerIdx: number; country: string; colMap: Record<string, number> }[] = [];
  for (const hIdx of headerRowIndices) {
    let country = '';
    // Look up to 3 rows back for a country label
    for (let back = 1; back <= 3 && hIdx - back >= 0; back++) {
      const found = detectCountry(allRows[hIdx - back]);
      if (found) { country = found; break; }
    }
    sections.push({ headerIdx: hIdx, country, colMap: buildColumnMap(allRows[hIdx]) });
  }

  const contacts: MappedContact[] = [];

  for (let s = 0; s < sections.length; s++) {
    const { headerIdx, country, colMap } = sections[s];
    const nextHeaderIdx = s + 1 < sections.length ? sections[s + 1].headerIdx : allRows.length;

    // Find column indices for known fields
    const firstNameIdx = colMap['first name'] ?? colMap['firstname'] ?? -1;
    const surnameIdx = colMap['surname'] ?? colMap['last name'] ?? colMap['lastname'] ?? -1;
    const fullNameIdx = colMap['name'] ?? colMap['full name'] ?? colMap['contact name'] ?? -1;
    const emailIdx = colMap['email'] ?? colMap['e-mail'] ?? colMap['mail'] ?? -1;
    const companyIdx = colMap['company'] ?? colMap['company name'] ?? colMap['organisation'] ?? colMap['organization'] ?? -1;
    const phoneIdx = colMap['phone'] ?? colMap['telephone'] ?? colMap['tel'] ?? colMap['mobile'] ?? -1;
    const notesIdx = colMap['notes'] ?? colMap['note'] ?? colMap['comments'] ?? colMap['remarks'] ?? -1;
    const addressIdx = colMap['address'] ?? -1;
    const roleIdx = colMap['role'] ?? colMap['type'] ?? colMap['category'] ?? colMap['position'] ?? colMap['title'] ?? -1;
    const countryIdx = colMap['country'] ?? colMap['location'] ?? colMap['region'] ?? -1;

    // Parse data rows after this header until the next section
    for (let r = headerIdx + 1; r < nextHeaderIdx; r++) {
      const row = allRows[r];
      if (!row || row.every(c => !String(c || '').trim())) continue; // skip empty rows

      // Check if this row is a country label for the next section — skip it
      if (detectCountry(row)) continue;

      // Build name: combine first + surname, or use full name
      let name = '';
      if (firstNameIdx >= 0) {
        const first = String(row[firstNameIdx] || '').trim();
        const last = surnameIdx >= 0 ? String(row[surnameIdx] || '').trim() : '';
        name = [first, last].filter(Boolean).join(' ');
      } else if (fullNameIdx >= 0) {
        name = String(row[fullNameIdx] || '').trim();
      }

      const email = emailIdx >= 0 ? String(row[emailIdx] || '').trim() : '';
      const company = companyIdx >= 0 ? String(row[companyIdx] || '').trim() : '';
      const phone = phoneIdx >= 0 ? String(row[phoneIdx] || '').trim() : '';
      const role = roleIdx >= 0 ? String(row[roleIdx] || '').trim() : 'Supplier';
      const rowCountry = countryIdx >= 0 ? String(row[countryIdx] || '').trim() : country;

      const address = addressIdx >= 0 ? String(row[addressIdx] || '').trim() : '';
      const notes = notesIdx >= 0 ? String(row[notesIdx] || '').trim() : '';

      // Only include contacts with at least a name
      if (!name) continue;

      contacts.push({ name, email, company, role, phone, address, country: rowCountry, notes });
    }
  }

  return { contacts, detected: contacts.length > 0 };
}

type PreviewFilter = 'all' | 'new' | 'update' | 'skipped';

function ContactImportModal({ existingEmails, onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, FieldKey | 'skip'>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Smart-parsed contacts bypass the mapping step entirely
  const [smartContacts, setSmartContacts] = useState<MappedContact[] | null>(null);
  // Preview filter (clickable summary boxes)
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all');
  // Editable emails for skipped contacts (keyed by index in the skipped array)
  const [skippedEdits, setSkippedEdits] = useState<Record<number, string>>({});
  // "Import without email" toggles for skipped contacts (keyed by index)
  const [importWithoutEmail, setImportWithoutEmail] = useState<Record<number, boolean>>({});

  // Auto-detect mapping from header names
  const autoDetectMapping = (hdrs: string[]) => {
    const map: Record<string, FieldKey | 'skip'> = {};
    const usedFields = new Set<FieldKey>();
    for (const header of hdrs) {
      const normalized = header.toLowerCase().trim();
      const match = HEADER_ALIASES[normalized];
      if (match && !usedFields.has(match)) {
        map[header] = match;
        usedFields.add(match);
      } else {
        map[header] = 'skip';
      }
    }
    return map;
  };

  // Parse uploaded file
  const parseFile = useCallback((file: File) => {
    setError('');
    setFileName(file.name);
    setSmartContacts(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData: string[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

        if (jsonData.length < 2) {
          setError('File appears to be empty or has no data rows.');
          return;
        }

        // First, try smart parsing (multi-section files, non-standard headers)
        const allRows = jsonData.map(row => row.map(c => String(c ?? '').trim()));
        const smart = smartParse(allRows);

        if (smart.detected && smart.contacts.length > 0) {
          // Smart mode: skip mapping entirely, go straight to preview
          setSmartContacts(smart.contacts);
          // Set dummy headers/rows for the mapping fallback
          setHeaders(['Name', 'Email', 'Company', 'Phone', 'Address', 'Country', 'Notes']);
          setRows(smart.contacts.map(c => [c.name, c.email, c.company, c.phone, c.address, c.country, c.notes]));
          setMapping({ Name: 'name', Email: 'email', Company: 'company', Phone: 'phone', Address: 'address', Country: 'country', Notes: 'notes' });
          setStep('preview');
          return;
        }

        // Standard mode: first row is headers
        const hdrs = jsonData[0].map(h => String(h).trim()).filter(h => h !== '');
        const dataRows = jsonData.slice(1).filter(row => row.some(cell => String(cell).trim() !== ''));

        if (hdrs.length === 0) {
          setError('Could not find column headers in the first row.');
          return;
        }

        setHeaders(hdrs);
        setRows(dataRows.map(row => hdrs.map((_, i) => String(row[i] || '').trim())));
        const detectedMapping = autoDetectMapping(hdrs);
        setMapping(detectedMapping);
        const detectedFields = new Set(Object.values(detectedMapping).filter(v => v !== 'skip'));
        if (detectedFields.has('name') && detectedFields.has('email')) {
          setStep('preview');
        } else {
          setStep('mapping');
        }
      } catch (err) {
        setError('Could not read this file. Please check it is a valid CSV or Excel file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  // Get ALL contacts including incomplete ones
  const getAllContacts = (): { valid: MappedContact[]; skipped: MappedContact[] } => {
    let all: MappedContact[] = [];
    if (smartContacts) {
      all = smartContacts.filter(c => c.name);
    } else {
      const fieldIndices: Partial<Record<FieldKey, number>> = {};
      headers.forEach((header, idx) => {
        const field = mapping[header];
        if (field && field !== 'skip') fieldIndices[field] = idx;
      });
      all = rows.map(row => ({
        name: row[fieldIndices.name ?? -1] || '',
        email: row[fieldIndices.email ?? -1] || '',
        company: row[fieldIndices.company ?? -1] || '',
        role: row[fieldIndices.role ?? -1] || 'Supplier',
        phone: row[fieldIndices.phone ?? -1] || '',
        address: row[fieldIndices.address ?? -1] || '',
        country: row[fieldIndices.country ?? -1] || '',
        notes: row[fieldIndices.notes ?? -1] || '',
      })).filter(c => c.name.trim() !== '');
    }
    const valid = all.filter(c => c.email.trim() !== '' && c.email.includes('@'));
    const skipped = all.filter(c => !c.email.trim() || !c.email.includes('@'));
    return { valid, skipped };
  };

  const { valid: mappedContacts, skipped: skippedContacts } = step === 'preview' ? getAllContacts() : { valid: [], skipped: [] };

  // Generate a placeholder email for contacts imported without one
  const generatePlaceholder = (name: string, idx: number) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30);
    return `noemail.${slug}.${idx}@placeholder.local`;
  };

  // Apply skipped edits: contacts that the user has fixed with valid emails move to the import list
  const fixedFromSkipped = skippedContacts
    .map((c, idx) => ({ ...c, email: skippedEdits[idx] || c.email }))
    .filter((c, idx) => {
      const hasValidEmail = c.email.trim() !== '' && c.email.includes('@');
      return hasValidEmail && !importWithoutEmail[idx];
    });
  // Contacts flagged to import without email get a placeholder
  const importedWithoutEmail = skippedContacts
    .map((c, idx) => ({ ...c, email: generatePlaceholder(c.name, idx), _originalIdx: idx }))
    .filter((_, idx) => importWithoutEmail[idx]);
  const stillSkipped = skippedContacts.filter((_, idx) => {
    if (importWithoutEmail[idx]) return false; // not skipped, will be imported
    const edited = skippedEdits[idx];
    return !edited || !edited.trim() || !edited.includes('@');
  });
  const allImportable = [...mappedContacts, ...fixedFromSkipped, ...importedWithoutEmail];
  const newContacts = allImportable.filter(c => !existingEmails.has(c.email.toLowerCase()));
  const updateContacts = allImportable.filter(c => existingEmails.has(c.email.toLowerCase()));

  const nameIsMapped = Object.values(mapping).includes('name');
  const emailIsMapped = Object.values(mapping).includes('email');
  const canProceed = nameIsMapped && emailIsMapped;

  const handleImport = async () => {
    setImporting(true);
    setError('');
    try {
      const res = await onImport(allImportable);
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Import Contacts</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {step === 'upload' && 'Upload a CSV or Excel file'}
              {step === 'mapping' && `Map columns from ${fileName}`}
              {step === 'preview' && 'Review before importing'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <Icon name="X" size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 px-6 py-3 bg-gray-50 border-b border-gray-100">
          {['Upload', 'Map Columns', 'Preview & Import'].map((label, i) => {
            const stepNames: Step[] = ['upload', 'mapping', 'preview'];
            const isActive = step === stepNames[i];
            const isDone = stepNames.indexOf(step) > i;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className={`w-8 h-0.5 ${isDone ? 'bg-blue-500' : 'bg-gray-200'}`} />}
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
                  isActive ? 'bg-blue-100 text-blue-700' : isDone ? 'bg-green-100 text-green-700' : 'text-gray-400'
                }`}>
                  {isDone ? <Icon name="Check" size={14} /> : <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold" style={{ borderColor: 'currentColor' }}>{i + 1}</span>}
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
              <Icon name="AlertCircle" size={16} /> {error}
            </div>
          )}

          {/* ===== STEP 1: UPLOAD ===== */}
          {step === 'upload' && (
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
                dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="Upload" size={28} className="text-blue-600" />
              </div>
              <p className="text-lg font-medium text-gray-700 mb-1">
                {dragActive ? 'Drop your file here' : 'Drag & drop your file here'}
              </p>
              <p className="text-sm text-gray-500 mb-4">Supports .csv, .xlsx, and .xls files</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
              >
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {/* ===== STEP 2: COLUMN MAPPING ===== */}
          {step === 'mapping' && (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                We found <span className="font-semibold">{headers.length} columns</span> and <span className="font-semibold">{rows.length} rows</span> in your file.
                Map each column to a contact field below. Columns set to "Skip" will be ignored.
              </p>
              <div className="space-y-3">
                {headers.map(header => {
                  const currentMapping = mapping[header] || 'skip';
                  const sampleValues = rows.slice(0, 3).map(r => r[headers.indexOf(header)]).filter(v => v).join(', ');
                  return (
                    <div key={header} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{header}</p>
                        <p className="text-xs text-gray-400 truncate">e.g. {sampleValues || '(empty)'}</p>
                      </div>
                      <Icon name="ArrowRight" size={16} className="text-gray-300 flex-shrink-0" />
                      <select
                        value={currentMapping}
                        onChange={(e) => setMapping({ ...mapping, [header]: e.target.value as FieldKey | 'skip' })}
                        className={`w-40 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 ${
                          currentMapping === 'skip' ? 'border-gray-200 text-gray-400' : 'border-blue-300 text-blue-700 bg-blue-50'
                        }`}
                      >
                        <option value="skip">-- Skip --</option>
                        {CONTACT_FIELDS.map(f => (
                          <option key={f.key} value={f.key}>
                            {f.label}{f.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              {!canProceed && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex items-center gap-2">
                  <Icon name="AlertCircle" size={16} />
                  Please map at least <strong>Name</strong> and <strong>Email</strong> to continue.
                </div>
              )}
            </div>
          )}

          {/* ===== STEP 3: PREVIEW ===== */}
          {step === 'preview' && !result && (
            <div>
              {/* Auto-detect note */}
              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 flex items-center justify-between">
                <span>{smartContacts ? `Auto-detected contacts from ${fileName}` : 'Columns were auto-detected from your file headers.'}</span>
                {!smartContacts && <button onClick={() => setStep('mapping')} className="text-blue-600 hover:text-blue-700 font-medium text-sm">Adjust mapping</button>}
              </div>

              {/* Clickable summary boxes */}
              <div className="flex gap-3 mb-4">
                <button
                  onClick={() => setPreviewFilter(previewFilter === 'new' ? 'all' : 'new')}
                  className={`flex-1 p-4 rounded-xl text-center transition-all ${
                    previewFilter === 'new' ? 'bg-green-100 border-2 border-green-400 ring-2 ring-green-200' : 'bg-green-50 border border-green-200 hover:border-green-300'
                  }`}
                >
                  <p className="text-2xl font-bold text-green-700">{newContacts.length}</p>
                  <p className="text-sm text-green-600">New contacts</p>
                </button>
                <button
                  onClick={() => setPreviewFilter(previewFilter === 'update' ? 'all' : 'update')}
                  className={`flex-1 p-4 rounded-xl text-center transition-all ${
                    previewFilter === 'update' ? 'bg-blue-100 border-2 border-blue-400 ring-2 ring-blue-200' : 'bg-blue-50 border border-blue-200 hover:border-blue-300'
                  }`}
                >
                  <p className="text-2xl font-bold text-blue-700">{updateContacts.length}</p>
                  <p className="text-sm text-blue-600">Will be updated</p>
                </button>
                {(skippedContacts.length > 0) && (
                  <button
                    onClick={() => setPreviewFilter(previewFilter === 'skipped' ? 'all' : 'skipped')}
                    className={`flex-1 p-4 rounded-xl text-center transition-all ${
                      previewFilter === 'skipped' ? 'bg-amber-100 border-2 border-amber-400 ring-2 ring-amber-200' : 'bg-gray-50 border border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-2xl font-bold text-gray-600">{stillSkipped.length}</p>
                    <p className="text-sm text-gray-500">Missing email</p>
                  </button>
                )}
              </div>

              {/* Skipped contacts: editable view */}
              {previewFilter === 'skipped' && (
                <div className="border border-amber-200 rounded-lg overflow-hidden mb-4">
                  <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800 font-medium flex items-center justify-between">
                    <span>These contacts are missing an email. Add one or import without it.</span>
                    {skippedContacts.length > 1 && (
                      <button
                        onClick={() => {
                          const allSelected = skippedContacts.every((_, idx) => importWithoutEmail[idx] || (skippedEdits[idx] && skippedEdits[idx].includes('@')));
                          if (allSelected) {
                            // Deselect all "import without email"
                            setImportWithoutEmail({});
                          } else {
                            // Select all that don't already have a valid email entered
                            const newFlags: Record<number, boolean> = {};
                            skippedContacts.forEach((_, idx) => {
                              const edited = skippedEdits[idx];
                              const hasEmail = edited && edited.trim() && edited.includes('@');
                              if (!hasEmail) newFlags[idx] = true;
                            });
                            setImportWithoutEmail(newFlags);
                          }
                        }}
                        className="text-xs font-medium text-amber-700 hover:text-amber-900 underline whitespace-nowrap ml-2"
                      >
                        {skippedContacts.every((_, idx) => importWithoutEmail[idx] || (skippedEdits[idx] && skippedEdits[idx].includes('@'))) ? 'Deselect all' : 'Import all without email'}
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto max-h-72">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Company</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Country</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-52">Email</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-28">No email</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {skippedContacts.map((contact, idx) => {
                          const editedEmail = skippedEdits[idx] || '';
                          const isFixed = editedEmail.trim() !== '' && editedEmail.includes('@');
                          const isImportWithout = importWithoutEmail[idx] || false;
                          return (
                            <tr key={idx} className={isImportWithout ? 'bg-blue-50' : isFixed ? 'bg-green-50' : ''}>
                              <td className="px-3 py-2 font-medium text-gray-800">{contact.name}</td>
                              <td className="px-3 py-2 text-gray-600">{contact.company || '-'}</td>
                              <td className="px-3 py-2 text-gray-600">{contact.country || '-'}</td>
                              <td className="px-3 py-1.5">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="email"
                                    placeholder={isImportWithout ? 'Not needed' : 'Enter email...'}
                                    value={editedEmail}
                                    disabled={isImportWithout}
                                    onChange={(e) => setSkippedEdits({ ...skippedEdits, [idx]: e.target.value })}
                                    className={`flex-1 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                      isImportWithout ? 'border-gray-200 bg-gray-100 text-gray-400' : isFixed ? 'border-green-300 bg-green-50' : 'border-gray-200'
                                    }`}
                                  />
                                  {isFixed && !isImportWithout && <Icon name="Check" size={16} className="text-green-600 flex-shrink-0" />}
                                </div>
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isImportWithout}
                                    onChange={(e) => setImportWithoutEmail({ ...importWithoutEmail, [idx]: e.target.checked })}
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                  />
                                  <span className="text-xs text-gray-500">Import</span>
                                </label>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {(fixedFromSkipped.length > 0 || importedWithoutEmail.length > 0) && (
                    <div className="px-4 py-2 bg-green-50 border-t border-green-200 text-sm text-green-700">
                      {fixedFromSkipped.length + importedWithoutEmail.length} contact{(fixedFromSkipped.length + importedWithoutEmail.length) !== 1 ? 's' : ''} will now be included in the import.
                      {importedWithoutEmail.length > 0 && (
                        <span className="text-gray-500 ml-1">({importedWithoutEmail.length} without email — you can add one later)</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Preview table (for new/update/all views) */}
              {previewFilter !== 'skipped' && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Email</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Company</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Role</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Country</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(previewFilter === 'new' ? newContacts : previewFilter === 'update' ? updateContacts : allImportable).slice(0, 50).map((contact, idx) => {
                          const isUpdate = existingEmails.has(contact.email.toLowerCase());
                          return (
                            <tr key={idx} className={isUpdate ? 'bg-blue-50' : ''}>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  isUpdate ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                                }`}>
                                  {isUpdate ? 'Update' : 'New'}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-medium text-gray-800">{contact.name}</td>
                              <td className="px-3 py-2 text-gray-600">{contact.email}</td>
                              <td className="px-3 py-2 text-gray-600">{contact.company || '-'}</td>
                              <td className="px-3 py-2 text-gray-600">{contact.role || '-'}</td>
                              <td className="px-3 py-2 text-gray-600">{contact.country || '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {allImportable.length > 50 && previewFilter === 'all' && (
                    <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500 text-center border-t">
                      Showing first 50 of {allImportable.length} contacts
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== SUCCESS RESULT ===== */}
          {result && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="Check" size={32} className="text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">Import Complete!</h3>
              <p className="text-gray-600">
                {result.inserted > 0 && <span><strong>{result.inserted}</strong> new contact{result.inserted !== 1 ? 's' : ''} added</span>}
                {result.inserted > 0 && result.updated > 0 && <span> and </span>}
                {result.updated > 0 && <span><strong>{result.updated}</strong> existing contact{result.updated !== 1 ? 's' : ''} updated</span>}
              </p>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button
            onClick={() => {
              if (step === 'mapping') setStep('upload');
              else if (step === 'preview' && !result) { setSmartContacts(null); setStep('upload'); }
              else onClose();
            }}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            {step === 'upload' || result ? 'Close' : 'Back'}
          </button>

          {step === 'mapping' && (
            <button
              onClick={() => setStep('preview')}
              disabled={!canProceed}
              className={`px-6 py-2.5 rounded-lg font-medium text-sm ${
                canProceed
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Preview Import
            </button>
          )}

          {step === 'preview' && !result && (
            <button
              onClick={handleImport}
              disabled={importing || allImportable.length === 0}
              className={`px-6 py-2.5 rounded-lg font-medium text-sm flex items-center gap-2 ${
                importing || allImportable.length === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {importing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Importing...
                </>
              ) : (
                <>Import {allImportable.length} Contact{allImportable.length !== 1 ? 's' : ''}</>
              )}
            </button>
          )}

          {result && (
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ContactImportModal;
