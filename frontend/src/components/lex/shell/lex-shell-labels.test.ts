import { describe, expect, it } from 'vitest';

import { resolveLexBilingual } from '@/app/(dashboard)/lex/_lib/lex-i18n';
import { LEX_ROLE_PERMISSIONS } from '@/components/lex/access/lex-role-permissions';
import { canAccessWith } from '@/lib/permissions';

import { LEX_NAV_GROUPS } from './lex-routes';
import { LEX_DAILY_NAV_CLUSTERS } from './lex-routes';
import { lexShellLabels } from './lex-shell-labels';

describe('task-oriented Lex topbar wording', () => {
  it('groups the full legal suite by intent with no duplicate destinations', () => {
    expect(LEX_NAV_GROUPS.map((group) => group.id)).toEqual([
      'daily_work',
      'governance',
      'insights',
      'administration',
    ]);
    const hrefs = LEX_NAV_GROUPS.flatMap((group) =>
      group.routes.map((route) => route.href),
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('keeps daily work concise and bilingual', () => {
    const modules = LEX_NAV_GROUPS.find((group) => group.id === 'daily_work');
    const labels = resolveLexBilingual(lexShellLabels, 'ar');

    expect(modules?.routes.map((route) => route.id)).toEqual([
      'command_center',
      'tasks',
      'legal_services',
      'contracts_control',
      'contracts',
      'consultations',
      'signatures',
      'drafting',
      'cases_control',
      'cases',
      'investigations',
      'knowledge_hub',
      'library',
      'clause_library',
      'playbooks',
      'policies',
      'learning_centre',
      'documents',
    ]);
    expect(modules?.routes.map((route) => labels.routes[route.id])).toEqual([
      'نظرة عامة',
      'إدارة المهام',
      'الخدمات والطلبات القانونية',
      'لوحة العقود والاستشارات',
      'العقود',
      'الاستشارات',
      'التوقيعات',
      'الصياغة بالذكاء الاصطناعي',
      'لوحة القضايا والتحقيقات',
      'القضايا',
      'التحقيقات',
      'مركز المعرفة',
      'المراجع',
      'مكتبة البنود',
      'الأدلة الإرشادية',
      'مركز السياسات',
      'مركز التعلّم',
      'الوثائق والمرفقات',
    ]);
  });

  it('places Calendar in the Governance dropdown', () => {
    const dailyWork = LEX_NAV_GROUPS.find((group) => group.id === 'daily_work');
    const governance = LEX_NAV_GROUPS.find((group) => group.id === 'governance');

    expect(dailyWork?.routes.some((route) => route.id === 'calendar')).toBe(false);
    expect(governance?.routes[0]).toMatchObject({
      id: 'calendar',
      href: '/lex/calendar',
    });
  });

  it('combines the related contract and case domains in the desktop rail', () => {
    expect(LEX_DAILY_NAV_CLUSTERS).toEqual([
      {
        id: 'contracts_consultations',
        routeIds: ['contracts_control', 'contracts', 'consultations', 'signatures', 'drafting'],
      },
      {
        id: 'cases_investigations',
        routeIds: ['cases_control', 'cases', 'investigations'],
      },
      {
        id: 'references_library',
        routeIds: [
          'knowledge_hub',
          'library',
          'clause_library',
          'playbooks',
          'policies',
          'learning_centre',
          'documents',
        ],
      },
    ]);

    expect(lexShellLabels.en.clusters).toEqual({
      contracts_consultations: 'Contracts and Consultations',
      cases_investigations: 'Cases and Investigations',
      references_library: 'References and Library',
    });
    expect(lexShellLabels.ar.clusters).toEqual({
      contracts_consultations: 'العقود والاستشارات',
      cases_investigations: 'القضايا والتحقيقات',
      references_library: 'المراجع والمكتبة',
    });
  });

  it('keeps Consultations in the Legal Officer combined dropdown', () => {
    const dailyWork = LEX_NAV_GROUPS.find((group) => group.id === 'daily_work');
    const cluster = LEX_DAILY_NAV_CLUSTERS.find(
      (item) => item.id === 'contracts_consultations',
    );
    const officerPermissions = [
      ...LEX_ROLE_PERMISSIONS['legal-officer'],
    ];
    const hasPermission = (permission: string) =>
      officerPermissions.includes(permission);

    const visibleClusterRouteIds = (dailyWork?.routes ?? [])
      .filter((route) => cluster?.routeIds.includes(route.id))
      .filter((route) => canAccessWith(hasPermission, route.permission))
      .map((route) => route.id);

    expect(visibleClusterRouteIds).toContain('consultations');
  });
});
