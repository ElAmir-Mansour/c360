'use client';

import { type ContradictionStats } from '@/lib/data-suite';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import { cn } from '@/lib/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface ContradictionStatBarProps {
  stats: ContradictionStats;
  activeStatus?: string | string[];
  onFilterStatus: (status?: string) => void;
}

const STATUS_ORDER = ['detected', 'investigating', 'resolved', 'accepted', 'false_positive'] as const;

// Semantic tone per investigation status: open contradictions read as risk
// (rose), in-flight investigation as time/in-progress (gold), resolved as a
// success/pass (emerald), accepted/dismissed as a neutral outcome/category
// (sky / slate). Keeps the RAG mapping restrained — accent only.
const STATUS_TONE: Record<(typeof STATUS_ORDER)[number], StatTone> = {
  detected: 'rose',
  investigating: 'gold',
  resolved: 'emerald',
  accepted: 'sky',
  false_positive: 'slate',
};

export function ContradictionStatBar({
  stats,
  activeStatus,
  onFilterStatus,
}: ContradictionStatBarProps) {
  const labels = useDataLabels();
  const active = Array.isArray(activeStatus) ? activeStatus[0] : activeStatus;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {STATUS_ORDER.map((status) => (
        <button
          key={status}
          type="button"
          aria-pressed={active === status}
          className={cn(
            'kpi-card-themed p-4 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            TONE_THEME_CLASS[STATUS_TONE[status]],
            active === status && 'ring-2 ring-primary/60',
          )}
          onClick={() => onFilterStatus(active === status ? undefined : status)}
        >
          <div
            className="text-overline font-semibold uppercase tracking-caps-wide"
            style={{ color: 'var(--kpi-accent)' }}
          >
            {labels.contradictions.status[status]}
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">
            {stats.by_status[status] ?? 0}
          </div>
        </button>
      ))}
    </div>
  );
}
