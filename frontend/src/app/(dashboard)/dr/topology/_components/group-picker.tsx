'use client';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/common/empty-state';
import { Network } from 'lucide-react';
import type { DRConsistencyGroup } from '@/types/clario-dr';
import { useTopologyPageLabels } from './topology-page-labels';

/**
 * Protection-group picker for the topology + boot authoring route.
 *
 * Drives the shared `useDRSelection` `?group=` param so the selection is
 * deep-linkable and shared with the rest of the console. Renders a labelled
 * shadcn `Select` of the tenant's real protection groups (`DRConsistencyGroup`);
 * when there are none it shows an in-card empty state pointing the operator at
 * the Protect surface. Logical spacing keeps it RTL-safe.
 */
export function GroupPicker({
  groups,
  activeGroupId,
  onSelectGroup,
}: {
  groups: DRConsistencyGroup[];
  activeGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
}) {
  const labels = useTopologyPageLabels();

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title={labels.noGroups}
        description={labels.noGroupsHint}
        className="border border-dashed border-outline-subtle"
        size="compact"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:max-w-md">
      <Label htmlFor="dr-topology-group-picker">{labels.groupPickerLabel}</Label>
      <Select
        value={activeGroupId ?? undefined}
        onValueChange={(value) => onSelectGroup(value)}
      >
        <SelectTrigger id="dr-topology-group-picker">
          <SelectValue placeholder={labels.groupPickerPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
