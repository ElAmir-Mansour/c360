'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { MITRECoverage } from '@/types/cyber';

import { useRulesLabels } from '../_lib/rules-i18n';

interface RuleMitreSelectorProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

export function RuleMitreSelector({ value, onChange }: RuleMitreSelectorProps) {
  const labels = useRulesLabels();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const { data: envelope } = useQuery({
    queryKey: ['mitre-coverage-for-selector'],
    queryFn: () => apiGet<{ data: MITRECoverage }>(API_ENDPOINTS.CYBER_MITRE_COVERAGE),
    staleTime: 300000,
  });

  const techniques = envelope?.data?.techniques ?? [];
  const filtered = techniques.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.technique_id.toLowerCase().includes(q) || t.technique_name.toLowerCase().includes(q);
  });

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((id) => {
          const technique = techniques.find((item) => item.technique_id === id);
          return (
            <Badge key={id} variant="secondary" className="gap-1 ps-2 pe-1 font-mono">
              {id}
              {technique && <span className="ms-0.5 max-w-[80px] sm:max-w-[120px] truncate text-xs text-muted-foreground">— {technique.technique_name}</span>}
              <button
                type="button"
                onClick={() => remove(id)}
                className="ms-0.5 rounded hover:bg-muted"
                aria-label={labels.mitreSelector.removeAria(id)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" type="button">
            <Search className="me-1.5 h-3.5 w-3.5" />
            {labels.mitreSelector.addTechnique}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <Input
            placeholder={labels.mitreSelector.searchPlaceholder}
            className="mb-2 h-7 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <ScrollArea className="h-56">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{labels.mitreSelector.noTechniques}</p>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((technique) => (
                  <button
                    key={technique.technique_id}
                    type="button"
                    className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-start text-xs transition-colors hover:bg-muted/50 ${
                      value.includes(technique.technique_id) ? 'bg-primary/10 font-medium' : ''
                    }`}
                    onClick={() => toggle(technique.technique_id)}
                  >
                    <span className="shrink-0 font-mono text-muted-foreground">{technique.technique_id}</span>
                    <span className="truncate">{technique.technique_name}</span>
                    {value.includes(technique.technique_id) && <span className="ms-auto text-primary">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
