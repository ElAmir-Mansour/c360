"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FormField } from "@/components/ui/form-field";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useBackendErrors } from "@/hooks/use-backend-errors";
import { showError, showBackendError } from "@/lib/toast";
import type { Role } from "@/types/models";
import { useAdminT } from "../../_lib/admin-i18n";

interface PermissionGroup {
  label: string;
  wildcard: string;
  permissions: Array<{ label: string; value: string }>;
}

type RoleLabels = ReturnType<typeof useAdminT>["roles"];

function buildPermissionTree(labels: RoleLabels): PermissionGroup[] {
  return [
    {
      label: labels.pgCyber,
      wildcard: "cyber:*",
      permissions: [
        { label: labels.pReadData, value: "cyber:read" },
        { label: labels.pWriteData, value: "cyber:write" },
        { label: labels.pReadAlerts, value: "alerts:read" },
        { label: labels.pManageAlerts, value: "alerts:write" },
        { label: labels.pExecRemediation, value: "remediation:execute" },
        { label: labels.pApproveRemediation, value: "remediation:approve" },
      ],
    },
    {
      label: labels.pgData,
      wildcard: "data:*",
      permissions: [
        { label: labels.pReadData, value: "data:read" },
        { label: labels.pWriteData, value: "data:write" },
        { label: labels.pManagePipelines, value: "pipelines:write" },
        { label: labels.pViewPipelines, value: "pipelines:read" },
        { label: labels.pDataQuality, value: "quality:read" },
        { label: labels.pDataLineage, value: "lineage:read" },
      ],
    },
    {
      label: labels.pgActa,
      wildcard: "acta:*",
      permissions: [
        { label: labels.pViewGovernance, value: "acta:read" },
        { label: labels.pManageGovernance, value: "acta:write" },
      ],
    },
    {
      label: labels.pgLex,
      wildcard: "lex:*",
      permissions: [
        { label: labels.pViewLegal, value: "lex:read" },
        { label: labels.pManageLegal, value: "lex:write" },
        { label: labels.pLexRequestView, value: "lex:request:view" },
        { label: labels.pLexRequestAdd, value: "lex:request:add" },
        { label: labels.pLexRequestEdit, value: "lex:request:edit" },
        { label: labels.pLexRequestApprove, value: "lex:request:approve" },
        { label: labels.pLexRequestClose, value: "lex:request:close" },
        { label: labels.pLexSlaManage, value: "lex:sla:manage" },
        { label: labels.pLexEscalationManage, value: "lex:escalation:manage" },
        { label: labels.pLexCaseView, value: "lex:case:view" },
        { label: labels.pLexCaseAdd, value: "lex:case:add" },
        { label: labels.pLexCaseEdit, value: "lex:case:edit" },
        { label: labels.pLexCaseAssign, value: "lex:case:assign" },
        { label: labels.pLexCaseApprove, value: "lex:case:approve" },
        { label: labels.pLexCaseClose, value: "lex:case:close" },
        { label: labels.pLexInvestigationEdit, value: "lex:investigation:edit" },
        { label: labels.pLexInvestigationApprove, value: "lex:investigation:approve" },
        { label: labels.pLexSettlementApprove, value: "lex:settlement:approve" },
        { label: labels.pLexContractView, value: "lex:contract:view" },
        { label: labels.pLexContractEdit, value: "lex:contract:edit" },
        { label: labels.pLexContractDistribute, value: "lex:contract:distribute" },
        { label: labels.pLexContractApprove, value: "lex:contract:approve" },
        { label: labels.pLexContractClose, value: "lex:contract:close" },
        { label: labels.pLexConsultationAdd, value: "lex:consultation:add" },
        { label: labels.pLexConsultationApprove, value: "lex:consultation:approve" },
        { label: labels.pLexReportRead, value: "lex:report:read" },
        { label: labels.pLexDocumentEdit, value: "lex:document:edit" },
        { label: labels.pLexNotificationManage, value: "lex:notification:manage" },
        { label: labels.pLexCatalogManage, value: "lex:catalog:manage" },
        { label: labels.pLexRoleAssign, value: "lex:role:assign" },
        { label: labels.pLexRoleManage, value: "lex:role:manage" },
        { label: labels.pLexAuditRead, value: "lex:audit:read" },
        { label: labels.pLexIntegrationManage, value: "lex:integration:manage" },
        { label: labels.pLexSecurityManage, value: "lex:security:manage" },
      ],
    },
    {
      label: labels.pgVisus,
      wildcard: "visus:*",
      permissions: [
        { label: labels.pViewExecDashboards, value: "visus:read" },
      ],
    },
    {
      label: labels.pgPlatform,
      wildcard: "tenant:*",
      permissions: [
        { label: labels.pViewTenantSettings, value: "tenant:read" },
        { label: labels.pManageTenantSettings, value: "tenant:write" },
        { label: labels.pViewUsers, value: "users:read" },
        { label: labels.pManageUsers, value: "users:write" },
        { label: labels.pViewRoles, value: "roles:read" },
        { label: labels.pManageRoles, value: "roles:write" },
      ],
    },
    {
      label: labels.pgReports,
      wildcard: "reports:*",
      permissions: [
        { label: labels.pViewReports, value: "reports:read" },
        { label: labels.pCreateReports, value: "reports:write" },
      ],
    },
    {
      label: labels.pgAudit,
      wildcard: "audit:*",
      permissions: [
        { label: labels.pViewAuditLogs, value: "audit:read" },
      ],
    },
  ];
}

const roleSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  description: z.string().optional(),
  permissions: z.array(z.string()).min(1, "Select at least one permission"),
});

type RoleFormData = z.infer<typeof roleSchema>;

interface RoleFormDialogProps {
  role?: Role;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RoleFormDialog({ role, open, onOpenChange, onSuccess }: RoleFormDialogProps) {
  const { roles: t, common: c } = useAdminT();
  const isEdit = !!role;
  // System (is_system) roles — the 14 seeded legal roles among them — are
  // IMMUTABLE (design v2 §4.3): even if the edit dialog is somehow opened for
  // one, every control is read-only and the role cannot be saved. The list UI
  // already hides the edit affordance; this is the in-dialog backstop.
  const isSystemReadOnly = isEdit && !!role?.is_system;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const applyBackendErrors = useBackendErrors<RoleFormData>();
  const PERMISSION_TREE = useMemo(() => buildPermissionTree(t), [t]);

  const methods = useForm<RoleFormData>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: role?.name ?? "",
      description: role?.description ?? "",
      permissions: role?.permissions ?? [],
    },
  });

  useEffect(() => {
    if (role) {
      methods.reset({
        name: role.name,
        description: role.description,
        permissions: role.permissions,
      });
    } else {
      methods.reset({ name: "", description: "", permissions: [] });
    }
  }, [role, methods]);

  const watchedPermissions = methods.watch("permissions");
  const selectedPermissions = useMemo(
    () => new Set(watchedPermissions),
    [watchedPermissions]
  );

  const getGroupState = useCallback(
    (group: PermissionGroup): "all" | "some" | "none" => {
      const groupPerms = group.permissions.map((p) => p.value);
      const selectedCount = groupPerms.filter((p) => selectedPermissions.has(p)).length;
      if (selectedCount === 0) return "none";
      if (selectedCount === groupPerms.length) return "all";
      return "some";
    },
    [selectedPermissions]
  );

  const toggleGroup = (group: PermissionGroup) => {
    if (isSystemReadOnly) return;
    const state = getGroupState(group);
    const groupPerms = group.permissions.map((p) => p.value);
    const current = new Set(methods.getValues("permissions"));
    if (state === "all") {
      groupPerms.forEach((p) => current.delete(p));
    } else {
      groupPerms.forEach((p) => current.add(p));
    }
    methods.setValue("permissions", [...current]);
  };

  const togglePermission = (value: string) => {
    if (isSystemReadOnly) return;
    const current = new Set(methods.getValues("permissions"));
    if (current.has(value)) current.delete(value);
    else current.add(value);
    methods.setValue("permissions", [...current]);
  };

  const toggleGroupExpanded = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  function toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  const mutation = useApiMutation<unknown, RoleFormData>(
    isEdit ? "put" : "post",
    isEdit ? `/api/v1/roles/${role!.id}` : "/api/v1/roles",
    {
      successMessage: isEdit ? t.roleUpdatedShort : t.roleCreatedShort,
      invalidateKeys: ["roles"],
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
      onError: (error) => {
        // Map 422/409 validation details onto the form (e.g. duplicate name);
        // the FormErrorSummary then links each message to its control.
        const { summary } = applyBackendErrors(
          error,
          methods.setError,
          methods.setFocus
        );
        if (summary) showBackendError(error);
      },
    }
  );

  const onSubmit = methods.handleSubmit(async (data) => {
    if (isEdit && role?.is_system) {
      showError(t.cannotModifySystem);
      return;
    }
    const payload = isEdit
      ? data
      : { ...data, slug: toSlug(data.name) };
    await mutation.mutate(payload as RoleFormData);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.editRoleTitle : t.createRoleTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? t.editingName(role!.name) : t.defineNewRole}
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...methods}>
          <form
            onSubmit={onSubmit}
            className="flex flex-col flex-1 overflow-hidden"
            noValidate
          >
            <div className="space-y-4 flex-shrink-0 px-1 pb-2">
              {isSystemReadOnly && (
                <Alert>
                  <Lock className="h-4 w-4" aria-hidden />
                  <AlertDescription className="text-xs">
                    {t.cannotModifySystem}
                  </AlertDescription>
                </Alert>
              )}
              <FormErrorSummary
                fieldLabels={{
                  name: t.roleName,
                  description: c.description,
                  permissions: t.permissions,
                }}
              />
              <FormField name="name" label={t.roleName} required showSuccess>
                <Input
                  {...methods.register("name")}
                  placeholder={t.roleNamePlaceholder}
                  disabled={mutation.isPending || isSystemReadOnly}
                />
              </FormField>
              <FormField name="description" label={c.description}>
                <Textarea
                  {...methods.register("description")}
                  placeholder={t.descriptionPlaceholder}
                  rows={2}
                  disabled={mutation.isPending || isSystemReadOnly}
                />
              </FormField>
            </div>

            <div className="flex-1 overflow-hidden px-1">
              <Label className="text-sm font-medium mb-2 block">
                {t.permissions}
                {methods.formState.errors.permissions && (
                  <span className="text-destructive text-xs ms-2">
                    {methods.formState.errors.permissions.message}
                  </span>
                )}
              </Label>
              <ScrollArea className="h-64 border border-border rounded-md p-2">
                <div className="space-y-1">
                  {PERMISSION_TREE.map((group) => {
                    const state = getGroupState(group);
                    const isExpanded = expandedGroups.has(group.label);
                    return (
                      <div key={group.label}>
                        <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50">
                          <button
                            type="button"
                            className="p-0 focus:outline-none"
                            onClick={() => toggleGroupExpanded(group.label)}
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? t.collapse : t.expand} ${group.label}`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <div
                            className="flex items-center gap-2 flex-1 cursor-pointer"
                            onClick={() => toggleGroup(group)}
                          >
                            <div
                              className={`flex h-4 w-4 items-center justify-center rounded border ${
                                state === "all"
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : state === "some"
                                  ? "bg-primary/20 border-primary"
                                  : "border-input"
                              }`}
                            >
                              {state === "all" && (
                                <span className="text-overline">✓</span>
                              )}
                              {state === "some" && (
                                <span className="text-overline text-primary">—</span>
                              )}
                            </div>
                            <span className="text-sm font-medium">{group.label}</span>
                            <span className="text-xs text-muted-foreground ms-auto">
                              {
                                group.permissions.filter((p) =>
                                  selectedPermissions.has(p.value)
                                ).length
                              }
                              /{group.permissions.length}
                            </span>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="ms-8 space-y-1 mt-1">
                            {group.permissions.map((perm) => (
                              <div
                                key={perm.value}
                                className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 cursor-pointer"
                                onClick={() => togglePermission(perm.value)}
                              >
                                <Checkbox
                                  checked={selectedPermissions.has(perm.value)}
                                  onCheckedChange={() => togglePermission(perm.value)}
                                  id={`perm-${perm.value}`}
                                  disabled={isSystemReadOnly}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Label
                                  htmlFor={`perm-${perm.value}`}
                                  className="text-sm cursor-pointer flex-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {perm.label}
                                </Label>
                                <code className="text-xs text-muted-foreground font-mono">
                                  {perm.value}
                                </code>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <DialogFooter className="pt-4 flex-shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                {c.cancel}
              </Button>
              {!isSystemReadOnly && (
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending
                    ? c.saving
                    : isEdit
                    ? t.saveChanges
                    : t.createRole}
                </Button>
              )}
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
