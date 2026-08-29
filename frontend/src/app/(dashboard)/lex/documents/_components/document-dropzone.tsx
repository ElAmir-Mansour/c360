/**
 * DocumentDropzone — full-region drag-and-drop upload UX for the Watheeq legal
 * documents repository.
 *
 * It wraps arbitrary children and listens (via window/document) for drag
 * activity carrying files. While files are being dragged anywhere over the
 * wrapped region, a solid dashed-ring overlay ("Drop files to upload") is shown.
 * On drop it prevents the browser default (file navigation), collects
 * `e.dataTransfer.files`, and hands them up via `onFiles(File[])`.
 *
 * This component ONLY handles the drop UX — it does not upload anything. The
 * integrator wires `onFiles` to the page's existing create/upload flow (see the
 * integrator note at the bottom of this file).
 *
 * SSR-safe (all DOM access is guarded inside effects / event handlers).
 * Accessibility: the overlay is purely visual (`aria-hidden`); keyboard users
 * cannot trigger a drag, so the integrator MUST keep an explicit, focusable
 * upload button elsewhere on the page.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { IconBadge } from '@/components/shared/icon-badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';

/** Bilingual copy for the drag overlay. All fields optional — sensible
 * EN/AR defaults are resolved from the active locale when omitted. */
export interface DocumentDropzoneLabels {
  /** Primary overlay line, e.g. "Drop files to upload". */
  overlayTitle: string;
  /** Secondary overlay line, e.g. "Release to add them to this repository.". */
  overlayHint: string;
  /** Accessible label applied to the (visually decorative) drop region. */
  regionLabel: string;
}

const DEFAULT_LABELS: Record<'en' | 'ar', DocumentDropzoneLabels> = {
  en: {
    overlayTitle: 'Drop files to upload',
    overlayHint: 'Release to add them to this repository.',
    regionLabel: 'Document upload drop zone',
  },
  ar: {
    overlayTitle: 'أفلت الملفات للرفع',
    overlayHint: 'حرّر الملفات لإضافتها إلى هذا المستودع.',
    regionLabel: 'منطقة إفلات رفع الوثائق',
  },
};

export interface DocumentDropzoneProps {
  /** The region that accepts dropped files. */
  children: React.ReactNode;
  /** When true, drag listeners are inert and no overlay is shown. */
  disabled?: boolean;
  /**
   * Called with the dropped File[] (guaranteed non-empty) when the user drops
   * one or more files over the wrapped region. Wire this to your upload flow.
   */
  onFiles: (files: File[]) => void;
  /** Optional overlay copy overrides; falls back to bilingual defaults. */
  labels?: Partial<DocumentDropzoneLabels>;
  /** Extra classes for the wrapper element. */
  className?: string;
}

/** True when a drag event payload contains files (not text/links/etc.). */
function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (!types) return false;
  // `types` may be a DOMStringList or a string[] depending on the browser.
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

export function DocumentDropzone({
  children,
  disabled = false,
  onFiles,
  labels,
  className,
}: DocumentDropzoneProps) {
  const { locale } = useLocaleOrDefault();
  const resolved: DocumentDropzoneLabels = {
    ...(locale === 'ar' ? DEFAULT_LABELS.ar : DEFAULT_LABELS.en),
    ...labels,
  };

  const regionRef = useRef<HTMLDivElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // Depth counter: dragenter/dragleave fire per child element, so we count to
  // know when the pointer has truly left the wrapped region.
  const dragDepth = useRef(0);

  // Keep the latest onFiles without re-subscribing window listeners each render.
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  const reset = useCallback(() => {
    dragDepth.current = 0;
    setDragActive(false);
  }, []);

  useEffect(() => {
    if (disabled) {
      reset();
      return;
    }
    if (typeof window === 'undefined') return;

    const isWithinRegion = (target: EventTarget | null): boolean => {
      const node = regionRef.current;
      if (!node) return false;
      return target instanceof Node && node.contains(target);
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      if (!isWithinRegion(event.target)) return;
      dragDepth.current += 1;
      setDragActive(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      if (!isWithinRegion(event.target)) return;
      // Required so the drop event fires and the browser shows a copy cursor.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (!dragActive) setDragActive(true);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      if (!isWithinRegion(event.target)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    };

    const handleDrop = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) {
        // Non-file drag (text/link): let the browser handle it normally.
        reset();
        return;
      }
      if (!isWithinRegion(event.target)) {
        reset();
        return;
      }
      event.preventDefault();
      const fileList = event.dataTransfer?.files;
      const files = fileList ? Array.from(fileList) : [];
      reset();
      if (files.length > 0) {
        onFilesRef.current(files);
      }
    };

    // window-level drop prevention so a near-miss drop outside the region does
    // not navigate the browser away from the app.
    const preventWindowDrop = (event: DragEvent) => {
      if (dragHasFiles(event.dataTransfer)) {
        event.preventDefault();
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragover', preventWindowDrop);
    window.addEventListener('drop', preventWindowDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragover', preventWindowDrop);
      window.removeEventListener('drop', preventWindowDrop);
    };
  }, [disabled, dragActive, reset]);

  const overlayVisible = !disabled && dragActive;

  return (
    <div
      ref={regionRef}
      className={cn('relative', className)}
      aria-label={resolved.regionLabel}
      data-drag-active={overlayVisible ? 'true' : undefined}
    >
      {children}

      {overlayVisible ? (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-3',
            'rounded-2xl border-2 border-dashed border-primary/60',
            'bg-card text-center',
            'transition-opacity duration-150 motion-safe:animate-in motion-safe:fade-in',
          )}
        >
          <IconBadge icon={Upload} tone="primary" size="lg" />
          <div className="space-y-1 px-6">
            <p className="text-base font-semibold text-foreground">{resolved.overlayTitle}</p>
            <p className="text-sm text-muted-foreground">{resolved.overlayHint}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
