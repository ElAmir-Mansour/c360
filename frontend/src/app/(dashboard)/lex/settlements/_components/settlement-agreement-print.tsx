/**
 * FEATURE 15 — Generate / print settlement agreement & summary (detail page).
 *
 * Exports <SettlementAgreementButton> — a header-action button that composes a
 * print-ready, RTL-aware settlement agreement document from the settlement
 * (title, reference, method, value, counterparty name/contact/id, terms) plus a
 * negotiation-history table from the rounds, with a letterhead/header area and
 * signature blocks for both parties.
 *
 * APPROACH — dedicated print window (not a hidden in-page container):
 *   Opening a fresh `window.open()` document and writing a fully self-contained
 *   HTML string is the cleaner option here because (a) the app's global print
 *   styles cannot leak into — or be clobbered by — the legal document, (b) the
 *   document gets its own `dir`/`lang` root so the RTL agreement renders
 *   correctly regardless of the dashboard's current direction, and (c) only the
 *   agreement prints — there is no need for an app-wide `@media print` scope
 *   that hides the chrome. The composed document carries its own scoped CSS
 *   (screen preview + `@media print`) and auto-invokes `window.print()` on load.
 *
 * If the popup is blocked, the button surfaces a toast and silently no-ops the
 * print (no app-state mutation, no navigation).
 *
 * Self-contained bilingual labels (English + professional MSA) per the canonical
 * lex bilingual contract. Money is rendered through `formatSettlementValue`.
 * Legal glossary: تسوية (settlement) / مفاوضة-تفاوض (negotiation) / تحكيم
 * (arbitration) / وساطة (mediation) / مصالحة-صلح (reconciliation) / اعتماد
 * (approval) / طرف مقابل (counterparty).
 */

'use client';

import { useCallback, useMemo } from 'react';
import { FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatDateTime } from '@/lib/format';
import { showApiError } from '@/lib/toast';
import {
  formatSettlementValue,
  type Settlement,
  type SettlementMethod,
  type SettlementNegotiationRound,
  type SettlementStatus,
} from '@/lib/lex/settlements';
import type { AppDirection, AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Bilingual labels — self-contained per the lex contract.
 * ------------------------------------------------------------------------- */

interface AgreementLabels {
  /** Header-action button trigger. */
  trigger: string;
  /** Toast shown when the browser blocks the print window. */
  popupBlocked: string;
  /** <title> of the generated print document. */
  documentTitle: (reference: string) => string;
  /** Letterhead / masthead. */
  letterhead: {
    org: string;
    department: string;
    docType: string;
  };
  /** Top metadata strip. */
  meta: {
    reference: string;
    status: string;
    method: string;
    generatedAt: string;
  };
  /** Parties / agreement particulars block. */
  particulars: {
    title: string;
    settlementTitle: string;
    matter: string;
    value: string;
    approvedAt: string;
    executedAt: string;
  };
  counterparty: {
    title: string;
    name: string;
    contact: string;
    idNumber: string;
  };
  terms: {
    title: string;
    empty: string;
  };
  history: {
    title: string;
    empty: string;
    columns: {
      round: string;
      proposedBy: string;
      value: string;
      terms: string;
      outcome: string;
      date: string;
    };
    roundLabel: (n: number) => string;
  };
  signatures: {
    title: string;
    firstParty: string;
    counterparty: string;
    name: string;
    signature: string;
    date: string;
  };
  statusOptions: Record<SettlementStatus, string>;
  methodOptions: Record<SettlementMethod, string>;
  /** Placeholder for any absent field. */
  notProvided: string;
}

const agreementLabels: LexBilingual<AgreementLabels> = {
  en: {
    trigger: 'Print agreement',
    popupBlocked: 'Unable to open the print window. Please allow pop-ups for this site.',
    documentTitle: (reference) => `Settlement Agreement — ${reference}`,
    letterhead: {
      org: 'Watheeq Legal Affairs',
      department: 'Settlements & Alternative Dispute Resolution',
      docType: 'Settlement Agreement & Summary',
    },
    meta: {
      reference: 'Reference',
      status: 'Status',
      method: 'Method',
      generatedAt: 'Generated',
    },
    particulars: {
      title: 'Agreement particulars',
      settlementTitle: 'Subject',
      matter: 'Matter',
      value: 'Settlement value',
      approvedAt: 'Approved on',
      executedAt: 'Executed on',
    },
    counterparty: {
      title: 'Counterparty',
      name: 'Name',
      contact: 'Contact',
      idNumber: 'Identifier',
    },
    terms: {
      title: 'Settlement terms',
      empty: 'No terms have been recorded for this settlement.',
    },
    history: {
      title: 'Negotiation history',
      empty: 'No negotiation rounds were recorded.',
      columns: {
        round: 'Round',
        proposedBy: 'Proposed by',
        value: 'Value',
        terms: 'Terms',
        outcome: 'Outcome',
        date: 'Date',
      },
      roundLabel: (n) => `Round ${n}`,
    },
    signatures: {
      title: 'Signatures',
      firstParty: 'First party (Watheeq)',
      counterparty: 'Counterparty',
      name: 'Name',
      signature: 'Signature',
      date: 'Date',
    },
    statusOptions: {
      proposed: 'Proposed',
      negotiating: 'Negotiating',
      pending_approval: 'Pending approval',
      approved: 'Approved',
      executed: 'Executed',
      rejected: 'Rejected',
      abandoned: 'Abandoned',
    },
    methodOptions: {
      reconciliation: 'Reconciliation',
      mediation: 'Mediation',
      arbitration: 'Arbitration',
      negotiation: 'Negotiation',
      other: 'Other',
    },
    notProvided: '—',
  },
  ar: {
    trigger: 'طباعة الاتفاقية',
    popupBlocked: 'تعذّر فتح نافذة الطباعة. يُرجى السماح بالنوافذ المنبثقة لهذا الموقع.',
    documentTitle: (reference) => `اتفاقية تسوية — ${reference}`,
    letterhead: {
      org: 'وثيق للشؤون القانونية',
      department: 'التسويات والحلول البديلة للنزاعات',
      docType: 'اتفاقية تسوية وملخّصها',
    },
    meta: {
      reference: 'المرجع',
      status: 'الحالة',
      method: 'الأسلوب',
      generatedAt: 'تاريخ الإصدار',
    },
    particulars: {
      title: 'بيانات الاتفاقية',
      settlementTitle: 'الموضوع',
      matter: 'القضية',
      value: 'قيمة التسوية',
      approvedAt: 'تاريخ الاعتماد',
      executedAt: 'تاريخ التنفيذ',
    },
    counterparty: {
      title: 'الطرف المقابل',
      name: 'الاسم',
      contact: 'وسيلة التواصل',
      idNumber: 'المعرّف',
    },
    terms: {
      title: 'بنود التسوية',
      empty: 'لم تُسجَّل بنود لهذه التسوية.',
    },
    history: {
      title: 'سجل المفاوضات',
      empty: 'لم تُسجَّل أي جولات تفاوض.',
      columns: {
        round: 'الجولة',
        proposedBy: 'مُقدِّم العرض',
        value: 'القيمة',
        terms: 'البنود',
        outcome: 'النتيجة',
        date: 'التاريخ',
      },
      roundLabel: (n) => `الجولة ${n}`,
    },
    signatures: {
      title: 'التواقيع',
      firstParty: 'الطرف الأول (وثيق)',
      counterparty: 'الطرف المقابل',
      name: 'الاسم',
      signature: 'التوقيع',
      date: 'التاريخ',
    },
    statusOptions: {
      proposed: 'مقترحة',
      negotiating: 'قيد التفاوض',
      pending_approval: 'بانتظار الاعتماد',
      approved: 'معتمدة',
      executed: 'منفّذة',
      rejected: 'مرفوضة',
      abandoned: 'متروكة',
    },
    methodOptions: {
      reconciliation: 'صلح',
      mediation: 'وساطة',
      arbitration: 'تحكيم',
      negotiation: 'تفاوض',
      other: 'أخرى',
    },
    notProvided: '—',
  },
};

function useAgreementLabels(): AgreementLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(agreementLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Pure HTML document composition.
 * ------------------------------------------------------------------------- */

/** Minimal HTML-entity escape so settlement free-text cannot break the markup. */
function esc(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a value or the localized not-provided placeholder. */
function orDash(L: AgreementLabels, value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? esc(trimmed) : esc(L.notProvided);
}

function statusLabel(L: AgreementLabels, status: SettlementStatus): string {
  return L.statusOptions[status] ?? status.replace(/_/g, ' ');
}

function methodLabel(L: AgreementLabels, method: SettlementMethod): string {
  return L.methodOptions[method] ?? method.replace(/_/g, ' ');
}

function metaRow(label: string, value: string): string {
  return `
    <div class="meta-cell">
      <span class="meta-label">${esc(label)}</span>
      <span class="meta-value">${value}</span>
    </div>`;
}

function detailRow(label: string, value: string): string {
  return `
    <tr>
      <th scope="row">${esc(label)}</th>
      <td>${value}</td>
    </tr>`;
}

function buildRoundsRows(
  L: AgreementLabels,
  rounds: SettlementNegotiationRound[],
): string {
  if (rounds.length === 0) {
    return `<tr><td class="empty" colspan="6">${esc(L.history.empty)}</td></tr>`;
  }
  const ordered = [...rounds].sort((a, b) => a.round_number - b.round_number);
  return ordered
    .map((round) => {
      const value = formatSettlementValue(round.proposed_value, round.currency);
      return `
        <tr>
          <td class="num">${esc(L.history.roundLabel(round.round_number))}</td>
          <td>${orDash(L, round.proposed_by)}</td>
          <td class="num">${esc(value)}</td>
          <td>${orDash(L, round.terms)}</td>
          <td>${orDash(L, round.outcome)}</td>
          <td>${esc(formatDateTime(round.created_at))}</td>
        </tr>`;
    })
    .join('');
}

function signatureBlock(L: AgreementLabels, partyLabel: string, name: string): string {
  return `
    <div class="sig-block">
      <div class="sig-party">${esc(partyLabel)}</div>
      <table class="sig-fields">
        <tr><th scope="row">${esc(L.signatures.name)}</th><td>${name}</td></tr>
        <tr><th scope="row">${esc(L.signatures.signature)}</th><td class="sig-line"></td></tr>
        <tr><th scope="row">${esc(L.signatures.date)}</th><td class="sig-line"></td></tr>
      </table>
    </div>`;
}

/**
 * Compose the full, self-contained agreement HTML document (with scoped CSS and
 * an auto-print bootstrap) for the given settlement + rounds at `locale`/`dir`.
 * Pure — exported for testability.
 */
export function composeSettlementAgreementHtml(
  settlement: Settlement,
  rounds: SettlementNegotiationRound[],
  L: AgreementLabels,
  locale: AppLocale,
  direction: AppDirection,
): string {
  const reference = settlement.reference?.trim() || settlement.id;
  const value = formatSettlementValue(settlement.value, settlement.currency);

  const particulars = [
    detailRow(L.particulars.settlementTitle, orDash(L, settlement.title)),
    detailRow(L.particulars.matter, esc(settlement.matter_id)),
    detailRow(L.particulars.value, esc(value)),
    detailRow(L.meta.method, esc(methodLabel(L, settlement.method))),
    detailRow(
      L.particulars.approvedAt,
      settlement.approved_at ? esc(formatDateTime(settlement.approved_at)) : esc(L.notProvided),
    ),
    detailRow(
      L.particulars.executedAt,
      settlement.executed_at ? esc(formatDateTime(settlement.executed_at)) : esc(L.notProvided),
    ),
  ].join('');

  const counterparty = [
    detailRow(L.counterparty.name, orDash(L, settlement.counterparty_name)),
    detailRow(L.counterparty.contact, orDash(L, settlement.counterparty_contact)),
    detailRow(L.counterparty.idNumber, orDash(L, settlement.counterparty_id_number)),
  ].join('');

  const termsHtml = settlement.terms?.trim()
    ? esc(settlement.terms).replace(/\n/g, '<br />')
    : `<span class="empty-inline">${esc(L.terms.empty)}</span>`;

  const counterpartySignatory = settlement.counterparty_name?.trim()
    ? esc(settlement.counterparty_name.trim())
    : '<span class="sig-line"></span>';

  // The auto-print bootstrap runs after layout. A short delay lets fonts settle
  // so the print dialog measures the final document height.
  const printBootstrap = `
    (function () {
      function go() { try { window.focus(); window.print(); } catch (e) {} }
      if (document.readyState === 'complete') { setTimeout(go, 120); }
      else { window.addEventListener('load', function () { setTimeout(go, 120); }); }
    })();`;

  return `<!doctype html>
<html lang="${esc(locale)}" dir="${esc(direction)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(L.documentTitle(reference))}</title>
<style>
  :root {
    --ink: #06352F;
    --muted: #6C7874;
    --line: #D1D8D5;
    --accent: #005E5E;
    --gold: #ABB705;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Noto Naskh Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif;
    color: var(--ink);
    background: #FDFFF6;
    line-height: 1.6;
    font-size: 13px;
  }
  .page {
    max-width: 820px;
    margin: 24px auto;
    background: #fff;
    padding: 40px 48px 56px;
    box-shadow: 0 6px 28px rgba(0, 94, 94, 0.12);
    border-radius: 6px;
  }
  .letterhead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 3px solid var(--accent);
    padding-bottom: 16px;
  }
  .letterhead .org { font-size: 18px; font-weight: 700; color: var(--accent); letter-spacing: 0.2px; }
  .letterhead .dept { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .letterhead .doc-type {
    font-size: 13px; font-weight: 600; color: var(--gold);
    text-align: end; max-width: 240px;
  }
  .meta {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px 24px;
    margin: 18px 0 26px;
    padding: 14px 18px;
    background: #f1f6f6;
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .meta-cell { display: flex; flex-direction: column; }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
  .meta-value { font-size: 13px; font-weight: 600; }
  section { margin-bottom: 24px; page-break-inside: avoid; }
  h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px;
    color: var(--accent); margin: 0 0 10px;
    padding-bottom: 6px; border-bottom: 1px solid var(--line);
  }
  table { width: 100%; border-collapse: collapse; }
  .detail th, .detail td {
    text-align: start; vertical-align: top; padding: 7px 10px;
    border-bottom: 1px solid var(--line); font-size: 12.5px;
  }
  .detail th {
    width: 32%; font-weight: 600; color: var(--muted);
    background: #fafcfc; white-space: nowrap;
  }
  .terms-body {
    font-size: 13px; white-space: pre-line;
    padding: 12px 14px; background: #fafcfc;
    border: 1px solid var(--line); border-radius: 6px;
  }
  .history th, .history td {
    text-align: start; padding: 7px 9px;
    border: 1px solid var(--line); font-size: 11.5px; vertical-align: top;
  }
  .history th { background: var(--accent); color: #fff; font-weight: 600; white-space: nowrap; }
  .history .num { white-space: nowrap; }
  .history .empty, .empty-inline { color: var(--muted); font-style: italic; }
  .signatures-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 8px;
  }
  .sig-block { border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; }
  .sig-party { font-weight: 700; font-size: 12.5px; color: var(--accent); margin-bottom: 10px; }
  .sig-fields th, .sig-fields td {
    text-align: start; padding: 9px 6px; font-size: 12px; vertical-align: bottom;
  }
  .sig-fields th { width: 34%; color: var(--muted); font-weight: 600; }
  .sig-line { border-bottom: 1px dashed #6C7874; min-height: 18px; }
  .footer {
    margin-top: 30px; padding-top: 12px; border-top: 1px solid var(--line);
    font-size: 10.5px; color: var(--muted); text-align: center;
  }
  @media print {
    body { background: #fff; font-size: 12px; }
    .page { box-shadow: none; margin: 0; max-width: none; border-radius: 0; padding: 0 6mm; }
    @page { margin: 14mm; }
  }
</style>
</head>
<body>
  <main class="page">
    <header class="letterhead">
      <div>
        <div class="org">${esc(L.letterhead.org)}</div>
        <div class="dept">${esc(L.letterhead.department)}</div>
      </div>
      <div class="doc-type">${esc(L.letterhead.docType)}</div>
    </header>

    <div class="meta">
      ${metaRow(L.meta.reference, esc(reference))}
      ${metaRow(L.meta.status, esc(statusLabel(L, settlement.status)))}
      ${metaRow(L.meta.method, esc(methodLabel(L, settlement.method)))}
      ${metaRow(L.meta.generatedAt, esc(formatDateTime(new Date())))}
    </div>

    <section>
      <h2>${esc(L.particulars.title)}</h2>
      <table class="detail"><tbody>${particulars}</tbody></table>
    </section>

    <section>
      <h2>${esc(L.counterparty.title)}</h2>
      <table class="detail"><tbody>${counterparty}</tbody></table>
    </section>

    <section>
      <h2>${esc(L.terms.title)}</h2>
      <div class="terms-body">${termsHtml}</div>
    </section>

    <section>
      <h2>${esc(L.history.title)}</h2>
      <table class="history">
        <thead>
          <tr>
            <th>${esc(L.history.columns.round)}</th>
            <th>${esc(L.history.columns.proposedBy)}</th>
            <th>${esc(L.history.columns.value)}</th>
            <th>${esc(L.history.columns.terms)}</th>
            <th>${esc(L.history.columns.outcome)}</th>
            <th>${esc(L.history.columns.date)}</th>
          </tr>
        </thead>
        <tbody>${buildRoundsRows(L, rounds)}</tbody>
      </table>
    </section>

    <section>
      <h2>${esc(L.signatures.title)}</h2>
      <div class="signatures-grid">
        ${signatureBlock(L, L.signatures.firstParty, '<span class="sig-line"></span>')}
        ${signatureBlock(L, L.signatures.counterparty, counterpartySignatory)}
      </div>
    </section>

    <div class="footer">${esc(L.letterhead.org)} · ${esc(reference)} · ${esc(formatDateTime(new Date()))}</div>
  </main>
  <script>${printBootstrap}</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------------- *
 * Public component.
 * ------------------------------------------------------------------------- */

export interface SettlementAgreementButtonProps {
  settlement: Settlement;
  rounds: SettlementNegotiationRound[];
  /** Optional visual override; defaults to the outline header-action style. */
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}

/**
 * Header-action button that opens a print-ready settlement agreement document in
 * a dedicated window and triggers the browser print dialog. Mount it in the
 * detail-page header actions row alongside the other action buttons.
 */
export function SettlementAgreementButton({
  settlement,
  rounds,
  variant = 'outline',
  size,
  className,
}: SettlementAgreementButtonProps) {
  const { locale, direction } = useLocaleOrDefault();
  const L = useAgreementLabels();

  const handlePrint = useCallback(() => {
    const html = composeSettlementAgreementHtml(settlement, rounds, L, locale, direction);
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000');
    if (!printWindow) {
      showApiError(new Error(L.popupBlocked));
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }, [settlement, rounds, L, locale, direction]);

  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={handlePrint}>
      <FileText className="me-1.5 h-3.5 w-3.5" />
      {L.trigger}
    </Button>
  );
}
