/**
 * Self-contained bilingual (EN/AR) label bundle for the org re-parent /
 * reorganize ("Move") dialog and its impact preview. Kept local to the
 * reorganize feature so the components stay independent of the shared
 * admin-labels module. Resolve at call sites with:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? reorganizeLabels.ar : reorganizeLabels.en;
 *
 * Arabic copy is professional Modern Standard Arabic (MSA). Default is EN.
 */
import type { EscalationChange } from './reparent-impact';

export interface ReorganizeLabels {
  /** Dialog shell. */
  title: string;
  /** (entity) => description sentence under the title. */
  description: (entity: string) => string;
  loading: string;
  /** Parent picker. */
  parentLabel: string;
  parentPlaceholder: string;
  makeRoot: string;
  currentParent: string;
  noParents: string;
  /** Impact preview headings + metrics. */
  impactTitle: string;
  descendantsMoving: (n: number) => string;
  newDepth: (depth: number) => string;
  depthWarning: (depth: number) => string;
  noChange: string;
  /** Escalation-delta table. */
  escalationTitle: string;
  colEntity: string;
  colLevel: string;
  colBefore: string;
  colAfter: string;
  colChange: string;
  uncovered: string;
  changeLabel: Record<EscalationChange, string>;
  /** (n) => prominent red summary when entities lose coverage. */
  coverageLossSummary: (n: number) => string;
  noEscalationImpact: string;
  authoritativeNote: string;
  /** Footer. */
  cancel: string;
  apply: string;
  applying: string;
  /** Toasts. */
  successTitle: string;
  successBody: (entity: string) => string;
}

const en: ReorganizeLabels = {
  title: 'Move org entity',
  description: (entity) =>
    `Choose a new parent for "${entity}" and review the projected hierarchy and escalation impact before applying.`,
  loading: 'Loading org structure…',
  parentLabel: 'New parent',
  parentPlaceholder: 'Select a new parent…',
  makeRoot: '(make root — no parent)',
  currentParent: 'Current parent',
  noParents: 'No eligible parent entities are available for this move.',
  impactTitle: 'Projected impact',
  descendantsMoving: (n) =>
    n === 1 ? '1 sub-entity moves with this entity' : `${n} sub-entities move with this entity`,
  newDepth: (depth) => `New depth: level ${depth}`,
  depthWarning: (depth) =>
    `This move places the entity at depth ${depth}. Deep hierarchies (beyond 6 levels) are hard to operate and slow escalation resolution.`,
  noChange: 'Select a different parent to preview the impact of the move.',
  escalationTitle: 'Escalation ladder impact (L1 / L2 / L3)',
  colEntity: 'Entity',
  colLevel: 'Level',
  colBefore: 'Current provider',
  colAfter: 'Projected provider',
  colChange: 'Change',
  uncovered: '— none —',
  changeLabel: {
    gained: 'Gained',
    lost: 'Lost',
    changed: 'Changed',
    same: 'Unchanged',
  },
  coverageLossSummary: (n) =>
    n === 1
      ? '1 entity loses escalation coverage at one or more levels.'
      : `${n} entities lose escalation coverage at one or more levels.`,
  noEscalationImpact: 'No escalation provider changes are projected for this move.',
  authoritativeNote:
    'This is an advisory projection. The backend escalation resolver remains authoritative after the move is applied.',
  cancel: 'Cancel',
  apply: 'Apply move',
  applying: 'Applying…',
  successTitle: 'Entity moved',
  successBody: (entity) => `"${entity}" was re-parented successfully.`,
};

const ar: ReorganizeLabels = {
  title: 'نقل الكيان التنظيمي',
  description: (entity) =>
    `اختر كياناً أصلاً جديداً لـ "${entity}" وراجع الأثر المتوقع على التسلسل الهرمي وسلّم التصعيد قبل التطبيق.`,
  loading: 'جارٍ تحميل الهيكل التنظيمي…',
  parentLabel: 'الكيان الأصل الجديد',
  parentPlaceholder: 'اختر كياناً أصلاً جديداً…',
  makeRoot: '(جعله جذراً — بدون أصل)',
  currentParent: 'الأصل الحالي',
  noParents: 'لا توجد كيانات أصل مؤهلة متاحة لهذا النقل.',
  impactTitle: 'الأثر المتوقع',
  descendantsMoving: (n) =>
    n === 1 ? 'يُنقل كيان فرعي واحد مع هذا الكيان' : `يُنقل ${n} كياناً فرعياً مع هذا الكيان`,
  newDepth: (depth) => `العمق الجديد: المستوى ${depth}`,
  depthWarning: (depth) =>
    `يضع هذا النقل الكيان عند العمق ${depth}. التسلسلات العميقة (أكثر من 6 مستويات) يصعب تشغيلها وتُبطئ تحديد مسار التصعيد.`,
  noChange: 'اختر أصلاً مختلفاً لمعاينة أثر النقل.',
  escalationTitle: 'أثر سلّم التصعيد (المستوى 1 / 2 / 3)',
  colEntity: 'الكيان',
  colLevel: 'المستوى',
  colBefore: 'المزوّد الحالي',
  colAfter: 'المزوّد المتوقع',
  colChange: 'التغيير',
  uncovered: '— لا يوجد —',
  changeLabel: {
    gained: 'مكتسب',
    lost: 'مفقود',
    changed: 'متغيّر',
    same: 'دون تغيير',
  },
  coverageLossSummary: (n) =>
    n === 1
      ? 'يفقد كيان واحد تغطية التصعيد في مستوى واحد أو أكثر.'
      : `يفقد ${n} كيانات تغطية التصعيد في مستوى واحد أو أكثر.`,
  noEscalationImpact: 'لا تتغيّر مزوّدات التصعيد المتوقعة نتيجة هذا النقل.',
  authoritativeNote:
    'هذه معاينة استرشادية. يبقى محرّك تحديد التصعيد في الخادم هو المرجع المعتمد بعد تطبيق النقل.',
  cancel: 'إلغاء',
  apply: 'تطبيق النقل',
  applying: 'جارٍ التطبيق…',
  successTitle: 'تم نقل الكيان',
  successBody: (entity) => `تم تغيير أصل "${entity}" بنجاح.`,
};

export const reorganizeLabels: { en: ReorganizeLabels; ar: ReorganizeLabels } = { en, ar };
