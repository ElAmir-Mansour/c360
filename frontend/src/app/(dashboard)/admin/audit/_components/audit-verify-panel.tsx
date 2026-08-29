"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import {
  CheckCircle,
  XCircle,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useAuditVerify } from "@/hooks/use-audit";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { AuditVerificationResult } from "@/types/audit";
import { useAdminT } from "../../_lib/admin-i18n";

export function AuditVerifyPanel() {
  const labels = useAdminT();
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [results, setResults] = useState<AuditVerificationResult[]>([]);

  const verifyMutation = useAuditVerify();

  const handleVerify = () => {
    verifyMutation.mutate(
      {
        date_from: new Date(dateFrom).toISOString(),
        date_to: new Date(dateTo + "T23:59:59").toISOString(),
      },
      {
        onSuccess: (result) => {
          setResults((prev) => [result, ...prev]);
        },
      }
    );
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">
                {labels.audit.chainOfCustody}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {labels.audit.chainOfCustodyHint}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="verify-date-from">{labels.audit.from}</Label>
              <Input
                id="verify-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                max={dateTo}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="verify-date-to">{labels.audit.to}</Label>
              <Input
                id="verify-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom}
                max={today}
              />
            </div>
          </div>

          {verifyMutation.isPending && (
            <div className="space-y-3 py-4">
              <p className="text-sm text-center text-muted-foreground">
                {labels.audit.verifyingChain}
              </p>
              <Progress value={undefined} className="h-2 animate-pulse" />
            </div>
          )}

          <Button
            onClick={handleVerify}
            disabled={verifyMutation.isPending || !dateFrom || !dateTo}
            className="w-full"
          >
            <ShieldCheck className="me-2 h-4 w-4" />
            {verifyMutation.isPending
              ? labels.audit.verifyRunning
              : labels.audit.runVerification}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              {labels.audit.verificationHistory}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {results.map((result, idx) => (
              <div key={idx}>
                {idx > 0 && <Separator className="mb-4" />}
                <div className="rounded-lg border p-4">
                  {result.verified ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-primary dark:text-primary">
                        <CheckCircle className="h-5 w-5" />
                        <span className="font-medium">{labels.audit.integrityVerifiedTitle}</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {labels.audit.recordsVerified}
                          </p>
                          <p className="font-medium">
                            {formatNumber(result.verified_records)} /{" "}
                            {formatNumber(result.total_records)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {labels.audit.verifiedAt}
                          </p>
                          <p className="font-medium">
                            {formatDateTime(result.verified_at)}
                          </p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-xs text-muted-foreground">
                            {labels.audit.verificationHash}
                          </p>
                          <code className="text-xs font-mono break-all">
                            {result.verification_hash}
                          </code>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-destructive">
                        <XCircle className="h-5 w-5" />
                        <span className="font-medium">
                          {labels.audit.integrityViolation}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {labels.audit.verifiedBeforeBreak}
                          </p>
                          <p className="font-medium">
                            {formatNumber(result.verified_records)} /{" "}
                            {formatNumber(result.total_records)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {labels.audit.verifiedAt}
                          </p>
                          <p className="font-medium">
                            {formatDateTime(result.verified_at)}
                          </p>
                        </div>
                      </div>
                      {result.broken_chain_at && (
                        <div className="flex items-center gap-2 text-sm">
                          <p className="text-muted-foreground">
                            {labels.audit.chainBrokeAt}
                          </p>
                          <Link
                            href={`/admin/audit/logs/${result.broken_chain_at}`}
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <code className="text-xs font-mono">
                              {result.broken_chain_at}
                            </code>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
