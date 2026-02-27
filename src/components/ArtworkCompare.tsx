import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from './Icon';

// PDF.js — loaded from CDN to avoid bundling the worker
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfjsLib: any = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      pdfjsLib = lib;
      resolve(lib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Render a URL (PDF or image) to a data URL string for use in <img> tags
async function urlToDataUrl(url: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const isPdf = /\.pdf(\?|#|$)/i.test(url);

  if (isPdf) {
    const lib = await loadPdfJs();
    // Strip hash fragment for pdf.js loading (it can't handle it)
    const cleanUrl = url.split('#')[0];
    const loadingTask = lib.getDocument(cleanUrl);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const scale = 2; // High-res render
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { dataUrl: canvas.toDataURL('image/png'), width: viewport.width, height: viewport.height };
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
    return { dataUrl: img.src, width: img.naturalWidth, height: img.naturalHeight };
  }
}

// Simple pixel comparison for summary stats
function computeDiffPercent(
  img1: HTMLImageElement,
  img2: HTMLImageElement,
  threshold: number
): number {
  const W = 800;
  const H = 1100;
  const c1 = document.createElement('canvas');
  c1.width = W; c1.height = H;
  const ctx1 = c1.getContext('2d')!;
  ctx1.fillStyle = '#fff';
  ctx1.fillRect(0, 0, W, H);
  const r1 = Math.min(W / img1.naturalWidth, H / img1.naturalHeight);
  ctx1.drawImage(img1, (W - img1.naturalWidth * r1) / 2, (H - img1.naturalHeight * r1) / 2, img1.naturalWidth * r1, img1.naturalHeight * r1);

  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const ctx2 = c2.getContext('2d')!;
  ctx2.fillStyle = '#fff';
  ctx2.fillRect(0, 0, W, H);
  const r2 = Math.min(W / img2.naturalWidth, H / img2.naturalHeight);
  ctx2.drawImage(img2, (W - img2.naturalWidth * r2) / 2, (H - img2.naturalHeight * r2) / 2, img2.naturalWidth * r2, img2.naturalHeight * r2);

  const d1 = ctx1.getImageData(0, 0, W, H).data;
  const d2 = ctx2.getImageData(0, 0, W, H).data;
  const t = threshold * 255;
  let diff = 0;
  for (let i = 0; i < d1.length; i += 4) {
    const maxDiff = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i+1] - d2[i+1]), Math.abs(d1[i+2] - d2[i+2]));
    if (maxDiff > t) diff++;
  }
  return Math.round((diff / (W * H)) * 10000) / 100;
}

interface Props {
  referenceUrl: string;
  referenceLabel: string;
  newUrl: string;
  newLabel: string;
  onClose: () => void;
}

type ViewMode = 'side-by-side' | 'slider';

export default function ArtworkCompare({ referenceUrl, referenceLabel, newUrl, newLabel, onClose }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffPercent, setDiffPercent] = useState<number | null>(null);

  // Image data URLs
  const [refDataUrl, setRefDataUrl] = useState<string | null>(null);
  const [newDataUrl, setNewDataUrl] = useState<string | null>(null);

  // Zoom & pan (synchronized)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panStartOffset = useRef({ x: 0, y: 0 });

  // Slider position (0 to 100)
  const [sliderPos, setSliderPos] = useState(50);
  const isDraggingSlider = useRef(false);
  const sliderContainerRef = useRef<HTMLDivElement>(null);

  // Load images
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [refResult, newResult] = await Promise.all([
          urlToDataUrl(referenceUrl),
          urlToDataUrl(newUrl),
        ]);
        if (cancelled) return;
        setRefDataUrl(refResult.dataUrl);
        setNewDataUrl(newResult.dataUrl);
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load artwork files');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [referenceUrl, newUrl]);

  // Compute diff % once images are loaded
  useEffect(() => {
    if (!refDataUrl || !newDataUrl) return;
    const img1 = new Image();
    const img2 = new Image();
    let loaded = 0;
    const check = () => {
      loaded++;
      if (loaded === 2) {
        try {
          setDiffPercent(computeDiffPercent(img1, img2, 0.1));
        } catch { /* ignore cross-origin issues */ }
      }
    };
    img1.onload = check;
    img2.onload = check;
    img1.src = refDataUrl;
    img2.src = newDataUrl;
  }, [refDataUrl, newDataUrl]);

  // Zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(prev => {
      const next = prev * (e.deltaY < 0 ? 1.15 : 0.87);
      return Math.max(0.5, Math.min(10, next));
    });
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isDraggingSlider.current) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    panStartOffset.current = { ...pan };
    e.preventDefault();
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      setPan({
        x: panStartOffset.current.x + (e.clientX - panStart.current.x) / zoom,
        y: panStartOffset.current.y + (e.clientY - panStart.current.y) / zoom,
      });
    }
  }, [zoom]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Slider drag handlers
  const handleSliderMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingSlider.current = true;
    e.stopPropagation();
    e.preventDefault();

    const onMove = (ev: MouseEvent) => {
      if (!sliderContainerRef.current) return;
      const rect = sliderContainerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSliderPos(Math.max(0, Math.min(100, pct)));
    };
    const onUp = () => {
      isDraggingSlider.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Reset zoom/pan on mode switch
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [viewMode]);

  const imgStyle = {
    transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
    transformOrigin: 'center center',
    transition: isPanning.current ? 'none' : 'transform 0.1s ease-out',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[95vw] max-w-[1400px] h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
              <Icon name="Layers" size={18} className="text-purple-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 text-lg">Artwork Comparison</h2>
              {diffPercent !== null && (
                <p className="text-xs text-gray-500">
                  {diffPercent === 0 ? 'Identical — no differences found' : `${diffPercent}% of pixels differ`}
                </p>
              )}
            </div>
            {diffPercent !== null && (
              <span className={`ml-3 px-3 py-1 rounded-full text-xs font-semibold ${
                diffPercent === 0 ? 'bg-green-100 text-green-700' :
                diffPercent < 2 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                {diffPercent === 0 ? 'Match' : diffPercent < 2 ? 'Minor Changes' : 'Significant Changes'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
            <Icon name="X" size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-6 bg-white">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {([
              { mode: 'side-by-side' as ViewMode, label: 'Side by Side', icon: 'Columns' },
              { mode: 'slider' as ViewMode, label: 'Slider', icon: 'Layers' },
            ]).map(({ mode, label, icon }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === mode ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon name={icon} size={14} />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-gray-500">Zoom: {Math.round(zoom * 100)}%</span>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="text-xs text-purple-600 hover:text-purple-800 font-medium">
              Reset
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-gray-100">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-10 h-10 border-3 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-600">Loading artwork files...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center bg-red-50 border border-red-200 rounded-xl p-6 max-w-md">
                <Icon name="AlertCircle" size={32} className="text-red-400 mx-auto mb-3" />
                <p className="text-sm text-red-700 font-medium">{error}</p>
                <p className="text-xs text-red-500 mt-2">Check that the artwork files are accessible.</p>
              </div>
            </div>
          ) : refDataUrl && newDataUrl ? (
            <>
              {viewMode === 'side-by-side' && (
                <div
                  className="grid grid-cols-2 gap-1 h-full p-2 select-none"
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
                >
                  <div className="flex flex-col overflow-hidden">
                    <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1 text-center shrink-0">Reference</p>
                    <p className="text-xs text-gray-400 text-center mb-1 truncate shrink-0">{referenceLabel}</p>
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex items-center justify-center">
                      <img src={refDataUrl} alt="Reference" style={imgStyle} className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
                    </div>
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1 text-center shrink-0">New Artwork</p>
                    <p className="text-xs text-gray-400 text-center mb-1 truncate shrink-0">{newLabel}</p>
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex items-center justify-center">
                      <img src={newDataUrl} alt="New" style={imgStyle} className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'slider' && (
                <div
                  ref={sliderContainerRef}
                  className="relative h-full select-none overflow-hidden"
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{ cursor: isPanning.current ? 'grabbing' : 'default' }}
                >
                  {/* New artwork (bottom layer — full) */}
                  <div className="absolute inset-0 flex items-center justify-center bg-white">
                    <img src={newDataUrl} alt="New" style={imgStyle} className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
                  </div>
                  {/* Reference (top layer — clipped from left) */}
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-white"
                    style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                  >
                    <img src={refDataUrl} alt="Reference" style={imgStyle} className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
                  </div>
                  {/* Divider line */}
                  <div
                    className="absolute top-0 bottom-0 z-10"
                    style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
                  >
                    <div className="w-0.5 h-full bg-purple-600" />
                    {/* Drag handle */}
                    <div
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center shadow-lg cursor-ew-resize hover:bg-purple-700 transition-colors"
                      onMouseDown={handleSliderMouseDown}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-white">
                        <path d="M5 3L2 8L5 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M11 3L14 8L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  {/* Labels */}
                  <div className="absolute top-3 left-3 z-10 px-2 py-1 bg-purple-600 text-white text-xs font-semibold rounded-md shadow">Reference</div>
                  <div className="absolute top-3 right-3 z-10 px-2 py-1 bg-blue-600 text-white text-xs font-semibold rounded-md shadow">New</div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
