'use client';

import { useMemo, useState } from 'react';
import { DatabaseZap, Layers, Network, Plus, Waves } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useProvisioningActions } from '../../_hooks/use-dr-actions';
import {
  useDRGroupMembers,
  useDRGroupNetworkMappings,
  useDRGroups,
  useDRSites,
  useDRStreams,
} from '../../_hooks/use-dr-queries';
import { DRWriteGate } from '../console/dr-write-gate';
import { AddMemberDialog } from './add-member-dialog';
import { CreateGroupDialog } from './create-group-dialog';
import { CreateNetworkMappingDialog } from './create-network-mapping-dialog';
import { CreateSiteDialog } from './create-site-dialog';
import { CreateStreamDialog } from './create-stream-dialog';
import { ProvisionOnboarding } from './provision-onboarding';
import { useProvisionLabels } from './provision-labels';

/** Which create dialog is currently open (only one at a time). */
type ActiveDialog = 'site' | 'group' | 'member' | 'stream' | 'network' | null;

function formatSeconds(value?: number | null): string {
  if (value === null || value === undefined) return '—';
  return `${value}s`;
}

function siteNameFor(sites: { id: string; name: string }[], siteId: string): string {
  return sites.find((site) => site.id === siteId)?.name ?? siteId;
}

/**
 * Provisioning inventory — the create-side surface for the DR recovery
 * inventory. Surfaces the live lists (sites, groups + members + network
 * mappings, replication streams) and the gated CREATE flows that build them.
 *
 * Every create trigger is wrapped in the shared `dr-write-gate`: an operator
 * without `dr:write` sees the read-only inventory plus a focusable, bilingual
 * explanation and cannot open any dialog. The actual mutations run through the
 * shared {@link useProvisioningActions} hook, which fires the success toast and
 * invalidates the matching `['clario-dr', ...]` list keys so new records appear
 * without a manual refetch.
 *
 * When the tenant has no sites AND no groups, a first-run onboarding panel is
 * shown above the inventory with guided CTAs into the same dialogs.
 *
 * Token-driven, RTL-safe (logical spacing), and fully bilingual via
 * {@link useProvisionLabels}.
 */
export function ProvisionInventory({ canWrite }: { canWrite: boolean }) {
  const labels = useProvisionLabels();

  const sitesQuery = useDRSites();
  const groupsQuery = useDRGroups();
  const streamsQuery = useDRStreams();

  const sites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const groups = groupsQuery.data ?? [];
  const streams = streamsQuery.data ?? [];

  // The provisioning UI manages a single selected group for the member /
  // network-mapping detail panes. Local state (not URL) so it stays isolated
  // from the protect page's group selection used by the recovery surfaces.
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const effectiveGroupId = selectedGroupId ?? groups[0]?.id ?? null;

  const membersQuery = useDRGroupMembers(effectiveGroupId);
  const networkMappingsQuery = useDRGroupNetworkMappings(effectiveGroupId);
  const members = membersQuery.data ?? [];
  const networkMappings = networkMappingsQuery.data ?? [];

  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const closeDialog = () => setActiveDialog(null);

  const {
    createSite,
    createSitePending,
    createGroup,
    createGroupPending,
    addMember,
    addMemberPending,
    createStream,
    createStreamPending,
    createNetworkMapping,
    createNetworkMappingPending,
  } = useProvisioningActions();

  // Sites not yet a member of the selected group are eligible to be added.
  const memberSiteIds = new Set(members.map((member) => member.site_id));
  const eligibleSites = sites.filter((site) => !memberSiteIds.has(site.id));

  const hasSites = sites.length > 0;
  const hasGroups = groups.length > 0;
  const hasStreams = streams.length > 0;
  const showOnboarding = !sitesQuery.isLoading && !groupsQuery.isLoading && !hasSites && !hasGroups;

  return (
    <div className="space-y-6">
      {showOnboarding ? (
        <ProvisionOnboarding
          canWrite={canWrite}
          hasSites={hasSites}
          hasGroups={hasGroups}
          hasStreams={hasStreams}
          onCreateSite={() => setActiveDialog('site')}
          onCreateGroup={() => setActiveDialog('group')}
          onCreateStream={() => setActiveDialog('stream')}
        />
      ) : null}

      <DRWriteGate canWrite={canWrite} description={labels.writeGate.description}>
        <div className="space-y-6">
          {/* Protected sites ------------------------------------------------ */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">{labels.site.triggerLabel}</CardTitle>
                <CardDescription>{labels.empty.noSitesDescription}</CardDescription>
              </div>
              <Button type="button" size="sm" onClick={() => setActiveDialog('site')}>
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {labels.site.triggerLabel}
              </Button>
            </CardHeader>
            <CardContent>
              {sitesQuery.isLoading ? (
                <LoadingSkeleton variant="table-row" count={3} />
              ) : sitesQuery.error && !hasSites ? (
                <ErrorState message={labels.writeGate.description} onRetry={() => void sitesQuery.refetch()} />
              ) : !hasSites ? (
                <EmptyState
                  icon={DatabaseZap}
                  title={labels.empty.noSitesTitle}
                  description={labels.empty.noSitesDescription}
                  className="border border-dashed"
                  size="compact"
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{labels.site.nameLabel}</TableHead>
                        <TableHead>{labels.site.kindLabel}</TableHead>
                        <TableHead>{labels.site.endpointLabel}</TableHead>
                        <TableHead className="text-end">RTO</TableHead>
                        <TableHead className="text-end">RPO</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sites.map((site) => (
                        <TableRow key={site.id}>
                          <TableCell className="font-medium">{site.name}</TableCell>
                          <TableCell className="capitalize">{site.kind}</TableCell>
                          <TableCell className="font-mono text-xs">{site.primary_endpoint}</TableCell>
                          <TableCell className="text-end">{formatSeconds(site.rto_objective_seconds)}</TableCell>
                          <TableCell className="text-end">{formatSeconds(site.rpo_objective_seconds)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Protection groups + members + network mappings ---------------- */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">{labels.group.triggerLabel}</CardTitle>
                <CardDescription>{labels.empty.noGroupsDescription}</CardDescription>
              </div>
              <Button type="button" size="sm" onClick={() => setActiveDialog('group')}>
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {labels.group.triggerLabel}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupsQuery.isLoading ? (
                <LoadingSkeleton variant="list-item" count={3} />
              ) : !hasGroups ? (
                <EmptyState
                  icon={Layers}
                  title={labels.empty.noGroupsTitle}
                  description={labels.empty.noGroupsDescription}
                  className="border border-dashed"
                  size="compact"
                />
              ) : (
                <>
                  <div className="flex flex-wrap gap-2" role="tablist" aria-label={labels.group.triggerLabel}>
                    {groups.map((group) => {
                      const selected = group.id === effectiveGroupId;
                      return (
                        <button
                          key={group.id}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-sm transition hover:border-primary/40',
                            selected ? 'border-primary/50 bg-primary/10 text-primary' : 'bg-card',
                          )}
                          onClick={() => setSelectedGroupId(group.id)}
                        >
                          {group.name}
                        </button>
                      );
                    })}
                  </div>

                  {/* Members of the selected group --------------------------- */}
                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">{labels.member.bootOrderLabel}</h3>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!effectiveGroupId}
                        onClick={() => setActiveDialog('member')}
                      >
                        <Plus className="me-1.5 h-4 w-4" aria-hidden />
                        {labels.member.triggerLabel}
                      </Button>
                    </div>
                    {membersQuery.isLoading ? (
                      <LoadingSkeleton variant="table-row" count={2} />
                    ) : members.length === 0 ? (
                      <EmptyState
                        icon={Layers}
                        title={labels.empty.noMembersTitle}
                        description={labels.empty.noMembersDescription}
                        size="compact"
                      />
                    ) : (
                      <div className="overflow-x-auto rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{labels.member.bootOrderLabel}</TableHead>
                              <TableHead>{labels.member.siteLabel}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...members]
                              .sort((a, b) => a.boot_order - b.boot_order)
                              .map((member) => (
                                <TableRow key={`${member.group_id}-${member.site_id}`}>
                                  <TableCell className="font-mono">{member.boot_order}</TableCell>
                                  <TableCell>{siteNameFor(sites, member.site_id)}</TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  {/* Network mappings of the selected group ----------------- */}
                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">{labels.networkMapping.triggerLabel}</h3>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!effectiveGroupId}
                        onClick={() => setActiveDialog('network')}
                      >
                        <Plus className="me-1.5 h-4 w-4" aria-hidden />
                        {labels.networkMapping.triggerLabel}
                      </Button>
                    </div>
                    {networkMappingsQuery.isLoading ? (
                      <LoadingSkeleton variant="table-row" count={2} />
                    ) : networkMappings.length === 0 ? (
                      <EmptyState
                        icon={Network}
                        title={labels.empty.noNetworkMappingsTitle}
                        description={labels.empty.noNetworkMappingsDescription}
                        size="compact"
                      />
                    ) : (
                      <div className="overflow-x-auto rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{labels.networkMapping.profileLabel}</TableHead>
                              <TableHead>{labels.networkMapping.primaryCidrLabel}</TableHead>
                              <TableHead>{labels.networkMapping.recoveryCidrLabel}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {networkMappings.map((mapping) => (
                              <TableRow key={mapping.id}>
                                <TableCell className="font-medium">{mapping.profile}</TableCell>
                                <TableCell className="font-mono text-xs" dir="ltr">
                                  {mapping.primary_cidr}
                                </TableCell>
                                <TableCell className="font-mono text-xs" dir="ltr">
                                  {mapping.recovery_cidr}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Replication streams ------------------------------------------- */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">{labels.stream.triggerLabel}</CardTitle>
                <CardDescription>{labels.empty.noStreamsDescription}</CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!hasSites}
                onClick={() => setActiveDialog('stream')}
              >
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {labels.stream.triggerLabel}
              </Button>
            </CardHeader>
            <CardContent>
              {streamsQuery.isLoading ? (
                <LoadingSkeleton variant="table-row" count={3} />
              ) : !hasStreams ? (
                <EmptyState
                  icon={Waves}
                  title={labels.empty.noStreamsTitle}
                  description={labels.empty.noStreamsDescription}
                  className="border border-dashed"
                  size="compact"
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{labels.stream.siteLabel}</TableHead>
                        <TableHead>{labels.stream.statusLabel}</TableHead>
                        <TableHead className="text-end">Seq</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {streams.map((stream) => (
                        <TableRow key={stream.id}>
                          <TableCell>{siteNameFor(sites, stream.site_id)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {stream.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-end font-mono">{stream.applied_seq}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DRWriteGate>

      {/* Create dialogs — only mounted/openable for dr:write operators ------ */}
      {canWrite ? (
        <>
          <CreateSiteDialog
            open={activeDialog === 'site'}
            onOpenChange={(next) => (next ? setActiveDialog('site') : closeDialog())}
            submitting={createSitePending}
            onCreate={(payload) => {
              createSite(payload);
              closeDialog();
            }}
          />
          <CreateGroupDialog
            open={activeDialog === 'group'}
            onOpenChange={(next) => (next ? setActiveDialog('group') : closeDialog())}
            submitting={createGroupPending}
            onCreate={(payload) => {
              createGroup(payload);
              closeDialog();
            }}
          />
          <AddMemberDialog
            open={activeDialog === 'member'}
            onOpenChange={(next) => (next ? setActiveDialog('member') : closeDialog())}
            submitting={addMemberPending}
            eligibleSites={eligibleSites}
            onAdd={(payload) => {
              if (!effectiveGroupId) return;
              addMember(effectiveGroupId, payload);
              closeDialog();
            }}
          />
          <CreateStreamDialog
            open={activeDialog === 'stream'}
            onOpenChange={(next) => (next ? setActiveDialog('stream') : closeDialog())}
            submitting={createStreamPending}
            sites={sites}
            onCreate={(payload) => {
              createStream(payload);
              closeDialog();
            }}
          />
          <CreateNetworkMappingDialog
            open={activeDialog === 'network'}
            onOpenChange={(next) => (next ? setActiveDialog('network') : closeDialog())}
            submitting={createNetworkMappingPending}
            onCreate={(payload) => {
              if (!effectiveGroupId) return;
              createNetworkMapping(effectiveGroupId, payload);
              closeDialog();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
