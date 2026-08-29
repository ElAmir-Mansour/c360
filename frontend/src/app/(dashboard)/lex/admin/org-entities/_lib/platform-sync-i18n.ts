/**
 * Bilingual (EN / AR — MSA) labels for the Platform Org-Unit Sync & Drift
 * Detection view. EN is the default fallback. Resolved at the call site via:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? labels.ar : labels.en;
 *
 * Kept module-local on purpose — this is a suite-specific admin feature and
 * must not touch the shared `@/lib/i18n/messages` catalog (the orchestrator
 * owns that). All copy here is plain strings (no JSX) so it stays portable.
 */

export interface PlatformSyncLabels {
  /* Header / section */
  title: string;
  subtitle: string;
  refresh: string;

  /* KPI strip */
  kpiLinked: string;
  kpiUnlinked: string;
  kpiOrphaned: string;
  kpiDrift: string;
  kpiLinkedHint: string;
  kpiUnlinkedHint: string;
  kpiOrphanedHint: string;
  kpiDriftHint: string;

  /* Reconcile table */
  reconcileTitle: string;
  reconcileSubtitle: string;
  colEntity: string;
  colCode: string;
  colStatus: string;
  colPlatformUnit: string;
  colAction: string;

  /* Status badges */
  statusLinked: string;
  statusUnlinked: string;
  statusOrphaned: string;
  statusInSync: string;
  statusDrift: string;

  /* Drift diff row */
  driftTitle: string;
  fieldNameEn: string;
  fieldNameAr: string;
  fieldActive: string;
  legalSide: string;
  platformSide: string;
  fixDrift: string;
  fixing: string;
  activeYes: string;
  activeNo: string;
  noUnitName: string;

  /* Link affordance */
  linkAction: string;
  linkPlaceholder: string;
  linking: string;
  cancel: string;
  noAvailableUnits: string;

  /* Available (unlinked) platform units */
  availableTitle: string;
  availableSubtitle: string;
  availableEmpty: string;
  linkedToEntity: string;

  /* Empty / error states */
  endpointMissingTitle: string;
  endpointMissingBody: string;
  endpointMissingPath: string;
  noEntitiesTitle: string;
  noEntitiesBody: string;
  loadErrorTitle: string;
  loadErrorBody: string;
  allLinkedTitle: string;
  allLinkedBody: string;

  /* Toasts */
  toastFixed: string;
  toastLinked: string;

  /* Misc */
  readOnlyNote: string;
}

export const labels: { en: PlatformSyncLabels; ar: PlatformSyncLabels } = {
  en: {
    title: 'Platform Directory Sync',
    subtitle:
      'Reconcile legal entities against the platform_core organisation directory and resolve drift.',
    refresh: 'Refresh',

    kpiLinked: 'Linked',
    kpiUnlinked: 'Unlinked',
    kpiOrphaned: 'Orphaned',
    kpiDrift: 'Drift',
    kpiLinkedHint: 'Entities mapped to a live platform unit',
    kpiUnlinkedHint: 'Entities with no platform mapping',
    kpiOrphanedHint: 'Mapped to a unit that no longer exists',
    kpiDriftHint: 'Linked entities whose values differ',

    reconcileTitle: 'Reconcile entities',
    reconcileSubtitle: 'Link status and drift for every legal entity.',
    colEntity: 'Legal entity',
    colCode: 'Code',
    colStatus: 'Link status',
    colPlatformUnit: 'Platform unit',
    colAction: '',

    statusLinked: 'Linked',
    statusUnlinked: 'Unlinked',
    statusOrphaned: 'Orphaned',
    statusInSync: 'In sync',
    statusDrift: 'Drift',

    driftTitle: 'Drift detected',
    fieldNameEn: 'Name (EN)',
    fieldNameAr: 'Name (AR)',
    fieldActive: 'Active',
    legalSide: 'Legal entity',
    platformSide: 'Platform unit',
    fixDrift: 'Fix drift',
    fixing: 'Applying…',
    activeYes: 'Yes',
    activeNo: 'No',
    noUnitName: '—',

    linkAction: 'Link to platform unit',
    linkPlaceholder: 'Select a platform unit…',
    linking: 'Linking…',
    cancel: 'Cancel',
    noAvailableUnits: 'No unlinked platform units available.',

    availableTitle: 'Available platform units',
    availableSubtitle: 'Units in the platform directory not yet linked to any legal entity.',
    availableEmpty: 'Every platform unit is already linked to a legal entity.',
    linkedToEntity: 'Linked',

    endpointMissingTitle: 'Platform references unavailable',
    endpointMissingBody:
      'The platform-unit reference request did not complete. Link status below is derived from each entity’s stored platform mapping, so the view stays useful while the service recovers.',
    endpointMissingPath: 'Endpoint: GET /api/v1/lex/org-entities/platform-units',
    noEntitiesTitle: 'No legal entities',
    noEntitiesBody: 'Create org entities first, then return here to map them to platform units.',
    loadErrorTitle: 'Could not load legal entities',
    loadErrorBody: 'The org-entities request failed. Retry, or check that the service is running.',
    allLinkedTitle: 'Everything is in sync',
    allLinkedBody: 'All legal entities are linked to a platform unit with no drift.',

    toastFixed: 'Entity updated to match the platform unit.',
    toastLinked: 'Entity linked to the platform unit.',

    readOnlyNote: 'You have read-only access; mapping changes are disabled.',
  },
  ar: {
    title: 'مزامنة دليل المنصة',
    subtitle: 'مطابقة الكيانات القانونية مع دليل المؤسسة في platform_core ومعالجة الانحراف.',
    refresh: 'تحديث',

    kpiLinked: 'مرتبط',
    kpiUnlinked: 'غير مرتبط',
    kpiOrphaned: 'يتيم',
    kpiDrift: 'انحراف',
    kpiLinkedHint: 'كيانات مرتبطة بوحدة منصة فعّالة',
    kpiUnlinkedHint: 'كيانات بلا ربط بالمنصة',
    kpiOrphanedHint: 'مرتبطة بوحدة لم تعد موجودة',
    kpiDriftHint: 'كيانات مرتبطة تختلف قيمها',

    reconcileTitle: 'مطابقة الكيانات',
    reconcileSubtitle: 'حالة الربط والانحراف لكل كيان قانوني.',
    colEntity: 'الكيان القانوني',
    colCode: 'الرمز',
    colStatus: 'حالة الربط',
    colPlatformUnit: 'وحدة المنصة',
    colAction: '',

    statusLinked: 'مرتبط',
    statusUnlinked: 'غير مرتبط',
    statusOrphaned: 'يتيم',
    statusInSync: 'متطابق',
    statusDrift: 'انحراف',

    driftTitle: 'تم رصد انحراف',
    fieldNameEn: 'الاسم (إنجليزي)',
    fieldNameAr: 'الاسم (عربي)',
    fieldActive: 'فعّال',
    legalSide: 'الكيان القانوني',
    platformSide: 'وحدة المنصة',
    fixDrift: 'تصحيح الانحراف',
    fixing: 'جارٍ التطبيق…',
    activeYes: 'نعم',
    activeNo: 'لا',
    noUnitName: '—',

    linkAction: 'الربط بوحدة منصة',
    linkPlaceholder: 'اختر وحدة منصة…',
    linking: 'جارٍ الربط…',
    cancel: 'إلغاء',
    noAvailableUnits: 'لا توجد وحدات منصة غير مرتبطة متاحة.',

    availableTitle: 'وحدات المنصة المتاحة',
    availableSubtitle: 'وحدات في دليل المنصة لم تُربط بعد بأي كيان قانوني.',
    availableEmpty: 'كل وحدات المنصة مرتبطة بالفعل بكيان قانوني.',
    linkedToEntity: 'مرتبط',

    endpointMissingTitle: 'مراجع وحدات المنصة غير متاحة',
    endpointMissingBody:
      'لم يكتمل طلب مراجع وحدات المنصة. تُشتق حالة الربط أدناه من ربط المنصة المخزّن لكل كيان، لتبقى الواجهة مفيدة أثناء تعافي الخدمة.',
    endpointMissingPath: 'نقطة النهاية: GET /api/v1/lex/org-entities/platform-units',
    noEntitiesTitle: 'لا توجد كيانات قانونية',
    noEntitiesBody: 'أنشئ كيانات تنظيمية أولاً، ثم عُد هنا لربطها بوحدات المنصة.',
    loadErrorTitle: 'تعذّر تحميل الكيانات القانونية',
    loadErrorBody: 'فشل طلب الكيانات التنظيمية. أعد المحاولة أو تحقق من تشغيل الخدمة.',
    allLinkedTitle: 'كل شيء متطابق',
    allLinkedBody: 'جميع الكيانات القانونية مرتبطة بوحدة منصة دون انحراف.',

    toastFixed: 'تم تحديث الكيان ليطابق وحدة المنصة.',
    toastLinked: 'تم ربط الكيان بوحدة المنصة.',

    readOnlyNote: 'صلاحيتك للقراءة فقط؛ تعديلات الربط معطّلة.',
  },
};
