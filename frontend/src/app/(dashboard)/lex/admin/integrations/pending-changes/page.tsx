'use client';

/**
 * Maker-checker review queue — `/lex/admin/integrations/pending-changes` (#13).
 *
 * A tenant-wide queue of configuration change requests for PROTECTED connectors
 * (active production or government-gated), rendered through the shared
 * {@link PendingChangesPanel}. The "maker" proposes a change from a connector's
 * detail form; a "checker" approves or rejects it here. Each card shows a
 * SECRET-MASKED diff (old → new), the requester/timestamp, an Approve/Reject
 * note, and an SoD hint that blocks self-approval.
 *
 * Reads gated on `lex:integration:read` (degrade gracefully to `[]`); approve /
 * reject require `lex:integration:manage` (coarse `lex:write` also satisfies
 * manage). Mirrors the org-entities admin module + the sibling DLQ page:
 * PermissionRedirect, PageHeader, SectionCard, bilingual labels, react-query, RTL.
 */
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { integrationLabels } from '../_labels';
import { useGovernanceLabels } from '../_lib/governance-labels';
import { PendingChangesPanel } from '../_components/pending-changes-panel';

const LIST_ROUTE = '/lex/admin/integrations';

export default function PendingChangesPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const shared = locale === 'ar' ? integrationLabels.ar : integrationLabels.en;
  const g = useGovernanceLabels();

  const canManage =
    hasPermission('lex:integration:manage') || hasPermission('lex:write');
  const BackIcon = direction === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <PermissionRedirect permission="lex:integration:read">
      <div dir={direction} lang={locale} className="space-y-6">
        <div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mb-2 h-8 px-2 text-muted-foreground"
          >
            <Link href={LIST_ROUTE}>
              <BackIcon className="me-1.5 h-4 w-4" aria-hidden />
              {shared.backToList}
            </Link>
          </Button>

          <PageHeader eyebrow={g.queueTab} title={g.queueTitle} description={g.queueSubtitle} />
        </div>

        <SectionCard title={g.queueTitle} description={g.queueSubtitle}>
          <PendingChangesPanel canManage={canManage} />
        </SectionCard>
      </div>
    </PermissionRedirect>
  );
}
