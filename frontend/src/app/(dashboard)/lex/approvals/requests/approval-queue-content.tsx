"use client";

import { useState } from "react";
import { LexInboxContent } from "../../inbox/_components/lex-inbox-content";
import { RequestInboxContent } from "../../service-desk/_components/request-inbox-page";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const queueLabels = {
  en: {
    label: "Approval queue view",
    all: "All decisions",
    requests: "Request approvals",
  },
  ar: {
    label: "عرض قائمة الموافقات",
    all: "جميع القرارات",
    requests: "موافقات الطلبات",
  },
} as const;

/**
 * Keep the actor-scoped cross-domain inbox introduced for case-intake work,
 * while restoring the dedicated request queue's search, service/status/
 * priority filters, row selection and bulk approve/reject controls.
 */
export function ApprovalQueueContent() {
  const { locale, direction } = useLocaleOrDefault();
  const labels = queueLabels[locale];
  const [view, setView] = useState<"all" | "requests">("all");

  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as "all" | "requests")}
      dir={direction}
      className="space-y-5"
    >
      <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1">
        <TabsList aria-label={labels.label} className="w-max min-w-full justify-start">
          <TabsTrigger value="all">{labels.all}</TabsTrigger>
          <TabsTrigger value="requests">{labels.requests}</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="all">
        {/* Case-intake and the other actor-scoped approval sources remain
            visible; this is the behavior bcb8d02f intentionally introduced. */}
        <LexInboxContent />
      </TabsContent>
      <TabsContent value="requests">
        <RequestInboxContent mode="approvals" />
      </TabsContent>
    </Tabs>
  );
}
