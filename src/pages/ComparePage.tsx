import { useState, useRef, useEffect, useMemo } from 'react';
import Icon from '../components/Icon';
import ArtworkCompare from '../components/ArtworkCompare';

export default function ComparePage() {
  const [refFile, setRefFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [comparing, setComparing] = useState(false);

  const refInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  const accept = '.pdf,.jpg,.jpeg,.png';

  // Append filename as hash so ArtworkCompare can detect PDFs from blob URLs
  const refUrl = useMemo(() => refFile ? URL.createObjectURL(refFile) + '#' + refFile.name : null, [refFile]);
  const newUrl = useMemo(() => newFile ? URL.createObjectURL(newFile) + '#' + newFile.name : null, [newFile]);

  // Revoke blob URLs on cleanup to prevent memory leaks
  useEffect(() => {
    return () => { if (refUrl) URL.revokeObjectURL(refUrl.split('#')[0]); };
  }, [refUrl]);
  useEffect(() => {
    return () => { if (newUrl) URL.revokeObjectURL(newUrl.split('#')[0]); };
  }, [newUrl]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Artwork Compare</h1>
        <p className="text-sm text-gray-500 mt-1">Upload two files to compare them side by side and see differences.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
        {/* Reference file */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Reference Artwork</label>
          <input ref={refInputRef} type="file" accept={accept} className="hidden" onChange={e => { if (e.target.files?.[0]) setRefFile(e.target.files[0]); }} />
          {refFile ? (
            <div className="flex items-center gap-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <Icon name="Image" size={18} className="text-purple-500 shrink-0" />
              <span className="text-sm text-purple-700 truncate flex-1">{refFile.name}</span>
              <button onClick={() => { setRefFile(null); setComparing(false); if (refInputRef.current) refInputRef.current.value = ''; }} className="text-purple-400 hover:text-purple-600"><Icon name="X" size={16} /></button>
            </div>
          ) : (
            <button onClick={() => refInputRef.current?.click()} className="w-full p-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors text-center">
              <Icon name="Upload" size={24} className="text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Click to select reference file</p>
              <p className="text-xs text-gray-400 mt-1">PDF, JPG, or PNG</p>
            </button>
          )}
        </div>

        {/* New artwork file */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">New Artwork</label>
          <input ref={newInputRef} type="file" accept={accept} className="hidden" onChange={e => { if (e.target.files?.[0]) setNewFile(e.target.files[0]); }} />
          {newFile ? (
            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Icon name="Image" size={18} className="text-blue-500 shrink-0" />
              <span className="text-sm text-blue-700 truncate flex-1">{newFile.name}</span>
              <button onClick={() => { setNewFile(null); setComparing(false); if (newInputRef.current) newInputRef.current.value = ''; }} className="text-blue-400 hover:text-blue-600"><Icon name="X" size={16} /></button>
            </div>
          ) : (
            <button onClick={() => newInputRef.current?.click()} className="w-full p-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors text-center">
              <Icon name="Upload" size={24} className="text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Click to select new artwork</p>
              <p className="text-xs text-gray-400 mt-1">PDF, JPG, or PNG</p>
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            disabled={!refFile || !newFile}
            onClick={() => setComparing(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Icon name="GitCompare" size={16} />
            Compare
          </button>
          {(refFile || newFile) && (
            <button onClick={() => { setRefFile(null); setNewFile(null); setComparing(false); if (refInputRef.current) refInputRef.current.value = ''; if (newInputRef.current) newInputRef.current.value = ''; }} className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700">
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Comparison modal */}
      {comparing && refUrl && newUrl && (
        <ArtworkCompare
          referenceUrl={refUrl}
          referenceLabel={refFile!.name}
          newUrl={newUrl}
          newLabel={newFile!.name}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  );
}
