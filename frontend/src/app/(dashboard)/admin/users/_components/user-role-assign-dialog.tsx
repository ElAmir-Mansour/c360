'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, FileEdit } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Spinner } from '@/components/ui/spinner';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { isApiError } from '@/types/api';
import type { User, Role } from '@/types/models';
import { useAdminT } from '../../_lib/admin-i18n';

interface UserRoleAssignDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function UserRoleAssignDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: UserRoleAssignDialogProps) {
  const labels = useAdminT();
  const [loading, setLoading] = useState(false);
  const userRoles = useMemo(() => user.roles ?? [], [user.roles]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(userRoles.map((r) => r.id))
  );

  // Backend GET /api/v1/roles returns a plain Role[] array (not paginated)
  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles', 'all'],
    queryFn: () => apiGet<Role[]>('/api/v1/roles'),
    enabled: open,
  });

  const allRoles = rolesData ?? [];
  const initialIds = useMemo(() => new Set(userRoles.map((r) => r.id)), [userRoles]);

  const toggle = (roleId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) {
        next.delete(roleId);
      } else {
        next.add(roleId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    const toAdd = allRoles.filter((r) => selected.has(r.id) && !initialIds.has(r.id));
    const toRemove = allRoles.filter((r) => !selected.has(r.id) && initialIds.has(r.id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      onOpenChange(false);
      return;
    }

    // Guard: check if removing the last tenant-admin
    const tenantAdminRole = allRoles.find((r) => r.slug === 'tenant-admin');
    if (tenantAdminRole && toRemove.some((r) => r.id === tenantAdminRole.id)) {
      // Allow backend to enforce this guard; show warning
    }

    setLoading(true);
    const failures: string[] = [];

    await Promise.all([
      ...toAdd.map((role) =>
        apiPost(`/api/v1/users/${user.id}/roles`, { role_id: role.id }).catch(() => {
          failures.push(role.name);
        })
      ),
      ...toRemove.map((role) =>
        apiDelete(`/api/v1/users/${user.id}/roles/${role.id}`).catch((err) => {
          const msg = isApiError(err) ? err.message : '';
          if (msg.toLowerCase().includes('last') || msg.toLowerCase().includes('admin')) {
            toast.error(labels.users.cannotRemoveLastAdmin);
          }
          failures.push(role.name);
        })
      ),
    ]);

    setLoading(false);

    if (failures.length > 0) {
      toast.warning(labels.users.someRoleChangesFailed(failures.join(', ')));
    } else {
      const name = `${user.first_name} ${user.last_name}`.trim();
      toast.success(labels.users.rolesUpdatedFor(name));
      onOpenChange(false);
      onSuccess();
    }
  };

  const name = `${user.first_name} ${user.last_name}`.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.users.manageRolesFor(name)}</DialogTitle>
          <DialogDescription>
            {labels.users.selectRolesToAssign}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-80">
          {rolesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
            <div className="space-y-1 pe-4">
              {allRoles.map((role) => {
                const isChecked = selected.has(role.id);
                return (
                  <div
                    key={role.id}
                    className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
                    onClick={() => toggle(role.id)}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggle(role.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{role.name}</span>
                        <Badge
                          variant={role.is_system ? 'default' : 'outline'}
                          className="text-xs gap-1"
                        >
                          {role.is_system ? (
                            <><Lock className="h-2.5 w-2.5" />{labels.users.system}</>
                          ) : (
                            <><FileEdit className="h-2.5 w-2.5" />{labels.users.custom}</>
                          )}
                        </Badge>
                      </div>
                      {role.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {role.description}
                        </p>
                      )}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-xs text-muted-foreground mt-0.5 cursor-default">
                              {labels.users.permissionsCount(role.permissions.length)}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <div className="space-y-0.5">
                              {role.permissions.slice(0, 10).map((p) => (
                                <p key={p} className="text-xs font-mono">{p}</p>
                              ))}
                              {role.permissions.length > 10 && (
                                <p className="text-xs text-muted-foreground">
                                  +{role.permissions.length - 10} {labels.common.more}
                                </p>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {labels.users.cancel}
          </Button>
          <Button onClick={handleSave} disabled={loading || rolesLoading}>
            {loading ? labels.users.saving : labels.users.saveChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
