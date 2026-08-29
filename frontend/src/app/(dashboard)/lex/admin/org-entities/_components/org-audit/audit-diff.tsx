'use client';

/**
 * Renders a before → after diff for a single audit event as a list of
 * changed-field rows (field key, old value, new value). Only keys whose values
 * actually differ are shown. Localized name fields (`name`, `entity_name`,
 * `label`) are resolved through `resolveLocalized` so RTL renders MSA Arabic.
 */
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { LocalizedText } from '@/types/forms';
import { auditLabels, tt, type Lang } from '../../_lib/org-audit-i18n';

interface AuditDiffProps {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Field keys that hold a bilingual {ar,en} label and should be localized. */
const LOCALIZED_KEYS = new Set(['name', 'entity_name', 'label']);

/** Snapshot/internal keys not worth showing in a human diff. */
const HIDDEN_KEYS = new Set(['snapshot_at', 'snapshot_reason', 'tenant_id', 'metadata']);

function isLocalizedText(value: unknown): value is LocalizedText {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('en' in (value as object) || 'ar' in (value as object))
  );
}

function displayValue(key: string, value: unknown, lang: Lang): string {
  const dash = tt(auditLabels.empty, lang);
  if (value === null || value === undefined) return dash;
  if (LOCALIZED_KEYS.has(key) && isLocalizedText(value)) {
    return resolveLocalized(value, lang) || dash;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' / ') || dash;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return dash;
    }
  }
  const str = String(value);
  return str.length > 0 ? str : dash;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function AuditDiff({ before, after }: AuditDiffProps) {
  const { locale } = useLocaleOrDefault();
  const lang: Lang = locale === 'ar' ? 'ar' : 'en';

  const beforeObj = before ?? {};
  const afterObj = after ?? {};
  const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])).filter(
    (key) => !HIDDEN_KEYS.has(key),
  );

  const changed = keys.filter((key) => !valuesEqual(beforeObj[key], afterObj[key]));

  if (changed.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">{tt(auditLabels.noChanges, lang)}</p>
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border/70 bg-muted/30">
      <div className="grid grid-cols-[minmax(6rem,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)] gap-px bg-border/60 text-xs">
        <div className="bg-muted/60 px-3 py-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
          {tt(auditLabels.field, lang)}
        </div>
        <div className="bg-muted/60 px-3 py-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
          {tt(auditLabels.oldValue, lang)}
        </div>
        <div className="bg-muted/60 px-3 py-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
          {tt(auditLabels.newValue, lang)}
        </div>
        {changed.map((key) => (
          <div className="contents" key={key}>
            <div className="bg-card px-3 py-1.5 font-medium text-foreground">{key}</div>
            <div className="bg-card px-3 py-1.5 text-error-600 line-through decoration-error-300">
              {displayValue(key, beforeObj[key], lang)}
            </div>
            <div className="bg-card px-3 py-1.5 text-success-700">
              {displayValue(key, afterObj[key], lang)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AuditDiff;
