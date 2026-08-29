/**
 * Client-side export helpers for the org-chart SVG. No new dependencies: SVG is
 * serialised with the platform XMLSerializer; PNG is rasterised by drawing the
 * serialised SVG onto an offscreen <canvas> via an <img> data URL.
 *
 * All functions are browser-only and no-op safely under SSR (guarded on
 * `typeof window`).
 */

/** Inline the computed font + a white backdrop so exports are self-contained. */
function prepareClone(svg: SVGSVGElement): { clone: SVGSVGElement; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const width = Math.max(1, Math.round(vb && vb.width ? vb.width : rect.width));
  const height = Math.max(1, Math.round(vb && vb.height ? vb.height : rect.height));

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  // White background rect so PNG/SVG don't render on transparency.
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', vb ? String(vb.x) : '0');
  bg.setAttribute('y', vb ? String(vb.y) : '0');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  return { clone, width, height };
}

function serialize(svg: SVGSVGElement): { source: string; width: number; height: number } {
  const { clone, width, height } = prepareClone(svg);
  const source = new XMLSerializer().serializeToString(clone);
  return { source: `<?xml version="1.0" standalone="no"?>\n${source}`, width, height };
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download the live chart SVG as a `.svg` file. */
export function exportSvg(svg: SVGSVGElement | null, filename = 'org-chart.svg'): void {
  if (typeof window === 'undefined' || !svg) return;
  const { source } = serialize(svg);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  // Revoke after the click has had a chance to dispatch.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Rasterise the chart SVG to a PNG and download it. `scale` (default 2)
 * controls pixel density for crisp output. Resolves once the download has been
 * triggered, rejects if the SVG image fails to load.
 */
export function exportPng(
  svg: SVGSVGElement | null,
  filename = 'org-chart.png',
  scale = 2,
): Promise<void> {
  if (typeof window === 'undefined' || !svg) return Promise.resolve();
  const { source, width, height } = serialize(svg);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('PNG encoding failed'));
            return;
          }
          const url = URL.createObjectURL(blob);
          triggerDownload(url, filename);
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          resolve();
        }, 'image/png');
      } catch (err) {
        reject(err instanceof Error ? err : new Error('PNG export failed'));
      }
    };
    img.onerror = () => reject(new Error('Failed to rasterise SVG'));
    img.src = svgUrl;
  });
}

/** Open the browser print dialog (user can choose "Save as PDF"). */
export function printChart(): void {
  if (typeof window === 'undefined') return;
  window.print();
}
