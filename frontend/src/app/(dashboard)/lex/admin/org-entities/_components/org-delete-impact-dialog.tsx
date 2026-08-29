'use client';

import { useMemo } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import type { EscalationRecipient, OrgEntity, OrgRoleKey } from '@/lib/lex/admin';
import { useOrgLabels } from '../../_lib/admin-labels';

const ESCALATION_ROLE_KEYS = [
  'section_supervisor',
  'department_manager',
  'shared_services_manager',
] as readonly OrgRoleKey[];

function collectDescendants(rootId: string, rows: OrgEntity[]): OrgEntity[] {
  const childrenByParent = new Map<string, OrgEntity[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    childrenByParent.set(row.parent_id, [...(childrenByParent.get(row.parent_id) ?? []), row]);
  }

  const descendants: OrgEntity[] = [];
  const visit = (id: string) => {
    for (const child of childrenByParent.get(id) ?? []) {
      descendants.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return descendants;
}

function roleCounts(entity: OrgEntity): { total: number; escalation: number } {
  const roles = entity.roles ?? [];
  return {
    total: roles.length,
    escalation: roles.filter((role) => ESCALATION_ROLE_KEYS.includes(role.role_key)).length,
  };
}

function entityLabel(entity: OrgEntity, locale: AppLocale): string {
  return resolveLocalized(entity.name, locale) || entity.code;
}

interface OrgDeleteImpactDialogProps {
  entity: OrgEntity | null;
  open: boolean;
  loadedEntities: OrgEntity[];
  escalationRecipients?: EscalationRecipient[];
  loading: boolean;
  locale: AppLocale;
  cancelLabel: string;
  deleteLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function OrgDeleteImpactDialog({
  entity,
  open,
  loadedEntities,
  escalationRecipients = [],
  loading,
  locale,
  cancelLabel,
  deleteLabel,
  onOpenChange,
  onConfirm,
}: OrgDeleteImpactDialogProps) {
  const di = useOrgLabels().deleteImpact;
  const impact = useMemo(() => {
    if (!entity) {
      return {
        directChildren: [],
        descendants: [],
        roles: { total: 0, escalation: 0 },
        ladderHits: [] as EscalationRecipient[],
      };
    }
    const directChildren = loadedEntities.filter((row) => row.parent_id === entity.id);
    const descendants = collectDescendants(entity.id, loadedEntities);
    return {
      directChildren,
      descendants,
      roles: roleCounts(entity),
      ladderHits: escalationRecipients.filter((recipient) => recipient.entity_id === entity.id),
    };
  }, [entity, escalationRecipients, loadedEntities]);

  const hasHierarchyImpact = impact.directChildren.length > 0 || impact.descendants.length > 0;
  const hasRoleImpact = impact.roles.total > 0 || impact.ladderHits.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{di.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {entity ? di.description(entityLabel(entity, locale)) : di.descriptionFallback}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {entity ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{di.children}</p>
                <p className="text-lg font-semibold">{impact.directChildren.length}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{di.descendants}</p>
                <p className="text-lg font-semibold">{impact.descendants.length}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{di.roles}</p>
                <p className="text-lg font-semibold">{impact.roles.total}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{di.escalation}</p>
                <p className="text-lg font-semibold">{impact.roles.escalation + impact.ladderHits.length}</p>
              </div>
            </div>

            {hasHierarchyImpact || hasRoleImpact ? (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertTitle>{di.impactFoundTitle}</AlertTitle>
                <AlertDescription>
                  {di.impactFoundBody}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertTitle>{di.noDepsTitle}</AlertTitle>
                <AlertDescription>
                  {di.noDepsBody}
                </AlertDescription>
              </Alert>
            )}

            {impact.directChildren.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{di.children}</span>
                {impact.directChildren.slice(0, 6).map((child) => (
                  <Badge key={child.id} variant="secondary">
                    {child.code}
                  </Badge>
                ))}
                {impact.directChildren.length > 6 ? <Badge variant="outline">+{impact.directChildren.length - 6}</Badge> : null}
              </div>
            ) : null}

            {impact.ladderHits.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{di.currentLadder}</span>
                {impact.ladderHits.map((recipient) => (
                  <Badge key={`${recipient.level}-${recipient.role_key}-${recipient.user_id}`} variant="outline">
                    {di.ladderItem(recipient.level, recipient.role_key)}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading || !entity}>
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {deleteLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface OrgBulkDeleteImpactDialogProps {
  entities: OrgEntity[];
  open: boolean;
  loadedEntities: OrgEntity[];
  loading: boolean;
  locale: AppLocale;
  cancelLabel: string;
  deleteLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function OrgBulkDeleteImpactDialog({
  entities,
  open,
  loadedEntities,
  loading,
  locale,
  cancelLabel,
  deleteLabel,
  onOpenChange,
  onConfirm,
}: OrgBulkDeleteImpactDialogProps) {
  const di = useOrgLabels().deleteImpact;
  const impact = useMemo(() => {
    const selectedIds = new Set(entities.map((entity) => entity.id));
    const children = entities.flatMap((entity) =>
      loadedEntities.filter((row) => row.parent_id === entity.id && !selectedIds.has(row.id)),
    );
    const descendants = entities.flatMap((entity) =>
      collectDescendants(entity.id, loadedEntities).filter((row) => !selectedIds.has(row.id)),
    );
    const roles = entities.reduce(
      (acc, entity) => {
        const counts = roleCounts(entity);
        return { total: acc.total + counts.total, escalation: acc.escalation + counts.escalation };
      },
      { total: 0, escalation: 0 },
    );
    return { children, descendants, roles };
  }, [entities, loadedEntities]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{di.bulkTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {di.bulkDescription(entities.length)}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{di.selected}</p>
              <p className="text-lg font-semibold">{entities.length}</p>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{di.children}</p>
              <p className="text-lg font-semibold">{impact.children.length}</p>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{di.roles}</p>
              <p className="text-lg font-semibold">{impact.roles.total}</p>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{di.escalation}</p>
              <p className="text-lg font-semibold">{impact.roles.escalation}</p>
            </div>
          </div>

          {impact.children.length > 0 || impact.descendants.length > 0 || impact.roles.total > 0 ? (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertTitle>{di.bulkImpactTitle}</AlertTitle>
              <AlertDescription>
                {di.bulkImpactBody}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertTitle>{di.bulkNoDepsTitle}</AlertTitle>
              <AlertDescription>{di.bulkNoDepsBody}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {entities.slice(0, 8).map((entity) => (
              <Badge key={entity.id} variant="secondary">
                {entityLabel(entity, locale)}
              </Badge>
            ))}
            {entities.length > 8 ? <Badge variant="outline">+{entities.length - 8}</Badge> : null}
          </div>
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading || entities.length === 0}>
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {deleteLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
