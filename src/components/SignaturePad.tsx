// Self-contained signature drawing/upload component
import { useState, useRef, useEffect } from 'react';
import Icon from './Icon';

interface Props {
  signatureData: string;
  onSignatureChange: (data: string) => void;
  onNotification: (notification: { type: 'success' | 'error' | 'info'; message: string }) => void;
}

function SignaturePad({ signatureData, onSignatureChange, onNotification }: Props) {
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load saved signature on mount
  useEffect(() => {
    const saved = localStorage.getItem('gi_signature');
    if (saved && !signatureData) onSignatureChange(saved);
  }, []);

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const getCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => setIsDrawing(false);

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSignatureChange(dataUrl);
    localStorage.setItem('gi_signature', dataUrl);
    setShowSignaturePad(false);
    onNotification({ type: 'success', message: 'Signature saved! It will appear on your POs.' });
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onNotification({ type: 'error', message: 'Please upload an image file (PNG, JPG).' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      onSignatureChange(dataUrl);
      localStorage.setItem('gi_signature', dataUrl);
      setShowSignaturePad(false);
      onNotification({ type: 'success', message: 'Signature uploaded and saved!' });
    };
    reader.readAsDataURL(file);
  };

  const removeSignature = () => {
    onSignatureChange('');
    localStorage.removeItem('gi_signature');
    onNotification({ type: 'info', message: 'Signature removed.' });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-gray-700">Digital Signature</label>
        {signatureData && !showSignaturePad && (
          <div className="flex gap-2">
            <button onClick={() => { setShowSignaturePad(true); setTimeout(initCanvas, 100); }} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Change</button>
            <button onClick={removeSignature} className="text-xs text-red-500 hover:text-red-700 font-medium">Remove</button>
          </div>
        )}
      </div>

      {signatureData && !showSignaturePad ? (
        <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <img src={signatureData} alt="Your signature" className="h-12 object-contain" style={{ maxWidth: '180px' }} />
          <span className="text-sm text-green-700 font-medium flex items-center gap-1">
            <Icon name="CheckCircle" size={14} /> Signature ready
          </span>
        </div>
      ) : !showSignaturePad ? (
        <div className="flex gap-3">
          <button
            onClick={() => { setShowSignaturePad(true); setTimeout(initCanvas, 100); }}
            className="flex-1 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all text-sm text-gray-600 flex flex-col items-center gap-1"
          >
            <Icon name="Edit" size={20} />
            <span>Draw Signature</span>
          </button>
          <label className="flex-1 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all text-sm text-gray-600 flex flex-col items-center gap-1 cursor-pointer">
            <Icon name="Upload" size={20} />
            <span>Upload Image</span>
            <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2 border-b border-gray-200 pb-2">
            <span className="text-sm font-medium text-blue-600 border-b-2 border-blue-600 pb-1 px-1">Draw</span>
            <label className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer pb-1 px-1">
              Upload instead
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
            </label>
          </div>
          <div className="border-2 border-gray-300 rounded-lg bg-white relative" style={{ touchAction: 'none' }}>
            <canvas
              ref={canvasRef}
              width={400}
              height={150}
              className="w-full cursor-crosshair"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
            <div className="absolute bottom-2 left-3 right-3 border-t border-gray-300" />
          </div>
          <p className="text-xs text-gray-400 text-center">Sign above the line using your mouse or finger</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowSignaturePad(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button onClick={clearCanvas} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg">Clear</button>
            <button onClick={saveSignature} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save Signature</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SignaturePad;
