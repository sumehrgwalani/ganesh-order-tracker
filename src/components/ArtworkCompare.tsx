import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from './Icon';

// PDF.js — loaded from CDN to avoid bundling the worker
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfjsLib: any = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  // Dynamically load pdf.js from CDN
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

// Simple pixel comparison — no external dependency needed
function comparePixels(
  imgData1: ImageData,
  imgData2: ImageData,
  width: number,
  height: number,
  threshold: number
): { diffCanvas: HTMLCanvasElement; diffCount: number; totalPixels: number } {
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffCtx = diffCanvas.getContext('2d')!;
  const diffData = diffCtx.createImageData(width, height);
  const d1 = imgData1.data;
  const d2 = imgData2.data;
  const dd = diffData.data;
  let diffCount = 0;
  const t = threshold * 255; // Convert 0-1 threshold to 0-255

  for (let i = 0; i < d1.length; i += 4) {
    const rDiff = Math.abs(d1[i] - d2[i]);
    const gDiff = Math.abs(d1[i + 1] - d2[i + 1]);
    const bDiff = Math.abs(d1[i + 2] - d2[i + 2]);
    const maxDiff = Math.max(rDiff, gDiff, bDiff);
    if (maxDiff > t) {
      // Different — mark red
      dd[i] = 255;     // R
      dd[i + 1] = 50;  // G
      dd[i + 2] = 50;  // B
      dd[i + 3] = 200; // A
      diffCount++;
    } else {
      // Same — transparent
      dd[i + 3] = 0;
    }
  }
  diffCtx.putImageData(diffData, 0, 0);
  return { diffCanvas, diffCount, totalPixels: width * height };
}

// Load image from URL to canvas
async function urlToCanvas(url: string, targetW: number, targetH: number): Promise<HTMLCanvasElement> {
  const isPdf = /\.pdf(\?|$)/i.test(url);
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);

  if (isPdf) {
    const lib = await loadPdfJs();
    const loadingTask = lib.getDocument(url);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const scale = Math.min(targetW / page.getViewport({ scale: 1 }).width, targetH / page.getViewport({ scale: 1 }).height);
    const viewport = page.getViewport({ scale });
    // Center on canvas
    const xOff = (targetW - viewport.width) / 2;
    const yOff = (targetH - viewport.height) / 2;
    ctx.translate(xOff, yOff);
    await page.render({ canvasContext: ctx, viewport }).promise;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
    // Fit image to canvas maintaining aspect ratio
    const ratio = Math.min(targetW / img.width, targetH / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    ctx.drawImage(img, (targetW - w) / 2, (targetH - h) / 2, w, h);
  }
  return canvas;
}

interface Props {
  referenceUrl: string;
  referenceLabel: string;
  newUrl: string;
  newLabel: string;
  onClose: () => void;
}

type ViewMode = 'side-by-side' | 'overlay' | 'diff-only';

export default function ArtworkCompare({ referenceUrl, referenceLabel, newUrl, newLabel, onClose }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [sensitivity, setSensitivity] = useState(0.1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffPercent, setDiffPercent] = useState<number | null>(null);

  const refCanvasRef = useRef<HTMLCanvasElement>(null);
  const newCanvasRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // Store rendered source canvases for re-comparison when sensitivity changes
  const sourceRef = useRef<{ refCanvas: HTMLCanvasElement; newCanvas: HTMLCanvasElement } | null>(null);

  const CANVAS_W = 800;
  const CANVAS_H = 1100;

  const runComparison = useCallback((refSrc: HTMLCanvasElement, newSrc: HTMLCanvasElement, thresh: number) => {
    const refData = refSrc.getContext('2d')!.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const newData = newSrc.getContext('2d')!.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const { diffCanvas, diffCount, totalPixels } = comparePixels(refData, newData, CANVAS_W, CANVAS_H, thresh);
    setDiffPercent(Math.round((diffCount / totalPixels) * 10000) / 100);

    // Draw to visible canvases
    if (refCanvasRef.current) {
      const ctx = refCanvasRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.drawImage(refSrc, 0, 0);
    }
    if (newCanvasRef.current) {
      const ctx = newCanvasRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.drawImage(newSrc, 0, 0);
    }
    if (diffCanvasRef.current) {
      const ctx = diffCanvasRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.drawImage(diffCanvas, 0, 0);
    }
    if (overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.drawImage(newSrc, 0, 0);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(diffCanvas, 0, 0);
      ctx.globalAlpha = 1.0;
    }
  }, []);

  // Load images and run initial comparison
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [refCanvas, newCanvas] = await Promise.all([
          urlToCanvas(referenceUrl, CANVAS_W, CANVAS_H),
          urlToCanvas(newUrl, CANVAS_W, CANVAS_H),
        ]);
        if (cancelled) return;
        sourceRef.current = { refCanvas, newCanvas };
        runComparison(refCanvas, newCanvas, sensitivity);
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load artwork files');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [referenceUrl, newUrl]); // Only reload when URLs change

  // Re-run comparison when sensitivity changes (but don't reload images)
  useEffect(() => {
    if (sourceRef.current && !loading) {
      runComparison(sourceRef.current.refCanvas, sourceRef.current.newCanvas, sensitivity);
    }
  }, [sensitivity, runComparison, loading]);

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
                  {diffPercent === 0
                    ? 'Identical — no differences found'
                    : `${diffPercent}% of pixels differ`}
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
              { mode: 'overlay' as ViewMode, label: 'Overlay', icon: 'Layers' },
              { mode: 'diff-only' as ViewMode, label: 'Diff Only', icon: 'Zap' },
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
            <span className="text-xs text-gray-500">Sensitivity</span>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.01"
              value={sensitivity}
              onChange={e => setSensitivity(parseFloat(e.target.value))}
              className="w-32 accent-purple-600"
            />
            <span className="text-xs text-gray-600 w-8">{Math.round(sensitivity * 100)}%</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 bg-gray-100">
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
          ) : (
            <>
              {viewMode === 'side-by-side' && (
                <div className="grid grid-cols-3 gap-3 h-full">
                  <div className="flex flex-col">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 text-center">Reference</p>
                    <p className="text-xs text-gray-400 text-center mb-2 truncate">{referenceLabel}</p>
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-auto flex items-start justify-center p-2">
                      <canvas ref={refCanvasRef} width={CANVAS_W} height={CANVAS_H} className="max-w-full h-auto" />
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 text-center">New Artwork</p>
                    <p className="text-xs text-gray-400 text-center mb-2 truncate">{newLabel}</p>
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-auto flex items-start justify-center p-2">
                      <canvas ref={newCanvasRef} width={CANVAS_W} height={CANVAS_H} className="max-w-full h-auto" />
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2 text-center">Differences</p>
                    <p className="text-xs text-gray-400 text-center mb-2">Red = changed pixels</p>
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-red-200 overflow-auto flex items-start justify-center p-2">
                      <canvas ref={diffCanvasRef} width={CANVAS_W} height={CANVAS_H} className="max-w-full h-auto" />
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'overlay' && (
                <div className="flex flex-col items-center h-full">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">New Artwork with Differences Highlighted</p>
                  <p className="text-xs text-gray-400 mb-3">Red areas show where the artwork differs from the reference</p>
                  <div className="flex-1 bg-white rounded-xl shadow-sm border border-purple-200 overflow-auto flex items-start justify-center p-2">
                    <canvas ref={overlayCanvasRef} width={CANVAS_W} height={CANVAS_H} className="max-w-full h-auto" />
                  </div>
                </div>
              )}

              {viewMode === 'diff-only' && (
                <div className="flex flex-col items-center h-full">
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">Difference Map</p>
                  <p className="text-xs text-gray-400 mb-3">Red = pixels that differ between reference and new artwork</p>
                  <div className="flex-1 bg-gray-900 rounded-xl shadow-sm border border-gray-700 overflow-auto flex items-start justify-center p-2">
                    <canvas ref={diffCanvasRef} width={CANVAS_W} height={CANVAS_H} className="max-w-full h-auto" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
