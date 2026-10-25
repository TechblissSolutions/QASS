'use client';

import { useEffect, useRef, useState } from 'react';

interface SmartLogoProps {
  src?: string;
  alt?: string;
  className?: string;
  fallback?: string;
}

/** Displays scraped logos while trimming common white/transparent padding.
 * The image is loaded through Sparrow's same-origin proxy, so a small canvas
 * inspection can safely find the visible mark without changing the stored URL.
 */
export default function SmartLogo({ src, alt = '', className = '', fallback = '' }: SmartLogoProps) {
  const [crop, setCrop] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [direct, setDirect] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setCrop(null);
    setFailed(false);
    setDirect(false);
  }, [src]);

  // The same-origin logo proxy can fail (blocked host, odd MIME type). Fall back to the raw URL.
  const rawSrc = (() => { try { const m = String(src || '').match(/^\/api\/brand-logo\?src=(.+)$/); return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; } })();
  const activeSrc = direct && rawSrc ? rawSrc : src;
  const handleError = () => { if (!direct && rawSrc) setDirect(true); else setFailed(true); };

  const inspect = () => {
    const img = imgRef.current;
    if (!img || !src || !img.naturalWidth || !img.naturalHeight) return;
    try {
      const maxSide = 320;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const a = data[i + 3];
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const visible = a > 18 && !(r > 246 && g > 246 && b > 246);
          if (visible) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
        }
      }
      if (maxX < 0 || maxY < 0) return;
      const padX = Math.max(2, Math.round((maxX - minX + 1) * 0.06));
      const padY = Math.max(2, Math.round((maxY - minY + 1) * 0.06));
      const x = Math.max(0, minX - padX);
      const y = Math.max(0, minY - padY);
      const w = Math.min(width - x, maxX - minX + 1 + padX * 2);
      const h = Math.min(height - y, maxY - minY + 1 + padY * 2);
      const changed = x > width * 0.04 || y > height * 0.04 || w < width * 0.92 || h < height * 0.92;
      if (changed) setCrop({ left: x / width, top: y / height, width: w / width, height: h / height });
    } catch {
      // If a remote format cannot be inspected, fall back to normal contain.
    }
  };

  if (!src || failed) return fallback ? <span className={className}>{fallback}</span> : null;

  return <span className={`smart-logo ${className}`} aria-hidden={alt ? undefined : true}>
    <span className="smart-logo-viewport">
      {crop ? <img src={activeSrc} alt={alt} className="smart-logo-cropped" style={{ left: `${(-crop.left / crop.width) * 100}%`, top: `${(-crop.top / crop.height) * 100}%`, width: `${100 / crop.width}%`, height: `${100 / crop.height}%` }} /> : <img ref={imgRef} src={activeSrc} alt={alt} className="smart-logo-image" onLoad={inspect} onError={handleError} />}
    </span>
  </span>;
}
