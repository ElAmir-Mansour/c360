'use client';

import { useState } from 'react';
import { Sparkles, Save, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { parseApiError } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PolicyDomain } from '@/types/cyber';
import { useVcisoLabels, useVcisoWorkflowLabels } from '../../_lib/vciso-i18n';

const POLICY_DOMAIN_VALUES: PolicyDomain[] = [
  'access_control',
  'incident_response',
  'data_protection',
  'acceptable_use',
  'business_continuity',
  'risk_management',
  'vendor_management',
  'change_management',
  'security_awareness',
  'network_security',
  'encryption',
  'physical_security',
  'other',
];

interface PolicyDraftGeneratorProps {
  onSaveAsDraft: (content: string, domain: PolicyDomain) => void;
}

export function PolicyDraftGenerator({ onSaveAsDraft }: PolicyDraftGeneratorProps) {
  const t = useVcisoWorkflowLabels().draftGenerator;
  const domainLabels = useVcisoLabels().pages.policies.domains as Record<string, string>;
  const [domain, setDomain] = useState<PolicyDomain | ''>('');
  const [context, setContext] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!domain) {
      toast.error(t.selectDomainToast);
      return;
    }

    setIsGenerating(true);
    setGeneratedContent('');

    try {
      const result = await apiPost<{ content: string }>(
        API_ENDPOINTS.CYBER_VCISO_POLICY_GENERATE,
        {
          domain,
          context: context.trim() || undefined,
        },
      );
      setGeneratedContent(result.content);
      toast.success(t.generatedToast);
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAsDraft = () => {
    if (!generatedContent) return;
    if (!domain) return;
    onSaveAsDraft(generatedContent, domain as PolicyDomain);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            {t.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="draft-domain">{t.policyDomain}</Label>
            <Select
              value={domain}
              onValueChange={(v) => setDomain(v as PolicyDomain)}
              disabled={isGenerating}
            >
              <SelectTrigger id="draft-domain">
                <SelectValue placeholder={t.selectDomain} />
              </SelectTrigger>
              <SelectContent>
                {POLICY_DOMAIN_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {domainLabels[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="draft-context">
              {t.additionalContext}{' '}
              <span className="text-muted-foreground font-normal">{t.optional}</span>
            </Label>
            <Textarea
              id="draft-context"
              placeholder={t.contextPlaceholder}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              disabled={isGenerating}
              className="min-h-[120px]"
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !domain}
            className="w-full sm:w-auto"
          >
            {isGenerating ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t.generating}
              </>
            ) : (
              <>
                <Sparkles className="me-2 h-4 w-4" />
                {t.generateDraft}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Content */}
      {(generatedContent || isGenerating) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-muted-foreground" />
              {t.generatedDraft}
            </CardTitle>
            {generatedContent && (
              <Button size="sm" onClick={handleSaveAsDraft}>
                <Save className="me-1.5 h-3.5 w-3.5" />
                {t.saveAsDraft}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground">
                  {t.generatingUsingAi}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t.mayTakeMoment}
                </p>
              </div>
            ) : (
              <div
                className={cn(
                  'rounded-lg border border-border bg-muted/30 p-6',
                  'prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground',
                )}
              >
                {generatedContent}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state when nothing is generated yet */}
      {!generatedContent && !isGenerating && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-base font-medium mb-1">{t.noDraftYet}</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {t.emptyHint}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
