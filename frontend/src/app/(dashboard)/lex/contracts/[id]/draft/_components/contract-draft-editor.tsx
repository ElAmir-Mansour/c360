'use client';

import {
  Bold,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Highlighter,
  Italic,
  MessageCirclePlus,
  MessageSquare,
  Pencil,
  Save,
  Search,
  SendHorizontal,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AppDirection, AppLocale } from '@/lib/i18n';
import { showInfo, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

const SARAH_AVATAR = '/images/lex/contracts/draft/sarah-al-qahtani.png';

type Clause = {
  id: string;
  title: string;
  body: string;
};

type Comment = {
  id: string;
  author: string;
  body: string;
  time: string;
};

export type DraftContractIdentity = {
  title: string;
  contractNumber?: string | null;
  status: string;
  partyAName?: string | null;
  partyBName?: string | null;
  draftDocumentText?: string | null;
};

type DraftCopy = {
  breadcrumbs: readonly [string, string, string];
  editDraft: string;
  agreementTitle: string;
  status: string;
  statusReview: string;
  saveDraft: string;
  sendReview: string;
  exportPdf: string;
  documentTitle: string;
  referenceNumber: string;
  outline: string;
  manageLibrary: string;
  clauseLibrary: string;
  searchPlaceholder: string;
  insert: string;
  inserted: string;
  discussions: string;
  twoHoursAgo: string;
  commentPlaceholder: string;
  addComment: string;
  cancel: string;
  editClause: string;
  saveClause: string;
  toolbar: {
    bold: string;
    italic: string;
    highlight: string;
    comment: string;
  };
  toasts: {
    saved: string;
    savedDescription: string;
    review: string;
    reviewDescription: string;
    export: string;
    inserted: string;
    commentAdded: string;
  };
  clauses: readonly [Clause, Clause];
  outlineItems: readonly [string, string, string, string];
  library: readonly {
    id: string;
    title: string;
    preview: string;
    clauseBody: string;
  }[];
  comments: readonly [Comment];
};

const COPY: Record<'en' | 'ar', DraftCopy> = {
  en: {
    breadcrumbs: ['WatheeqTech', 'Contracts', 'CON-2024-089'],
    editDraft: 'Edit Draft',
    agreementTitle: 'Mutual IT Services Agreement',
    status: 'Draft Under Revision',
    statusReview: 'Sent for Review',
    saveDraft: 'Save Draft',
    sendReview: 'Send for Review',
    exportPdf: 'Export PDF',
    documentTitle: 'MUTUAL INFORMATION TECHNOLOGY SERVICES AGREEMENT',
    referenceNumber: 'Reference Number: CON-2024-089',
    outline: 'Document Outline',
    manageLibrary: 'Manage Library',
    clauseLibrary: 'Clause Library',
    searchPlaceholder: 'Search standard templates...',
    insert: 'Insert',
    inserted: 'Inserted',
    discussions: 'Active Discussions & Comments',
    twoHoursAgo: '2 hrs ago',
    commentPlaceholder: 'Add a comment for the review team…',
    addComment: 'Add comment',
    cancel: 'Cancel',
    editClause: 'Edit clause',
    saveClause: 'Save clause',
    toolbar: {
      bold: 'Bold selected clause',
      italic: 'Italicize selected clause',
      highlight: 'Highlight selected clause',
      comment: 'Add a comment',
    },
    toasts: {
      saved: 'Draft saved',
      savedDescription: 'Your contract changes are saved in this browser.',
      review: 'Sent for review',
      reviewDescription: 'The review team has been notified.',
      export: 'Print dialog opened',
      inserted: 'Clause inserted into the draft',
      commentAdded: 'Comment added',
    },
    clauses: [
      {
        id: 'scope',
        title: 'Clause 1: Scope of Services & Support',
        body:
          'The First Party shall provide dedicated technical support, software infrastructure updates, and server maintenance services to the Second Party in accordance with the specifications detailed in Annex (A). The Second Party commits to facilitating the tasks of the First Party by providing necessary technical authorizations and environment access.',
      },
      {
        id: 'financial',
        title: 'Clause 2: Financial Considerations & Milestone Payments',
        body:
          'The Second Party shall pay the First Party a total sum of 150,000 Saudi Riyals (SAR) to be disbursed in three equal installments based on successful completion of the delivery phases outlined in Annex (B).',
      },
    ],
    outlineItems: [
      'Clause 1: Scope of Services & Support',
      'Clause 2: Financial Considerations & Payments',
      'Clause 3: Intellectual Property & Ownership',
      'Clause 4: Term & Termination Guidelines',
    ],
    library: [
      {
        id: 'privacy',
        title: 'NDA / Strict Privacy Clause',
        preview:
          'Each party agrees to maintain strict confidentiality of all data and technical assets exchanged...',
        clauseBody:
          'Each party agrees to maintain strict confidentiality of all data and technical assets exchanged during the performance of this Agreement.',
      },
      {
        id: 'jurisdiction',
        title: 'Dispute Resolution & Jurisdiction',
        preview:
          'This agreement shall be governed by and construed in accordance with the laws of the Kingdom of Saudi Arabia...',
        clauseBody:
          'This Agreement shall be governed by and construed in accordance with the laws of the Kingdom of Saudi Arabia.',
      },
    ],
    comments: [
      {
        id: 'sarah-finance',
        author: 'Sarah Al-Qahtani (Finance)',
        body:
          'Has the finance team confirmed quarterly instead of semi-annual disbursements? The milestone payment clause might need adjustments.',
        time: '2 hrs ago',
      },
    ],
  },
  ar: {
    breadcrumbs: ['وثيقتك', 'العقود', 'CON-2024-089'],
    editDraft: 'تحرير المسودة',
    agreementTitle: 'اتفاقية تقديم خدمات تقنية معلومات متبادلة',
    status: 'مسودة قيد التعديل',
    statusReview: 'أُرسلت للمراجعة',
    saveDraft: 'حفظ المسودة',
    sendReview: 'إرسال للمراجعة',
    exportPdf: 'تصدير PDF',
    documentTitle: 'عقد تقديم خدمات تقنية معلومات',
    referenceNumber: 'الرقم المرجعي: CON-2024-089',
    outline: 'مخطط المستند',
    manageLibrary: 'إدارة المكتبة القانونية',
    clauseLibrary: 'مكتبة البنود السريعة',
    searchPlaceholder: 'البحث عن بند نموذجي...',
    insert: 'إدراج سريع',
    inserted: 'تم الإدراج',
    discussions: 'المناقشات والتعليقات النشطة',
    twoHoursAgo: 'منذ ساعتين',
    commentPlaceholder: 'أضف تعليقًا لفريق المراجعة…',
    addComment: 'إضافة تعليق',
    cancel: 'إلغاء',
    editClause: 'تحرير البند',
    saveClause: 'حفظ البند',
    toolbar: {
      bold: 'تغليظ البند المحدد',
      italic: 'إمالة البند المحدد',
      highlight: 'تمييز البند المحدد',
      comment: 'إضافة تعليق',
    },
    toasts: {
      saved: 'تم حفظ المسودة',
      savedDescription: 'حُفظت تغييرات العقد في هذا المتصفح.',
      review: 'أُرسلت للمراجعة',
      reviewDescription: 'تم إشعار فريق المراجعة.',
      export: 'تم فتح نافذة الطباعة',
      inserted: 'تم إدراج البند في المسودة',
      commentAdded: 'تمت إضافة التعليق',
    },
    clauses: [
      {
        id: 'scope',
        title: 'البند الأول: موضوع التعاقد والخدمات',
        body:
          'يقوم الطرف الأول بتقديم خدمات الدعم الفني وتحديث البنية التحتية البرمجية للطرف الثاني وفقاً للمواصفات المحددة في الملحق رقم (أ)، ويلتزم الطرف الثاني بتسهيل مهام الطرف الأول وتقديم كافة الصلاحيات التقنية اللازمة.',
      },
      {
        id: 'financial',
        title: 'البند الثاني: المقابل المالي وآلية الدفع',
        body:
          'يدفع الطرف الثاني للطرف الأول مبلغاً إجمالياً وقدره 150,000 ريال سعودي يُسدد على ثلاث دفعات متساوية بناءً على إنجاز مراحل التسليم المحددة في العقد.',
      },
    ],
    outlineItems: [
      'البند الأول: موضوع التعاقد والخدمات',
      'البند الثاني: المقابل المالي وآلية الدفع',
      'البند الثالث: الملكية الفكرية وحقوق التملك',
      'البند الرابع: مدة العقد وإرشادات الإنهاء',
    ],
    library: [
      {
        id: 'privacy',
        title: 'بند سرية المعلومات والخصوصية الأقصى',
        preview: 'يلتزم الطرفان بالحفاظ التام على البيانات والسرية التقنية...',
        clauseBody:
          'يلتزم الطرفان بالمحافظة على السرية التامة لجميع البيانات والأصول التقنية المتبادلة أثناء تنفيذ هذا العقد.',
      },
      {
        id: 'jurisdiction',
        title: 'بند فض النزاعات والاختصاص القضائي',
        preview: 'يخضع هذا العقد وتفسيره للأنظمة واللوائح المعمول بها في المملكة العربية السعودية...',
        clauseBody:
          'يخضع هذا العقد وتفسيره للأنظمة واللوائح المعمول بها في المملكة العربية السعودية.',
      },
    ],
    comments: [
      {
        id: 'sarah-finance',
        author: 'سارة القحطاني (مراجعة مالية)',
        body:
          'هل تم تأكيد آلية الدفع لتكون على دفعات ربع سنوية بدلاً من نصف سنوية؟ البند المالي الحالي يحتاج تعديل دقيق.',
        time: 'منذ ساعتين',
      },
    ],
  },
};

const STATUS_LABELS: Record<'en' | 'ar', Record<string, string>> = {
  en: {
    draft: 'Draft Under Revision',
    internal_review: 'Internal Review',
    legal_review: 'Legal Review',
    negotiation: 'Negotiation',
    pending_signature: 'Pending Signature',
    active: 'Active',
    suspended: 'Suspended',
    expired: 'Expired',
    terminated: 'Terminated',
    renewed: 'Renewed',
    cancelled: 'Cancelled',
  },
  ar: {
    draft: 'مسودة قيد التعديل',
    internal_review: 'مراجعة داخلية',
    legal_review: 'مراجعة قانونية',
    negotiation: 'قيد التفاوض',
    pending_signature: 'بانتظار التوقيع',
    active: 'ساري',
    suspended: 'موقوف',
    expired: 'منتهي',
    terminated: 'مفسوخ',
    renewed: 'مجدّد',
    cancelled: 'ملغى',
  },
};

type ContractDraftEditorProps = {
  contractId: string;
  locale: AppLocale;
  direction: AppDirection;
  identity?: DraftContractIdentity;
  identityLoading?: boolean;
};

export function ContractDraftEditor({
  contractId,
  locale,
  direction,
  identity,
  identityLoading = false,
}: ContractDraftEditorProps) {
  const language = locale === 'ar' ? 'ar' : 'en';
  const copy = COPY[language];
  const storageKey = `watheeq-contract-draft:${contractId}:${language}`;
  const [clauses, setClauses] = useState<Clause[]>(() => copy.clauses.map((clause) => ({ ...clause })));
  const [comments, setComments] = useState<Comment[]>(() =>
    copy.comments.map((comment) => ({ ...comment })),
  );
  const [query, setQuery] = useState('');
  const [editingClause, setEditingClause] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [reviewSent, setReviewSent] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentValue, setCommentValue] = useState('');
  const [boldFinancial, setBoldFinancial] = useState(false);
  const [italicFinancial, setItalicFinancial] = useState(false);
  const [highlightFinancial, setHighlightFinancial] = useState(false);
  const financialRef = useRef<HTMLElement | null>(null);
  const documentHydratedRef = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      documentHydratedRef.current = false;
      if (!saved) {
        setClauses(copy.clauses.map((clause) => ({ ...clause })));
        setComments(copy.comments.map((comment) => ({ ...comment })));
        return;
      }
      const parsed = JSON.parse(saved) as { clauses?: Clause[]; comments?: Comment[] };
      if (Array.isArray(parsed.clauses)) setClauses(parsed.clauses);
      if (Array.isArray(parsed.comments)) setComments(parsed.comments);
    } catch {
      // A malformed browser draft should never make the editor unusable.
    }
  }, [copy.clauses, copy.comments, storageKey]);

  useEffect(() => {
    const documentText = identity?.draftDocumentText?.trim();
    if (!documentText || documentHydratedRef.current) return;
    documentHydratedRef.current = true;
    if (window.localStorage.getItem(storageKey)) return;
    setClauses((current) =>
      current.map((clause, index) =>
        index === 0 ? { ...clause, body: documentText } : clause,
      ),
    );
  }, [identity?.draftDocumentText, storageKey]);

  const filteredLibrary = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(language);
    if (!normalized) return copy.library;
    return copy.library.filter(
      (item) =>
        item.title.toLocaleLowerCase(language).includes(normalized) ||
        item.preview.toLocaleLowerCase(language).includes(normalized),
    );
  }, [copy.library, language, query]);

  const insertedIds = useMemo(
    () => new Set(clauses.map((clause) => clause.id)),
    [clauses],
  );
  const contractNumber = identity?.contractNumber?.trim() || contractId || copy.breadcrumbs[2];
  const contractTitle = identity?.title.trim() || copy.agreementTitle;
  const documentTitle =
    identity?.title.trim()
      ? language === 'en'
        ? identity.title.toLocaleUpperCase('en')
        : identity.title
      : copy.documentTitle;
  const referenceNumber =
    language === 'ar'
      ? `الرقم المرجعي: ${contractNumber}`
      : `Reference Number: ${contractNumber}`;
  const statusToken = identity?.status ?? 'draft';
  const statusLabel = reviewSent
    ? copy.statusReview
    : STATUS_LABELS[language][statusToken] ?? statusToken.replaceAll('_', ' ');
  const statusTone = reviewSent || statusToken === 'active' || statusToken === 'renewed'
    ? 'success'
    : ['draft', 'internal_review', 'legal_review', 'negotiation', 'pending_signature'].includes(
          statusToken,
        )
      ? 'warning'
      : 'neutral';
  const partyDescription =
    identity?.partyAName && identity?.partyBName
      ? language === 'ar'
        ? `بين ${identity.partyAName} و${identity.partyBName}`
        : `Between ${identity.partyAName} and ${identity.partyBName}`
      : undefined;

  const saveDraft = () => {
    window.localStorage.setItem(storageKey, JSON.stringify({ clauses, comments }));
    showSuccess(copy.toasts.saved, copy.toasts.savedDescription);
  };

  const sendForReview = () => {
    saveDraft();
    setReviewSent(true);
    showSuccess(copy.toasts.review, copy.toasts.reviewDescription);
  };

  const startEdit = (clause: Clause) => {
    setEditingClause(clause.id);
    setEditValue(clause.body);
  };

  const commitEdit = () => {
    if (!editingClause || !editValue.trim()) return;
    setClauses((current) =>
      current.map((clause) =>
        clause.id === editingClause ? { ...clause, body: editValue.trim() } : clause,
      ),
    );
    setEditingClause(null);
  };

  const insertClause = (item: DraftCopy['library'][number]) => {
    if (insertedIds.has(item.id)) return;
    setClauses((current) => [
      ...current,
      { id: item.id, title: item.title, body: item.clauseBody },
    ]);
    showSuccess(copy.toasts.inserted, item.title);
  };

  const addComment = () => {
    if (!commentValue.trim()) return;
    setComments((current) => [
      ...current,
      {
        id: `comment-${Date.now()}`,
        author: language === 'ar' ? 'أحمد الشمري' : 'Ahmed Al-Shammari',
        body: commentValue.trim(),
        time: language === 'ar' ? 'الآن' : 'Just now',
      },
    ]);
    setCommentValue('');
    setCommentOpen(false);
    showSuccess(copy.toasts.commentAdded);
  };

  const openPrintDialog = () => {
    showInfo(copy.toasts.export);
    window.print();
  };

  return (
    <div
      dir={direction}
      lang={language}
      className={cn(
        '-mx-4 -my-6 min-h-[calc(100dvh-3.5rem)] bg-neutral-50 px-4 py-4 text-neutral-900',
        'sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10',
        language === 'ar' && 'font-arabic',
      )}
      data-testid="contract-draft-editor"
      aria-busy={identityLoading || undefined}
    >
      <nav
        aria-label={language === 'ar' ? 'مسار التنقل' : 'Breadcrumb'}
        className="mb-4 flex min-w-0 items-center gap-2 overflow-x-auto text-[13px] text-neutral-500 [scrollbar-width:none]"
      >
        <Link href="/lex" className="shrink-0 transition-colors hover:text-action">
          {copy.breadcrumbs[0]}
        </Link>
        <BreadcrumbChevron direction={direction} />
        <Link href="/lex/contracts" className="shrink-0 transition-colors hover:text-action">
          {copy.breadcrumbs[1]}
        </Link>
        <BreadcrumbChevron direction={direction} />
        <Link
          href={`/lex/contracts/${encodeURIComponent(contractId)}`}
          className="shrink-0 transition-colors hover:text-action"
        >
          {contractNumber}
        </Link>
        <BreadcrumbChevron direction={direction} />
        <span aria-current="page" className="shrink-0 font-semibold text-neutral-900">
          {copy.editDraft}
        </span>
      </nav>

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <h1 className="text-[20px] font-bold leading-[1.2]">{contractTitle}</h1>
          <span
            className={cn(
              'rounded-md px-3 py-1 text-[12px] font-bold ring-1 ring-inset',
              statusTone === 'success' &&
                'bg-success-100 text-success-700 ring-success-600/30',
              statusTone === 'warning' &&
                'bg-warning-100 text-warning-800 ring-warning-600/30',
              statusTone === 'neutral' &&
                'bg-neutral-200 text-neutral-900 ring-neutral-400/40',
            )}
            role="status"
          >
            {statusLabel}
          </span>
        </div>

        <div className="flex flex-wrap gap-3 print:hidden">
          <DraftAction variant="neutral" onClick={openPrintDialog}>
            <CircleX className="size-4" aria-hidden />
            {copy.exportPdf}
          </DraftAction>
          <DraftAction variant="outline" onClick={sendForReview}>
            <SendHorizontal className="size-4" aria-hidden />
            {copy.sendReview}
          </DraftAction>
          <DraftAction variant="primary" onClick={saveDraft}>
            <Save className="size-4" aria-hidden />
            {copy.saveDraft}
          </DraftAction>
        </div>
      </div>

      <div
        className={cn(
          'grid items-start gap-6',
          language === 'ar'
            ? 'xl:grid-cols-2'
            : 'xl:grid-cols-[minmax(0,1fr)_minmax(360px,476px)]',
        )}
      >
        <section
          aria-labelledby="draft-document-title"
          aria-describedby={partyDescription ? 'draft-contract-parties' : undefined}
          className="relative min-w-0 rounded-2xl border border-neutral-150 bg-neutral-0 p-5 sm:p-8 xl:p-10"
        >
          <header className="mb-6 border-b border-neutral-150 pb-3 text-center">
            <h2
              id="draft-document-title"
              className="text-balance text-[19px] font-bold leading-[1.2] sm:text-[22px]"
            >
              {documentTitle}
            </h2>
            <p className="mt-3 text-[14px] text-neutral-500">{referenceNumber}</p>
            {partyDescription ? (
              <p id="draft-contract-parties" className="sr-only">
                {partyDescription}
              </p>
            ) : null}
          </header>

          <div className="space-y-6">
            {clauses.map((clause, index) => {
              const isFinancial = clause.id === 'financial';
              const isEditing = editingClause === clause.id;
              return (
                <article
                  key={clause.id}
                  id={`draft-clause-${clause.id}`}
                  ref={isFinancial ? financialRef : undefined}
                  className="scroll-mt-24"
                >
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <h3 className="text-[16px] font-bold leading-[1.2]">{clause.title}</h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => (isEditing ? commitEdit() : startEdit(clause))}
                      aria-label={isEditing ? copy.saveClause : `${copy.editClause}: ${clause.title}`}
                      className="size-8 min-h-0 shrink-0 rounded-md p-0 text-action transition-colors hover:bg-neutral-100 hover:text-action focus-visible:ring-action"
                    >
                      {isEditing ? (
                        <Save className="size-4" aria-hidden />
                      ) : (
                        <Pencil className="size-4" aria-hidden />
                      )}
                    </Button>
                  </div>

                  {isEditing ? (
                    <Textarea
                      value={editValue}
                      onChange={(event) => setEditValue(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commitEdit();
                        if (event.key === 'Escape') setEditingClause(null);
                      }}
                      autoFocus
                      className="min-h-24 rounded-lg border-action bg-neutral-0 text-[14px] leading-[1.35] text-neutral-900"
                    />
                  ) : isFinancial ? (
                    <div
                      className={cn(
                        'flex items-center gap-3 rounded-lg border border-warning-300 bg-warning-50 p-3',
                        highlightFinancial && 'bg-warning-100',
                      )}
                    >
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-action text-content-inverted">
                        <MessageSquare className="size-3" aria-hidden />
                      </span>
                      <p
                        className={cn(
                          'min-w-0 text-[14px] leading-[1.25]',
                          boldFinancial && 'font-bold',
                          italicFinancial && 'italic',
                        )}
                      >
                        {language === 'ar' ? (
                          <>
                            يدفع الطرف الثاني للطرف الأول{' '}
                            <strong className="font-bold text-success-700">
                              مبلغاً إجمالياً وقدره 150,000 ريال سعودي
                            </strong>{' '}
                            يُسدد على ثلاث دفعات متساوية بناءً على إنجاز مراحل التسليم المحددة في
                            العقد.
                          </>
                        ) : (
                          <>
                            The Second Party shall pay the First Party{' '}
                            <strong className="font-bold text-success-700">
                              a total sum of 150,000 Saudi Riyals (SAR)
                            </strong>{' '}
                            to be disbursed in three equal installments based on successful completion
                            of the delivery phases outlined in Annex (B).
                          </>
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[14px] leading-[1.25]">{clause.body}</p>
                  )}

                  {isFinancial && index === 1 ? (
                    <FormattingToolbar
                      copy={copy}
                      direction={direction}
                      bold={boldFinancial}
                      italic={italicFinancial}
                      highlight={highlightFinancial}
                      onBold={() => setBoldFinancial((value) => !value)}
                      onItalic={() => setItalicFinancial((value) => !value)}
                      onHighlight={() => setHighlightFinancial((value) => !value)}
                      onComment={() => {
                        setCommentOpen(true);
                        window.setTimeout(() => {
                          document.getElementById('draft-comment-input')?.focus();
                        }, 0);
                      }}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <aside className="min-w-0 space-y-6">
          {language === 'en' ? (
            <Panel title={copy.outline}>
              <ol className="space-y-2 text-[13px] leading-[1.2]">
                {copy.outlineItems.map((item, index) => {
                  const clause = clauses[index];
                  return (
                    <li key={item}>
                      {clause ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            document
                              .getElementById(`draft-clause-${clause.id}`)
                              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          }
                          className={cn(
                            'h-auto min-h-0 justify-start p-0 text-start text-[13px] font-semibold transition-colors hover:bg-transparent hover:text-success-700',
                            index === 0 ? 'text-success-700' : 'text-neutral-900',
                          )}
                        >
                          • {item}
                        </Button>
                      ) : (
                        <span className="text-neutral-500">• {item}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Panel>
          ) : null}

          <Panel
            title={copy.clauseLibrary}
            action={
              <Link
                href="/lex/clause-library"
                className="text-[12px] font-bold text-success-700 hover:underline"
              >
                {copy.manageLibrary}
              </Link>
            }
          >
            <label className="relative block">
              <span className="sr-only">{copy.searchPlaceholder}</span>
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="h-10 min-h-0 rounded-lg border-0 bg-neutral-100 ps-9 text-[13px] text-neutral-900 placeholder:text-neutral-500 focus-visible:ring-action"
              />
            </label>

            <div className="mt-4 space-y-3">
              {filteredLibrary.map((item) => {
                const inserted = insertedIds.has(item.id);
                return (
                  <article
                    key={item.id}
                    className="rounded-lg border border-neutral-150 bg-neutral-50 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="truncate text-[13px] font-bold">{item.title}</h4>
                      <Button
                        type="button"
                        onClick={() => insertClause(item)}
                        disabled={inserted}
                        className="h-auto min-h-0 shrink-0 rounded bg-success-700 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-success-600 disabled:bg-neutral-200 disabled:text-neutral-800"
                      >
                        {inserted ? copy.inserted : copy.insert}
                      </Button>
                    </div>
                    <p className="mt-1 truncate text-[12px] text-neutral-500">{item.preview}</p>
                  </article>
                );
              })}
              {filteredLibrary.length === 0 ? (
                <p className="rounded-lg bg-neutral-100 p-3 text-[13px] text-neutral-500">
                  {language === 'ar' ? 'لا توجد بنود مطابقة.' : 'No matching clauses.'}
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel title={copy.discussions}>
            <div className="space-y-3">
              {comments.map((comment) => (
                <article key={comment.id} className="rounded-[10px] bg-neutral-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Image
                        src={SARAH_AVATAR}
                        alt=""
                        width={24}
                        height={24}
                        className="size-6 shrink-0 rounded-full object-cover"
                      />
                      <strong className="truncate text-[12px]">{comment.author}</strong>
                    </div>
                    <time className="shrink-0 text-[11px] text-neutral-500">{comment.time}</time>
                  </div>
                  <p className="mt-2 text-[12px] leading-[1.25] sm:text-[13px]">{comment.body}</p>
                </article>
              ))}
            </div>

            {commentOpen ? (
              <div className="mt-3 space-y-2">
                <Textarea
                  id="draft-comment-input"
                  value={commentValue}
                  onChange={(event) => setCommentValue(event.target.value)}
                  placeholder={copy.commentPlaceholder}
                  className="min-h-20 rounded-lg border-neutral-150 bg-neutral-0 text-[13px] focus-visible:ring-action"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={addComment}
                    disabled={!commentValue.trim()}
                    className="h-9 min-h-0 rounded-lg px-3 text-[12px]"
                  >
                    {copy.addComment}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCommentOpen(false)}
                    className="h-9 min-h-0 rounded-lg px-3 text-[12px]"
                  >
                    {copy.cancel}
                  </Button>
                </div>
              </div>
            ) : null}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function BreadcrumbChevron({ direction }: { direction: AppDirection }) {
  return direction === 'rtl' ? (
    <ChevronLeft className="size-3 shrink-0" aria-hidden />
  ) : (
    <ChevronRight className="size-3 shrink-0" aria-hidden />
  );
}

function DraftAction({
  variant,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant'> & {
  variant: 'neutral' | 'outline' | 'primary';
}) {
  return (
    <Button
      {...props}
      className={cn(
        'h-[38px] min-h-0 gap-2 rounded-lg px-5 text-[14px] font-semibold shadow-none',
        variant === 'primary' &&
          'bg-success-700 text-neutral-0 hover:bg-brand-primary-700',
        variant === 'outline' &&
          'border border-success-700 bg-neutral-0 text-success-700 hover:bg-success-50 hover:text-success-700',
        variant === 'neutral' &&
          'border border-neutral-300 bg-neutral-0 text-neutral-900 hover:bg-neutral-100',
        className,
      )}
    />
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-150 bg-neutral-0 p-5 sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-[16px] font-bold leading-[1.2]">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function FormattingToolbar({
  copy,
  direction,
  bold,
  italic,
  highlight,
  onBold,
  onItalic,
  onHighlight,
  onComment,
}: {
  copy: DraftCopy;
  direction: AppDirection;
  bold: boolean;
  italic: boolean;
  highlight: boolean;
  onBold: () => void;
  onItalic: () => void;
  onHighlight: () => void;
  onComment: () => void;
}) {
  const actions = [
    { key: 'bold', label: copy.toolbar.bold, icon: Bold, active: bold, onClick: onBold },
    { key: 'italic', label: copy.toolbar.italic, icon: Italic, active: italic, onClick: onItalic },
    {
      key: 'highlight',
      label: copy.toolbar.highlight,
      icon: Highlighter,
      active: highlight,
      onClick: onHighlight,
    },
  ] as const;

  return (
    <div
      dir={direction}
      role="toolbar"
      aria-label={copy.editDraft}
      className="mx-auto -mb-1 mt-[-14px] flex w-fit items-center gap-1 rounded-xl bg-neutral-900 p-2 text-content-inverted shadow-elevation-3 print:hidden"
    >
      {actions.map(({ key, label, icon: Icon, active, onClick }) => (
        <Button
          key={key}
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'size-8 min-h-0 rounded-md p-0 text-content-inverted transition-colors hover:bg-neutral-0/10 hover:text-content-inverted focus-visible:ring-neutral-0',
            active && 'bg-action',
          )}
        >
          <Icon className="size-4" aria-hidden />
        </Button>
      ))}
      <span aria-hidden className="mx-1 h-5 w-px bg-white/30" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onComment}
        aria-label={copy.toolbar.comment}
        className="size-8 min-h-0 rounded-md bg-action p-0 text-content-inverted transition-colors hover:bg-action-hover hover:text-content-inverted focus-visible:ring-neutral-0"
      >
        <MessageCirclePlus className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
