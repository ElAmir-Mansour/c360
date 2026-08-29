'use client';

/**
 * provision-labels.ts — feature-local bilingual copy for the ClarioDR
 * provisioning surface (create protected site / protection group / group member /
 * replication stream / group network mapping).
 *
 * Per the console's i18n convention, feature-local user-facing strings live
 * beside the feature (NOT the shared `_lib/dr-i18n.ts`). All copy is held in a
 * `DRBilingual<ProvisionLabels>` bundle — two full, same-shaped copies of the
 * label object (English + professional Modern Standard Arabic) — and resolved
 * against the active locale by the {@link useProvisionLabels} hook
 * (`useLocaleOrDefault`-based, mirroring {@link useDRLabels} /
 * {@link useProtectStateLabels}). Resolution defaults to English (the
 * `resolveDRBilingual` cross-locale fallback) so the `renderWithQuery` `en`
 * default keeps the existing English assertions green; an Arabic user sees the
 * full MSA surface with logical RTL props.
 *
 * REAL DATA SHAPES (no invented fields): the select-option keys mirror the
 * backend enums exactly —
 *   - site kind: `vm | database | fileset | iac` (model.SiteKind*)
 *   - stream status: a newly created stream MUST start `pending`
 *     (service.CreateStream rejects any other asserted status), so the create
 *     form exposes `pending` only and explains the constraint.
 * Established acronyms (RTO/RPO) are kept and glossed on first natural use.
 * Interpolation params and Western digits are preserved across both locales.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

/** Shared button / action copy reused across every provisioning dialog. */
export interface ProvisionActionLabels {
  submit: string;
  cancel: string;
  saving: string;
  /** Re-open the create flow from an empty state. */
  retry: string;
  /** Generic required-field marker description for accessibility. */
  requiredFieldHint: string;
  /** Generic validation message when a free-text field is blank. */
  requiredError: string;
}

/** Copy for the "create protected site" dialog/form. */
export interface CreateSiteFormLabels {
  triggerLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  nameLabel: string;
  namePlaceholder: string;
  nameError: string;
  kindLabel: string;
  kindPlaceholder: string;
  kindError: string;
  /** Select-option display text keyed by the real `kind` enum value. */
  kindOptions: Record<'vm' | 'database' | 'fileset' | 'iac', string>;
  endpointLabel: string;
  endpointPlaceholder: string;
  endpointError: string;
  rtoLabel: string;
  rtoHelp: string;
  rtoError: string;
  rpoLabel: string;
  rpoHelp: string;
  rpoError: string;
  /** ICU-style success toast/announcement. `{name}` = created site name. */
  successAnnouncement: string;
}

/** Copy for the "create protection group" dialog/form. */
export interface CreateGroupFormLabels {
  triggerLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  nameLabel: string;
  namePlaceholder: string;
  nameError: string;
  successAnnouncement: string;
}

/** Copy for the "add protection group member" dialog/form. */
export interface AddMemberFormLabels {
  triggerLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  siteLabel: string;
  sitePlaceholder: string;
  siteError: string;
  /** Empty option text when no eligible (unassigned) sites remain. */
  noEligibleSites: string;
  bootOrderLabel: string;
  bootOrderHelp: string;
  bootOrderError: string;
  successAnnouncement: string;
}

/** Copy for the "create replication stream" dialog/form. */
export interface CreateStreamFormLabels {
  triggerLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  siteLabel: string;
  sitePlaceholder: string;
  siteError: string;
  statusLabel: string;
  /** The only permitted initial status display text (`pending`). */
  statusPendingOption: string;
  statusHelp: string;
  successAnnouncement: string;
}

/** Copy for the "create group network mapping" dialog/form. */
export interface CreateNetworkMappingFormLabels {
  triggerLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  profileLabel: string;
  profilePlaceholder: string;
  profileError: string;
  primaryCidrLabel: string;
  primaryCidrPlaceholder: string;
  primaryCidrError: string;
  recoveryCidrLabel: string;
  recoveryCidrPlaceholder: string;
  recoveryCidrError: string;
  successAnnouncement: string;
}

/** First-class empty / onboarding states for the provisioning inventory lists. */
export interface ProvisionEmptyStateLabels {
  noSitesTitle: string;
  noSitesDescription: string;
  noGroupsTitle: string;
  noGroupsDescription: string;
  noMembersTitle: string;
  noMembersDescription: string;
  noStreamsTitle: string;
  noStreamsDescription: string;
  noNetworkMappingsTitle: string;
  noNetworkMappingsDescription: string;
}

/** Shown when the operator lacks `dr:write` (provisioning is gated). */
export interface ProvisionWriteGateLabels {
  title: string;
  description: string;
}

/**
 * First-run guided onboarding panel shown to a brand-new tenant (no sites AND no
 * groups). Walks the operator through the canonical build-out order: register a
 * protected site, bundle it into a protection group, then open a replication
 * stream. The `done` copy describes the completed-step affordance.
 */
export interface ProvisionOnboardingLabels {
  title: string;
  description: string;
  /** Visually-hidden numbered-step prefix, e.g. "Step {step} of {total}". */
  stepAria: string;
  done: string;
  siteStepTitle: string;
  siteStepDescription: string;
  siteStepCta: string;
  groupStepTitle: string;
  groupStepDescription: string;
  groupStepCta: string;
  streamStepTitle: string;
  streamStepDescription: string;
  streamStepCta: string;
}

export interface ProvisionLabels {
  actions: ProvisionActionLabels;
  site: CreateSiteFormLabels;
  group: CreateGroupFormLabels;
  member: AddMemberFormLabels;
  stream: CreateStreamFormLabels;
  networkMapping: CreateNetworkMappingFormLabels;
  empty: ProvisionEmptyStateLabels;
  writeGate: ProvisionWriteGateLabels;
  onboarding: ProvisionOnboardingLabels;
}

export const provisionLabelBundle: DRBilingual<ProvisionLabels> = {
  en: {
    actions: {
      submit: 'Create',
      cancel: 'Cancel',
      saving: 'Creating…',
      retry: 'Try again',
      requiredFieldHint: 'Required',
      requiredError: 'This field is required.',
    },
    site: {
      triggerLabel: 'Add protected site',
      dialogTitle: 'Add a protected site',
      dialogDescription:
        'Register a workload endpoint that ClarioDR will protect. Its recovery objectives drive the recommended recovery tier and objective-fit checks.',
      nameLabel: 'Site name',
      namePlaceholder: 'e.g. Production database',
      nameError: 'Enter a site name.',
      kindLabel: 'Workload kind',
      kindPlaceholder: 'Select a workload kind',
      kindError: 'Select a workload kind.',
      kindOptions: {
        vm: 'Virtual machine',
        database: 'Database',
        fileset: 'File set',
        iac: 'Infrastructure as code',
      },
      endpointLabel: 'Primary endpoint',
      endpointPlaceholder: 'e.g. pg://primary.internal:5432',
      endpointError: 'Enter the primary endpoint.',
      rtoLabel: 'RTO objective (seconds)',
      rtoHelp:
        'Recovery time objective (RTO) — the maximum acceptable time to restore this workload after a disruption.',
      rtoError: 'Enter an RTO objective of at least 1 second.',
      rpoLabel: 'RPO objective (seconds)',
      rpoHelp:
        'Recovery point objective (RPO) — the maximum acceptable data-loss window measured in seconds.',
      rpoError: 'Enter an RPO objective of at least 1 second.',
      successAnnouncement: 'Protected site {name} created.',
    },
    group: {
      triggerLabel: 'Create protection group',
      dialogTitle: 'Create a protection group',
      dialogDescription:
        'Protection groups bundle the sites and data that must recover together, then unlock failover, drills, and evidence for the group.',
      nameLabel: 'Group name',
      namePlaceholder: 'e.g. Critical ERP',
      nameError: 'Enter a group name.',
      successAnnouncement: 'Protection group {name} created.',
    },
    member: {
      triggerLabel: 'Add member',
      dialogTitle: 'Add a member to this group',
      dialogDescription:
        'Add a protected site to this group and set its boot order — the sequence in which members are recovered during a failover.',
      siteLabel: 'Protected site',
      sitePlaceholder: 'Select a protected site',
      siteError: 'Select a protected site.',
      noEligibleSites: 'No eligible protected sites — register a site first.',
      bootOrderLabel: 'Boot order',
      bootOrderHelp:
        'Lower numbers boot first. Members sharing a boot order are recovered together.',
      bootOrderError: 'Enter a boot order of 0 or greater.',
      successAnnouncement: 'Member added to the protection group.',
    },
    stream: {
      triggerLabel: 'Create replication stream',
      dialogTitle: 'Create a replication stream',
      dialogDescription:
        'Open a continuous data-protection stream for a protected site so ClarioDR can track its live RPO and recovery points.',
      siteLabel: 'Protected site',
      sitePlaceholder: 'Select a protected site',
      siteError: 'Select a protected site.',
      statusLabel: 'Initial status',
      statusPendingOption: 'Pending',
      statusHelp:
        'New streams always start pending; they transition to seeding and streaming as data flows.',
      successAnnouncement: 'Replication stream created.',
    },
    networkMapping: {
      triggerLabel: 'Add network mapping',
      dialogTitle: 'Add a network mapping',
      dialogDescription:
        'Map the primary network range to its recovery-site range for a recovery profile so workloads re-address correctly on failover.',
      profileLabel: 'Recovery profile',
      profilePlaceholder: 'e.g. isolated',
      profileError: 'Enter a recovery profile.',
      primaryCidrLabel: 'Primary CIDR',
      primaryCidrPlaceholder: 'e.g. 10.0.0.0/16',
      primaryCidrError: 'Enter a valid primary CIDR range.',
      recoveryCidrLabel: 'Recovery CIDR',
      recoveryCidrPlaceholder: 'e.g. 10.10.0.0/16',
      recoveryCidrError: 'Enter a valid recovery CIDR range.',
      successAnnouncement: 'Network mapping {profile} created.',
    },
    empty: {
      noSitesTitle: 'No protected sites yet',
      noSitesDescription:
        'Register a workload endpoint to start protecting it and unlock recovery-tier recommendations.',
      noGroupsTitle: 'No protection groups yet',
      noGroupsDescription:
        'Create a protection group to bundle the sites that must recover together.',
      noMembersTitle: 'No members in this group yet',
      noMembersDescription:
        'Add protected sites to this group so their boot order and stream health appear here.',
      noStreamsTitle: 'No replication streams yet',
      noStreamsDescription:
        'Create a replication stream for a protected site to begin continuous data protection.',
      noNetworkMappingsTitle: 'No network mappings yet',
      noNetworkMappingsDescription:
        'Add a primary-to-recovery network mapping so workloads re-address correctly during failover.',
    },
    writeGate: {
      title: 'Provisioning requires write access',
      description:
        'You can view the recovery inventory but need the DR write permission to create sites, groups, members, streams, or network mappings.',
    },
    onboarding: {
      title: 'Get started with ClarioDR',
      description:
        'Stand up your first protected workload in three steps. Each step unlocks the next.',
      stepAria: 'Step {step} of {total}',
      done: 'Done',
      siteStepTitle: 'Register a protected site',
      siteStepDescription:
        'Add a workload endpoint with its recovery objectives so ClarioDR can start protecting it.',
      siteStepCta: 'Add protected site',
      groupStepTitle: 'Create a protection group',
      groupStepDescription:
        'Bundle the sites that must recover together to unlock failover, drills, and evidence.',
      groupStepCta: 'Create protection group',
      streamStepTitle: 'Open a replication stream',
      streamStepDescription:
        'Start continuous data protection for a protected site so live RPO and recovery points appear.',
      streamStepCta: 'Create replication stream',
    },
  },
  ar: {
    actions: {
      submit: 'إنشاء',
      cancel: 'إلغاء',
      saving: 'جارٍ الإنشاء…',
      retry: 'حاول مرة أخرى',
      requiredFieldHint: 'مطلوب',
      requiredError: 'هذا الحقل مطلوب.',
    },
    site: {
      triggerLabel: 'إضافة موقع محمي',
      dialogTitle: 'إضافة موقع محمي',
      dialogDescription:
        'سجّل نقطة وصول عبء عمل سيحميها ClarioDR. تحدد أهداف استرداده مستوى الاسترداد الموصى به وفحوصات مطابقة الأهداف.',
      nameLabel: 'اسم الموقع',
      namePlaceholder: 'مثال: قاعدة بيانات الإنتاج',
      nameError: 'أدخل اسم الموقع.',
      kindLabel: 'نوع عبء العمل',
      kindPlaceholder: 'اختر نوع عبء العمل',
      kindError: 'اختر نوع عبء العمل.',
      kindOptions: {
        vm: 'جهاز افتراضي',
        database: 'قاعدة بيانات',
        fileset: 'مجموعة ملفات',
        iac: 'البنية التحتية ككود',
      },
      endpointLabel: 'نقطة الوصول الأساسية',
      endpointPlaceholder: 'مثال: pg://primary.internal:5432',
      endpointError: 'أدخل نقطة الوصول الأساسية.',
      rtoLabel: 'هدف زمن الاسترداد (RTO) (بالثواني)',
      rtoHelp:
        'هدف زمن الاسترداد (RTO) — أقصى زمن مقبول لاستعادة عبء العمل هذا بعد حدوث عطل.',
      rtoError: 'أدخل هدف زمن استرداد (RTO) لا يقل عن ثانية واحدة.',
      rpoLabel: 'هدف نقطة الاسترداد (RPO) (بالثواني)',
      rpoHelp:
        'هدف نقطة الاسترداد (RPO) — أقصى نافذة مقبولة لفقدان البيانات مقاسة بالثواني.',
      rpoError: 'أدخل هدف نقطة استرداد (RPO) لا يقل عن ثانية واحدة.',
      successAnnouncement: 'تم إنشاء الموقع المحمي {name}.',
    },
    group: {
      triggerLabel: 'إنشاء مجموعة حماية',
      dialogTitle: 'إنشاء مجموعة حماية',
      dialogDescription:
        'تجمع مجموعات الحماية المواقع والبيانات التي يجب أن تتعافى معًا، ثم تفعّل تجاوز الفشل والتمارين والأدلة للمجموعة.',
      nameLabel: 'اسم المجموعة',
      namePlaceholder: 'مثال: نظام تخطيط الموارد الحيوي',
      nameError: 'أدخل اسم المجموعة.',
      successAnnouncement: 'تم إنشاء مجموعة الحماية {name}.',
    },
    member: {
      triggerLabel: 'إضافة عضو',
      dialogTitle: 'إضافة عضو إلى هذه المجموعة',
      dialogDescription:
        'أضف موقعًا محميًا إلى هذه المجموعة وحدّد ترتيب إقلاعه — وهو التسلسل الذي يُستعاد به الأعضاء أثناء تجاوز الفشل.',
      siteLabel: 'الموقع المحمي',
      sitePlaceholder: 'اختر موقعًا محميًا',
      siteError: 'اختر موقعًا محميًا.',
      noEligibleSites: 'لا توجد مواقع محمية مؤهلة — سجّل موقعًا أولًا.',
      bootOrderLabel: 'ترتيب الإقلاع',
      bootOrderHelp:
        'الأرقام الأصغر تُقلِع أولًا. الأعضاء الذين يتشاركون الترتيب نفسه يُستعادون معًا.',
      bootOrderError: 'أدخل ترتيب إقلاع يساوي 0 أو أكبر.',
      successAnnouncement: 'تمت إضافة العضو إلى مجموعة الحماية.',
    },
    stream: {
      triggerLabel: 'إنشاء تدفق نسخ متماثل',
      dialogTitle: 'إنشاء تدفق نسخ متماثل',
      dialogDescription:
        'افتح تدفق حماية مستمرة للبيانات لموقع محمي حتى يتمكن ClarioDR من تتبّع قيمة RPO (نقطة الاسترداد) المباشرة ونقاط استرداده.',
      siteLabel: 'الموقع المحمي',
      sitePlaceholder: 'اختر موقعًا محميًا',
      siteError: 'اختر موقعًا محميًا.',
      statusLabel: 'الحالة الأولية',
      statusPendingOption: 'معلّق',
      statusHelp:
        'تبدأ التدفقات الجديدة دائمًا في حالة «معلّق»؛ ثم تنتقل إلى «التهيئة» و«البث» مع تدفق البيانات.',
      successAnnouncement: 'تم إنشاء تدفق النسخ المتماثل.',
    },
    networkMapping: {
      triggerLabel: 'إضافة تعيين شبكة',
      dialogTitle: 'إضافة تعيين شبكة',
      dialogDescription:
        'اربط نطاق الشبكة الأساسي بنطاق موقع الاسترداد لملف استرداد محدد حتى تُعاد عنونة أعباء العمل بشكل صحيح عند تجاوز الفشل.',
      profileLabel: 'ملف الاسترداد',
      profilePlaceholder: 'مثال: معزول',
      profileError: 'أدخل ملف الاسترداد.',
      primaryCidrLabel: 'نطاق CIDR الأساسي',
      primaryCidrPlaceholder: 'مثال: 10.0.0.0/16',
      primaryCidrError: 'أدخل نطاق CIDR أساسيًا صالحًا.',
      recoveryCidrLabel: 'نطاق CIDR للاسترداد',
      recoveryCidrPlaceholder: 'مثال: 10.10.0.0/16',
      recoveryCidrError: 'أدخل نطاق CIDR للاسترداد صالحًا.',
      successAnnouncement: 'تم إنشاء تعيين الشبكة {profile}.',
    },
    empty: {
      noSitesTitle: 'لا توجد مواقع محمية بعد',
      noSitesDescription:
        'سجّل نقطة وصول عبء عمل لبدء حمايته وتفعيل توصيات مستوى الاسترداد.',
      noGroupsTitle: 'لا توجد مجموعات حماية بعد',
      noGroupsDescription:
        'أنشئ مجموعة حماية لتجميع المواقع التي يجب أن تتعافى معًا.',
      noMembersTitle: 'لا يوجد أعضاء في هذه المجموعة بعد',
      noMembersDescription:
        'أضف مواقع محمية إلى هذه المجموعة ليظهر هنا ترتيب إقلاعها وحالة سلامة بثّها.',
      noStreamsTitle: 'لا توجد تدفقات نسخ متماثل بعد',
      noStreamsDescription:
        'أنشئ تدفق نسخ متماثل لموقع محمي لبدء الحماية المستمرة للبيانات.',
      noNetworkMappingsTitle: 'لا توجد تعيينات شبكة بعد',
      noNetworkMappingsDescription:
        'أضف تعيين شبكة من الأساسي إلى الاسترداد حتى تُعاد عنونة أعباء العمل بشكل صحيح أثناء تجاوز الفشل.',
    },
    writeGate: {
      title: 'يتطلب التزويد صلاحية الكتابة',
      description:
        'يمكنك عرض مخزون الاسترداد، لكنك تحتاج إلى صلاحية الكتابة في خطة التعافي لإنشاء المواقع أو المجموعات أو الأعضاء أو التدفقات أو تعيينات الشبكة.',
    },
    onboarding: {
      title: 'ابدأ مع ClarioDR',
      description:
        'هيّئ أول عبء عمل محمي لديك في ثلاث خطوات. كل خطوة تفتح التالية.',
      stepAria: 'الخطوة {step} من {total}',
      done: 'مكتملة',
      siteStepTitle: 'سجّل موقعًا محميًا',
      siteStepDescription:
        'أضف نقطة وصول عبء عمل مع أهداف استرداده حتى يتمكن ClarioDR من بدء حمايته.',
      siteStepCta: 'إضافة موقع محمي',
      groupStepTitle: 'أنشئ مجموعة حماية',
      groupStepDescription:
        'اجمع المواقع التي يجب أن تتعافى معًا لتفعيل تجاوز الفشل والتمارين والأدلة.',
      groupStepCta: 'إنشاء مجموعة حماية',
      streamStepTitle: 'افتح تدفق نسخ متماثل',
      streamStepDescription:
        'ابدأ الحماية المستمرة للبيانات لموقع محمي حتى تظهر قيمة RPO (نقطة الاسترداد) المباشرة ونقاط الاسترداد.',
      streamStepCta: 'إنشاء تدفق نسخ متماثل',
    },
  },
};

/**
 * The active (English) provisioning label set, kept as a stable named export for
 * non-React callers and direct-import unit tests. React components resolve the
 * locale-aware copy via {@link useProvisionLabels} instead.
 */
export const provisionLabels: ProvisionLabels = provisionLabelBundle.en;

/**
 * useProvisionLabels resolves the provisioning copy against the active locale
 * (English fallback), mirroring {@link useDRLabels} / {@link useProtectStateLabels}.
 * Memoised by locale so the returned object is stable across renders.
 */
export function useProvisionLabels(): ProvisionLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(provisionLabelBundle, locale), [locale]);
}
