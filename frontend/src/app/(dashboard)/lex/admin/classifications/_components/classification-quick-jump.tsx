'use client';

import { useMemo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { CaseClassification } from '@/lib/lex/admin';
import { useAdminCommonLabels, useClassificationLabels } from '../../_lib/admin-labels';

interface Props {
  open: boolean;
  items: CaseClassification[];
  onOpenChange: (open: boolean) => void;
  onSelect: (node: CaseClassification) => void;
}

export function ClassificationQuickJump({ open, items, onOpenChange, onSelect }: Props) {
  const { locale } = useLocaleOrDefault();
  const common = useAdminCommonLabels();
  const t = useClassificationLabels();

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const an = resolveLocalized(a.name, locale) || a.code;
        const bn = resolveLocalized(b.name, locale) || b.code;
        return an.localeCompare(bn);
      }),
    [items, locale],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.jumpTo}
      description={t.pageDescription}
    >
      <CommandInput placeholder={common.searchPlaceholder} />
      <CommandList>
        <CommandEmpty>{t.emptyTitle}</CommandEmpty>
        <CommandGroup heading={t.pageTitle}>
          {sorted.map((node) => {
            const name = resolveLocalized(node.name, locale) || node.code;
            const depth = node.path.length;
            return (
              <CommandItem
                key={node.id}
                value={`${node.code} ${name}`}
                onSelect={() => {
                  onSelect(node);
                  onOpenChange(false);
                }}
                className="gap-2"
              >
                <span className="font-mono text-xs text-muted-foreground">{node.code}</span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {!node.active ? (
                  <Badge variant="outline" className="shrink-0">
                    {t.inactiveBadge}
                  </Badge>
                ) : null}
                <span
                  className="ms-auto shrink-0 text-xs text-muted-foreground"
                  aria-label={`${t.cascade.chainDepth} ${depth}`}
                  title={`${t.cascade.chainDepth} ${depth}`}
                >
                  L{depth}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
