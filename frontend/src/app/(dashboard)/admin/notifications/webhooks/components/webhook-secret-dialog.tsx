'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Copy, Check } from 'lucide-react';
import { useT } from '@/components/providers/locale-provider';

interface WebhookSecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhookName: string;
  secret: string;
}

export function WebhookSecretDialog({
  open,
  onOpenChange,
  webhookName,
  secret,
}: WebhookSecretDialogProps) {
  const t = useT('admin');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('wss.title')}</DialogTitle>
          <DialogDescription>
            {t('wss.desc', { name: webhookName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border border-warning/50 bg-warning/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-warning">
              {t('wss.warning')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={secret}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              aria-label={t('wss.copyAria')}
            >
              {copied ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('wss.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
