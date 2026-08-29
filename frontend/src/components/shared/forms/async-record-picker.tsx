'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, RefreshCw, X } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

export interface RecordPickerOption {
  value: string;
  label: string;
  triggerLabel?: string;
  description?: string;
  keywords?: string[];
  metadata?: Record<string, unknown>;
}

export interface AsyncRecordPickerLabels {
  select: string;
  search: string;
  loading: string;
  empty: string;
  loadError: string;
  retry: string;
  clear: string;
}

interface AsyncRecordPickerProps {
  id?: string;
  ariaLabel: string;
  queryKey: readonly unknown[];
  loadOptions: (search: string) => Promise<RecordPickerOption[]>;
  value: string;
  onChange: (value: string, option?: RecordPickerOption) => void;
  enabled?: boolean;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  selectedLabel?: string;
  labels?: Partial<AsyncRecordPickerLabels>;
  className?: string;
  pageSizeHint?: number;
}

const COPY: Record<'en' | 'ar', AsyncRecordPickerLabels> = {
  en: {
    select: 'Select a record',
    search: 'Search by name or reference…',
    loading: 'Loading records…',
    empty: 'No matching records found.',
    loadError: 'Could not load records.',
    retry: 'Retry',
    clear: 'Clear selection',
  },
  ar: {
    select: 'اختر سجلاً',
    search: 'ابحث بالاسم أو الرقم المرجعي…',
    loading: 'جارٍ تحميل السجلات…',
    empty: 'لم يتم العثور على سجلات مطابقة.',
    loadError: 'تعذّر تحميل السجلات.',
    retry: 'إعادة المحاولة',
    clear: 'مسح الاختيار',
  },
};

/**
 * Searchable picker for tenant-scoped records.
 *
 * The UUID is kept as the controlled value, but the user only sees a useful
 * label and secondary reference. Search is delegated to the supplied loader so
 * large directories are not downloaded into the browser.
 */
export function AsyncRecordPicker({
  id,
  ariaLabel,
  queryKey,
  loadOptions,
  value,
  onChange,
  enabled = true,
  disabled = false,
  required = false,
  allowClear = false,
  selectedLabel,
  labels,
  className,
}: AsyncRecordPickerProps) {
  const { locale } = useLocaleOrDefault();
  const copy = { ...COPY[locale === 'ar' ? 'ar' : 'en'], ...labels };
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOption, setSelectedOption] = useState<RecordPickerOption | null>(null);
  const debouncedSearch = useDebounce(search.trim(), 250);

  const recordsQuery = useQuery({
    queryKey: [...queryKey, debouncedSearch],
    queryFn: () => loadOptions(debouncedSearch),
    // Prefetch while the field is enabled so opening the popover is immediate
    // and an existing controlled value can resolve to its human-readable label.
    enabled,
    staleTime: 60_000,
  });

  const options = recordsQuery.data ?? [];
  const showsOptionList =
    !recordsQuery.isLoading &&
    !recordsQuery.isFetching &&
    !recordsQuery.isError &&
    options.length > 0;
  const current = value
    ? selectedOption?.value === value
      ? selectedOption
      : (options.find((option) => option.value === value) ?? null)
    : null;
  const visibleLabel = current?.triggerLabel ?? current?.label ?? (value ? selectedLabel : undefined);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      setSearch('');
    }
    if (!value) setSelectedOption(null);
  }, [enabled, value]);

  const setOpenState = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearch('');
  };

  return (
    <div className={cn('flex min-w-0 gap-1.5', className)}>
      <Popover open={open} onOpenChange={setOpenState}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-required={required}
            disabled={disabled || !enabled}
            className="min-w-0 flex-1 justify-between font-normal"
          >
            <span className={cn('min-w-0 truncate text-start', !visibleLabel && 'text-muted-foreground')}>
              {visibleLabel ?? copy.select}
            </span>
            {recordsQuery.isLoading ? (
              <Loader2 className="ms-2 h-4 w-4 shrink-0 animate-spin opacity-60" aria-hidden />
            ) : (
              <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={ariaLabel}
          className="p-0"
          style={{ width: 'var(--radix-popover-trigger-width)' }}
        >
          <Command shouldFilter={false}>
            <CommandInput value={search} onValueChange={setSearch} placeholder={copy.search} />
            {showsOptionList ? (
              <CommandList>
                <CommandGroup>
                  {options.map((option) => {
                    const selected = option.value === value;
                    return (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        keywords={[option.label, option.description ?? '', ...(option.keywords ?? [])]}
                        onSelect={() => {
                          setSelectedOption(option);
                          onChange(option.value, option);
                          setOpenState(false);
                        }}
                      >
                        <Check
                          className={cn('me-2 h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{option.label}</span>
                          {option.description ? (
                            <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
                          ) : null}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            ) : (
              <>
                {/* cmdk's input owns aria-controls for its list. Preserve that
                    target while keeping the empty list out of the a11y tree. */}
                <CommandList className="hidden" aria-hidden />
                <div role="status" aria-live="polite" className="max-h-[300px] overflow-y-auto overflow-x-hidden">
                  {recordsQuery.isLoading || recordsQuery.isFetching ? (
                    <div className="flex items-center justify-center px-3 py-6 text-sm text-muted-foreground">
                      <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                      {copy.loading}
                    </div>
                  ) : recordsQuery.isError ? (
                    <div className="space-y-2 px-3 py-4 text-center text-sm text-muted-foreground">
                      <p>{copy.loadError}</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => recordsQuery.refetch()}>
                        <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                        {copy.retry}
                      </Button>
                    </div>
                  ) : options.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">{copy.empty}</div>
                  ) : null}
                </div>
              </>
            )}
          </Command>
        </PopoverContent>
      </Popover>
      {allowClear && value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={copy.clear}
          disabled={disabled || !enabled}
          onClick={() => {
            setSelectedOption(null);
            onChange('');
          }}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
