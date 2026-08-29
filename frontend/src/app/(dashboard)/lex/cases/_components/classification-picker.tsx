'use client';

/**
 * Case-type picker for intake.
 *
 * The taxonomy contains both canonical root case types and deeper cascade nodes
 * used to describe an existing case's escalation path. Intake must not offer
 * both representations of the same concept, so this picker deliberately lists
 * active roots only. Existing nested selections are still resolved and shown in
 * edit mode until the user deliberately replaces them.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import { casesApi, type CaseClassification } from '@/lib/lex/cases';
import { useCaseLabels } from './labels';

export interface ClassificationPickerSelection {
  id: string | null;
  node: CaseClassification | null;
  chain: CaseClassification[];
  metadata: Record<string, unknown> | null;
}

interface ClassificationPickerProps {
  id?: string;
  value?: string | null;
  selectedLabel?: string;
  otherSelected?: boolean;
  onChange: (id: string | null) => void;
  onOtherSelect?: () => void;
  onSelectionChange?: (selection: ClassificationPickerSelection) => void;
  disabled?: boolean;
}

interface ClassificationIndex {
  byId: Map<string, CaseClassification>;
  roots: CaseClassification[];
}

function compareClassification(a: CaseClassification, b: CaseClassification): number {
  return a.sort - b.sort || a.code.localeCompare(b.code);
}

/** Exported for focused tests: intake presents one canonical, active flat set. */
export function indexSelectableClassifications(nodes: CaseClassification[]): ClassificationIndex {
  const byId = new Map<string, CaseClassification>();
  const walk = (node: CaseClassification) => {
    byId.set(node.id, node);
    (node.children ?? []).forEach(walk);
  };
  nodes.forEach(walk);
  return {
    byId,
    roots: nodes.filter((node) => node.active).sort(compareClassification),
  };
}

function ancestorChain(
  byId: Map<string, CaseClassification>,
  selectedId: string | null,
): CaseClassification[] {
  if (!selectedId) return [];
  const chain: CaseClassification[] = [];
  let current = byId.get(selectedId);
  while (current) {
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return chain;
}

function buildSelection(
  byId: Map<string, CaseClassification>,
  selectedId: string | null,
): ClassificationPickerSelection {
  const node = selectedId ? byId.get(selectedId) ?? null : null;
  return {
    id: node?.id ?? null,
    node,
    chain: ancestorChain(byId, node?.id ?? null),
    metadata: node?.metadata ?? null,
  };
}

export function ClassificationPicker({
  id,
  value,
  selectedLabel: selectedLabelFallback,
  otherSelected = false,
  onChange,
  onOtherSelect,
  onSelectionChange,
  disabled,
}: ClassificationPickerProps) {
  const { locale } = useLocaleOrDefault();
  const picker = useCaseLabels().picker;
  const [open, setOpen] = useState(false);

  const treeQuery = useQuery({
    queryKey: ['lex-case-classifications', 'selectable'],
    queryFn: () =>
      casesApi.listSelectableClassifications({
        page: 1,
        per_page: 100,
        sort: 'sort',
        order: 'asc',
      }),
    staleTime: 60_000,
  });
  const index = useMemo(
    () => indexSelectableClassifications(treeQuery.data?.data ?? []),
    [treeQuery.data],
  );
  const selected = value ? index.byId.get(value) ?? null : null;
  const selectedLabel = otherSelected
    ? picker.other
    : selected
      ? resolveLocalized(selected.name, locale) || selected.code
      : value && selectedLabelFallback
        ? selectedLabelFallback
      : picker.select;

  const selectClassification = (classification: CaseClassification) => {
    onChange(classification.id);
    onSelectionChange?.(buildSelection(index.byId, classification.id));
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    onSelectionChange?.(buildSelection(index.byId, null));
  };

  return (
    <div className="flex min-w-0 gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-label={picker.label}
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={disabled}
            className="min-w-0 flex-1 justify-between font-normal"
          >
            <span
              className={cn(
                'min-w-0 truncate text-start',
                !selected && !otherSelected && !selectedLabelFallback && 'text-muted-foreground',
              )}
            >
              {selectedLabel}
            </span>
            {treeQuery.isLoading ? (
              <Loader2 className="ms-2 h-4 w-4 shrink-0 animate-spin opacity-60" aria-hidden />
            ) : (
              <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="p-0"
          style={{ width: 'var(--radix-popover-trigger-width)' }}
        >
          <Command>
            <CommandInput placeholder={picker.search} />
            <CommandList className="max-h-72">
              {treeQuery.isLoading ? (
                <div className="flex items-center justify-center px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  {picker.loading}
                </div>
              ) : treeQuery.isError ? (
                <div className="space-y-2 px-3 py-4 text-center text-sm text-muted-foreground">
                  <p>{picker.loadError}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => treeQuery.refetch()}
                  >
                    <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                    {picker.retry}
                  </Button>
                </div>
              ) : (
                <>
                  <CommandEmpty>{picker.empty}</CommandEmpty>
                  <CommandGroup>
                    {index.roots.map((classification) => {
                      const localizedName =
                        resolveLocalized(classification.name, locale) || classification.code;
                      return (
                        <CommandItem
                          key={classification.id}
                          value={`${classification.code} ${classification.name.ar ?? ''} ${classification.name.en ?? ''}`}
                          onSelect={() => selectClassification(classification)}
                        >
                          <Check
                            className={cn(
                              'me-2 h-4 w-4 shrink-0',
                              value === classification.id && !otherSelected
                                ? 'opacity-100'
                                : 'opacity-0',
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{localizedName}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {classification.code}
                            </span>
                          </span>
                        </CommandItem>
                      );
                    })}
                    {onOtherSelect ? (
                      <CommandItem
                        value={`${picker.other} other أخرى`}
                        onSelect={() => {
                          onOtherSelect();
                          onSelectionChange?.(buildSelection(index.byId, null));
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            'me-2 h-4 w-4 shrink-0',
                            otherSelected ? 'opacity-100' : 'opacity-0',
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{picker.other}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {picker.otherDescription}
                          </span>
                        </span>
                      </CommandItem>
                    ) : null}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {(value || otherSelected) && !disabled ? (
        <Button type="button" variant="ghost" size="icon" aria-label={picker.none} onClick={clear}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
