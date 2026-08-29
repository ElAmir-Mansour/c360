'use client';

import type { AssetScan } from '@/types/cyber';
import { useAssetLabels } from '../../../_lib/assets-i18n';

interface Props {
  scan: AssetScan;
}

export function ScanProgressIndicator({ scan }: Props) {
  const t = useAssetLabels();
  if (scan.status !== 'running') return null;

  const elapsed = scan.started_at
    ? Math.floor((Date.now() - new Date(scan.started_at).getTime()) / 1000)
    : 0;

  const assetsFound = scan.assets_found;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          <h3 className="text-sm font-semibold">{t.scanPanels.inProgress}</h3>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {elapsed < 60
            ? t.scanPanels.elapsedSec(elapsed)
            : t.scanPanels.elapsedMin(Math.floor(elapsed / 60), elapsed % 60)}
        </span>
      </div>

      {/* Indeterminate progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full animate-[progress_1.5s_ease-in-out_infinite] rounded-full bg-blue-500" />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {assetsFound > 0
          ? t.scanPanels.discoveredSoFar(assetsFound)
          : t.scanPanels.scanningForAssets}
      </p>

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%) scaleX(0.3); }
          50% { transform: translateX(50%) scaleX(0.7); }
          100% { transform: translateX(200%) scaleX(0.3); }
        }
      `}</style>
    </div>
  );
}
