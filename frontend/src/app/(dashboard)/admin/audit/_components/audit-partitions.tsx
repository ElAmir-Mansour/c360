"use client";

import { useState } from "react";
import { Plus, Archive, Trash2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAuditPartitions,
  useCreateAuditPartition,
  useArchiveAuditPartition,
  useDeleteAuditPartition,
} from "@/hooks/use-audit";
import { formatDate, formatBytes, formatNumber } from "@/lib/format";
import type { AuditPartition, AuditPartitionStatus } from "@/types/audit";
import { useAdminT } from "../../_lib/admin-i18n";

const statusVariant: Record<AuditPartitionStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  archived: "secondary",
  pending: "outline",
};

export function AuditPartitions() {
  const labels = useAdminT();
  const { data: partitions, isLoading, error, refetch } = useAuditPartitions();
  const createMutation = useCreateAuditPartition();
  const archiveMutation = useArchiveAuditPartition();
  const deleteMutation = useDeleteAuditPartition();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AuditPartition | null>(null);

  const handleCreate = () => {
    createMutation.mutate(undefined, {
      onSuccess: () => setCreateOpen(false),
    });
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-sm text-muted-foreground">
          {labels.audit.failedToLoadPartitions}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          {labels.audit.retry}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Partition timeline bar */}
      {partitions && partitions.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">
            {labels.audit.partitionCoverage}
          </p>
          <div className="flex gap-1 h-6">
            {partitions.map((p) => (
              <div
                key={p.id}
                className={`flex-1 rounded text-overline flex items-center justify-center text-white truncate px-1 ${
                  p.status === "active"
                    ? "bg-primary"
                    : p.status === "archived"
                    ? "bg-muted-foreground"
                    : "bg-muted"
                }`}
                title={`${p.name}: ${formatDate(p.date_range_start)} - ${formatDate(p.date_range_end)}`}
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions bar */}
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="me-2 h-4 w-4" />
          {labels.audit.runMaintenance}
        </Button>
      </div>

      {/* Partitions table */}
      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{labels.audit.pName}</TableHead>
              <TableHead>{labels.audit.pDateRange}</TableHead>
              <TableHead>{labels.audit.pRecords}</TableHead>
              <TableHead>{labels.audit.pSize}</TableHead>
              <TableHead>{labels.audit.colStatus}</TableHead>
              <TableHead>{labels.audit.pCreated}</TableHead>
              <TableHead className="w-24">{labels.audit.pActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : !partitions?.length ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <HardDrive className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      {labels.audit.noPartitions}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="me-2 h-4 w-4" />
                      {labels.audit.runMaintenance}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              partitions.map((partition) => (
                <TableRow key={partition.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">
                    {partition.name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(partition.date_range_start)} –{" "}
                    {formatDate(partition.date_range_end)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatNumber(partition.record_count)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatBytes(partition.size_bytes)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[partition.status]}>
                      {partition.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(partition.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {partition.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            archiveMutation.mutate(partition.name)
                          }
                          disabled={archiveMutation.isPending}
                          aria-label={labels.audit.archiveAria(partition.name)}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      )}
                      {partition.status === "archived" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(partition)}
                          aria-label={labels.audit.deletePartitionAria(partition.name)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Maintenance Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{labels.audit.runPartitionMaintenance}</DialogTitle>
            <DialogDescription>
              {labels.audit.runMaintenanceHint}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {labels.audit.cancel}
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? labels.audit.running : labels.audit.runMaintenance}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.audit.deletePartition}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.audit.deletePartitionDescription(deleteTarget?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.audit.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.name, {
                    onSuccess: () => setDeleteTarget(null),
                  });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? labels.audit.deleting : labels.audit.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
