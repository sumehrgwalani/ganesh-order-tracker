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
  { key: 'country', label: 'Country', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const;

type FieldKey = typeof CONTACT_FIELDS[number]['key'];

// Common header names → our field keys (for auto-detection)
const HEADER_ALIASES: Record<string, FieldKey> = {
  name: 'name', 'full name': 'name', 'contact name': 'name', 'first name': 'name', 'nombre': 'name',
  email: 'email', 'e-mail': 'email', 'email address': 'email', 'mail': 'email', 'correo': 'email',
  company: 'company', 'company name': 'company', 'organisation': 'company', 'organization': 'company', 'empresa': 'company', 'firm': 'company',
  role: 'role', 'type': 'role', 'category': 'role', 'position': 'role', 'title': 'role', 'job title': 'role',
  phone: 'phone', 'telephone': 'phone', 'tel': 'phone', 'mobile': 'phone', 'cell': 'phone', 'phone number': 'phone', 'telefono': 'phone',
  country: 'country', 'location': 'country', 'region': 'country', 'pais': 'country',
  notes: 'notes', 'note': 'notes', 'comments': 'notes', 'description': 'notes', 'remarks': 'notes', 'notas': 'notes',
};

interface MappedContact {
  name: string;
  email: string;
  company: string;
  role: string;
  phone: string;
  country: string;
  notes: string;
}

interface Props {
  existingEmails: Set<string>;
  onImport: (contacts: MappedContact[]) => Promise<{ inserted: number; updated: number }>;
  onClose: () => void;
}

type Step = 'upload' | 'mapping' | 'preview';

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

        const hdrs = jsonData[0].map(h => String(h).trim()).filter(h => h !== '');
        const dataRows = jsonData.slice(1).filter(row => row.some(cell => String(cell).trim() !== ''));

        if (hdrs.length === 0) {
          setError('Could not find column headers in the first row.');
          return;
        }

        setHeaders(hdrs);
        setRows(dataRows.map(row => hdrs.map((_, i) => String(row[i] || '').trim())));
        setMapping(autoDetectMapping(hdrs));
        setStep('mapping');
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

  // Build mapped contacts from rows + mapping
  const getMappedContacts = (): MappedContact[] => {
    const fieldIndices: Partial<Record<FieldKey, number>> = {};
    headers.forEach((header, idx) => {
      const field = mapping[header];
      if (field && field !== 'skip') {
        fieldIndices[field] = idx;
      }
    });

    return rows
      .map(row => ({
        name: row[fieldIndices.name ?? -1] || '',
        email: row[fieldIndices.email ?? -1] || '',
        company: row[fieldIndices.company ?? -1] || '',
        role: row[fieldIndices.role ?? -1] || 'Supplier',
        phone: row[fieldIndices.phone ?? -1] || '',
        country: row[fieldIndices.country ?? -1] || '',
        notes: row[fieldIndices.notes ?? -1] || '',
      }))
      .filter(c => c.name.trim() !== '' && c.email.trim() !== '' && c.email.includes('@'));
  };

  const mappedContacts = step === 'preview' ? getMappedContacts() : [];
  const newContacts = mappedContacts.filter(c => !existingEmails.has(c.email.toLowerCase()));
  const updateContacts = mappedContacts.filter(c => existingEmails.has(c.email.toLowerCase()));

  // Check if required fields are mapped
  const nameIsMapped = Object.values(mapping).includes('name');
  const emailIsMapped = Object.values(mapping).includes('email');
  const canProceed = nameIsMapped && emailIsMapped;

  const handleImport = async () => {
    setImporting(true);
    setError('');
    try {
      const contacts = getMappedContacts();
      const res = await onImport(contacts);
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
              <p className="text-xs text-gray-400 mt-4">
                First row should contain column headers (e.g. Name, Email, Company, Phone)
              </p>
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
              {/* Summary */}
              <div className="flex gap-4 mb-4">
                <div className="flex-1 p-4 bg-green-50 border border-green-200 rounded-xl text-center">
                  <p className="text-2xl font-bold text-green-700">{newContacts.length}</p>
                  <p className="text-sm text-green-600">New contacts</p>
                </div>
                <div className="flex-1 p-4 bg-blue-50 border border-blue-200 rounded-xl text-center">
                  <p className="text-2xl font-bold text-blue-700">{updateContacts.length}</p>
                  <p className="text-sm text-blue-600">Will be updated</p>
                </div>
                {rows.length - mappedContacts.length > 0 && (
                  <div className="flex-1 p-4 bg-gray-50 border border-gray-200 rounded-xl text-center">
                    <p className="text-2xl font-bold text-gray-500">{rows.length - mappedContacts.length}</p>
                    <p className="text-sm text-gray-500">Skipped (missing name/email)</p>
                  </div>
                )}
              </div>

              {/* Preview table */}
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
                      {mappedContacts.slice(0, 50).map((contact, idx) => {
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
                {mappedContacts.length > 50 && (
                  <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500 text-center border-t">
                    Showing first 50 of {mappedContacts.length} contacts
                  </div>
                )}
              </div>
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
              else if (step === 'preview' && !result) setStep('mapping');
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
              disabled={importing || mappedContacts.length === 0}
              className={`px-6 py-2.5 rounded-lg font-medium text-sm flex items-center gap-2 ${
                importing || mappedContacts.length === 0
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
                <>Import {mappedContacts.length} Contact{mappedContacts.length !== 1 ? 's' : ''}</>
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
