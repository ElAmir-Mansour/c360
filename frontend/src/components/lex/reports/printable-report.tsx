"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useLocale } from "@/components/providers/locale-provider";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export interface ReportPeriod {
  from?: Date | string;
  to?: Date | string;
  label?: string;
}

export interface PrintableReportProps {
  title: string;
  period?: ReportPeriod;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  const isoDate =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value.split("-").map(Number)
      : null;
  const date =
    value instanceof Date
      ? value
      : isoDate
        ? new Date(isoDate[0], isoDate[1] - 1, isoDate[2])
        : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatReportPeriod(
  period: ReportPeriod | undefined,
  locale: string,
): string {
  if (period?.label) return period.label;
  const from = toDate(period?.from);
  const to = toDate(period?.to);
  const formatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  if (from && to) return `${formatter.format(from)} – ${formatter.format(to)}`;
  if (from) {
    return locale === "ar"
      ? `من ${formatter.format(from)}`
      : `From ${formatter.format(from)}`;
  }
  if (to) {
    return locale === "ar"
      ? `حتى ${formatter.format(to)}`
      : `Through ${formatter.format(to)}`;
  }
  return locale === "ar" ? "كل الفترات" : "All time";
}

/**
 * Shared print boundary for every Lex report.
 *
 * The screen view is unchanged. During printing, only this boundary is visible
 * and its table display-groups repeat the brand header and confidentiality
 * footer on each A4 landscape page.
 */
export function PrintableReport({
  title,
  period,
  children,
  className,
  contentClassName,
}: PrintableReportProps) {
  const { locale, direction } = useLocale();
  const { tenant, user } = useAuth();
  const isArabic = locale === "ar";
  const tenantName = tenant?.settings?.branding?.company_name || tenant?.name || "—";
  const generatedBy =
    user?.full_name ||
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    user?.email ||
    "—";
  const generatedAt = new Intl.DateTimeFormat(isArabic ? "ar-SA" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  const periodLabel = formatReportPeriod(period, locale);

  return (
    <div
      className={cn("lex-print-root", className)}
      dir={direction}
      lang={locale}
      data-testid="printable-report"
    >
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      <div className="lex-print-header-group" aria-hidden="true">
        <div className="lex-print-row">
          <header className="lex-print-header lex-print-cell">
            <div className="lex-print-brand">
              <Image
                src={
                  isArabic
                    ? "/brand/WatheeqTech-arabic-logo.svg"
                    : "/brand/WatheeqTech-english-logo.svg"
                }
                width={150}
                height={42}
                alt="WatheeqTech"
                className="lex-print-logo"
                priority
              />
              <div className="lex-print-heading">
                <strong>{title}</strong>
                <span>{isArabic ? "الشؤون القانونية" : "Legal Affairs"}</span>
              </div>
            </div>
            <dl className="lex-print-meta">
              <div>
                <dt>{isArabic ? "الفترة" : "Period"}</dt>
                <dd>{periodLabel}</dd>
              </div>
              <div>
                <dt>{isArabic ? "المنشأة" : "Tenant"}</dt>
                <dd>{tenantName}</dd>
              </div>
              <div>
                <dt>{isArabic ? "تاريخ الإنشاء" : "Generated"}</dt>
                <dd suppressHydrationWarning>{generatedAt}</dd>
              </div>
            </dl>
          </header>
        </div>
      </div>

      <div className="lex-print-body-group">
        <div className="lex-print-row">
          <main className={cn("lex-print-cell lex-print-content", contentClassName)}>
            {children}
          </main>
        </div>
      </div>

      <div className="lex-print-footer-group" aria-hidden="true">
        <div className="lex-print-row">
          <footer className="lex-print-footer lex-print-cell">
            <span>
              {isArabic
                ? "سري — للاستخدام الداخلي فقط"
                : "Confidential — Internal use only"}
            </span>
            <span className="lex-print-page-number">
              {isArabic ? "صفحة " : "Page "}
            </span>
            <span>{generatedBy}</span>
          </footer>
        </div>
      </div>
    </div>
  );
}

const PRINT_STYLES = `
  .lex-print-header-group,
  .lex-print-footer-group { display: none; }

  @page {
    size: A4 landscape;
    margin: 12mm 12mm 16mm;
  }

  @media print {
    html, body {
      background: #fff !important;
    }

    body * { visibility: hidden !important; }
    body *:not(:has(.lex-print-root)):not(.lex-print-root):not(.lex-print-root *) {
      display: none !important;
    }
    .lex-print-root,
    .lex-print-root * { visibility: visible !important; }
    .lex-print-root {
      position: absolute !important;
      inset: 0 auto auto 0 !important;
      display: table !important;
      width: 100% !important;
      min-width: 0 !important;
      color: #172326 !important;
      background: #fff !important;
      font-size: 9pt !important;
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }

    [dir="rtl"] .lex-print-root,
    .lex-print-root[dir="rtl"] { direction: rtl !important; }

    .lex-print-header-group { display: table-header-group !important; }
    .lex-print-body-group { display: table-row-group !important; }
    .lex-print-footer-group { display: table-footer-group !important; }
    .lex-print-row { display: table-row !important; }
    .lex-print-cell { display: table-cell !important; }

    .lex-print-header {
      padding-block: 0 4mm !important;
      border-bottom: 1.5px solid #0f766e !important;
      text-align: start !important;
    }
    .lex-print-brand {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8mm !important;
    }
    .lex-print-logo {
      width: 38mm !important;
      height: auto !important;
      object-fit: contain !important;
    }
    .lex-print-heading {
      display: flex !important;
      min-width: 0 !important;
      flex: 1 !important;
      align-items: baseline !important;
      justify-content: flex-end !important;
      gap: 3mm !important;
      text-align: end !important;
    }
    .lex-print-heading strong { font-size: 15pt !important; }
    .lex-print-heading span { color: #0f766e !important; font-weight: 600 !important; }
    .lex-print-meta {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 2mm 8mm !important;
      margin: 3mm 0 0 !important;
      font-size: 8pt !important;
    }
    .lex-print-meta > div { display: flex !important; gap: 1.5mm !important; }
    .lex-print-meta dt { color: #5f6d70 !important; font-weight: 600 !important; }
    .lex-print-meta dt::after { content: ":"; }
    .lex-print-meta dd { margin: 0 !important; }

    .lex-print-content { padding-block: 5mm 4mm !important; }
    .lex-print-content > :first-child { margin-top: 0 !important; }

    .lex-print-footer {
      padding-block: 3mm 0 !important;
      border-top: 1px solid #b7c8c6 !important;
      color: #5f6d70 !important;
      font-size: 7.5pt !important;
      text-align: start !important;
    }
    .lex-print-footer > span {
      display: inline-block !important;
      width: 33.333% !important;
    }
    .lex-print-footer > span:nth-child(2) { text-align: center !important; }
    .lex-print-footer > span:last-child { text-align: end !important; }
    .lex-print-page-number::after { content: counter(page) " / " counter(pages); }

    .lex-report-no-print,
    [data-report-no-print="true"],
    [role="dialog"],
    [data-radix-popper-content-wrapper] { display: none !important; }

    .lex-print-root button:not([data-report-no-print="true"]) {
      pointer-events: none !important;
      cursor: default !important;
    }

    .lex-print-root table {
      width: 100% !important;
      border-collapse: collapse !important;
    }
    .lex-print-root thead { display: table-header-group !important; }
    .lex-print-root tfoot { display: table-footer-group !important; }
    .lex-print-root tr,
    .lex-print-root .card,
    .lex-print-root [data-report-card="true"],
    .lex-print-root [class*="rounded-"] { break-inside: avoid !important; }
    .lex-print-root [data-report-section="true"] { break-before: page !important; }
    .lex-print-root [data-report-section="true"]:first-child { break-before: auto !important; }
    .lex-print-root .recharts-responsive-container,
    .lex-print-root [data-chart] {
      width: 250mm !important;
      max-width: 100% !important;
      min-width: 0 !important;
      min-height: 55mm !important;
    }
    .lex-print-root .recharts-wrapper,
    .lex-print-root .recharts-surface { max-width: 100% !important; }
    .lex-print-root .overflow-auto,
    .lex-print-root .overflow-x-auto,
    .lex-print-root .overflow-y-auto { overflow: visible !important; }
    .lex-print-root .sticky { position: static !important; }
    .lex-print-root a { color: inherit !important; text-decoration: none !important; }
  }
`;
