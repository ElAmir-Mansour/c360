'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import type { VCISOPolicy, PolicyDomain } from '@/types/cyber';
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

interface PolicyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy?: VCISOPolicy | null;
  onSuccess: () => void;
  initialContent?: string;
  initialDomain?: PolicyDomain;
}

export function PolicyFormDialog({
  open,
  onOpenChange,
  policy,
  onSuccess,
  initialContent,
  initialDomain,
}: PolicyFormDialogProps) {
  const t = useVcisoWorkflowLabels().policyForm;
  const domainLabels = useVcisoLabels().pages.policies.domains as Record<string, string>;
  const isEditing = !!policy;

  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState<PolicyDomain | ''>('');
  const [content, setContent] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      if (policy) {
        setTitle(policy.title);
        setDomain(policy.domain);
        setContent(policy.content);
        setTags(policy.tags ?? []);
      } else {
        setTitle('');
        setDomain(initialDomain ?? '');
        setContent(initialContent ?? '');
        setTags([]);
      }
      setTagInput('');
    }
  }, [open, policy, initialContent, initialDomain]);

  const createMutation = useApiMutation<VCISOPolicy, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_POLICIES,
    {
      invalidateKeys: ['vciso-policies'],
      successMessage: t.createdToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const updateMutation = useApiMutation<VCISOPolicy, Record<string, unknown>>(
    'put',
    () => `${API_ENDPOINTS.CYBER_VCISO_POLICIES}/${policy?.id}`,
    {
      invalidateKeys: ['vciso-policies'],
      successMessage: t.updatedToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error(t.titleRequired);
      return;
    }
    if (!domain) {
      toast.error(t.domainRequired);
      return;
    }
    if (!content.trim()) {
      toast.error(t.contentRequired);
      return;
    }

    const payload = {
      title: title.trim(),
      domain,
      version: isEditing ? (policy?.version ?? '1.0') : '1.0',
      status: isEditing ? (policy?.status ?? 'draft') : 'draft',
      content: content.trim(),
      owner_id: isEditing ? (policy?.owner_id ?? '') : '',
      owner_name: isEditing ? (policy?.owner_name ?? '') : '',
      review_due: isEditing ? (policy?.review_due ?? '') : '',
      tags,
    };

    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>
            {isEditing ? t.editDesc : t.createDesc}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="policy-title">{t.title}</Label>
            <Input
              id="policy-title"
              placeholder={t.titlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="policy-domain">{t.domain}</Label>
            <Select
              value={domain}
              onValueChange={(v) => setDomain(v as PolicyDomain)}
              disabled={isSubmitting}
            >
              <SelectTrigger id="policy-domain">
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
            <Label htmlFor="policy-content">{t.content}</Label>
            <Textarea
              id="policy-content"
              placeholder={t.contentPlaceholder}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isSubmitting}
              className="min-h-[240px] font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="policy-tags">{t.tags}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="policy-tags"
                placeholder={t.tagsPlaceholder}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                disabled={isSubmitting}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddTag}
                disabled={isSubmitting || !tagInput.trim()}
              >
                {t.add}
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ms-0.5 hover:text-destructive"
                      aria-label={t.removeTagAria(tag)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
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
              {isSubmitting
                ? isEditing
                  ? t.updating
                  : t.creating
                : isEditing
                  ? t.updatePolicy
                  : t.createPolicy}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
