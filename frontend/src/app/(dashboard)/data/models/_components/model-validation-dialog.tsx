'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { type ModelValidationResult } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface ModelValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ModelValidationResult | null;
  isValidating: boolean;
}

export function ModelValidationDialog({
  open,
  onOpenChange,
  result,
  isValidating,
}: ModelValidationDialogProps) {
  const labels = useDataLabels();
  const passed = result?.success ?? false;
  const errors = result?.errors ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.models.validationTitle}</DialogTitle>
          <DialogDescription>
            {labels.models.validationDesc}
          </DialogDescription>
        </DialogHeader>

        {isValidating ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{labels.models.validatingModel}</div>
        ) : result ? (
          <div className="space-y-4">
            <div
              className={`flex items-center gap-3 rounded-lg border p-4 ${
                passed
                  ? 'border-success-100 bg-success-50 dark:border-success-700/50 dark:bg-success-700/30'
                  : 'border-destructive/40 bg-destructive/5'
              }`}
            >
              {passed ? (
                <CheckCircle2 className="h-5 w-5 text-success-600 dark:text-success-300" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              <div>
                <div className="font-medium">{passed ? labels.models.validationPassed : labels.models.validationFailed}</div>
                <div className="text-sm text-muted-foreground">
                  {passed
                    ? labels.models.conformsChecks
                    : labels.models.issuesFound(String(errors.length), errors.length === 1 ? '' : 's')}
                </div>
              </div>
            </div>

            {errors.length > 0 ? (
              <div className="space-y-2">
                {errors.map((error, index) => (
                  <div key={`${error.field}-${error.code}-${index}`} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{error.field || labels.models.modelFallback}</Badge>
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        {error.code}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-muted-foreground">{error.message}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
