'use client';

/**
 * TriggerConfigEditor — reusable editor for a workflow definition's
 * `trigger_config` (backend model.TriggerConfig).
 *
 * Bound to BackendTriggerConfig: { type: manual|event|schedule, topic?, cron?,
 * filter? }. The `filter` is edited as JSON text and only committed when it
 * parses to a JSON object (matching the backend `map[string]interface{}`).
 *
 * Pure value/onChange — no canvas/definition coupling — so Phase C can remount it
 * unchanged inside the React Flow inspector / definition-settings drawer.
 */

import { useEffect, useState } from 'react';
import { Hand, Radio, CalendarClock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CodeEditor } from '@/components/shared/code-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { BackendTriggerConfig } from '@/types/models';

interface TriggerConfigEditorProps {
  value: BackendTriggerConfig;
  onChange: (next: BackendTriggerConfig) => void;
  readOnly?: boolean;
}

const T = {
  en: {
    title: 'Trigger',
    type: 'Trigger type',
    manual: 'Manual',
    event: 'Event',
    schedule: 'Schedule',
    manualHint: 'Started by a user or an API call.',
    topic: 'Event topic',
    topicPh: 'e.g. contract.submitted',
    filter: 'Event filter (JSON)',
    filterErr: 'Must be a JSON object.',
    cron: 'Cron expression',
    cronPh: 'e.g. 0 9 * * 1 (Mon 09:00)',
    cronHint: 'Standard 5-field cron, evaluated in the tenant calendar.',
  },
  ar: {
    title: 'المُشغِّل',
    type: 'نوع التشغيل',
    manual: 'يدوي',
    event: 'حدث',
    schedule: 'مجدول',
    manualHint: 'يبدأ بواسطة مستخدم أو استدعاء واجهة برمجية.',
    topic: 'موضوع الحدث',
    topicPh: 'مثال: contract.submitted',
    filter: 'عامل تصفية الحدث (JSON)',
    filterErr: 'يجب أن يكون كائن JSON.',
    cron: 'تعبير كرون',
    cronPh: 'مثال: 0 9 * * 1',
    cronHint: 'كرون قياسي بخمسة حقول، يُقيَّم وفق تقويم المستأجر.',
  },
} as const;

function parseFilter(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

export function TriggerConfigEditor({ value, onChange, readOnly = false }: TriggerConfigEditorProps) {
  const { locale, direction } = useLocaleOrDefault();
  const t = locale === 'ar' ? T.ar : T.en;

  const type = value.type ?? 'manual';

  const [filterText, setFilterText] = useState(() =>
    value.filter && Object.keys(value.filter).length > 0
      ? JSON.stringify(value.filter, null, 2)
      : '',
  );
  const [filterError, setFilterError] = useState<string | null>(null);

  // Re-seed the JSON editor only when the trigger type flips to/away from event,
  // so an in-progress edit isn't clobbered on every committed parse.
  useEffect(() => {
    if (type !== 'event') return;
    setFilterText(
      value.filter && Object.keys(value.filter).length > 0
        ? JSON.stringify(value.filter, null, 2)
        : '',
    );
    setFilterError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const setType = (next: BackendTriggerConfig['type']) => {
    // Drop the now-irrelevant fields so the persisted config stays clean.
    if (next === 'manual') {
      onChange({ type: 'manual' });
    } else if (next === 'event') {
      onChange({ type: 'event', topic: value.topic ?? '', filter: value.filter });
    } else {
      onChange({ type: 'schedule', cron: value.cron ?? '' });
    }
  };

  const handleFilterChange = (text: string) => {
    setFilterText(text);
    const parsed = parseFilter(text);
    if (parsed) {
      onChange({ ...value, type: 'event', filter: parsed });
      setFilterError(null);
    } else {
      setFilterError(t.filterErr);
    }
  };

  return (
    <div className="space-y-3" dir={direction}>
      <Label className="text-xs font-semibold">{t.title}</Label>

      {/* Type */}
      <div className="space-y-1">
        <Label className="text-overline uppercase text-muted-foreground">{t.type}</Label>
        <Select
          value={type}
          onValueChange={(v) => setType(v as BackendTriggerConfig['type'])}
          disabled={readOnly}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">
              <span className="flex items-center gap-2">
                <Hand className="h-3.5 w-3.5" /> {t.manual}
              </span>
            </SelectItem>
            <SelectItem value="event">
              <span className="flex items-center gap-2">
                <Radio className="h-3.5 w-3.5" /> {t.event}
              </span>
            </SelectItem>
            <SelectItem value="schedule">
              <span className="flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5" /> {t.schedule}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {type === 'manual' && (
        <p className="text-[11px] text-muted-foreground">{t.manualHint}</p>
      )}

      {type === 'event' && (
        <>
          <div className="space-y-1">
            <Label className="text-overline uppercase text-muted-foreground">{t.topic}</Label>
            <Input
              value={value.topic ?? ''}
              onChange={(e) => onChange({ ...value, type: 'event', topic: e.target.value })}
              placeholder={t.topicPh}
              disabled={readOnly}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-overline uppercase text-muted-foreground">{t.filter}</Label>
            <CodeEditor
              value={filterText}
              onChange={handleFilterChange}
              language="json"
              height={120}
              readOnly={readOnly}
              ariaLabel={t.filter}
            />
            {filterError && (
              <p role="alert" className="text-[11px] text-destructive">
                {filterError}
              </p>
            )}
          </div>
        </>
      )}

      {type === 'schedule' && (
        <div className="space-y-1">
          <Label className="text-overline uppercase text-muted-foreground">{t.cron}</Label>
          <Input
            value={value.cron ?? ''}
            onChange={(e) => onChange({ ...value, type: 'schedule', cron: e.target.value })}
            placeholder={t.cronPh}
            disabled={readOnly}
            dir="ltr"
            className="h-8 text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground">{t.cronHint}</p>
        </div>
      )}
    </div>
  );
}
