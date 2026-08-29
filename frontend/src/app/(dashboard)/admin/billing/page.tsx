'use client';

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  CreditCard,
  Database,
  Download,
  Eye,
  Gauge,
  Gavel,
  HardDrive,
  LayoutGrid,
  Receipt,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useTenant, useTenantUsage } from '@/hooks/use-tenants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { IconBadge } from '@/components/shared/icon-badge';
import { MetricTile } from '@/components/shared/metric-tile';
import { StatusBadge } from '@/components/shared/status-badge';
import { Progress } from '@/components/ui/progress';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatBytes, formatDate, formatNumber, downloadBlob } from '@/lib/format';
import { cn } from '@/lib/utils';
import { tenantPlanConfig, tenantStatusConfig } from '@/lib/status-configs';
import type { SubscriptionTier, Tenant, TenantUsage } from '@/types/tenant';
import { QuotaMeter } from './_components/quota-meter';
import { PlanCards } from './_components/plan-cards';
import { quotaPercent, quotaTone } from './_components/billing-helpers';
import { useAdminT, type AdminLabels } from '../_lib/admin-i18n';

type BillingPageLabels = AdminLabels['billingPage'];
type ProductServiceId = keyof BillingPageLabels['products'];
type PlatformServiceId = keyof BillingPageLabels['platformServices'];

const GB = 1024 ** 3;
const BILLING_CURRENCY = 'USD';

interface PlanDefaults {
  seats: number | null;
  storageGb: number | null;
  apiCalls: number | null;
}

const PLAN_DEFAULTS: Record<SubscriptionTier, PlanDefaults> = {
  free: {
    seats: 5,
    storageGb: 1,
    apiCalls: 10_000,
  },
  starter: {
    seats: 25,
    storageGb: 50,
    apiCalls: 250_000,
  },
  professional: {
    seats: 250,
    storageGb: 500,
    apiCalls: 2_000_000,
  },
  enterprise: {
    seats: null,
    storageGb: null,
    apiCalls: null,
  },
};

interface ProductService {
  id: ProductServiceId;
  aliases: string[];
  service: string;
  entitlement: string;
  routes: string;
  icon: LucideIcon;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
}

const PRODUCT_SERVICES: ProductService[] = [
  {
    id: 'cyber',
    aliases: ['cyber', 'cybersecurity', 'security', 'rca'],
    service: 'cyber-service',
    entitlement: 'suite.cyber',
    routes: '/api/v1/cyber, /api/v1/rca',
    icon: Shield,
    tone: 'danger',
  },
  {
    id: 'siem',
    aliases: ['siem', 'logs', 'events'],
    service: 'siem-service',
    entitlement: 'suite.siem',
    routes: '/api/v1/siem',
    icon: Activity,
    tone: 'warning',
  },
  {
    id: 'data',
    aliases: ['data', 'datastream', 'data-intelligence', 'pipelines'],
    service: 'data-service',
    entitlement: 'suite.data',
    routes: '/api/v1/data',
    icon: Database,
    tone: 'info',
  },
  {
    id: 'dr',
    aliases: ['dr', 'resilience', 'datastream-dr', 'suite.datastream', 'clariodr', 'clario-dr'],
    service: 'clario-dr-service',
    entitlement: 'suite.datastream',
    routes: '/api/v1/dr',
    icon: ShieldCheck,
    tone: 'success',
  },
  {
    id: 'acta',
    aliases: ['acta', 'governance', 'meetings', 'app.acta'],
    service: 'acta-service',
    entitlement: 'app.acta',
    routes: '/api/v1/acta',
    icon: Building2,
    tone: 'primary',
  },
  {
    id: 'lex',
    aliases: ['lex', 'watheeq', 'legal', 'contracts', 'app.watheeq'],
    service: 'lex-service',
    entitlement: 'app.watheeq',
    routes: '/api/v1/lex, /api/v1/watheeq',
    icon: Gavel,
    tone: 'muted',
  },
  {
    id: 'visus',
    aliases: ['visus', 'bosalah', 'executive', 'reports', 'app.bosalah'],
    service: 'visus-service',
    entitlement: 'app.bosalah',
    routes: '/api/v1/visus',
    icon: Eye,
    tone: 'info',
  },
];

const BILLABLE_SUITE_IDS = PRODUCT_SERVICES.map((suite) => suite.id);

const PLAN_DEFAULT_SUITES: Record<SubscriptionTier, ProductServiceId[]> = {
  free: ['cyber'],
  starter: ['cyber', 'data', 'lex'],
  professional: BILLABLE_SUITE_IDS,
  enterprise: BILLABLE_SUITE_IDS,
};

const PLATFORM_SERVICES = [
  { id: 'iam', service: 'iam-service', route: '/api/v1/{users,roles,tenants,ai}' },
  { id: 'licensing', service: 'license-service', route: '/api/v1/licensing' },
  { id: 'audit', service: 'audit-service', route: '/api/v1/audit' },
  { id: 'workflow', service: 'workflow-engine, automation-service', route: '/api/v1/workflows, /api/v1/automation' },
  { id: 'files', service: 'file-service, notification-service', route: '/api/v1/files, /api/v1/notifications' },
] satisfies Array<{ id: PlatformServiceId; service: string; route: string }>;

function resolveSuiteId(value: string): ProductServiceId | null {
  const token = value.toLowerCase().replace(/[_\s]+/g, '-');
  const match = PRODUCT_SERVICES.find((suite) =>
    suite.id === token || suite.aliases.some((alias) => alias.toLowerCase().replace(/[_\s]+/g, '-') === token),
  );
  return match?.id ?? null;
}

function formatLimit(value: number | null, unlimitedLabel: string, formatter = formatNumber): string {
  return value === null ? unlimitedLabel : formatter(value);
}

function nextRenewalDate(createdAt: string): Date | null {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;

  const now = new Date();
  const next = new Date(now.getFullYear(), created.getMonth(), created.getDate());
  if (next < now) next.setFullYear(next.getFullYear() + 1);
  return next;
}

function periodLabel(usage: TenantUsage | null | undefined, labels: BillingPageLabels): string {
  const period = usage?.period?.trim();
  if (!period) return labels.currentPeriod;

  const normalized = period.toLowerCase().replace(/[_\s-]+/g, '');
  if (normalized === 'currentperiod' || normalized === 'currentmonth') return labels.periods.current;
  if (normalized === 'monthly' || normalized === 'month') return labels.periods.monthly;
  if (normalized === 'yearly' || normalized === 'annual' || normalized === 'year') return labels.periods.annual;
  if (normalized === 'daily' || normalized === 'day') return labels.periods.daily;
  if (normalized === 'weekly' || normalized === 'week') return labels.periods.weekly;
  if (normalized === 'quarterly' || normalized === 'quarter') return labels.periods.quarterly;

  return period;
}

function compactBytes(bytes: number): string {
  return formatBytes(bytes);
}

function usageByProduct(usage: TenantUsage | null | undefined) {
  const rows = new Map<string, { api_calls: number; active_users: number; last_accessed: string | null }>();

  Object.values(usage?.suite_usage ?? {}).forEach((item) => {
    const suiteId = resolveSuiteId(item.suite);
    if (!suiteId) return;

    const current = rows.get(suiteId) ?? { api_calls: 0, active_users: 0, last_accessed: null };
    rows.set(suiteId, {
      api_calls: current.api_calls + item.api_calls,
      active_users: current.active_users + item.active_users,
      last_accessed:
        !current.last_accessed || (item.last_accessed && item.last_accessed > current.last_accessed)
          ? item.last_accessed
          : current.last_accessed,
    });
  });

  return rows;
}

function enabledSuitesForTenant(tenant: Tenant) {
  const explicit = tenant.settings?.enabled_suites ?? [];
  if (explicit.length === 0) {
    return {
      source: 'plan' as const,
      suiteIds: new Set(PLAN_DEFAULT_SUITES[tenant.subscription_tier]),
    };
  }

  return {
    source: 'tenant' as const,
    suiteIds: new Set(explicit.map(resolveSuiteId).filter((id): id is ProductServiceId => Boolean(id))),
  };
}

function ratioText(used: number, limit: number | null, labels: BillingPageLabels, formatter = formatNumber): string {
  return `${formatter(used)} / ${formatLimit(limit, labels.unlimited, formatter)}`;
}

function csvValue(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

function statusLabel(status: string, labels: BillingPageLabels): string {
  return labels.statuses[status as keyof typeof labels.statuses] ?? status;
}

function exportUsageCsv(
  tenant: Tenant,
  usage: TenantUsage | null | undefined,
  enabledSuiteIds: Set<ProductServiceId>,
  labels: BillingPageLabels,
) {
  const productUsage = usageByProduct(usage);
  const rows = [
    [
      labels.csvHeaders.product,
      labels.csvHeaders.entitlement,
      labels.csvHeaders.enabled,
      labels.csvHeaders.apiCalls,
      labels.csvHeaders.activeUsers,
      labels.csvHeaders.lastActive,
    ],
    ...PRODUCT_SERVICES.map((suite) => {
      const suiteUsage = productUsage.get(suite.id);
      return [
        labels.products[suite.id].name,
        suite.entitlement,
        enabledSuiteIds.has(suite.id) ? labels.csvEnabledYes : labels.csvEnabledNo,
        suiteUsage?.api_calls ?? 0,
        suiteUsage?.active_users ?? 0,
        suiteUsage?.last_accessed ? formatDate(suiteUsage.last_accessed) : '',
      ];
    }),
  ];

  const csv = rows.map((row) => row.map(csvValue).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${tenant.slug || tenant.id}-usage.csv`);
  toast.success(labels.toastExportGenerated);
}

function BillingLedger({
  tenant,
  usage,
  userName,
}: {
  tenant: Tenant;
  usage: TenantUsage | null | undefined;
  userName: string;
}) {
  const labels = useAdminT();
  const plan = PLAN_DEFAULTS[tenant.subscription_tier];
  const planLabels = labels.billingPage.planDefaults[tenant.subscription_tier];
  const renewalDate = nextRenewalDate(tenant.created_at);

  const details = [
    { label: labels.billingPage.ledgerFields.commercialModel, value: planLabels.commercialModel },
    { label: labels.billingPage.ledgerFields.contractTerm, value: planLabels.contractTerm },
    { label: labels.billingPage.ledgerFields.currency, value: BILLING_CURRENCY },
    { label: labels.billingPage.ledgerFields.billingOwner, value: userName },
    { label: labels.billingPage.ledgerFields.usagePeriod, value: periodLabel(usage, labels.billingPage) },
    { label: labels.billingPage.ledgerFields.nextReview, value: renewalDate ? formatDate(renewalDate) : labels.billingPage.accountTeam },
  ];

  return (
    <SectionCard
      title={labels.billingPage.ledgerTitle}
      description={labels.billingPage.ledgerDescription}
      actions={
        <Badge variant={tenant.status === 'active' ? 'success' : tenant.status === 'trial' ? 'warning' : 'outline'}>
          {statusLabel(tenant.status, labels.billingPage)}
        </Badge>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-caps-xwide text-primary">{labels.billingPage.currentPlan}</p>
              <h2 className="mt-2 text-h1 font-semibold text-foreground">
                {labels.billingPage.tiers[tenant.subscription_tier]}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {labels.billingPage.planSummary(tenant.name, planLabels.commercialModel)}
              </p>
            </div>
            <StatusBadge
              status={tenant.subscription_tier}
              config={tenantPlanConfig}
              label={labels.billingPage.tiers[tenant.subscription_tier]}
              variant="outline"
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-background/70 p-3">
              <p className="text-overline font-semibold uppercase tracking-caps-wide text-muted-foreground">{labels.billingPage.seats}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{formatLimit(plan.seats, labels.billingPage.unlimited)}</p>
            </div>
            <div className="rounded-lg bg-background/70 p-3">
              <p className="text-overline font-semibold uppercase tracking-caps-wide text-muted-foreground">{labels.billingPage.storage}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {formatLimit(plan.storageGb, labels.billingPage.unlimited, (value) => `${formatNumber(value)} GB`)}
              </p>
            </div>
            <div className="rounded-lg bg-background/70 p-3">
              <p className="text-overline font-semibold uppercase tracking-caps-wide text-muted-foreground">{labels.billingPage.support}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{planLabels.support}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {details.map((item) => (
            <div key={item.label} className="rounded-lg border border-border/70 bg-background/60 p-4">
              <p className="text-overline font-semibold uppercase tracking-caps-wide text-muted-foreground">{item.label}</p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

function UsageRiskCard({
  label,
  icon: Icon,
  used,
  limit,
  formatter = formatNumber,
}: {
  label: string;
  icon: LucideIcon;
  used: number;
  limit: number | null;
  formatter?: (value: number) => string;
}) {
  const labels = useAdminT();
  const pct = quotaPercent(used, limit);
  const tone = quotaTone(pct);
  const indicatorClass =
    tone === 'danger'
      ? 'bg-status-error'
      : tone === 'warning'
        ? 'bg-status-warning'
        : tone === 'muted'
          ? 'bg-muted-foreground/35'
          : 'bg-primary';

  return (
    <div className="rounded-lg border border-border/80 bg-background/70 p-4">
      <div className="flex items-start gap-3">
        <IconBadge icon={Icon} tone={tone === 'muted' ? 'muted' : tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="text-xs font-medium text-muted-foreground">{pct == null ? labels.billingPage.noCap : `${pct}%`}</p>
          </div>
          <Progress value={pct ?? 0} className="mt-3 h-2" indicatorClassName={indicatorClass} />
          <p className="mt-2 text-xs text-muted-foreground">{ratioText(used, limit, labels.billingPage, formatter)}</p>
        </div>
      </div>
    </div>
  );
}

function SuiteMatrix({
  tenant,
  usage,
  enabledSuiteIds,
  suiteSource,
}: {
  tenant: Tenant;
  usage: TenantUsage | null | undefined;
  enabledSuiteIds: Set<ProductServiceId>;
  suiteSource: 'tenant' | 'plan';
}) {
  const labels = useAdminT();
  const productUsage = usageByProduct(usage);

  return (
    <SectionCard
      title={labels.billingPage.coverageTitle}
      description={labels.billingPage.coverageDescription}
      actions={
        <Badge variant="outline">
          {suiteSource === 'tenant'
            ? labels.billingPage.suiteSourceTenant
            : labels.billingPage.suiteSourcePlanDefault(labels.billingPage.tiers[tenant.subscription_tier])}
        </Badge>
      }
    >
      <div className="grid gap-3">
        {PRODUCT_SERVICES.map((suite) => {
          const enabled = enabledSuiteIds.has(suite.id);
          const item = productUsage.get(suite.id);
          const suiteLabels = labels.billingPage.products[suite.id];
          const lastActive = item?.last_accessed
            ? formatDate(item.last_accessed)
            : enabled
              ? labels.billingPage.suiteNoActivityYet
              : labels.billingPage.suiteNotProvisioned;

          return (
            <div
              key={suite.id}
              className={cn(
                'grid gap-4 rounded-lg border p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(14rem,0.8fr)_minmax(12rem,0.55fr)] lg:items-center',
                enabled ? 'border-border bg-background/70' : 'border-border/60 bg-muted/30 opacity-80',
              )}
            >
              <div className="flex min-w-0 gap-3">
                <IconBadge icon={suite.icon} tone={suite.tone} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{suiteLabels.name}</h3>
                    <Badge variant={enabled ? 'success' : 'outline'}>
                      {enabled ? labels.billingPage.suiteIncluded : labels.billingPage.suiteOffPlan}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{suiteLabels.description}</p>
                </div>
              </div>

              <div className="min-w-0 rounded-lg bg-card/60 px-3 py-2 text-left text-xs" dir="ltr">
                <p className="font-mono text-foreground">{suite.entitlement}</p>
                <p className="mt-1 truncate text-muted-foreground">{suite.service}</p>
                <p className="mt-1 truncate text-muted-foreground">{suite.routes}</p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-end text-xs lg:grid-cols-1">
                <div>
                  <p className="text-muted-foreground">{labels.billingPage.calls}</p>
                  <p className="font-semibold text-foreground">{formatNumber(item?.api_calls ?? 0)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{labels.billingPage.users}</p>
                  <p className="font-semibold text-foreground">{formatNumber(item?.active_users ?? 0)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{labels.billingPage.lastActive}</p>
                  <p className="font-semibold text-foreground">{lastActive}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function PlatformServicesPanel() {
  const labels = useAdminT();
  return (
    <SectionCard title={labels.billingPage.platformTitle} description={labels.billingPage.platformDescription}>
      <div className="space-y-3">
        {PLATFORM_SERVICES.map((item) => (
          <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{labels.billingPage.platformServices[item.id]}</p>
              <p className="mt-1 truncate text-left font-mono text-xs text-muted-foreground" dir="ltr">{item.route}</p>
            </div>
            <Badge variant="outline" className="w-fit text-left" dir="ltr">{item.service}</Badge>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function InvoicesPanel() {
  const labels = useAdminT();
  return (
    <SectionCard
      title={labels.billingPage.invoicesTitle}
      description={labels.billingPage.invoicesDescription}
      actions={<Badge variant="outline">{labels.billingPage.accountManaged}</Badge>}
    >
      <EmptyState
        size="compact"
        icon={Receipt}
        title={labels.billingPage.invoicesEmptyTitle}
        description={labels.billingPage.invoicesEmptyDescription(BILLING_CURRENCY)}
      />
    </SectionCard>
  );
}

export default function BillingPage() {
  const labels = useAdminT();
  const { direction } = useLocaleOrDefault();
  const { user, tenant, isHydrated, hasPermission } = useAuth();
  const tenantLookupId = tenant?.id ? '' : user?.tenant_id ?? '';
  const tenantQuery = useTenant(tenantLookupId, false);
  const currentTenant = tenant ?? tenantQuery.data ?? null;
  const effectiveTenantId = currentTenant?.id ?? user?.tenant_id ?? '';
  const usageQuery = useTenantUsage(effectiveTenantId);
  const usage = usageQuery.data;
  const fallbackTenant: Tenant | null =
    !currentTenant && user?.tenant_id
      ? {
          id: user.tenant_id,
          name: labels.billingPage.currentWorkspace,
          slug: user.tenant_id.slice(0, 8),
          domain: null,
          status: 'active',
          subscription_tier: 'enterprise',
          settings: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : null;
  const billingTenant = currentTenant ?? fallbackTenant;
  const usingSessionTenantFallback = !currentTenant && Boolean(fallbackTenant);

  const onSelectPlan = (tier: SubscriptionTier) => {
    toast.info(labels.billingPage.toastPlanRequested, {
      description: labels.billingPage.toastPlanRequestedDescription(labels.billingPage.tiers[tier]),
    });
  };

  if (!isHydrated || tenantQuery.isLoading) {
    return (
      <PermissionRedirect permission="tenant:read">
        <div className="space-y-6" dir={direction}>
          <PageHeader title={labels.billingPage.title} description={labels.billingPage.loadingDescription} />
          <LoadingSkeleton variant="kpi" count={4} />
          <LoadingSkeleton variant="card" count={3} />
        </div>
      </PermissionRedirect>
    );
  }

  if (!billingTenant) {
    return (
      <PermissionRedirect permission="tenant:read">
        <div className="space-y-6" dir={direction}>
          <PageHeader title={labels.billingPage.title} description={labels.billingPage.loadingDescription} />
          <ErrorState
            title={labels.billingPage.contextUnavailableTitle}
            message={labels.billingPage.contextUnavailableMessage}
            onRetry={() => {
              if (tenantLookupId) void tenantQuery.refetch();
            }}
          />
        </div>
      </PermissionRedirect>
    );
  }

  const settings = billingTenant.settings ?? {};
  const plan = PLAN_DEFAULTS[billingTenant.subscription_tier];
  const userLimit = settings.max_users ?? plan.seats;
  const storageLimitGb = settings.max_storage_gb ?? plan.storageGb;
  const effectiveStorageLimitBytes = storageLimitGb === null ? null : storageLimitGb * GB;
  const enabledState = enabledSuitesForTenant(billingTenant);
  const enabledSuiteCount = enabledState.suiteIds.size;
  const totalSuiteCount = PRODUCT_SERVICES.length;
  const serviceCoveragePct = Math.round((enabledSuiteCount / totalSuiteCount) * 100);
  const ownerName = user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || labels.billingPage.accountOwner;
  const usageUnavailable = !usage && !usageQuery.isLoading;
  const hasPlatformAccess = hasPermission('admin:console');

  return (
    <PermissionRedirect permission="tenant:read">
      <div className="space-y-6" dir={direction}>
        <PageHeader
          title={labels.billingPage.title}
          description={labels.billingPage.description}
          tags={[
            { label: billingTenant.name, icon: <Building2 className="h-3.5 w-3.5" aria-hidden />, tone: 'primary' },
            { label: labels.billingPage.tiers[billingTenant.subscription_tier], icon: <WalletCards className="h-3.5 w-3.5" aria-hidden />, tone: 'info' },
            { label: statusLabel(billingTenant.status, labels.billingPage), icon: <Gauge className="h-3.5 w-3.5" aria-hidden />, tone: billingTenant.status === 'active' ? 'success' : 'warning' },
          ]}
          stats={[
            { label: labels.billingPage.pageStats.suites, value: `${enabledSuiteCount}/${totalSuiteCount}` },
            { label: labels.billingPage.pageStats.seats, value: usageQuery.isLoading ? '...' : ratioText(usage?.active_users ?? 0, userLimit, labels.billingPage) },
            { label: labels.billingPage.pageStats.period, value: periodLabel(usage, labels.billingPage) },
          ]}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportUsageCsv(billingTenant, usage, enabledState.suiteIds, labels.billingPage)}
              >
                <Download className="me-1.5 h-3.5 w-3.5" />
                {labels.billingPage.exportUsage}
              </Button>
              <Button variant="outline" size="sm" onClick={() => toast.info(labels.billingPage.toastPaymentManaged)}>
                <CreditCard className="me-1.5 h-3.5 w-3.5" />
                {labels.billingPage.paymentMethods}
              </Button>
              {hasPlatformAccess ? (
                <Button asChild size="sm">
                  <Link href="/platform/licensing">
                    {labels.billingPage.licensingConsole}
                    <ArrowRight className="ms-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />

        {billingTenant.status === 'trial' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-warning-300 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/10 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-warning-600 dark:text-warning-300" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-foreground">{labels.billingPage.trialTitle}</p>
                <p className="text-sm text-muted-foreground">{labels.billingPage.trialDescription}</p>
              </div>
            </div>
            <Button size="sm" onClick={() => onSelectPlan('professional')}>{labels.billingPage.upgradeNow}</Button>
          </div>
        ) : null}

        {usingSessionTenantFallback ? (
          <div className="flex flex-col gap-3 rounded-lg border border-warning-300 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/10 sm:flex-row sm:items-center">
            <IconBadge icon={AlertTriangle} tone="warning" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{labels.billingPage.fallbackTitle}</p>
              <p className="text-sm text-muted-foreground">
                {labels.billingPage.fallbackMessage}
              </p>
            </div>
          </div>
        ) : null}

        {usageUnavailable ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
            <IconBadge icon={AlertTriangle} tone="warning" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{labels.billingPage.usagePendingTitle}</p>
              <p className="text-sm text-muted-foreground">
                {labels.billingPage.usagePendingMessage}
              </p>
            </div>
          </div>
        ) : null}

        <BillingLedger tenant={billingTenant} usage={usage} userName={ownerName} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <MetricTile
            label={labels.billingPage.metricActiveUsers}
            value={usageQuery.isLoading ? '...' : ratioText(usage?.active_users ?? 0, userLimit, labels.billingPage)}
            icon={Users}
            tone="primary"
          />
          <MetricTile
            label={labels.billingPage.metricStorageUsed}
            value={usageQuery.isLoading ? '...' : ratioText(usage?.storage_used_bytes ?? 0, effectiveStorageLimitBytes, labels.billingPage, compactBytes)}
            icon={HardDrive}
            tone="info"
          />
          <MetricTile
            label={labels.billingPage.metricApiCalls}
            value={usageQuery.isLoading ? '...' : ratioText(usage?.api_calls ?? 0, plan.apiCalls, labels.billingPage)}
            icon={Activity}
            tone="warning"
          />
          <MetricTile
            label={labels.billingPage.metricSuiteCoverage}
            value={`${serviceCoveragePct}%`}
            icon={LayoutGrid}
            tone="success"
          />
        </div>

        <SectionCard
          title={labels.billingPage.allowancesTitle}
          description={labels.billingPage.allowancesDescription}
          actions={
            <StatusBadge
              status={billingTenant.status}
              config={tenantStatusConfig}
              label={statusLabel(billingTenant.status, labels.billingPage)}
              variant="outline"
            />
          }
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <QuotaMeter label={labels.billingPage.quotaUsers} used={usage?.active_users ?? 0} limit={userLimit} />
            <QuotaMeter label={labels.billingPage.quotaStorage} used={usage?.storage_used_bytes ?? 0} limit={effectiveStorageLimitBytes} formatValue={formatBytes} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <UsageRiskCard label={labels.billingPage.riskApiCalls} icon={Workflow} used={usage?.api_calls ?? 0} limit={plan.apiCalls} />
            <UsageRiskCard label={labels.billingPage.riskBandwidth} icon={BarChart3} used={usage?.bandwidth_bytes ?? 0} limit={null} formatter={formatBytes} />
            <UsageRiskCard label={labels.billingPage.riskEnabledSuites} icon={Boxes} used={enabledSuiteCount} limit={totalSuiteCount} />
          </div>
        </SectionCard>

        <SuiteMatrix
          tenant={billingTenant}
          usage={usage}
          enabledSuiteIds={enabledState.suiteIds}
          suiteSource={enabledState.source}
        />

        <SectionCard title={labels.billingPage.plansTitle} description={labels.billingPage.plansDescription}>
          <PlanCards current={billingTenant.subscription_tier} onSelect={onSelectPlan} />
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <PlatformServicesPanel />

          <InvoicesPanel />
        </div>

        {!usageQuery.isLoading && Object.keys(usage?.suite_usage ?? {}).length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={labels.billingPage.noEventsTitle}
            description={labels.billingPage.noEventsDescription}
            size="compact"
          />
        ) : null}
      </div>
    </PermissionRedirect>
  );
}
