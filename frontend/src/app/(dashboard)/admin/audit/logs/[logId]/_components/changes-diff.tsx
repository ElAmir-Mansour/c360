"use client";

import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";
import type { AuditChange } from "@/types/audit";

interface ChangesDiffProps {
  changes: AuditChange[];
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "object") return JSON.stringify(val, null, 2);
  return String(val);
}

export function ChangesDiff({ changes }: ChangesDiffProps) {
  const t = useT("admin");
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("chd.empty")}</p>
    );
  }

  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-3 py-2 text-start font-semibold text-muted-foreground">
                {t("chd.field")}
              </th>
              <th className="px-3 py-2 text-start font-semibold text-error-700 dark:text-error-300">
                {t("chd.oldValue")}
              </th>
              <th className="px-3 py-2 text-start font-semibold text-success-700 dark:text-success-300">
                {t("chd.newValue")}
              </th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.field} className="border-b last:border-0">
                <td className="px-3 py-2 font-semibold whitespace-nowrap">
                  {change.field}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 whitespace-pre-wrap break-all",
                    "bg-error-50 dark:bg-error-700/15 text-error-700 dark:text-error-300"
                  )}
                >
                  {formatValue(change.old_value)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 whitespace-pre-wrap break-all",
                    "bg-success-50 dark:bg-success-700/15 text-success-700 dark:text-success-300"
                  )}
                >
                  {formatValue(change.new_value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
