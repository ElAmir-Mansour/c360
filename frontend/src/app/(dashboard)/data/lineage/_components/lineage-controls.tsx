'use client';

import { Button } from '@/components/ui/button';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface LineageControlsProps {
  direction: 'LR' | 'TB';
  onDirectionChange: (direction: 'LR' | 'TB') => void;
  onFit: () => void;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFullscreen: () => void;
}

export function LineageControls({
  direction,
  onDirectionChange,
  onFit,
  onReset,
  onZoomIn,
  onZoomOut,
  onFullscreen,
}: LineageControlsProps) {
  const labels = useDataLabels();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={direction === 'LR' ? 'default' : 'outline'} onClick={() => onDirectionChange('LR')}>
        {labels.lineage.horizontal}
      </Button>
      <Button type="button" size="sm" variant={direction === 'TB' ? 'default' : 'outline'} onClick={() => onDirectionChange('TB')}>
        {labels.lineage.vertical}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onFit}>
        {labels.lineage.fitToScreen}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onZoomIn}>
        {labels.lineage.zoomIn}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onZoomOut}>
        {labels.lineage.zoomOut}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onReset}>
        {labels.lineage.reset}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onFullscreen}>
        {labels.lineage.fullScreen}
      </Button>
    </div>
  );
}
