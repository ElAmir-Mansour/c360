'use client';

import { useState, useMemo } from 'react';
import {
  Plus,
  Scale,
  ShieldCheck,
  GitBranch,
  Eye,
  Edit,
  ClipboardCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/common/page-header';
import {
  useVcisoLabels,
  useVcisoGovLabels,
  useVcisoComplianceListLabels,
} from '../_lib/vciso-i18n';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { StatusBadge } from '@/components/shared/status-badge';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import {
  obligationStatusConfig,
  controlTestResultConfig,
} from '@/lib/status-configs';
import { useDataTable } from '@/hooks/use-data-table';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDate, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DetailPanel } from '@/components/shared/detail-panel';
import { Separator } from '@/components/ui/separator';
import type { ColumnDef } from '@tanstack/react-table';
import type { PaginatedResponse } from '@/types/api';
import type { FilterConfig } from '@/types/table';
import type {
  VCISORegulatoryObligation,
  VCISOControlTest,
  VCISOControlDependency,
  ControlFailureImpact,
} from '@/types/cyber';

import { ObligationFormDialog } from './_components/obligation-form-dialog';
import { ObligationDetailPanel } from './_components/obligation-detail-panel';
import { ControlTestFormDialog } from './_components/control-test-form-dialog';
import { DependencyDetailPanel } from './_components/dependency-detail-panel';

// ─── Failure Impact → Severity mapping ───────────────────────────────────────

const impactToSeverity: Record<ControlFailureImpact, Severity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

// ─── Regulatory Obligations Tab ──────────────────────────────────────────────

function ObligationsTab({ onCreateObligation }: { onCreateObligation: () => void }) {
  const cl = useVcisoComplianceListLabels();
  const gc = useVcisoGovLabels();
  const [detailObligation, setDetailObligation] = useState<VCISORegulatoryObligation | null>(null);
  const [editObligation, setEditObligation] = useState<VCISORegulatoryObligation | null>(null);

  const obligTypeLabels: Record<string, string> = {
    legal: gc.compliance.obligationTypes.legal(),
    regulatory: gc.compliance.obligationTypes.regulatory(),
    contractual: gc.compliance.obligationTypes.contractual(),
    industry_standard: gc.compliance.obligationTypes.industry_standard(),
  };

  const table = useDataTable<VCISORegulatoryObligation>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISORegulatoryObligation>>(
        API_ENDPOINTS.CYBER_VCISO_OBLIGATIONS,
        params,
      ),
    queryKey: 'vciso-obligations',
    defaultSort: { column: 'name', direction: 'asc' },
    wsTopics: ['vciso.obligations'],
  });

  const filters: FilterConfig[] = [
    {
      key: 'type',
      label: cl.obligFilters.type,
      type: 'select',
      options: [
        { label: obligTypeLabels.legal, value: 'legal' },
        { label: obligTypeLabels.regulatory, value: 'regulatory' },
        { label: obligTypeLabels.contractual, value: 'contractual' },
        { label: obligTypeLabels.industry_standard, value: 'industry_standard' },
      ],
    },
    {
      key: 'status',
      label: cl.obligFilters.status,
      type: 'select',
      options: [
        { label: cl.obligFilters.statusOptions.compliant, value: 'compliant' },
        { label: cl.obligFilters.statusOptions.partially_compliant, value: 'partially_compliant' },
        { label: cl.obligFilters.statusOptions.non_compliant, value: 'non_compliant' },
        { label: cl.obligFilters.statusOptions.not_assessed, value: 'not_assessed' },
      ],
    },
  ];

  const columns: ColumnDef<VCISORegulatoryObligation>[] = [
    {
      id: 'name',
      header: cl.obligColumns.name,
      accessorKey: 'name',
      enableSorting: true,
      cell: ({ row }) => (
        <button
          className="font-semibold text-sm hover:underline text-start max-w-[180px] sm:max-w-[280px] truncate block"
          onClick={(e) => {
            e.stopPropagation();
            setDetailObligation(row.original);
          }}
        >
          {row.original.name}
        </button>
      ),
    },
    {
      id: 'type',
      header: cl.obligColumns.type,
      accessorKey: 'type',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">{obligTypeLabels[row.original.type] ?? titleCase(row.original.type)}</Badge>
      ),
    },
    {
      id: 'jurisdiction',
      header: cl.obligColumns.jurisdiction,
      accessorKey: 'jurisdiction',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.jurisdiction}</span>
      ),
    },
    {
      id: 'status',
      header: cl.obligColumns.status,
      accessorKey: 'status',
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={obligationStatusConfig}
          size="sm"
        />
      ),
    },
    {
      id: 'requirements_met',
      header: cl.obligColumns.requirementsMet,
      accessorKey: 'met_requirements',
      enableSorting: false,
      cell: ({ row }) => {
        const { met_requirements, total_requirements } = row.original;
        const percent =
          total_requirements > 0
            ? Math.round((met_requirements / total_requirements) * 100)
            : 0;
        return (
          <div className="flex items-center gap-2 min-w-[140px]">
            <span className="text-sm font-medium whitespace-nowrap">
              {met_requirements}/{total_requirements}
            </span>
            <Progress value={percent} className="h-1.5 flex-1" />
          </div>
        );
      },
    },
    {
      id: 'owner_name',
      header: cl.obligColumns.owner,
      accessorKey: 'owner_name',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.owner_name ?? <span className="text-muted-foreground">{cl.obligColumns.unassigned}</span>}
        </span>
      ),
    },
    {
      id: 'review_date',
      header: cl.obligColumns.reviewDate,
      accessorKey: 'review_date',
      enableSorting: true,
      cell: ({ row }) => {
        const isOverdue = new Date(row.original.review_date) < new Date();
        return (
          <span
            className={cn(
              'text-sm',
              isOverdue && 'text-status-error font-medium',
            )}
          >
            {formatDate(row.original.review_date)}
          </span>
        );
      },
    },
  ];

  const rowActions = (obligation: VCISORegulatoryObligation) => [
    {
      label: cl.obligActions.viewDetails,
      icon: Eye,
      onClick: (o: VCISORegulatoryObligation) => setDetailObligation(o),
    },
    {
      label: cl.obligActions.edit,
      icon: Edit,
      onClick: (o: VCISORegulatoryObligation) => setEditObligation(o),
    },
  ];

  return (
    <>
      <DataTable
        {...table.tableProps}
        columns={columns}
        filters={filters}
        rowActions={rowActions}
        onRowClick={(obligation) => setDetailObligation(obligation)}
        searchPlaceholder={cl.obligSearch}
        searchSlot={
          <SearchInput
            value={table.tableProps.searchValue ?? ''}
            onChange={table.tableProps.onSearchChange ?? (() => undefined)}
            placeholder={cl.obligSearch}
            loading={table.tableProps.isLoading}
          />
        }
        emptyState={{
          icon: Scale,
          title: cl.obligEmpty.title,
          description: cl.obligEmpty.desc(),
          action: {
            label: cl.headerActions.addObligation,
            onClick: onCreateObligation,
            icon: Plus,
          },
        }}
      />

      {/* Detail Panel */}
      {detailObligation && (
        <ObligationDetailPanel
          obligation={detailObligation}
          open={!!detailObligation}
          onClose={() => setDetailObligation(null)}
          onEdit={() => {
            setEditObligation(detailObligation);
            setDetailObligation(null);
          }}
        />
      )}

      {/* Edit Dialog */}
      {editObligation && (
        <ObligationFormDialog
          open={!!editObligation}
          onOpenChange={(o) => !o && setEditObligation(null)}
          obligation={editObligation}
          onSuccess={() => table.refetch()}
        />
      )}
    </>
  );
}

// ─── Control Testing Tab ─────────────────────────────────────────────────────

function ControlTestingTab({ onRecordTest }: { onRecordTest: () => void }) {
  const cl = useVcisoComplianceListLabels();
  const gc = useVcisoGovLabels();
  const [detailTest, setDetailTest] = useState<VCISOControlTest | null>(null);
  const [recordTestOpen, setRecordTestOpen] = useState(false);

  const testTypeLabels = gc.compliance.testTypes as Record<string, string>;

  const table = useDataTable<VCISOControlTest>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISOControlTest>>(
        API_ENDPOINTS.CYBER_VCISO_CONTROL_TESTS,
        params,
      ),
    queryKey: 'vciso-control-tests',
    defaultSort: { column: 'test_date', direction: 'desc' },
    wsTopics: ['vciso.control-tests'],
  });

  const filters: FilterConfig[] = [
    {
      key: 'result',
      label: cl.testFilters.result,
      type: 'select',
      options: [
        { label: gc.compliance.testResults.effective, value: 'effective' },
        { label: gc.compliance.testResults.partially_effective, value: 'partially_effective' },
        { label: gc.compliance.testResults.ineffective, value: 'ineffective' },
        { label: gc.compliance.testResults.not_tested, value: 'not_tested' },
      ],
    },
    {
      key: 'test_type',
      label: cl.testFilters.testType,
      type: 'select',
      options: [
        { label: testTypeLabels.design, value: 'design' },
        { label: testTypeLabels.operating_effectiveness, value: 'operating_effectiveness' },
      ],
    },
  ];

  const columns: ColumnDef<VCISOControlTest>[] = [
    {
      id: 'control_name',
      header: cl.testColumns.controlName,
      accessorKey: 'control_name',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-semibold text-sm max-w-[140px] sm:max-w-[240px] truncate block">
          {row.original.control_name}
        </span>
      ),
    },
    {
      id: 'framework',
      header: cl.testColumns.framework,
      accessorKey: 'framework',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.framework}</Badge>
      ),
    },
    {
      id: 'test_type',
      header: cl.testColumns.testType,
      accessorKey: 'test_type',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="secondary">{testTypeLabels[row.original.test_type] ?? titleCase(row.original.test_type)}</Badge>
      ),
    },
    {
      id: 'result',
      header: cl.testColumns.result,
      accessorKey: 'result',
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.result}
          config={controlTestResultConfig}
          size="sm"
        />
      ),
    },
    {
      id: 'tester_name',
      header: cl.testColumns.tester,
      accessorKey: 'tester_name',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.tester_name}</span>
      ),
    },
    {
      id: 'test_date',
      header: cl.testColumns.testDate,
      accessorKey: 'test_date',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.test_date)}
        </span>
      ),
    },
    {
      id: 'next_test_date',
      header: cl.testColumns.nextTestDate,
      accessorKey: 'next_test_date',
      enableSorting: true,
      cell: ({ row }) => {
        const isPast =
          row.original.next_test_date &&
          new Date(row.original.next_test_date) < new Date();
        return (
          <span
            className={cn(
              'text-sm',
              isPast ? 'text-status-error font-medium' : 'text-muted-foreground',
            )}
          >
            {row.original.next_test_date
              ? formatDate(row.original.next_test_date)
              : '—'}
          </span>
        );
      },
    },
  ];

  const rowActions = (test: VCISOControlTest) => [
    {
      label: cl.testActions.viewDetails,
      icon: Eye,
      onClick: (t: VCISOControlTest) => setDetailTest(t),
    },
    {
      label: cl.testActions.recordNew(),
      icon: ClipboardCheck,
      onClick: () => setRecordTestOpen(true),
    },
  ];

  return (
    <>
      <DataTable
        {...table.tableProps}
        columns={columns}
        filters={filters}
        rowActions={rowActions}
        onRowClick={(test) => setDetailTest(test)}
        searchPlaceholder={cl.testSearch}
        searchSlot={
          <SearchInput
            value={table.tableProps.searchValue ?? ''}
            onChange={table.tableProps.onSearchChange ?? (() => undefined)}
            placeholder={cl.testSearch}
            loading={table.tableProps.isLoading}
          />
        }
        emptyState={{
          icon: ShieldCheck,
          title: cl.testEmpty.title,
          description: cl.testEmpty.desc(),
          action: {
            label: cl.headerActions.recordTest(),
            onClick: onRecordTest,
            icon: Plus,
          },
        }}
      />

      {/* Test Detail Panel */}
      {detailTest && (
        <ControlTestDetailView
          test={detailTest}
          open={!!detailTest}
          onClose={() => setDetailTest(null)}
        />
      )}

      {/* Record New Test from row action */}
      <ControlTestFormDialog
        open={recordTestOpen}
        onOpenChange={setRecordTestOpen}
        onSuccess={() => table.refetch()}
      />
    </>
  );
}

// ─── Control Test Detail View (inline) ───────────────────────────────────────

function ControlTestDetailView({
  test,
  open,
  onClose,
}: {
  test: VCISOControlTest;
  open: boolean;
  onClose: () => void;
}) {
  const cl = useVcisoComplianceListLabels();
  const gc = useVcisoGovLabels();
  const testTypeLabels = gc.compliance.testTypes as Record<string, string>;
  const testTypeLabel = testTypeLabels[test.test_type] ?? titleCase(test.test_type);
  const isPastDue =
    test.next_test_date && new Date(test.next_test_date) < new Date();

  return (
    <DetailPanel
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={test.control_name}
      description={cl.testDetail.frameworkPrefix(test.framework)}
      width="xl"
    >
      <div className="space-y-6">
        {/* Result */}
        <div className="flex items-center justify-between">
          <StatusBadge
            status={test.result}
            config={controlTestResultConfig}
            size="lg"
          />
          <Badge variant="secondary">{testTypeLabel}</Badge>
        </div>

        <Separator />

        {/* Metadata */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {cl.testDetail.framework}
            </p>
            <Badge variant="outline">{test.framework}</Badge>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {cl.testDetail.testType}
            </p>
            <p className="text-sm">{testTypeLabel}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {cl.testDetail.tester}
            </p>
            <p className="text-sm">{test.tester_name}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {cl.testDetail.testDate}
            </p>
            <p className="text-sm">{formatDate(test.test_date)}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {cl.testDetail.nextTestDate}
            </p>
            <p
              className={cn(
                'text-sm',
                isPastDue && 'text-status-error font-medium',
              )}
            >
              {test.next_test_date
                ? formatDate(test.next_test_date)
                : '—'}
              {isPastDue && cl.testDetail.overdueSuffix}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {cl.testDetail.evidenceItems}
            </p>
            <p className="text-sm">{test.evidence_ids?.length ?? 0}</p>
          </div>
        </div>

        <Separator />

        {/* Findings */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{cl.testDetail.findings}</h3>
          {test.findings ? (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm whitespace-pre-wrap">{test.findings}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {cl.testDetail.noFindings}
            </p>
          )}
        </div>
      </div>
    </DetailPanel>
  );
}

// ─── Control Dependencies Tab ────────────────────────────────────────────────

function ControlDependenciesTab() {
  const cl = useVcisoComplianceListLabels();
  const [detailDependency, setDetailDependency] = useState<VCISOControlDependency | null>(null);

  const table = useDataTable<VCISOControlDependency>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISOControlDependency>>(
        API_ENDPOINTS.CYBER_VCISO_CONTROL_DEPENDENCIES,
        params,
      ),
    queryKey: 'vciso-control-dependencies',
    defaultSort: { column: 'control_name', direction: 'asc' },
    wsTopics: ['vciso.control-dependencies'],
  });

  const columns: ColumnDef<VCISOControlDependency>[] = [
    {
      id: 'control_name',
      header: cl.depColumns.controlName,
      accessorKey: 'control_name',
      enableSorting: true,
      cell: ({ row }) => (
        <button
          className="font-semibold text-sm hover:underline text-start max-w-[160px] sm:max-w-[260px] truncate block"
          onClick={(e) => {
            e.stopPropagation();
            setDetailDependency(row.original);
          }}
        >
          {row.original.control_name}
        </button>
      ),
    },
    {
      id: 'framework',
      header: cl.depColumns.framework,
      accessorKey: 'framework',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.framework}</Badge>
      ),
    },
    {
      id: 'failure_impact',
      header: cl.depColumns.failureImpact,
      accessorKey: 'failure_impact',
      enableSorting: true,
      cell: ({ row }) => (
        <SeverityIndicator
          severity={impactToSeverity[row.original.failure_impact]}
          size="sm"
        />
      ),
    },
    {
      id: 'depends_on',
      header: cl.depColumns.dependsOn,
      accessorKey: 'depends_on',
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="secondary">
          {row.original.depends_on.length}
        </Badge>
      ),
    },
    {
      id: 'depended_by',
      header: cl.depColumns.dependedBy,
      accessorKey: 'depended_by',
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="secondary">
          {row.original.depended_by.length}
        </Badge>
      ),
    },
    {
      id: 'risk_domains',
      header: cl.depColumns.riskDomains,
      accessorKey: 'risk_domains',
      enableSorting: false,
      cell: ({ row }) => {
        const domains = row.original.risk_domains;
        const displayed = domains.slice(0, 2);
        const remaining = domains.length - displayed.length;
        return (
          <div className="flex items-center gap-1">
            {displayed.map((d) => (
              <Badge key={d} variant="secondary" className="text-xs">
                {titleCase(d)}
              </Badge>
            ))}
            {remaining > 0 && (
              <span className="text-xs text-muted-foreground">
                +{remaining}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'compliance_domains',
      header: cl.depColumns.complianceDomains,
      accessorKey: 'compliance_domains',
      enableSorting: false,
      cell: ({ row }) => {
        const domains = row.original.compliance_domains;
        const displayed = domains.slice(0, 2);
        const remaining = domains.length - displayed.length;
        return (
          <div className="flex items-center gap-1">
            {displayed.map((d) => (
              <Badge key={d} variant="outline" className="text-xs">
                {titleCase(d)}
              </Badge>
            ))}
            {remaining > 0 && (
              <span className="text-xs text-muted-foreground">
                +{remaining}
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        {...table.tableProps}
        columns={columns}
        onRowClick={(dep) => setDetailDependency(dep)}
        searchPlaceholder={cl.depSearch}
        searchSlot={
          <SearchInput
            value={table.tableProps.searchValue ?? ''}
            onChange={table.tableProps.onSearchChange ?? (() => undefined)}
            placeholder={cl.depSearch}
            loading={table.tableProps.isLoading}
          />
        }
        getRowId={(row) => row.control_id}
        emptyState={{
          icon: GitBranch,
          title: cl.depEmpty.title,
          description: cl.depEmpty.desc,
        }}
      />

      {/* Detail Panel */}
      {detailDependency && (
        <DependencyDetailPanel
          dependency={detailDependency}
          open={!!detailDependency}
          onClose={() => setDetailDependency(null)}
        />
      )}
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function VCISOCompliancePage() {
  const tv = useVcisoLabels();
  const cl = useVcisoComplianceListLabels();
  const [activeTab, setActiveTab] = useState('obligations');
  const [createObligationOpen, setCreateObligationOpen] = useState(false);
  const [createTestOpen, setCreateTestOpen] = useState(false);

  const headerActions = useMemo(() => {
    if (activeTab === 'obligations') {
      return (
        <Button onClick={() => setCreateObligationOpen(true)}>
          <Plus className="me-2 h-4 w-4" />
          {cl.headerActions.addObligation}
        </Button>
      );
    }
    if (activeTab === 'testing') {
      return (
        <Button onClick={() => setCreateTestOpen(true)}>
          <Plus className="me-2 h-4 w-4" />
          {cl.headerActions.recordTest()}
        </Button>
      );
    }
    return null;
  }, [activeTab, cl]);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={tv.pages.compliance.title}
          description={tv.pages.compliance.description}
          actions={headerActions}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="obligations" className="gap-1.5">
              <Scale className="h-4 w-4" />
              {cl.tabs.obligations}
            </TabsTrigger>
            <TabsTrigger value="testing" className="gap-1.5">
              <ShieldCheck className="h-4 w-4" />
              {cl.tabs.testing}
            </TabsTrigger>
            <TabsTrigger value="dependencies" className="gap-1.5">
              <GitBranch className="h-4 w-4" />
              {cl.tabs.dependencies}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="obligations" className="mt-6">
            <ObligationsTab
              onCreateObligation={() => setCreateObligationOpen(true)}
            />
          </TabsContent>

          <TabsContent value="testing" className="mt-6">
            <ControlTestingTab
              onRecordTest={() => setCreateTestOpen(true)}
            />
          </TabsContent>

          <TabsContent value="dependencies" className="mt-6">
            <ControlDependenciesTab />
          </TabsContent>
        </Tabs>

        {/* Create Obligation Dialog */}
        <ObligationFormDialog
          open={createObligationOpen}
          onOpenChange={setCreateObligationOpen}
          onSuccess={() => {}}
        />

        {/* Create Test Dialog */}
        <ControlTestFormDialog
          open={createTestOpen}
          onOpenChange={setCreateTestOpen}
          onSuccess={() => {}}
        />
      </div>
    </PermissionRedirect>
  );
}
