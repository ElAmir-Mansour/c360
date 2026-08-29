'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MoveRight, PencilLine, Plus, Trash2, UserCog } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { SectionCard } from '@/components/suites/section-card';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { ESCALATION_ROLE_KEYS, lexAdminApi, type OrgRole, type OrgRoleKey } from '@/lib/lex/admin';
import { useAdminCommonLabels, useOrgLabels } from '../../_lib/admin-labels';
import { OrgEntityFormDialog } from '../_components/org-entity-form-dialog';
import { OrgRoleDialog } from '../_components/org-role-dialog';
import OrgMoveDialog from '../_components/reorganize/org-move-dialog';
import RoleHolderChip from '../_components/people/role-holder-chip';
import OrgMetadataPanel from '../_components/org-metadata/org-metadata-panel';
import EscalationWhatIfSimulator from '../_components/escalation-whatif/escalation-whatif-simulator';
import OrgAuditTimeline from '../_components/org-audit/org-audit-timeline';

export default function OrgEntityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const t = useOrgLabels();
  const common = useAdminCommonLabels();
  const id = params?.id ?? '';
  const canWrite = hasPermission('lex:security:manage');

  const [editOpen, setEditOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [rolePreset, setRolePreset] = useState<OrgRoleKey | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removingRole, setRemovingRole] = useState<OrgRole | null>(null);

  const q = useQuery({
    queryKey: ['lex-admin-org-entity', id],
    queryFn: () => lexAdminApi.getOrgEntity(id),
    enabled: Boolean(id),
  });

  // Deep link from the registry's "Missing n" chip: ?focus=escalation-roles
  // scrolls the roles section (with its coverage hint) into view once loaded.
  const searchParams = useSearchParams();
  const focusEscalationRoles = searchParams?.get('focus') === 'escalation-roles';
  const rolesSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusEscalationRoles || !q.data) return;
    rolesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusEscalationRoles, q.data]);
  const escalation = useQuery({
    queryKey: ['lex-admin-org-escalation', id],
    queryFn: () => lexAdminApi.getOrgEscalation(id),
    enabled: Boolean(id),
  });

  const del = useMutation({
    mutationFn: () => lexAdminApi.deleteOrgEntity(id),
    onSuccess: async () => {
      showSuccess(common.toast.deleted);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
      router.push('/lex/admin/org-entities');
    },
    onError: showApiError,
  });

  const removeRole = useMutation({
    mutationFn: (roleKey: string) => lexAdminApi.removeOrgRole(id, roleKey),
    onSuccess: async () => {
      showSuccess(t.roleDialog.toastRemoved);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-entity', id] });
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-escalation', id] });
      setRemovingRole(null);
    },
    onError: showApiError,
  });

  if (q.isLoading) {
    return (
      <LexAccessGuard routeKey="/lex/admin/org-entities/*" resourceName={t.detail.loadingTitle}>
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader title={t.detail.loadingTitle} />
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </LexAccessGuard>
    );
  }
  if (q.isError || !q.data) {
    return (
      <LexAccessGuard routeKey="/lex/admin/org-entities/*" resourceName={t.detail.loadingTitle}>
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader title={t.detail.loadingTitle} />
          <ErrorState message={t.detail.errorMessage} onRetry={() => void q.refetch()} />
        </div>
      </LexAccessGuard>
    );
  }

  const entity = q.data;
  const roles = entity.roles ?? [];
  const ladder = escalation.data?.recipients ?? [];
  const missingEscalation = ESCALATION_ROLE_KEYS.filter((roleKey) => !roles.some((role) => role.role_key === roleKey));

  return (
    <LexAccessGuard
      routeKey="/lex/admin/org-entities/*"
      resourceName={resolveLocalized(entity.name, locale) || entity.code}
    >
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          title={resolveLocalized(entity.name, locale) || entity.code}
          description={entity.parent_id ? entity.code : t.noParent}
          actions={
            canWrite ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <PencilLine className="me-1.5 h-3.5 w-3.5" />
                  {common.edit}
                </Button>
                <Button variant="outline" onClick={() => setMoveOpen(true)}>
                  <MoveRight className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />
                  {locale === 'ar' ? 'نقل' : 'Move'}
                </Button>
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="me-1.5 h-3.5 w-3.5" />
                  {common.delete}
                </Button>
              </div>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailStatCard
            label={t.detail.metricType}
            value={t.entityTypes[entity.entity_type] ?? entity.entity_type}
            tone="teal"
            href={`/lex/admin/org-entities?search=${encodeURIComponent(entity.code)}`}
          />
          <DetailStatCard
            label={t.detail.metricCode}
            value={entity.code}
            tone="slate"
            href={`/lex/admin/org-entities?search=${encodeURIComponent(entity.code)}`}
          />
          <DetailStatCard
            label={t.detail.metricRoles}
            value={roles.length}
            tone="gold"
            href="#org-entity-role-records"
          />
          <DetailStatCard
            label={t.detail.metricStatus}
            value={entity.active ? common.active : common.inactive}
            tone={entity.active ? 'emerald' : 'rose'}
            href={`/lex/admin/org-entities?search=${encodeURIComponent(entity.code)}`}
          />
        </div>

        <div id="org-entity-role-records" ref={rolesSectionRef} className="scroll-mt-24">
          <SectionCard
            title={t.detail.rolesTitle}
            description={t.detail.rolesDescription}
            actions={
              canWrite ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRolePreset(null);
                    setRoleOpen(true);
                  }}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t.detail.addRole}
                </Button>
              ) : undefined
            }
          >
            {missingEscalation.length > 0 ? (
              <div className="mb-4 rounded-lg border border-warning-300/50 bg-warning-50 p-4 dark:border-warning-700/50 dark:bg-warning-700/10">
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300"
                    aria-hidden
                  />
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-warning-700 dark:text-warning-300">
                      {t.escalationHint.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.escalationHint.description}</p>
                    {canWrite ? (
                      <div className="flex flex-wrap gap-2 pt-1.5">
                        {missingEscalation.map((roleKey) => (
                          <Button
                            key={roleKey}
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRolePreset(roleKey);
                              setRoleOpen(true);
                            }}
                          >
                            <Plus className="me-1.5 h-3.5 w-3.5" />
                            {t.escalationHint.assign(t.roleKeys[roleKey] ?? roleKey)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {roles.length === 0 ? (
              <EmptyState icon={UserCog} title={t.detail.rolesEmpty} description={t.detail.rolesDescription} />
            ) : (
              <div className="space-y-2">
                {roles.map((role) => (
                  <div
                    key={role.id}
                    className="relative flex items-center justify-between overflow-hidden rounded-lg border px-4 py-3 ps-5"
                  >
                    <span className="absolute inset-y-0 start-0 w-1 bg-sky-400/70" aria-hidden />
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium">{t.roleKeys[role.role_key] ?? role.role_key}</p>
                      <RoleHolderChip userId={role.user_id} label={role.label} size="sm" />
                    </div>
                    {canWrite ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={common.remove}
                        onClick={() => setRemovingRole(role)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard title={t.detail.escalationTitle} description={t.detail.escalationDescription}>
          {escalation.isLoading ? (
            <LoadingSkeleton variant="list-item" count={3} />
          ) : ladder.length === 0 ? (
            <EmptyState icon={UserCog} title={t.detail.escalationEmpty} description={t.detail.escalationDescription} />
          ) : (
            <div className="space-y-2">
              {ladder.map((rec) => (
                <div
                  key={`${rec.level}-${rec.user_id}`}
                  className="relative flex items-center justify-between overflow-hidden rounded-lg border px-4 py-3 ps-5"
                >
                  <span className="absolute inset-y-0 start-0 w-1 bg-warning-300/70" aria-hidden />
                  <div>
                    <p className="text-sm font-medium">{t.roleKeys[rec.role_key] ?? rec.role_key}</p>
                    <p className="text-xs text-muted-foreground">
                      {resolveLocalized(rec.entity_name, locale) || rec.entity_code}
                    </p>
                  </div>
                  <Badge variant="secondary">{t.detail.level(rec.level)}</Badge>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={locale === 'ar' ? 'السمات' : 'Attributes'}
          description={
            locale === 'ar'
              ? 'بيانات رئيسية إضافية لهذه الجهة (مركز التكلفة، السجل التجاري، الرقم الضريبي، المنطقة).'
              : 'Additional master-data attributes for this entity (cost centre, CR/VAT, region).'
          }
        >
          <OrgMetadataPanel metadata={entity.metadata ?? {}} />
        </SectionCard>

        <EscalationWhatIfSimulator entityId={id} />

        <OrgAuditTimeline entityId={id} />

        {canWrite ? (
          <>
            <OrgEntityFormDialog entity={entity} open={editOpen} onOpenChange={setEditOpen} />
            <OrgMoveDialog
              entity={entity}
              open={moveOpen}
              onOpenChange={setMoveOpen}
              onMoved={() => setMoveOpen(false)}
            />
            <OrgRoleDialog
              entityId={id}
              open={roleOpen}
              onOpenChange={setRoleOpen}
              initialRoleKey={rolePreset ?? undefined}
            />
            <ConfirmDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={common.confirm.deleteTitle}
              description={common.confirm.deleteDescription(resolveLocalized(entity.name, locale) || entity.code)}
              confirmLabel={common.delete}
              variant="destructive"
              loading={del.isPending}
              onConfirm={async () => {
                await del.mutateAsync();
              }}
            />
            <ConfirmDialog
              open={removingRole !== null}
              onOpenChange={(o) => !o && setRemovingRole(null)}
              title={t.roleDialog.title}
              description={common.confirm.deleteDescription(
                removingRole ? (t.roleKeys[removingRole.role_key] ?? removingRole.role_key) : '',
              )}
              confirmLabel={common.remove}
              variant="destructive"
              loading={removeRole.isPending}
              onConfirm={async () => {
                if (removingRole) await removeRole.mutateAsync(removingRole.role_key);
              }}
            />
          </>
        ) : null}
      </div>
    </LexAccessGuard>
  );
}
