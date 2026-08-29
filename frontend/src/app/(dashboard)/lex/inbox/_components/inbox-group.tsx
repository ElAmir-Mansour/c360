'use client';

/**
 * <InboxGroup> — one kind section (header + count badge + description + rows).
 *
 * The header carries a tinted icon chip and a neutral count badge; rows render
 * via <InboxRow>. Each kind maps to a distinct lucide icon so the queue reads at
 * a glance. Bilingual + RTL-safe (logical spacing; host stamps `dir`).
 */

import {
  FileSignature,
  BriefcaseBusiness,
  Gavel,
  Handshake,
  Headphones,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import type { InboxItem, InboxKind } from '../_lib/use-inbox';
import { useInboxLabels } from '../_lib/labels';
import { InboxRow } from './inbox-row';

/** Per-kind icon + tint. Tints use full literal classes for the JIT scanner. */
const KIND_META: Record<InboxKind, { icon: LucideIcon; chip: string }> = {
  settlement: { icon: Handshake, chip: 'bg-warning-500/10 text-warning-700 dark:text-warning-300' },
  case: { icon: BriefcaseBusiness, chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  contract: { icon: FileSignature, chip: 'bg-brand-primary-500/10 text-brand-primary-600 dark:text-brand-primary-400' },
  governance: { icon: Gavel, chip: 'bg-brand-teal-500/10 text-brand-teal-700 dark:text-brand-teal-300' },
  workflow: { icon: ListChecks, chip: 'bg-brand-accent-500/10 text-brand-accent-700 dark:text-brand-accent-300' },
  request: { icon: Headphones, chip: 'bg-brand-primary-500/10 text-brand-primary-600 dark:text-brand-primary-400' },
};

interface InboxGroupProps {
  kind: InboxKind;
  items: InboxItem[];
  onDecide: (item: InboxItem) => void;
}

export function InboxGroup({ kind, items, onDecide }: InboxGroupProps) {
  const L = useInboxLabels();
  const f = useLexFormat();
  const meta = KIND_META[kind];
  const Icon = meta.icon;

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className={cn('grid h-8 w-8 place-items-center rounded-lg', meta.chip)}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {L.kinds[kind]}
          </h2>
          <p className="truncate text-xs text-muted-foreground">{L.kindDescription[kind]}</p>
        </div>
        <span className="badge-base badge-neutral ms-auto tabular-nums">
          {L.groupCount(f.formatNumber(items.length))}
        </span>
      </header>

      <div className="space-y-2">
        {items.map((item) => (
          <InboxRow key={item.id} item={item} icon={Icon} onDecide={onDecide} />
        ))}
      </div>
    </section>
  );
}
