'use client';

import { KeyRound, Pencil, Power, PowerOff, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import type { IdPConnection } from '@/lib/admin/idp';

type Bi = { en: string; ar: string };

const T = {
  kindOidc: { en: 'OIDC', ar: 'OIDC' },
  kindNafath: { en: 'Nafath', ar: 'نفاذ' },
  kindSaml: { en: 'SAML', ar: 'SAML' },
  enabled: { en: 'Enabled', ar: 'مُفعّل' },
  disabled: { en: 'Disabled', ar: 'مُعطّل' },
  jit: { en: 'JIT provisioning', ar: 'إنشاء تلقائي' },
  edit: { en: 'Edit', ar: 'تعديل' },
  enable: { en: 'Enable', ar: 'تفعيل' },
  disable: { en: 'Disable', ar: 'تعطيل' },
  delete: { en: 'Delete', ar: 'حذف' },
  updated: { en: 'Updated', ar: 'آخر تحديث' },
} satisfies Record<string, Bi>;

const KIND_LABEL: Record<IdPConnection['kind'], Bi> = {
  oidc: T.kindOidc,
  nafath: T.kindNafath,
  saml: T.kindSaml,
};

interface IdPConnectionListProps {
  connections: IdPConnection[];
  busyProvider: string | null;
  onEdit: (c: IdPConnection) => void;
  onToggle: (c: IdPConnection) => void;
  onDelete: (c: IdPConnection) => void;
}

export function IdPConnectionList({
  connections,
  busyProvider,
  onEdit,
  onToggle,
  onDelete,
}: IdPConnectionListProps) {
  const { locale } = useLocale();
  const tr = (b: Bi) => (locale === 'ar' ? b.ar : b.en);
  const dateFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-GB', {
    dateStyle: 'medium',
  });

  return (
    <ul className="space-y-3">
      {connections.map((c) => {
        const busy = busyProvider === c.provider;
        return (
          <li
            key={c.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{c.display_name || c.provider}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {c.provider}
                  </Badge>
                  <Badge variant="secondary">{tr(KIND_LABEL[c.kind])}</Badge>
                  <Badge variant={c.enabled ? 'default' : 'outline'}>
                    {c.enabled ? tr(T.enabled) : tr(T.disabled)}
                  </Badge>
                  {c.allow_jit_provisioning && (
                    <Badge variant="outline" className="gap-1">
                      <KeyRound className="h-3 w-3" />
                      {tr(T.jit)}
                    </Badge>
                  )}
                </div>
                {c.issuer && (
                  <p className="mt-1 truncate text-xs text-muted-foreground" dir="ltr">
                    {c.issuer}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {tr(T.updated)}: {c.updated_at ? dateFmt.format(new Date(c.updated_at)) : '—'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToggle(c)}
                disabled={busy}
                aria-label={c.enabled ? tr(T.disable) : tr(T.enable)}
              >
                {c.enabled ? (
                  <PowerOff className="me-1.5 h-4 w-4" />
                ) : (
                  <Power className="me-1.5 h-4 w-4" />
                )}
                {c.enabled ? tr(T.disable) : tr(T.enable)}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onEdit(c)} disabled={busy}>
                <Pencil className="me-1.5 h-4 w-4" />
                {tr(T.edit)}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(c)}
                disabled={busy}
                className="text-destructive hover:text-destructive"
                aria-label={tr(T.delete)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
