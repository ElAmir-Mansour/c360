import { describe, expect, it } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';
import { resolveMessage, resolveNavLabel } from './navigation-labels';

describe('layout navigation labels', () => {
  it('resolves Arabic-first Lex navigation labels from the shared catalog', () => {
    const messages = getMessages('ar');

    expect(resolveNavLabel(messages, 'lex', 'WatheeqTech')).toBe('وثيقتك');
    expect(resolveNavLabel(messages, 'lex-overview', 'Overview')).toBe('نظرة عامة');
    expect(resolveNavLabel(messages, 'lex-legal-services', 'Legal Services & Requests')).toBe(
      'الخدمات والطلبات القانونية',
    );
    expect(resolveNavLabel(messages, 'lex-service-desk', 'My Requests')).toBe('طلباتي');
    expect(resolveNavLabel(messages, 'lex-service-desk-group', 'Legal Service Desk')).toBe('السجل الخاص بي');
    expect(resolveNavLabel(messages, 'lex-cases', 'Litigation Cases')).toBe('القضايا');
    expect(resolveNavLabel(messages, 'lex-investigations', 'Investigations')).toBe('التحقيقات');
    expect(resolveNavLabel(messages, 'lex-consultations', 'Consultations')).toBe('الاستشارات');
    expect(resolveNavLabel(messages, 'lex-contracts', 'Contracts')).toBe('العقود');
    expect(resolveNavLabel(messages, 'lex-library', 'References')).toBe('المراجع');
    expect(resolveNavLabel(messages, 'lex-reports', 'Reports & Performance Indicators')).toBe(
      'التقارير ومؤشرات الأداء',
    );
    expect(resolveNavLabel(messages, 'lex-roles', 'Roles & Users')).toBe(
      'الأدوار والمستخدمون',
    );
    expect(resolveNavLabel(messages, 'lex-reports-analytics', 'Analytics & KPIs')).toBe('التحليلات والمؤشرات');
    expect(resolveNavLabel(messages, 'lex-admin-sla-targets', 'SLA Targets')).toBe('مستهدفات اتفاقية مستوى الخدمة');
    expect(resolveNavLabel(messages, 'lex-playbooks', 'Playbooks')).toBe('كتيبات القواعد');
    expect(resolveNavLabel(messages, 'watheeq-platform-core', 'Platform Core')).toBe('النواة الأساسية للمنصة');
    expect(resolveNavLabel(messages, 'watheeq-workspace', 'Workspace')).toBe('مساحة العمل');
    expect(resolveNavLabel(messages, 'security-operations', 'Security operations')).toBe('عمليات الأمن السيبراني');
    expect(resolveNavLabel(messages, 'cyber-overview', 'Overview')).toBe('نظرة عامة');
    expect(resolveNavLabel(messages, 'cyber-assets', 'Assets')).toBe('الأصول');
    expect(resolveNavLabel(messages, 'cyber-alerts', 'Alerts')).toBe('التنبيهات');
    expect(resolveNavLabel(messages, 'cyber-indicators', 'IOC Management')).toBe('إدارة مؤشرات الاختراق');
    expect(resolveNavLabel(messages, 'cyber-feeds', 'Threat Feeds')).toBe('مصادر التهديدات');
    expect(resolveNavLabel(messages, 'cyber-threats', 'Threat Hunting')).toBe('اصطياد التهديدات');
    expect(resolveNavLabel(messages, 'cyber-detection', 'Detection Rules')).toBe('قواعد الكشف');
    expect(resolveNavLabel(messages, 'cyber-events', 'Event Explorer')).toBe('مستكشف الأحداث');
    expect(resolveNavLabel(messages, 'cyber-siem', 'SIEM Operations')).toBe(
      'عمليات SIEM — إدارة معلومات وأحداث الأمن',
    );
    expect(resolveNavLabel(messages, 'cyber-cti', 'Threat intelligence')).toBe('استخبارات التهديدات');
    expect(resolveNavLabel(messages, 'cyber-programs', 'Cyber programs')).toBe('البرامج السيبرانية');
    expect(resolveNavLabel(messages, 'data-intelligence', 'Data intelligence')).toBe('ذكاء البيانات');
    expect(resolveNavLabel(messages, 'recover', 'Recover · Application recovery')).toBe('التعافي · استعادة التطبيقات');
    expect(resolveNavLabel(messages, 'recover-overview', 'Overview')).toBe('نظرة عامة');
    expect(resolveNavLabel(messages, 'recover-cyber-recovery', 'Cyber Recovery')).toBe('التعافي السيبراني');
    expect(resolveNavLabel(messages, 'respond', 'Respond')).toBe('الاستجابة');
    expect(resolveNavLabel(messages, 'respond-incidents', 'Incidents')).toBe('الحوادث');
    expect(resolveNavLabel(messages, 'migrate', 'Migrate')).toBe('الترحيل');
    expect(resolveNavLabel(messages, 'migrate-command-center', 'Command Center')).toBe('مركز القيادة');
    expect(resolveNavLabel(messages, 'migrate-portfolio', 'Portfolio')).toBe('المحفظة');
    expect(resolveNavLabel(messages, 'migrate-move-groups', 'Move Groups')).toBe('مجموعات النقل');
    expect(resolveNavLabel(messages, 'acta-committees', 'Committees')).toBe('اللجان');
    expect(resolveNavLabel(messages, 'acta-meetings', 'Meetings')).toBe('الاجتماعات');
    expect(resolveNavLabel(messages, 'acta-actions', 'Action Items')).toBe('بنود العمل');
    expect(resolveNavLabel(messages, 'visus-dashboards', 'Dashboards')).toBe('لوحات المعلومات');
    expect(resolveNavLabel(messages, 'visus-kpis', 'KPIs')).toBe('مؤشرات الأداء');
    expect(resolveNavLabel(messages, 'visus-reports', 'Reports')).toBe('التقارير');
    expect(resolveNavLabel(messages, 'administration', 'Administration')).toBe('الإدارة');
    expect(resolveNavLabel(messages, 'admin-users', 'Users')).toBe('المستخدمون');
    expect(resolveNavLabel(messages, 'admin-roles', 'Roles')).toBe('الأدوار');
    expect(resolveNavLabel(messages, 'admin-tenants', 'Tenants')).toBe('المستأجرون');
    expect(resolveNavLabel(messages, 'admin-api-keys', 'API Keys')).toBe('مفاتيح API');
    expect(resolveNavLabel(messages, 'admin-invitations', 'Invitations')).toBe('الدعوات');
    expect(resolveNavLabel(messages, 'admin-ai-governance', 'AI Governance')).toBe('حوكمة الذكاء الاصطناعي');
    expect(resolveNavLabel(messages, 'admin-billing', 'Billing & Usage')).toBe('الفوترة والاستخدام');
    expect(resolveNavLabel(messages, 'admin-integrations', 'Integrations')).toBe('التكاملات');
    expect(resolveNavLabel(messages, 'platform-operations', 'Operations & audit')).toBe('العمليات والتدقيق');
    expect(resolveNavLabel(messages, 'admin-audit', 'Audit Logs')).toBe('سجلات التدقيق');
    expect(resolveNavLabel(messages, 'admin-settings', 'Settings')).toBe('الإعدادات');
    expect(resolveNavLabel(messages, 'admin-notification-management', 'Notification Mgmt')).toBe('إدارة الإشعارات');
  });

  it('resolves Arabic workflow navigation fallbacks when workflow ids are absent from the catalog', () => {
    const messages = getMessages('ar');

    expect(resolveNavLabel(messages, 'admin-workflows', 'Workflows', 'ar')).toBe('سير العمل');
    expect(resolveNavLabel(messages, 'workflows-my-tasks', 'My Tasks', 'ar')).toBe('مهامي');
    expect(resolveNavLabel(messages, 'workflows-definitions-browse', 'Browse Workflows', 'ar')).toBe(
      'استعراض سير العمل',
    );
    expect(resolveNavLabel(messages, 'admin-workflow-tasks', 'Task Queue', 'ar')).toBe('قائمة المهام');
    expect(resolveNavLabel(messages, 'admin-workflow-instances', 'Instances', 'ar')).toBe('المثيلات');
    expect(resolveNavLabel(messages, 'admin-workflow-definitions', 'Definitions', 'ar')).toBe(
      'التعريفات',
    );
    expect(resolveNavLabel(messages, 'admin-workflow-templates', 'Templates', 'ar')).toBe('القوالب');
    expect(resolveNavLabel(messages, 'admin-workflow-forms', 'Forms', 'ar')).toBe('النماذج');
    expect(resolveNavLabel(messages, 'admin-workflow-operations', 'Operations', 'ar')).toBe(
      'العمليات',
    );
    expect(resolveNavLabel(messages, 'admin-automation-engine', 'Automation Engine', 'ar')).toBe(
      'محرك الأتمتة',
    );
    expect(resolveNavLabel(messages, 'admin-workflow-analytics', 'Analytics', 'ar')).toBe(
      'التحليلات',
    );
  });

  it('keeps English labels available and falls back for unmapped future items', () => {
    const messages = getMessages('en');

    expect(resolveNavLabel(messages, 'admin-workflows', 'Workflows', 'en')).toBe('Workflows');
    expect(resolveNavLabel(messages, 'workflows-my-tasks', 'My Tasks', 'en')).toBe('My Tasks');
    expect(resolveNavLabel(messages, 'admin-automation-engine', 'Automation Engine', 'en')).toBe('Automation Engine');
    expect(resolveNavLabel(messages, 'admin-workflow-analytics', 'Analytics', 'en')).toBe('Analytics');
    expect(resolveNavLabel(messages, 'lex-admin-attachment-policies', 'Attachment Policies')).toBe(
      'Attachment Policies',
    );
    expect(resolveNavLabel(messages, 'future-lex-screen', 'Future Lex Screen')).toBe(
      'Future Lex Screen',
    );
  });

  it('applies the WatheeqTech v22 overlay only when explicitly enabled', () => {
    const messages = getMessages('ar');

    expect(resolveNavLabel(messages, 'lex-cases', 'Litigation Cases', 'ar')).toBe('القضايا');
    expect(
      resolveNavLabel(messages, 'lex-cases', 'Litigation Cases', 'ar', {
        useWatheeqTranslationMemory: true,
      }),
    ).toBe('قضايا التقاضي');

    expect(resolveNavLabel(messages, 'watheeq-platform-core', 'Platform Core', 'ar')).toBe(
      'النواة الأساسية للمنصة',
    );
    expect(
      resolveNavLabel(messages, 'watheeq-platform-core', 'Platform Core', 'ar', {
        useWatheeqTranslationMemory: true,
      }),
    ).toBe('نواة المنصة');
  });

  it('applies the WatheeqTech v22 overlay to shared shell labels when enabled', () => {
    const messages = getMessages('ar');

    expect(resolveMessage(messages, 'shell.searchOrJumpTo', 'Search or jump to', 'ar')).toBe(
      'بحث أو انتقال إلى',
    );
    expect(
      resolveMessage(messages, 'shell.searchOrJumpTo', 'Search or jump to', 'ar', {
        useWatheeqTranslationMemory: true,
      }),
    ).toBe('ابحث أو انتقل إلى');
  });
});
