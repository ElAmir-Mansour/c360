"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LexCreationGuidance } from "@/components/lex/creation-guidance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showApiError, showSuccess } from "@/lib/toast";
import { lexRequestsApi } from "@/lib/lex/requests";
import { useServiceDeskLabels } from "./labels";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  contractFlow?: boolean;
  onSaved?: () => void;
}

export function DeliveryRequestDialog({
  open,
  onOpenChange,
  requestId,
  contractFlow = false,
  onSaved,
}: Props) {
  const labels = useServiceDeskLabels();
  const { locale } = useLocaleOrDefault();
  const t = labels.deliveryRequestDialog;
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [lateJustification, setLateJustification] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setContact("");
      setNotes("");
      setLateJustification("");
      setError("");
    }
  }, [open]);

  const clockQuery = useQuery({
    queryKey: ["lex-request-clock", requestId],
    queryFn: () => lexRequestsApi.getRequestClock(requestId),
    enabled: open,
  });
  const isLate = Boolean(
    clockQuery.data?.outcome === "pending" &&
      Date.now() > new Date(clockQuery.data.turnaround_due_at).getTime(),
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      lexRequestsApi.requestDeliveryConfirmation(requestId, {
        recipient_name: name.trim(),
        recipient_contact: contact.trim() || undefined,
        notes: notes.trim() || undefined,
        ...(lateJustification.trim()
          ? { late_justification: lateJustification.trim() }
          : {}),
      }),
    onSuccess: () => {
      showSuccess(
        contractFlow
          ? labels.execution.toast.contractHandoverRecorded
          : labels.execution.toast.deliveryRequested,
      );
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const submit = () => {
    if (!name.trim()) {
      setError(t.errors.recipientRequired);
      return;
    }
    if (isLate && !lateJustification.trim()) {
      setError(
        locale === "ar"
          ? "مبرر تجاوز اتفاقية مستوى الخدمة مطلوب."
          : "A late SLA justification is required.",
      );
      return;
    }
    setError("");
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{contractFlow ? t.contractTitle : t.title}</DialogTitle>
          <DialogDescription>
            {contractFlow ? t.contractDescription : t.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <LexCreationGuidance workflow="service-request" />
          <div className="space-y-1.5">
            <Label htmlFor="delivery-name">{t.recipientName}</Label>
            <Input
              id="delivery-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.recipientNamePlaceholder}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <div className="space-y-1.5 rounded-lg border border-warning-300 bg-warning-50/60 p-3 dark:bg-warning-700/10">
              <Label htmlFor="delivery-late-justification">
                {locale === "ar" ? "مبرر تجاوز اتفاقية مستوى الخدمة" : "Late SLA justification"}{" "}
                {isLate ? <span className="text-destructive">*</span> : null}
              </Label>
              <Textarea
                id="delivery-late-justification"
                value={lateJustification}
                onChange={(event) => setLateJustification(event.target.value)}
                rows={3}
                placeholder={
                  locale === "ar"
                    ? "اشرح سبب تسليم الطلب بعد الموعد المحدد."
                    : "Explain why this request was delivered after its SLA deadline."
                }
              />
              <p className="text-xs text-muted-foreground">
                {locale === "ar"
                  ? "مطلوب عند تجاوز الموعد، ويظهر فقط لمدير الإدارة القانونية والمدير المختص."
                  : "Required when delivery is overdue; visible only to the Legal Director and corresponding manager."}
              </p>
            </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery-contact">{t.recipientContact}</Label>
            <Input
              id="delivery-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t.recipientContactPlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery-notes">{t.notes}</Label>
            <Textarea
              id="delivery-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.cancel}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={saveMutation.isPending || (isLate && !lateJustification.trim())}
          >
            {saveMutation.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
            ) : null}
            {contractFlow ? t.contractConfirm : t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
