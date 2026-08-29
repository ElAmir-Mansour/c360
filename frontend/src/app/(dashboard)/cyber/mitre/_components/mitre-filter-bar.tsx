'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { useMitreLabels } from '../_lib/mitre-i18n';

export type MitreFilter = 'all' | 'covered' | 'gaps' | 'alerts';

interface MitreFilterBarProps {
  activeFilter: MitreFilter;
  onFilterChange: (filter: MitreFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
}

export function MitreFilterBar({
  activeFilter,
  onFilterChange,
  search,
  onSearchChange,
}: MitreFilterBarProps) {
  const t = useMitreLabels();
  const FILTERS: { value: MitreFilter; label: string }[] = [
    { value: 'all', label: t.filters.all },
    { value: 'covered', label: t.filters.covered },
    { value: 'gaps', label: t.filters.gapsOnly },
    { value: 'alerts', label: t.filters.withAlerts },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border bg-muted/30 p-0.5">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={activeFilter === f.value ? 'default' : 'ghost'}
            size="sm"
            className={`h-7 px-3 text-xs ${activeFilter === f.value ? '' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => onFilterChange(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <div className="relative">
        <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t.filters.searchPlaceholder}
          className="h-8 w-52 ps-8 text-xs"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
