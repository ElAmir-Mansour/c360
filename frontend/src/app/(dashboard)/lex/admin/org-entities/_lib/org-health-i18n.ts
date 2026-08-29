/**
 * Bilingual (EN / professional MSA AR) labels for the org-entity Health & QA
 * panel. Resolve with:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? labels.ar : labels.en;
 *
 * Default is EN. The `en` and `ar` objects are kept structurally identical so
 * the resolved `t` is uniformly typed regardless of locale.
 *
 * Two distinct label surfaces live here:
 *   - {@link HealthLabels} drives the chrome (panel title, KPI strip, verdict,
 *     group headers, empty/error/loading states);
 *   - {@link HealthRuleLabels} is consumed by the PURE rules engine
 *     (`runOrgHealthRules`) so every emitted {@link AdminIssue} carries an
 *     already-localized `title`/`description` (the "how to fix"). Keeping the
 *     rule copy here — rather than inside the engine — preserves the engine's
 *     framework-free, side-effect-free shape.
 */
import type { OrgEntityType } from '@/lib/lex/admin';

/** Chrome labels for the panel shell. */
export interface HealthLabels {
  title: string;
  description: string;
  /** Score badge. */
  scoreLabel: string;
  scoreOutOf: string;
  verdictHealthy: string;
  verdictGood: string;
  verdictAtRisk: string;
  verdictCritical: string;
  /** KPI strip. */
  kpiCritical: string;
  kpiWarning: string;
  kpiInfo: string;
  /** Issue list. */
  issuesTitle: string;
  issueCount: (count: number) => string;
  openEntity: string;
  /** Severity group headers. */
  groupCritical: string;
  groupWarning: string;
  groupInfo: string;
  /** Empty / loading / error states. */
  emptyTitle: string;
  emptyDescription: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  loadingLabel: string;
}

/** Labels consumed by the pure rules engine to compose each AdminIssue. */
export interface HealthRuleLabels {
  /** `area` tags grouping issues in the list. */
  areaStructure: string;
  areaIdentity: string;
  areaLocalization: string;
  areaRoles: string;
  areaEscalation: string;
  /** Human-readable name for an entity type (used inside messages). */
  entityType: (type: OrgEntityType) => string;
  /** A best-effort display name for an entity inside a message. */
  entityRef: (code: string, name: string) => string;

  cycleTitle: string;
  cycleDescription: (ref: string) => string;

  inactiveParentTitle: string;
  inactiveParentDescription: (childRef: string, parentRef: string) => string;

  duplicateCodeTitle: string;
  duplicateCodeDescription: (code: string, count: number) => string;

  missingNameTitle: string;
  missingNameDescriptionAr: (ref: string) => string;
  missingNameDescriptionEn: (ref: string) => string;

  noRolesTitle: string;
  noRolesDescription: (ref: string) => string;

  escalationDeadEndTitle: string;
  escalationDeadEndDescription: (ref: string) => string;

  depthTitle: string;
  depthDescription: (ref: string, depth: number) => string;

  rootTypeTitle: string;
  rootTypeDescription: (ref: string, type: string) => string;

  sectionParentTitle: string;
  sectionParentDescription: (ref: string) => string;
}

const ENTITY_TYPE_EN: Record<OrgEntityType, string> = {
  company: 'Company',
  business_unit: 'Business unit',
  department: 'Department',
  section: 'Section',
  shared_services_unit: 'Shared services unit',
};

const ENTITY_TYPE_AR: Record<OrgEntityType, string> = {
  company: 'شركة',
  business_unit: 'وحدة أعمال',
  department: 'إدارة',
  section: 'قسم',
  shared_services_unit: 'وحدة خدمات مشتركة',
};

export interface HealthI18n {
  ui: HealthLabels;
  rules: HealthRuleLabels;
}

const en: HealthI18n = {
  ui: {
    title: 'Health & QA',
    description:
      'Data-quality validation across the organizational registry. Each finding links to the affected entity with a recommended fix.',
    scoreLabel: 'Data-quality score',
    scoreOutOf: '/ 100',
    verdictHealthy: 'Registry is healthy.',
    verdictGood: 'Mostly healthy — a few items to tidy up.',
    verdictAtRisk: 'At risk — several issues need attention.',
    verdictCritical: 'Critical — escalation or structural gaps detected.',
    kpiCritical: 'Critical',
    kpiWarning: 'Warnings',
    kpiInfo: 'Info',
    issuesTitle: 'Findings',
    issueCount: (count) => `${count} ${count === 1 ? 'issue' : 'issues'}`,
    openEntity: 'Open entity',
    groupCritical: 'Critical',
    groupWarning: 'Warnings',
    groupInfo: 'Informational',
    emptyTitle: 'No issues found',
    emptyDescription: 'The organizational registry is healthy. All validation checks passed.',
    errorTitle: 'Could not run health checks',
    errorDescription: 'The organizational registry could not be loaded. Please retry.',
    retry: 'Retry',
    loadingLabel: 'Running validation checks…',
  },
  rules: {
    areaStructure: 'Structure',
    areaIdentity: 'Identity',
    areaLocalization: 'Localization',
    areaRoles: 'Roles',
    areaEscalation: 'Escalation',
    entityType: (type) => ENTITY_TYPE_EN[type],
    entityRef: (code, name) => (name ? `${code} — ${name}` : code),

    cycleTitle: 'Cycle in parent chain',
    cycleDescription: (ref) =>
      `${ref} is part of a parent-id loop. Re-parent one entity in the chain to a valid ancestor (or to none for a company root) to break the cycle.`,

    inactiveParentTitle: 'Active child under inactive parent',
    inactiveParentDescription: (childRef, parentRef) =>
      `${childRef} is active but its parent ${parentRef} is inactive. Re-activate the parent, or move the child under an active parent.`,

    duplicateCodeTitle: 'Duplicate entity code',
    duplicateCodeDescription: (code, count) =>
      `Code "${code}" is used by ${count} entities. Codes must be unique — rename the duplicates so each entity has a distinct code.`,

    missingNameTitle: 'Missing localized name',
    missingNameDescriptionAr: (ref) =>
      `${ref} has no Arabic name. Add the Arabic (MSA) name so the entity renders correctly for Arabic users.`,
    missingNameDescriptionEn: (ref) =>
      `${ref} has no English name. Add the English name so the entity renders correctly for English users.`,

    noRolesTitle: 'No roles assigned',
    noRolesDescription: (ref) =>
      `${ref} has no role holders. Assign at least one role (e.g. a supervisor or manager) so routing and escalation can resolve a person.`,

    escalationDeadEndTitle: 'Escalation dead-end',
    escalationDeadEndDescription: (ref) =>
      `No supervisor or manager is reachable for ${ref} anywhere up its branch. An SLA breach here would have nobody to escalate to — assign a section supervisor, department manager, or shared-services manager on this entity or an ancestor.`,

    depthTitle: 'Deep nesting',
    depthDescription: (ref, depth) =>
      `${ref} sits ${depth} levels deep. Deep hierarchies slow escalation and routing — consider flattening the branch.`,

    rootTypeTitle: 'Invalid root entity',
    rootTypeDescription: (ref, type) =>
      `${ref} is a root entity (no parent) but is a ${type}. Only a company may be a root — re-parent it under a company, or change its type to company.`,

    sectionParentTitle: 'Section under wrong parent',
    sectionParentDescription: (ref) =>
      `${ref} is a section but is not placed under a department. Move it under a department so the escalation ladder resolves correctly.`,
  },
};

const ar: HealthI18n = {
  ui: {
    title: 'الصحة وضمان الجودة',
    description:
      'التحقق من جودة البيانات عبر السجل التنظيمي. كل ملاحظة مرتبطة بالكيان المتأثر مع توصية بالإصلاح.',
    scoreLabel: 'درجة جودة البيانات',
    scoreOutOf: '/ ١٠٠',
    verdictHealthy: 'السجل سليم.',
    verdictGood: 'سليم في الغالب — بعض العناصر تحتاج إلى ترتيب.',
    verdictAtRisk: 'معرّض للخطر — عدة مشكلات تستلزم المعالجة.',
    verdictCritical: 'حرج — رُصدت فجوات في التصعيد أو في الهيكل.',
    kpiCritical: 'حرجة',
    kpiWarning: 'تحذيرات',
    kpiInfo: 'معلومات',
    issuesTitle: 'الملاحظات',
    issueCount: (count) => `${count} ${count === 1 ? 'ملاحظة' : 'ملاحظات'}`,
    openEntity: 'فتح الكيان',
    groupCritical: 'حرجة',
    groupWarning: 'تحذيرات',
    groupInfo: 'معلوماتية',
    emptyTitle: 'لا توجد مشكلات',
    emptyDescription: 'السجل التنظيمي سليم. اجتازت جميع عمليات التحقق.',
    errorTitle: 'تعذّر تشغيل فحوصات الصحة',
    errorDescription: 'تعذّر تحميل السجل التنظيمي. يرجى إعادة المحاولة.',
    retry: 'إعادة المحاولة',
    loadingLabel: 'جارٍ تشغيل عمليات التحقق…',
  },
  rules: {
    areaStructure: 'الهيكل',
    areaIdentity: 'الهوية',
    areaLocalization: 'التعريب',
    areaRoles: 'الأدوار',
    areaEscalation: 'التصعيد',
    entityType: (type) => ENTITY_TYPE_AR[type],
    entityRef: (code, name) => (name ? `${code} — ${name}` : code),

    cycleTitle: 'حلقة في سلسلة الكيان الأب',
    cycleDescription: (ref) =>
      `${ref} جزء من حلقة في معرّف الكيان الأب. أعِد إسناد أحد الكيانات في السلسلة إلى كيان أب صحيح (أو إلى لا شيء لجذر الشركة) لكسر الحلقة.`,

    inactiveParentTitle: 'كيان نشط تحت كيان أب غير نشط',
    inactiveParentDescription: (childRef, parentRef) =>
      `${childRef} نشط لكن الكيان الأب ${parentRef} غير نشط. أعِد تفعيل الكيان الأب، أو انقل الكيان الفرعي تحت كيان أب نشط.`,

    duplicateCodeTitle: 'رمز كيان مكرر',
    duplicateCodeDescription: (code, count) =>
      `الرمز "${code}" مستخدم في ${count} كيانات. يجب أن تكون الرموز فريدة — أعِد تسمية المكررات بحيث يكون لكل كيان رمز مميز.`,

    missingNameTitle: 'اسم محلي مفقود',
    missingNameDescriptionAr: (ref) =>
      `${ref} ليس له اسم عربي. أضِف الاسم العربي (الفصحى) ليظهر الكيان بشكل صحيح للمستخدمين العرب.`,
    missingNameDescriptionEn: (ref) =>
      `${ref} ليس له اسم إنجليزي. أضِف الاسم الإنجليزي ليظهر الكيان بشكل صحيح للمستخدمين الإنجليز.`,

    noRolesTitle: 'لا توجد أدوار مُسندة',
    noRolesDescription: (ref) =>
      `${ref} ليس له شاغلو أدوار. أسنِد دورًا واحدًا على الأقل (مثل مشرف أو مدير) ليتمكّن التوجيه والتصعيد من تحديد شخص.`,

    escalationDeadEndTitle: 'طريق مسدود في التصعيد',
    escalationDeadEndDescription: (ref) =>
      `لا يوجد مشرف أو مدير يمكن الوصول إليه لـ ${ref} في أي مستوى أعلى من فرعه. أي خرق لاتفاقية مستوى الخدمة هنا لن يجد جهة للتصعيد إليها — أسنِد مشرف قسم أو مدير إدارة أو مدير خدمات مشتركة على هذا الكيان أو أحد أصوله.`,

    depthTitle: 'تداخل عميق',
    depthDescription: (ref, depth) =>
      `${ref} يقع على عمق ${depth} مستويات. الهياكل العميقة تبطئ التصعيد والتوجيه — يُفضّل تبسيط الفرع.`,

    rootTypeTitle: 'كيان جذري غير صالح',
    rootTypeDescription: (ref, type) =>
      `${ref} كيان جذري (بلا أب) لكنه ${type}. يُسمح بالشركة فقط أن تكون جذرًا — أعِد إسناده تحت شركة، أو غيّر نوعه إلى شركة.`,

    sectionParentTitle: 'قسم تحت كيان أب غير صحيح',
    sectionParentDescription: (ref) =>
      `${ref} قسم لكنه ليس موضوعًا تحت إدارة. انقله تحت إدارة ليُحلّ سلّم التصعيد بشكل صحيح.`,
  },
};

export const healthI18n = { en, ar } as const;
