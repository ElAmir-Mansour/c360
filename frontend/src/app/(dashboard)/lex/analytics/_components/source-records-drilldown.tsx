"use client";

import Link from "next/link";
import { ArrowUpRight, FileSearch } from "lucide-react";

import { useLocale } from "@/components/providers/locale-provider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLexFormat } from "@/lib/lex/ksa";

export interface AnalyticsSourceRecord {
  id: string;
  href: string;
  eyebrow: string;
  title: string;
  status?: string;
  details?: Array<{ label: string; value: string }>;
}

export interface AnalyticsSourceSelection {
  title: string;
  description?: string;
  records: AnalyticsSourceRecord[];
}

/**
 * Contributor drawer for client-derived analytics. The dashboard values and
 * this list share the same fetched records, so the displayed total can always
 * be audited down to the exact source rows that produced it.
 */
export function SourceRecordsDrilldown({
  selection,
  onOpenChange,
}: {
  selection: AnalyticsSourceSelection | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const copy =
    locale === "ar"
      ? {
          count: (value: string) => `${value} سجل مصدر`,
          empty: "لا توجد سجلات تساهم في هذه القيمة.",
          open: (title: string) => `فتح ${title}`,
        }
      : {
          count: (value: string, total: number) =>
            `${value} source record${total === 1 ? "" : "s"}`,
          empty: "No source records contribute to this value.",
          open: (title: string) => `Open ${title}`,
        };
  const total = selection?.records.length ?? 0;

  return (
    <Sheet open={selection !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === "rtl" ? "left" : "right"}
        dir={direction}
        className="flex w-full flex-col overflow-hidden sm:max-w-2xl"
      >
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2 text-start">
            <FileSearch className="h-5 w-5 text-primary" aria-hidden />
            {selection?.title}
          </SheetTitle>
          <SheetDescription className="text-start">
            {[selection?.description, copy.count(f.formatNumber(total), total)]
              .filter(Boolean)
              .join(" · ")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pe-1">
          {selection?.records.length ? (
            <div className="space-y-3">
              {selection.records.map((record) => (
                <Link
                  key={`${record.href}-${record.id}`}
                  href={record.href}
                  className="group block rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={copy.open(record.title)}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {record.eyebrow}
                        </span>
                        {record.status ? (
                          <span className="rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {record.status.replaceAll("_", " ")}
                          </span>
                        ) : null}
                      </div>
                      <p
                        className="mt-2 line-clamp-2 font-semibold text-foreground"
                        dir="auto"
                      >
                        {record.title}
                      </p>
                    </div>
                    <ArrowUpRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:-scale-x-100"
                      aria-hidden
                    />
                  </div>

                  {record.details?.length ? (
                    <dl className="mt-3 grid gap-x-4 gap-y-2 border-t pt-3 text-xs sm:grid-cols-2">
                      {record.details.map((detail) => (
                        <div
                          key={`${detail.label}-${detail.value}`}
                          className="min-w-0"
                        >
                          <dt className="text-muted-foreground">
                            {detail.label}
                          </dt>
                          <dd
                            className="mt-0.5 truncate font-medium text-foreground"
                            dir="auto"
                          >
                            {detail.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {copy.empty}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
