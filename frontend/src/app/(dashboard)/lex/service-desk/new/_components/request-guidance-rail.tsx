'use client';

import { Lightbulb, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { RequestPriority, ServiceCatalogEntry } from '@/lib/lex/requests';
import { cn } from '@/lib/utils';
import { useServiceSlaTargets } from '../_lib/service-sla';

interface RequestGuidanceRailProps {
  service?: ServiceCatalogEntry;
  priority: RequestPriority;
}

const COPY = {
  en: {
    title: 'Service Level Agreement (SLA)',
    description:
      'WatheeqTech Legal commits to reviewing requests and providing feedback within these service windows:',
    urgent: 'Urgent requests',
    normal: 'Normal requests',
    businessDays: (days: string) => `${days} working days`,
    urgentNote: 'Requires a clear business justification and may require department approval.',
    tipTitle: 'Legal advisor tip',
    tipBody:
      'Attach editable drafts whenever possible (for example, Word or DOCX) so Legal can add comments and suggested wording directly.',
  },
  ar: {
    title: 'اتفاقية مستوى الخدمة',
    description:
      'يلتزم فريق واثق تك القانوني بمراجعة الطلبات وتقديم الملاحظات ضمن المدد التالية:',
    urgent: 'الطلبات العاجلة',
    normal: 'الطلبات العادية',
    businessDays: (days: string) => `${days} أيام عمل`,
    urgentNote: 'تتطلب مبررًا واضحًا وقد تستلزم موافقة الإدارة.',
    tipTitle: 'نصيحة المستشار القانوني',
    tipBody:
      'أرفق المسودات بصيغة قابلة للتحرير متى أمكن، مثل Word أو DOCX، ليتمكن الفريق القانوني من إضافة التعليقات والصياغات المقترحة مباشرة.',
  },
} as const;

export default function RequestGuidanceRail({
  service,
  priority,
}: RequestGuidanceRailProps) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const { slaByCode } = useServiceSlaTargets();
  const sla = service?.code ? slaByCode.get(service.code) : undefined;
  const urgentDays = sla?.urgent ?? 3;
  const normalDays = sla?.normal ?? 5;

  return (
    <aside className="space-y-5 xl:sticky xl:top-24" aria-label={copy.title}>
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300"
            aria-hidden
          >
            <ShieldCheck className="h-[18px] w-[18px]" />
          </span>
          <h2 className="text-lg font-semibold leading-tight text-foreground">{copy.title}</h2>
        </div>

        <p className="mt-4 text-sm leading-5 text-muted-foreground">{copy.description}</p>

        <div className="mt-4 space-y-4">
          <div
            className={cn(
              'rounded-lg transition-colors',
              (priority === 'urgent' || priority === 'emergency') &&
                'bg-warning-50/60 p-3 dark:bg-warning-800/15',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning" size="sm">
                {copy.businessDays(f.formatNumber(urgentDays))}
              </Badge>
              <span className="text-sm font-semibold text-foreground">{copy.urgent}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.urgentNote}</p>
          </div>

          <div className="border-t border-border pt-4">
            <div
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-lg transition-colors',
                priority === 'normal' && 'bg-info-50/60 p-3 dark:bg-info-800/15',
              )}
            >
              <Badge variant="info" size="sm">
                {copy.businessDays(f.formatNumber(normalDays))}
              </Badge>
              <span className="text-sm font-semibold text-foreground">{copy.normal}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-success-300/70 bg-success-50 p-6 text-success-800 dark:border-success-700/50 dark:bg-success-700/15 dark:text-success-200">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Lightbulb className="h-4 w-4 shrink-0" aria-hidden />
          {copy.tipTitle}
        </h2>
        <p className="mt-3 text-sm leading-5">{copy.tipBody}</p>
      </section>
    </aside>
  );
}
