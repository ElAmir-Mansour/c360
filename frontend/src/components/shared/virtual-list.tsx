'use client';

import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Estimated row height in px (rows are measured precisely after mount). */
  estimateSize?: number;
  overscan?: number;
  /** Classes for the scroll container — MUST constrain height (e.g. max-h-[60vh]). */
  className?: string;
  getKey?: (item: T, index: number) => string | number;
}

/**
 * Windowed list for long client-side collections (notifications, audit streams,
 * search results). Only the visible rows + overscan are in the DOM, so a 10k-row
 * list stays smooth. The shared DataTable is server-paginated and does NOT need
 * this; reach for VirtualList when you render a large array in one scroll view.
 */
export function VirtualList<T>({
  items,
  renderItem,
  estimateSize = 56,
  overscan = 8,
  className,
  getKey,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  return (
    <div ref={parentRef} className={cn('overflow-auto', className)}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={getKey ? getKey(item, virtualRow.index) : virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
