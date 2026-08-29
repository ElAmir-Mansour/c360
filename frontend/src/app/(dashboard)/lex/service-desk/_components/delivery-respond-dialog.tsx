"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showApiError, showSuccess } from "@/lib/toast";
import { lexRequestsApi, type DeliveryConfirmation } from "@/lib/lex/requests";
import { deliveryConfirmationRequestNote } from "./delivery-confirmation-eligibility";
import { useServiceDeskLabels } from "./labels";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  confirmation: DeliveryConfirmation | null;
  contractFlow?: boolean;
  onSaved?: () => void;
}

export function DeliveryRespondDialog({
  open,
  onOpenChange,
  requestId,
  confirmation,
  contractFlow = false,
  onSaved,
}: Props) {
  const labels = useServiceDeskLabels();
  const t = labels.deliveryRespondDialog;
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const deliveryNote = deliveryConfirmationRequestNote(confirmation);

  useEffect(() => {
    if (open) {
      setNote("");
      setError("");
    }
  }, [open]);

  const respondMutation = useMutation({
    mutationFn: (confirm: boolean) => {
      if (!confirmation) throw new Error("no confirmation");
      return lexRequestsApi.respondDeliveryConfirmation(
        requestId,
        confirmation.id,
        {
          confirm,
          note: note.trim() || undefined,
        },
      );
    },
    onSuccess: () => {
      showSuccess(labels.execution.toast.deliveryResponded);
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const submit = (confirm: boolean) => {
    if (contractFlow && confirm && !note.trim()) {
      setError(t.errors.finalNoteRequired);
      return;
    }
    setError("");
    respondMutation.mutate(confirm);
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
          {deliveryNote ? (
            <div className="min-w-0 rounded-xl border border-border/70 bg-muted/50 p-3">
              <p className="text-xs font-semibold text-muted-foreground">
                {labels.execution.deliveryNote}
              </p>
              <p
                className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground"
                dir="auto"
              >
                {deliveryNote}
              </p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="respond-note">
              {contractFlow ? t.finalNote : t.note}
            </Label>
            <Textarea
              id="respond-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                contractFlow ? t.finalNotePlaceholder : t.notePlaceholder
              }
              rows={3}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "respond-note-error" : undefined}
            />
            {error ? (
              <p id="respond-note-error" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.cancel}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={() => submit(false)}
              disabled={respondMutation.isPending}
            >
              {t.deny}
            </Button>
            <Button
              type="button"
              onClick={() => submit(true)}
              disabled={respondMutation.isPending}
            >
              {respondMutation.isPending ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
              ) : null}
              {contractFlow ? t.submitFinalNotes : t.confirm}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
