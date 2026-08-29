'use client';

import {
  ShieldCheck,
  Database,
  ClipboardCheck,
  Scale,
  BarChart3,
  CalendarDays,
  MoreHorizontal,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatGregorian } from '@/lib/format/datetime';
import type { SuiteName } from '@/types/models';
import { useDashboardText } from '@/components/dashboard/dashboard-i18n';
import { useDashboardViewPreferences } from '@/components/dashboard/widget-board/dashboard-preferences-context';
import { BOARD_TEXT, pickText } from '@/components/dashboard/widget-board/board-i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Suites surfaced as access chips in the hero, with their gate permission + icon. */
const SUITE_CHIPS: ReadonlyArray<{
  suite: SuiteName;
  label: { en: string; ar: string };
  permission: string;
  icon: LucideIcon;
}> = [
  { suite: 'cyber', label: { en: 'Cyber', ar: 'الأمن السيبراني' }, permission: 'cyber:read', icon: ShieldCheck },
  { suite: 'data', label: { en: 'Data', ar: 'البيانات' }, permission: 'data:read', icon: Database },
  { suite: 'acta', label: { en: 'Acta', ar: 'الحوكمة' }, permission: 'acta:read', icon: ClipboardCheck },
  { suite: 'lex', label: { en: 'وثيقتك', ar: 'وثيقتك' }, permission: 'lex:read', icon: Scale },
  { suite: 'visus', label: { en: 'Visus', ar: 'ذكاء تنفيذي' }, permission: 'visus:read', icon: BarChart3 },
];

/**
 * Dashboard hero. Consumes the shared `PageHeader` primitive (eyebrow + tags +
 * tonal stat aside) to present a commanding, sea-frontend-grade landing header.
 * Replaces the legacy flat welcome banner. Route-local; reads only from the
 * existing auth store, so it adds no new data fetching.
 */
export function DashboardHero() {
  const { user, tenant, hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const t = useDashboardText();
  const { openCustomizer } = useDashboardViewPreferences();
  const firstName = user?.first_name || user?.email?.split('@')[0] || 'there';
  const now = new Date();
  const today = formatGregorian(now, locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Suite-access chips: only the suites this user can actually open.
  const suiteTags: PageHeaderTag[] = SUITE_CHIPS.filter((s) =>
    hasPermission(s.permission),
  ).map((s) => ({
    label: s.label[locale],
    tone: 'primary' as const,
    icon: <s.icon className="h-3.5 w-3.5" aria-hidden="true" />,
  }));

  const tags: PageHeaderTag[] = [
    {
      label: today,
      tone: 'neutral' as const,
      icon: <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />,
    },
    ...suiteTags,
  ];

  return (
    <PageHeader
      eyebrow={t.hero.eyebrow}
      // The user's name may be Latin inside an RTL greeting — isolate it with
      // <bdi> so a trailing period never jumps to the wrong side.
      title={
        <>
          {t.hero.greeting} <bdi>{firstName}</bdi>
        </>
      }
      description={
        tenant
          ? `${t.hero.descTenant} ${tenant.name}.`
          : t.hero.descWorkspace
      }
      actions={
        openCustomizer ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={pickText(BOARD_TEXT.customize, locale)}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={locale === 'ar' ? 'start' : 'end'}>
              <DropdownMenuItem onSelect={openCustomizer}>
                <SlidersHorizontal className="me-2 h-4 w-4" aria-hidden="true" />
                {pickText(BOARD_TEXT.customize, locale)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
      tags={tags}
      stats={[
        {
          label: t.hero.activeSuites,
          value: suiteTags.length,
          accent: 'hsl(var(--primary))',
        },
        {
          label: t.hero.today,
          value: formatGregorian(now, locale, { month: 'short', day: 'numeric' }),
        },
      ]}
    />
  );
}
