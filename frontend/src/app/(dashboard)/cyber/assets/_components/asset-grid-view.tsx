'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { MoreHorizontal, Pencil, Trash2, Tag, ShieldAlert } from 'lucide-react';
import { TYPE_ICONS } from './asset-columns';
import { cn } from '@/lib/utils';
import type { CyberAsset } from '@/types/cyber';
import { useAssetLabels } from '../_lib/assets-i18n';

const STATUS_COLORS = {
  active: 'bg-primary/15 text-primary dark:bg-primary/30 dark:text-primary',
  inactive: 'bg-secondary text-foreground dark:bg-neutral-ink dark:text-foreground/45',
  decommissioned: 'bg-error-100 text-error-700 dark:bg-error-700/30 dark:text-error-300',
  unknown: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
};

interface AssetGridViewProps {
  assets: CyberAsset[];
  onEdit?: (asset: CyberAsset) => void;
  onDelete?: (asset: CyberAsset) => void;
  onTag?: (asset: CyberAsset) => void;
}

export function AssetGridView({ assets, onEdit, onDelete, onTag }: AssetGridViewProps) {
  const t = useAssetLabels();
  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ShieldAlert className="mb-3 h-10 w-10 opacity-40" />
        <p className="text-sm">{t.grid.emptyTitle}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {assets.map((asset) => {
        const Icon = TYPE_ICONS[asset.type] ?? TYPE_ICONS.server;
        const vulnCount = asset.vulnerability_count ?? 0;
        const critVulns = asset.critical_vuln_count ?? 0;

        return (
          <div
            key={asset.id}
            className="group relative rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <Link href={`/cyber/assets/${asset.id}`} className="flex min-w-0 items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold hover:underline">{asset.name}</p>
                  <p className="text-xs text-muted-foreground">{t.typeLabels[asset.type] ?? asset.type}</p>
                </div>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 opacity-0 group-hover:opacity-100"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit?.(asset)}>
                    <Pencil className="me-2 h-3.5 w-3.5" /> {t.rowActions.edit}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTag?.(asset)}>
                    <Tag className="me-2 h-3.5 w-3.5" /> {t.rowActions.manageTags}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => onDelete?.(asset)}>
                    <Trash2 className="me-2 h-3.5 w-3.5" /> {t.rowActions.delete}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Details */}
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t.grid.criticality}</span>
                <SeverityIndicator severity={asset.criticality} showLabel />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t.grid.status}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[asset.status] ?? STATUS_COLORS.unknown)}>
                  {t.statusLabels[asset.status] ?? asset.status}
                </span>
              </div>

              {asset.ip_address && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t.grid.ip}</span>
                  <span className="font-mono">{asset.ip_address}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t.grid.vulnerabilities}</span>
                <span className={cn(
                  'font-medium tabular-nums',
                  critVulns > 0 ? 'text-error-500' : vulnCount > 0 ? 'text-warning-700 dark:text-warning-300' : 'text-primary',
                )}>
                  {vulnCount} {critVulns > 0 && <span className="text-xs">{t.grid.critShort(critVulns)}</span>}
                </span>
              </div>
            </div>

            {/* Tags */}
            {(asset.tags?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {asset.tags.slice(0, 4).map((tag) => (
                  <Badge key={tag} variant="secondary" className="px-1.5 py-0.5 text-xs">
                    {tag}
                  </Badge>
                ))}
                {asset.tags.length > 4 && (
                  <span className="text-xs text-muted-foreground">+{asset.tags.length - 4}</span>
                )}
              </div>
            )}

            {asset.owner && (
              <p className="mt-2 truncate text-xs text-muted-foreground">{asset.owner}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
