"use client";

import { AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/shared/copy-button";
import { useT } from "@/components/providers/locale-provider";

interface KeySecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: string;
}

export function KeySecretDialog({ open, onOpenChange, secret }: KeySecretDialogProps) {
  const t = useT("admin");
  if (!secret) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-primary" />
            {t("ksd.title")}
          </DialogTitle>
          <DialogDescription>
            {t("ksd.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-warning-300/70 bg-warning-50 dark:border-warning-700/60 dark:bg-warning-700/15 p-4 space-y-3">
          <div className="flex items-center gap-2 text-warning-700 dark:text-warning-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="text-sm font-medium">
              {t("ksd.warning")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-card dark:bg-auth-dark-raised border rounded px-3 py-2 overflow-auto select-all break-all">
              {secret}
            </code>
            <CopyButton value={secret} label={t("ksd.copyAria")} size="md" />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {t("ksd.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
