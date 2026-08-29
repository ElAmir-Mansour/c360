/**
 * humanizeLexToken — turn raw lower_snake enum tokens that the backend surfaces
 * (contract renewal-warning reasons, workflow/request/contract statuses) into
 * readable, bilingual labels for the command-center surfaces.
 *
 * Real human strings (owner names, reference numbers like "CASE-2024-001")
 * contain spaces, capitals, digits or hyphens and pass through unchanged.
 */
const TOKEN_LABELS: Record<string, { en: string; ar: string }> = {
  // contract renewal-warning reasons
  renewal_date: { en: 'Renewal due', ar: 'موعد التجديد' },
  expiry_minus_lead: { en: 'Expiring soon', ar: 'قرب الانتهاء' },
  expired: { en: 'Expired', ar: 'منتهٍ' },
  // statuses across requests / contracts / consultations / workflow
  draft: { en: 'Draft', ar: 'مسودة' },
  active: { en: 'Active', ar: 'نشط' },
  routed: { en: 'Routed', ar: 'موجّه' },
  submitted: { en: 'Submitted', ar: 'مُقدّم' },
  classified: { en: 'Classified', ar: 'مُصنّف' },
  responded: { en: 'Responded', ar: 'تمت الإجابة' },
  approved: { en: 'Approved', ar: 'معتمد' },
  rejected: { en: 'Rejected', ar: 'مرفوض' },
  pending: { en: 'Pending', ar: 'قيد الانتظار' },
  pending_approval: { en: 'Pending approval', ar: 'بانتظار الاعتماد' },
  awaiting_approval: { en: 'Awaiting approval', ar: 'بانتظار الاعتماد' },
  awaiting_review: { en: 'Awaiting review', ar: 'بانتظار المراجعة' },
  in_review: { en: 'In review', ar: 'قيد المراجعة' },
  internal_review: { en: 'Internal review', ar: 'مراجعة داخلية' },
  legal_review: { en: 'Legal review', ar: 'مراجعة قانونية' },
  negotiation: { en: 'Negotiation', ar: 'تفاوض' },
  pending_signature: { en: 'Pending signature', ar: 'بانتظار التوقيع' },
  open: { en: 'Open', ar: 'مفتوح' },
  closed: { en: 'Closed', ar: 'مغلق' },
  completed: { en: 'Completed', ar: 'مكتمل' },
  blocked: { en: 'Blocked', ar: 'محظور' },
  // common human-task / assignment roles
  legal_counsel: { en: 'Legal counsel', ar: 'المستشار القانوني' },
  legal_reviewer: { en: 'Legal reviewer', ar: 'المراجع القانوني' },
  contract_owner: { en: 'Contract owner', ar: 'مالك العقد' },
  business_owner: { en: 'Business owner', ar: 'مالك الأعمال' },
  requester: { en: 'Requester', ar: 'مقدم الطلب' },
  approver: { en: 'Approver', ar: 'المعتمد' },
};

export function humanizeLexToken(raw: string | null | undefined, locale: string): string {
  if (!raw) return '';
  const key = raw.trim().toLowerCase();
  const known = TOKEN_LABELS[key];
  if (known) return locale === 'ar' ? known.ar : known.en;
  if (/^[a-z]+(?:_[a-z]+)*$/.test(key)) {
    if (locale === 'ar') return 'قيمة غير معروفة';
    return key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  return raw;
}

/**
 * humanizeLexText — humanize raw enum tokens *embedded inside* a free-text
 * string. Backend-authored messages sometimes inline a status enum, e.g.
 * "Risk score 100.00 exceeds 70.00 but status is internal_review". Known tokens
 * become their localized label; any other lower_snake_case run is title-cased.
 * Ordinary prose (owner names, "exceeds", numbers) is left untouched, so this is
 * safe to apply to any subtitle/description.
 */
export function humanizeLexText(text: string | null | undefined, locale: string): string {
  if (!text) return '';
  let out = text;
  // 1) Known tokens → localized labels (longest keys first so multi-word enums
  //    like `pending_approval` win over any shorter prefix).
  for (const key of Object.keys(TOKEN_LABELS).sort((a, b) => b.length - a.length)) {
    const label = locale === 'ar' ? TOKEN_LABELS[key].ar : TOKEN_LABELS[key].en;
    out = out.replace(new RegExp(`\\b${key}\\b`, 'g'), label);
  }
  // 2) Any remaining lower_snake_case run (with at least one underscore) → Title
  //    Case in English. Arabic mode must not synthesize English from unknown
  //    machine tokens.
  out = out.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (m) =>
    locale === 'ar'
      ? 'قيمة غير معروفة'
      : m.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
  );
  return out;
}
