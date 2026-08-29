'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BriefcaseBusiness, Gavel, LayoutDashboard, UserRoundPlus } from 'lucide-react';

import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';

const items = {
  en: [
    {
      href: '/lex/cases/control',
      label: 'Control dashboard',
      icon: LayoutDashboard,
      exact: true,
    },
    {
      href: '/lex/cases/control/overview',
      label: 'Workload overview',
      icon: BriefcaseBusiness,
    },
    {
      href: '/lex/cases/control/assignment',
      label: 'Lawyer assignment',
      icon: UserRoundPlus,
    },
    {
      href: '/lex/cases/control/litigation',
      label: 'Litigation monitor',
      icon: Gavel,
    },
  ],
  ar: [
    {
      href: '/lex/cases/control',
      label: 'لوحة التحكم',
      icon: LayoutDashboard,
      exact: true,
    },
    {
      href: '/lex/cases/control/overview',
      label: 'نظرة أعباء العمل',
      icon: BriefcaseBusiness,
    },
    {
      href: '/lex/cases/control/assignment',
      label: 'تكليف المحامين',
      icon: UserRoundPlus,
    },
    {
      href: '/lex/cases/control/litigation',
      label: 'مراقبة التقاضي',
      icon: Gavel,
    },
  ],
} as const;

export function ManagerControlNav() {
  const pathname = usePathname();
  const { locale, direction } = useLocale();
  const navItems = locale === 'ar' ? items.ar : items.en;

  return (
    <nav
      dir={direction}
      aria-label={
        locale === 'ar' ? 'مساحات عمل مدير القضايا والتحقيقات' : 'Cases manager workspaces'
      }
      className="overflow-x-auto rounded-xl bg-brand-primary-700 px-2"
    >
      <div className="flex min-w-max items-stretch">
        {navItems.map((item) => {
          const active =
            'exact' in item && item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative inline-flex min-h-14 items-center gap-2 px-4 text-sm font-semibold text-primary-foreground/90 transition-colors hover:bg-white/10 hover:text-white',
                active &&
                  'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:bg-brand-gold-500',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
