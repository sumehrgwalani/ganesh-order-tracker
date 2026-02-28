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

// Render a URL (PDF or image) to a data URL string
async function urlToDataUrl(url: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const isPdf = /\.pdf(\?|#|$)/i.test(url);

  if (isPdf) {
    const lib = await loadPdfJs();
    const cleanUrl = url.split('#')[0];
    const loadingTask = lib.getDocument(cleanUrl);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const scale = 2;
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

// Extract text from a PDF URL using pdf.js
async function extractPdfText(url: string): Promise<string[]> {
  const lib = await loadPdfJs();
  const cleanUrl = url.split('#')[0];
  const loadingTask = lib.getDocument(cleanUrl);
  const pdf = await loadingTask.promise;
  const lines: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    // Group text items by their Y position to form lines
    const itemsByY: Map<number, { x: number; str: string }[]> = new Map();
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      // Round Y to nearest 2px to group items on same line
      const y = Math.round(item.transform[5] / 2) * 2;
      if (!itemsByY.has(y)) itemsByY.set(y, []);
      itemsByY.get(y)!.push({ x: item.transform[4], str: item.str });
    }
    // Sort by Y (descending — PDF coords go bottom-up) then X
    const sortedYs = [...itemsByY.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const items = itemsByY.get(y)!.sort((a, b) => a.x - b.x);
      const line = items.map(i => i.str).join(' ').trim();
      if (line) lines.push(line);
    }
  }
  return lines;
}

// Compare two sets of text lines and produce a structured diff
interface DiffItem {
  type: 'match' | 'changed' | 'missing' | 'added';
  refLine?: string;
  newLine?: string;
  lineNum: number;
}

function compareTextLines(refLines: string[], newLines: string[]): DiffItem[] {
  const results: DiffItem[] = [];
  const maxLen = Math.max(refLines.length, newLines.length);

  // Normalize for comparison (lowercase, collapse whitespace)
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  // Build a set of new lines for quick lookup
  const newNormSet = new Set(newLines.map(normalize));
  const refNormSet = new Set(refLines.map(normalize));

  // First pass: find lines in reference that are missing from new
  let lineNum = 0;
  for (const refLine of refLines) {
    lineNum++;
    const refNorm = normalize(refLine);
    if (!refNorm) continue;

    if (newNormSet.has(refNorm)) {
      results.push({ type: 'match', refLine, lineNum });
    } else {
      // Try to find a close match in new lines (same start or >60% similar)
      const closeMatch = newLines.find(nl => {
        const nn = normalize(nl);
        if (!nn) return false;
        // Check if they share a common prefix of at least 10 chars
        const minLen = Math.min(refNorm.length, nn.length);
        let common = 0;
        for (let i = 0; i < minLen; i++) {
          if (refNorm[i] === nn[i]) common++;
          else break;
        }
        return common >= Math.min(10, minLen * 0.5);
      });

      if (closeMatch) {
        results.push({ type: 'changed', refLine, newLine: closeMatch, lineNum });
        // Remove from consideration
        newNormSet.delete(normalize(closeMatch));
      } else {
        results.push({ type: 'missing', refLine, lineNum });
      }
    }
  }

  // Second pass: find lines in new that aren't in reference
  for (const newLine of newLines) {
    const newNorm = normalize(newLine);
    if (!newNorm) continue;
    if (!refNormSet.has(newNorm) && !results.some(r => r.newLine && normalize(r.newLine!) === newNorm)) {
      lineNum++;
      results.push({ type: 'added', newLine, lineNum });
    }
  }

  return results;
}

// Analyze pixel diff regions to describe WHERE differences are on the page
function describeDiffRegions(
  img1: HTMLImageElement,
  img2: HTMLImageElement,
  threshold: number
): { regions: { zone: string; percent: number }[]; totalPercent: number } {
  const W = 600;
  const H = 800;

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

  // Divide into a 3x3 grid
  const zoneNames = [
    'Top-Left', 'Top-Center', 'Top-Right',
    'Middle-Left', 'Middle-Center', 'Middle-Right',
    'Bottom-Left', 'Bottom-Center', 'Bottom-Right'
  ];
  const zoneW = Math.floor(W / 3);
  const zoneH = Math.floor(H / 3);
  const zoneDiffs = new Array(9).fill(0);
  const zonePixels = new Array(9).fill(0);
  let totalDiff = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const maxDiff = Math.max(
        Math.abs(d1[i] - d2[i]),
        Math.abs(d1[i+1] - d2[i+1]),
        Math.abs(d1[i+2] - d2[i+2])
      );
      const col = Math.min(Math.floor(x / zoneW), 2);
      const row = Math.min(Math.floor(y / zoneH), 2);
      const zoneIdx = row * 3 + col;
      zonePixels[zoneIdx]++;
      if (maxDiff > t) {
        zoneDiffs[zoneIdx]++;
        totalDiff++;
      }
    }
  }

  const regions = zoneNames.map((zone, i) => ({
    zone,
    percent: zonePixels[i] > 0 ? Math.round((zoneDiffs[i] / zonePixels[i]) * 10000) / 100 : 0
  })).filter(r => r.percent > 0.05) // Only include zones with meaningful differences
    .sort((a, b) => b.percent - a.percent);

  const totalPercent = Math.round((totalDiff / (W * H)) * 10000) / 100;
  return { regions, totalPercent };
}

// Generate an HTML report and trigger download
function downloadReport(
  diffs: DiffItem[],
  refLabel: string,
  newLabel: string,
  diffPercent: number | null,
  refLines: string[],
  newLines: string[],
  diffRegions: { zone: string; percent: number }[]
) {
  const changes = diffs.filter(d => d.type !== 'match');
  const missing = diffs.filter(d => d.type === 'missing');
  const changed = diffs.filter(d => d.type === 'changed');
  const added = diffs.filter(d => d.type === 'added');
  const matched = diffs.filter(d => d.type === 'match');
  const noTextExtracted = refLines.length === 0 && newLines.length === 0;

  const now = new Date().toLocaleString();

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Artwork Comparison Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
  h1 { color: #7c3aed; font-size: 22px; border-bottom: 2px solid #7c3aed; padding-bottom: 8px; }
  h2 { color: #374151; font-size: 16px; margin-top: 28px; }
  .summary { background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0; }
  .green { color: #059669; }
  .red { color: #dc2626; }
  .orange { color: #d97706; }
  .blue { color: #2563eb; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th { background: #f9fafb; text-align: left; padding: 8px 12px; border-bottom: 2px solid #e5e7eb; font-size: 11px; text-transform: uppercase; color: #6b7280; }
  td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr.changed td { background: #fffbeb; }
  tr.missing td { background: #fef2f2; }
  tr.added td { background: #eff6ff; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  .no-issues { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 20px; text-align: center; color: #065f46; }
  .warning { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 16px 0; color: #92400e; }
  .region-bar { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .region-name { width: 120px; font-size: 13px; color: #374151; }
  .region-fill { height: 20px; border-radius: 4px; background: #fbbf24; min-width: 4px; }
  .region-pct { font-size: 12px; color: #6b7280; width: 50px; }
  .grid-visual { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; width: 200px; margin: 16px auto; }
  .grid-cell { aspect-ratio: 1; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: white; }
</style></head><body>`;

  html += `<h1>Artwork Comparison Report</h1>`;
  html += `<div class="summary">`;
  html += `<div><strong>Reference:</strong> ${refLabel}</div>`;
  html += `<div><strong>New Artwork:</strong> ${newLabel}</div>`;
  html += `<div><strong>Generated:</strong> ${now}</div>`;
  if (diffPercent !== null) {
    html += `<div><strong>Visual difference:</strong> ${diffPercent}% of pixels differ</div>`;
    if (diffPercent === 0) {
      html += `<div style="margin-top:8px;color:#059669;font-weight:600;">The artworks appear visually identical.</div>`;
    }
  }
  html += `</div>`;

  // Visual difference regions — always show this
  if (diffRegions.length > 0) {
    html += `<h2>Where Differences Were Found</h2>`;
    html += `<p style="font-size:13px;color:#6b7280;">The page was divided into a 3&times;3 grid. These areas have visual differences:</p>`;

    // Grid visualization
    const zoneNames = ['Top-Left', 'Top-Center', 'Top-Right', 'Middle-Left', 'Middle-Center', 'Middle-Right', 'Bottom-Left', 'Bottom-Center', 'Bottom-Right'];
    html += `<div class="grid-visual">`;
    for (const zone of zoneNames) {
      const match = diffRegions.find(r => r.zone === zone);
      const pct = match ? match.percent : 0;
      const intensity = Math.min(pct * 10, 100);
      const bg = pct > 0 ? `hsl(40, 100%, ${80 - intensity * 0.4}%)` : '#e5e7eb';
      const color = pct > 1 ? 'white' : '#6b7280';
      html += `<div class="grid-cell" style="background:${bg};color:${color}">${pct > 0 ? pct.toFixed(1) + '%' : '—'}</div>`;
    }
    html += `</div>`;

    // Bar chart
    html += `<div style="margin-top:16px">`;
    const maxPct = Math.max(...diffRegions.map(r => r.percent));
    for (const r of diffRegions) {
      const barW = maxPct > 0 ? Math.max((r.percent / maxPct) * 100, 4) : 4;
      html += `<div class="region-bar">`;
      html += `<span class="region-name">${r.zone}</span>`;
      html += `<div class="region-fill" style="width:${barW}%"></div>`;
      html += `<span class="region-pct">${r.percent.toFixed(2)}%</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  } else if (diffPercent !== null && diffPercent === 0) {
    html += `<div class="no-issues">No visual differences detected. The artworks appear identical.</div>`;
  }

  // Text comparison section
  if (noTextExtracted) {
    html += `<h2>Text Comparison</h2>`;
    html += `<div class="warning">`;
    html += `<strong>No extractable text found in either PDF.</strong><br>`;
    html += `This is common with packaging artwork — designers often convert text to outlines (vector paths) for print compatibility. `;
    html += `The text you see in the artwork is actually drawn as shapes, not characters.<br><br>`;
    html += `<strong>What you can do:</strong> Use the visual comparison above to identify which areas of the artwork have changed, `;
    html += `then manually check those regions in the Side by Side or Slider view.`;
    html += `</div>`;
  } else {
    // Text stats
    if (refLines.length > 0 || newLines.length > 0) {
      html += `<h2>Text Comparison</h2>`;
      html += `<table><tr>`;
      html += `<th style="text-align:center">Matched</th><th style="text-align:center">Changed</th><th style="text-align:center">Missing</th><th style="text-align:center">Added</th>`;
      html += `</tr><tr>`;
      html += `<td style="text-align:center;font-size:20px;font-weight:700" class="green">${matched.length}</td>`;
      html += `<td style="text-align:center;font-size:20px;font-weight:700" class="orange">${changed.length}</td>`;
      html += `<td style="text-align:center;font-size:20px;font-weight:700" class="red">${missing.length}</td>`;
      html += `<td style="text-align:center;font-size:20px;font-weight:700" class="blue">${added.length}</td>`;
      html += `</tr></table>`;
    }

    if (changes.length === 0 && (refLines.length > 0 || newLines.length > 0)) {
      html += `<div class="no-issues">All extracted text matches between the two artworks.</div>`;
    }

    if (changed.length > 0) {
      html += `<h2>Changed Text (${changed.length})</h2>`;
      html += `<p style="font-size:13px;color:#6b7280;">These lines exist in both but have differences:</p>`;
      html += `<table><tr><th>#</th><th>Reference</th><th>New Artwork</th></tr>`;
      changed.forEach((d, i) => {
        html += `<tr class="changed"><td>${i + 1}</td><td>${d.refLine}</td><td>${d.newLine}</td></tr>`;
      });
      html += `</table>`;
    }

    if (missing.length > 0) {
      html += `<h2>Missing from New Artwork (${missing.length})</h2>`;
      html += `<p style="font-size:13px;color:#6b7280;">These lines appear in the reference but are missing from the new artwork:</p>`;
      html += `<table><tr><th>#</th><th>Missing Text</th></tr>`;
      missing.forEach((d, i) => {
        html += `<tr class="missing"><td>${i + 1}</td><td>${d.refLine}</td></tr>`;
      });
      html += `</table>`;
    }

    if (added.length > 0) {
      html += `<h2>Added in New Artwork (${added.length})</h2>`;
      html += `<p style="font-size:13px;color:#6b7280;">These lines appear in the new artwork but not in the reference:</p>`;
      html += `<table><tr><th>#</th><th>Added Text</th></tr>`;
      added.forEach((d, i) => {
        html += `<tr class="added"><td>${i + 1}</td><td>${d.newLine}</td></tr>`;
      });
      html += `</table>`;
    }

    if (refLines.length > 0 || newLines.length > 0) {
      html += `<h2>Full Text Extracted</h2>`;
      html += `<table><tr><th>Reference (${refLines.length} lines)</th><th>New Artwork (${newLines.length} lines)</th></tr>`;
      const maxLen = Math.max(refLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        html += `<tr><td>${refLines[i] || '<em style="color:#ccc">—</em>'}</td><td>${newLines[i] || '<em style="color:#ccc">—</em>'}</td></tr>`;
      }
      html += `</table>`;
    }
  }

  html += `<div class="footer">Generated by With The Tide — Artwork Comparison Tool</div>`;
  html += `</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `artwork-comparison-report-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// Generate a highlight overlay
function buildHighlightOverlay(
  img1: HTMLImageElement,
  img2: HTMLImageElement,
  threshold: number
): { overlayUrl: string; diffPercent: number; width: number; height: number } {
  const W = Math.max(img1.naturalWidth, img2.naturalWidth);
  const H = Math.max(img1.naturalHeight, img2.naturalHeight);

  const c1 = document.createElement('canvas');
  c1.width = W; c1.height = H;
  const ctx1 = c1.getContext('2d')!;
  ctx1.fillStyle = '#fff';
  ctx1.fillRect(0, 0, W, H);
  ctx1.drawImage(img1, 0, 0, W, H);

  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const ctx2 = c2.getContext('2d')!;
  ctx2.fillStyle = '#fff';
  ctx2.fillRect(0, 0, W, H);
  ctx2.drawImage(img2, 0, 0, W, H);

  const d1 = ctx1.getImageData(0, 0, W, H).data;
  const d2 = ctx2.getImageData(0, 0, W, H).data;
  const t = threshold * 255;

  const blockSize = 8;
  const cols = Math.ceil(W / blockSize);
  const rows = Math.ceil(H / blockSize);
  const diffGrid: boolean[][] = [];
  let totalDiffPixels = 0;

  for (let by = 0; by < rows; by++) {
    diffGrid[by] = [];
    for (let bx = 0; bx < cols; bx++) {
      let blockDiff = 0;
      const startX = bx * blockSize;
      const startY = by * blockSize;
      const endX = Math.min(startX + blockSize, W);
      const endY = Math.min(startY + blockSize, H);
      const blockPixels = (endX - startX) * (endY - startY);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = (y * W + x) * 4;
          const maxDiff = Math.max(
            Math.abs(d1[i] - d2[i]),
            Math.abs(d1[i+1] - d2[i+1]),
            Math.abs(d1[i+2] - d2[i+2])
          );
          if (maxDiff > t) blockDiff++;
        }
      }
      const isDiff = blockDiff > blockPixels * 0.15;
      diffGrid[by][bx] = isDiff;
      if (isDiff) totalDiffPixels += blockDiff;
    }
  }

  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d')!;
  octx.fillStyle = 'rgba(255, 220, 0, 0.35)';
  octx.strokeStyle = 'rgba(255, 180, 0, 0.7)';
  octx.lineWidth = 1.5;

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      if (diffGrid[by][bx]) {
        const x = bx * blockSize;
        const y = by * blockSize;
        octx.fillRect(x, y, blockSize, blockSize);
        const top = by === 0 || !diffGrid[by-1][bx];
        const bottom = by === rows - 1 || !diffGrid[by+1]?.[bx];
        const left = bx === 0 || !diffGrid[by][bx-1];
        const right = bx === cols - 1 || !diffGrid[by][bx+1];
        octx.beginPath();
        if (top) { octx.moveTo(x, y); octx.lineTo(x + blockSize, y); }
        if (bottom) { octx.moveTo(x, y + blockSize); octx.lineTo(x + blockSize, y + blockSize); }
        if (left) { octx.moveTo(x, y); octx.lineTo(x, y + blockSize); }
        if (right) { octx.moveTo(x + blockSize, y); octx.lineTo(x + blockSize, y + blockSize); }
        octx.stroke();
      }
    }
  }

  const diffPercent = Math.round((totalDiffPixels / (W * H)) * 10000) / 100;
  return { overlayUrl: overlay.toDataURL('image/png'), diffPercent, width: W, height: H };
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
  const [showHighlights, setShowHighlights] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);

  const [refDataUrl, setRefDataUrl] = useState<string | null>(null);
  const [newDataUrl, setNewDataUrl] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panStartOffset = useRef({ x: 0, y: 0 });

  const [sliderPos, setSliderPos] = useState(50);
  const isDraggingSlider = useRef(false);
  const sliderContainerRef = useRef<HTMLDivElement>(null);

  // Check if either file is a PDF (report only works for PDFs)
  const refIsPdf = /\.pdf(\?|#|$)/i.test(referenceUrl);
  const newIsPdf = /\.pdf(\?|#|$)/i.test(newUrl);
  const bothPdf = refIsPdf && newIsPdf;

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

  // Build highlight overlay
  useEffect(() => {
    if (!refDataUrl || !newDataUrl) return;
    const img1 = new Image();
    const img2 = new Image();
    let loaded = 0;
    const check = () => {
      loaded++;
      if (loaded === 2) {
        try {
          const result = buildHighlightOverlay(img1, img2, 0.1);
          setOverlayUrl(result.overlayUrl);
          setDiffPercent(result.diffPercent);
        } catch { /* ignore */ }
      }
    };
    img1.onload = check;
    img2.onload = check;
    img1.src = refDataUrl;
    img2.src = newDataUrl;
  }, [refDataUrl, newDataUrl]);

  // Generate report
  const handleGenerateReport = useCallback(async () => {
    if (!bothPdf) return;
    setGeneratingReport(true);
    try {
      // Extract text and load images in parallel
      const [refLines, newLines, refData, newData] = await Promise.all([
        extractPdfText(referenceUrl),
        extractPdfText(newUrl),
        urlToDataUrl(referenceUrl),
        urlToDataUrl(newUrl),
      ]);
      const diffs = compareTextLines(refLines, newLines);

      // Load images for visual region analysis
      const loadImg = (src: string): Promise<HTMLImageElement> =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [img1, img2] = await Promise.all([
        loadImg(refData.dataUrl),
        loadImg(newData.dataUrl),
      ]);
      const { regions } = describeDiffRegions(img1, img2, sensitivity);

      downloadReport(diffs, referenceLabel, newLabel, diffPercent, refLines, newLines, regions);
    } catch (err: any) {
      alert('Failed to generate report: ' + (err.message || 'Unknown error'));
    }
    setGeneratingReport(false);
  }, [referenceUrl, newUrl, referenceLabel, newLabel, diffPercent, bothPdf, sensitivity]);

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

  // Slider wipe drag
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

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [viewMode]);

  const imgStyle: React.CSSProperties = {
    transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
    transformOrigin: 'center center',
    transition: isPanning.current ? 'none' : 'transform 0.15s ease-out',
  };

  const overlayStyle: React.CSSProperties = {
    ...imgStyle,
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
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
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-4 bg-white flex-wrap">
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

          {/* Highlight toggle */}
          <button
            onClick={() => setShowHighlights(!showHighlights)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              showHighlights
                ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}
          >
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: showHighlights ? 'rgba(255,220,0,0.6)' : '#ccc' }} />
            Highlights {showHighlights ? 'On' : 'Off'}
          </button>

          {/* Generate Report button (only for PDFs) */}
          {bothPdf && (
            <button
              onClick={handleGenerateReport}
              disabled={generatingReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border bg-green-50 border-green-300 text-green-800 hover:bg-green-100 disabled:opacity-50"
            >
              <Icon name="FileText" size={14} />
              {generatingReport ? 'Generating...' : 'Generate Report'}
            </button>
          )}

          {/* Zoom slider */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500">Zoom</span>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.1"
              value={zoom}
              onChange={e => setZoom(parseFloat(e.target.value))}
              className="w-28 accent-purple-600"
            />
            <span className="text-xs text-gray-600 w-10">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              className="text-xs text-purple-600 hover:text-purple-800 font-medium"
            >
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
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
                >
                  <div className="flex flex-col overflow-hidden">
                    <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1 text-center shrink-0">Reference</p>
                    <p className="text-xs text-gray-400 text-center mb-1 truncate shrink-0">{referenceLabel}</p>
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex items-center justify-center relative">
                      <img src={refDataUrl} alt="Reference" style={imgStyle} className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
                      {showHighlights && overlayUrl && (
                        <img src={overlayUrl} alt="" style={overlayStyle} className="max-w-full max-h-full object-contain" draggable={false} />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1 text-center shrink-0">New Artwork</p>
                    <p className="text-xs text-gray-400 text-center mb-1 truncate shrink-0">{newLabel}</p>
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex items-center justify-center relative">
                      <img src={newDataUrl} alt="New" style={imgStyle} className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
                      {showHighlights && overlayUrl && (
                        <img src={overlayUrl} alt="" style={overlayStyle} className="max-w-full max-h-full object-contain" draggable={false} />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'slider' && (
                <div
                  ref={sliderContainerRef}
                  className="relative h-full select-none overflow-hidden"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{ cursor: isPanning.current ? 'grabbing' : 'default' }}
                >
                  <div className="absolute inset-0 flex items-center justify-center bg-white">
                    <img src={newDataUrl} alt="New" style={imgStyle} className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
                    {showHighlights && overlayUrl && (
                      <img src={overlayUrl} alt="" style={overlayStyle} className="max-w-full max-h-full object-contain" draggable={false} />
                    )}
                  </div>
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-white"
                    style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                  >
                    <img src={refDataUrl} alt="Reference" style={imgStyle} className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
                    {showHighlights && overlayUrl && (
                      <img src={overlayUrl} alt="" style={overlayStyle} className="max-w-full max-h-full object-contain" draggable={false} />
                    )}
                  </div>
                  <div
                    className="absolute top-0 bottom-0 z-10"
                    style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
                  >
                    <div className="w-0.5 h-full bg-purple-600" />
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
