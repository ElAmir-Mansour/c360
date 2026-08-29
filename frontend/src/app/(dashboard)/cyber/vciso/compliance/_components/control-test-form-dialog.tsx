'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type {
  VCISOControlTest,
  ControlTestType,
  ControlTestResult,
} from '@/types/cyber';
import { useVcisoGovLabels } from '../../_lib/vciso-i18n';

const TEST_TYPE_VALUES: ControlTestType[] = ['design', 'operating_effectiveness'];
const TEST_RESULT_VALUES: ControlTestResult[] = [
  'effective',
  'partially_effective',
  'ineffective',
  'not_tested',
];

interface ControlTestFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controlTest?: VCISOControlTest | null;
  onSuccess: () => void;
}

export function ControlTestFormDialog({
  open,
  onOpenChange,
  controlTest,
  onSuccess,
}: ControlTestFormDialogProps) {
  const labels = useVcisoGovLabels().compliance;
  const t = labels.controlTest;
  const testTypeLabels = labels.testTypes as Record<string, string>;
  const testResultLabels = labels.testResults as Record<string, string>;

  const [controlId, setControlId] = useState('');
  const [controlName, setControlName] = useState('');
  const [framework, setFramework] = useState('');
  const [testType, setTestType] = useState<ControlTestType | ''>('');
  const [result, setResult] = useState<ControlTestResult | ''>('');
  const [testerName, setTesterName] = useState('');
  const [findings, setFindings] = useState('');
  const [nextTestDate, setNextTestDate] = useState('');

  useEffect(() => {
    if (open) {
      if (controlTest) {
        setControlId(controlTest.control_id);
        setControlName(controlTest.control_name);
        setFramework(controlTest.framework);
        setTestType(controlTest.test_type);
        setResult(controlTest.result);
        setTesterName(controlTest.tester_name);
        setFindings(controlTest.findings);
        setNextTestDate(controlTest.next_test_date?.slice(0, 10) ?? '');
      } else {
        setControlId('');
        setControlName('');
        setFramework('');
        setTestType('');
        setResult('');
        setTesterName('');
        setFindings('');
        setNextTestDate('');
      }
    }
  }, [open, controlTest]);

  const createMutation = useApiMutation<VCISOControlTest, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_CONTROL_TESTS,
    {
      invalidateKeys: ['vciso-control-tests'],
      successMessage: t.recordedToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!controlId.trim()) {
      toast.error(t.controlIdRequired);
      return;
    }
    if (!controlName.trim()) {
      toast.error(t.controlNameRequired);
      return;
    }
    if (!framework.trim()) {
      toast.error(t.frameworkRequired);
      return;
    }
    if (!testType) {
      toast.error(t.testTypeRequired);
      return;
    }
    if (!result) {
      toast.error(t.resultRequired);
      return;
    }
    if (!testerName.trim()) {
      toast.error(t.testerRequired);
      return;
    }

    const payload = {
      control_id: controlId.trim(),
      control_name: controlName.trim(),
      framework: framework.trim(),
      test_type: testType,
      result,
      tester_name: testerName.trim(),
      test_date: new Date().toISOString().slice(0, 10),
      findings: findings.trim(),
      evidence_ids: controlTest?.evidence_ids ?? [],
      next_test_date: nextTestDate || undefined,
    };

    createMutation.mutate(payload);
  };

  const isSubmitting = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title()}</DialogTitle>
          <DialogDescription>{t.description()}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ct-control-id">
                {t.controlId} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ct-control-id"
                placeholder={t.controlIdPlaceholder}
                value={controlId}
                onChange={(e) => setControlId(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ct-control-name">
                {t.controlName} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ct-control-name"
                placeholder={t.controlNamePlaceholder}
                value={controlName}
                onChange={(e) => setControlName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ct-framework">
              {t.framework} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ct-framework"
              placeholder={t.frameworkPlaceholder}
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ct-test-type">{t.testType}</Label>
              <Select
                value={testType}
                onValueChange={(v) => setTestType(v as ControlTestType)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="ct-test-type">
                  <SelectValue placeholder={t.selectTestType} />
                </SelectTrigger>
                <SelectContent>
                  {TEST_TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {testTypeLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ct-result">{t.result}</Label>
              <Select
                value={result}
                onValueChange={(v) => setResult(v as ControlTestResult)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="ct-result">
                  <SelectValue placeholder={t.selectResult} />
                </SelectTrigger>
                <SelectContent>
                  {TEST_RESULT_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {testResultLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ct-tester-name">{t.testerName}</Label>
              <Input
                id="ct-tester-name"
                placeholder={t.testerNamePlaceholder}
                value={testerName}
                onChange={(e) => setTesterName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ct-next-test-date">{t.nextTestDate}</Label>
              <Input
                id="ct-next-test-date"
                type="date"
                value={nextTestDate}
                onChange={(e) => setNextTestDate(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ct-findings">{t.findings}</Label>
            <Textarea
              id="ct-findings"
              placeholder={t.findingsPlaceholder}
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              disabled={isSubmitting}
              className="min-h-[120px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t.recording : t.recordTest()}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
