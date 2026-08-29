"use client";

import type { ComponentType } from "react";
import { useCallback, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  BarChart3,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Gauge,
  History,
  LayoutGrid,
  Plus,
  RefreshCw,
  Rows3,
  Rows4,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table as TableIcon,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { LexRouteGuard } from "../_guards/lex-route-guard";
import { StatusBadge } from "@/components/shared/status-badge";
import { DataTable } from "@/components/shared/data-table/data-table";
import { selectColumn } from "@/components/shared/data-table/columns/common-columns";
import {
  EMPTY_SELECTION_SCOPE,
  type SelectionScope,
} from "@/components/shared/data-table/selection-scope";
import { BoardView, type BoardColumn } from "@/components/shared/board-view";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { SavedViewsBar } from "@/components/shared/saved-views-bar";
import { SearchInput } from "@/components/shared/forms/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Surface } from "@/components/ui/surface";
import { IconBadge } from "@/components/shared/icon-badge";
import { useDataTable } from "@/hooks/use-data-table";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/components/providers/locale-provider";
import { canAccessWith, LEX_ROUTE_PERMISSIONS } from "@/lib/permissions";
import { useLexFormat } from "@/lib/lex/ksa";
import { API_ENDPOINTS } from "@/lib/constants";
import { fetchSuitePaginated } from "@/lib/suite-api";
import { enterpriseApi } from "@/lib/enterprise";
import { downloadBlob } from "@/lib/format";
import { showApiError, showSuccess, showError } from "@/lib/toast";
import { contractStatusConfig } from "@/lib/status-configs";
import { cn } from "@/lib/utils";
import type { LexContract, LexContractStatus } from "@/types/suites";
import type { BulkAction, RowAction } from "@/types/table";
import { ContractBoardCard } from "./_components/contract-board-card";
import { BulkStatusDialog } from "./_components/bulk-status-dialog";
import { ContractPreviewDrawer } from "./_components/contract-preview-drawer";
import { ContractRiskCell } from "./_components/contract-risk-cell";
import {
  ContractRenewalCell,
  RenewalWarningsBanner,
} from "./_components/renewal-warnings-banner";
import { ContractsCalendarView } from "./_components/contracts-calendar-view";
import { ContractsAnalyticsView } from "./_components/contracts-analytics-view";
import { ContractMoneyKpis } from "./_components/contract-money-kpis";
import { ContractKpiTile } from "./_components/contracts-kpi-tile";
import {
  ContractSignatureCell,
  PendingSignatureKpi,
  useContractSignatureCellLabels,
  useSignatureReminderRowAction,
} from "./_components/contract-signature-cell";
import {
  ContractPlaybookCell,
  PlaybookThresholdChip,
  useContractPlaybookCellLabels,
  usePlaybookDeviationsBulkAction,
} from "./_components/contract-playbook-cell";
import {
  ContractObligationsCell,
  useContractObligationsCellLabels,
} from "./_components/contract-obligations-cell";
import {
  ObligationsCommandCenter,
  ObligationsKpiTile,
} from "./_components/obligations-command-center";
import { BulkAiActionsDialog } from "./_components/bulk-ai-actions";
import {
  SendForReviewDialog,
  useSendForReviewLabels,
} from "./_components/send-for-review-action";
import {
  ContractAuditDrawer,
  contractAuditDrawerLabels,
} from "./_components/contract-audit-drawer";
import { ContractAuditExportButton } from "./_components/contract-audit-export-button";
import { RenewalDecisionQueue } from "./_components/renewal-decision-queue";
import {
  ContractsEntityRollupPanel,
  ContractsPortfolioTcvFooter,
  useEntityRollupLabels,
} from "./_components/contracts-entity-rollup";
import { contractWorkspaceHref } from "./_lib/contract-workspace-route";
import {
  ContractInsightFeed,
  type ContractInsightViewMatchingRequest,
} from "./_components/contract-insight-feed";
import {
  ContractSearchModeToggle,
  ContractTextSearchPanel,
  useContractTextSearchLabels,
} from "./_components/contract-text-search";
import {
  contractRiskLabels,
  contractTypeLabels,
  useContractTypeLabels,
  useContractsListLabels,
} from "./_lib/contracts-labels";
import { useContractsControlLabels } from "./control/_lib/labels";
import {
  CONTRACT_BOARD_COLUMN_COLOR,
  CONTRACT_BOARD_COLUMN_ORDER,
  isAllowedContractTransition,
} from "./_lib/contracts-board";
import {
  CONTRACT_PRESETS,
  buildPresetFilters,
  matchActivePreset,
} from "./_lib/contracts-presets";
import {
  CONTRACTS_ALL_VIEW,
  CONTRACTS_DEFAULT_SORT,
  isContractViewActive,
  type ContractViewSpec,
} from "./_lib/contract-view-specs";
import { useContractsViewPrefs } from "./_lib/use-contracts-view-prefs";
import { useSignatureSummaries } from "./_lib/use-signature-summaries";
import { useBulkAi } from "./_lib/use-bulk-ai";
import {
  filterBelowPlaybookThreshold,
  usePlaybookScores,
} from "./_lib/use-playbook-scores";
import { useOrgEntityOptions } from "./_lib/use-entity-rollup";
import {
  type ContractSearchMode,
  useContractTextSearch,
} from "./_lib/use-contract-text-search";
import {
  contractsReportFilename,
  csvBlobWithBom,
  useServerExportLabels,
} from "./_lib/export-utils";
import { lexContractStatusLabels, resolveLexBilingual } from "../_lib/lex-i18n";

const CONTRACT_STATUS_VALUES = [
  "draft",
  "internal_review",
  "legal_review",
  "negotiation",
  "pending_signature",
  "active",
  "suspended",
  "expired",
  "terminated",
  "renewed",
  "cancelled",
] as const;

const CONTRACT_TYPE_VALUES = [
  "service_agreement",
  "nda",
  "employment",
  "vendor",
  "license",
  "lease",
  "partnership",
  "consulting",
  "procurement",
  "sla",
  "mou",
  "amendment",
  "renewal",
  "other",
] as const;

const CONTRACT_RISK_VALUES = [
  "critical",
  "high",
  "medium",
  "low",
  "none",
] as const;

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

/**
 * Page-local bilingual strings not covered by the shared contracts label bundle
 * (new UX chrome: density toggle, calendar view, extra filters, row actions, and
 * the analyze/export toasts). Resolved through the existing `resolveTokenRecord`
 * idiom against the active locale.
 */
interface ContractExtras {
  pageEyebrow: string;
  portfolio: { eyebrow: string; title: string; description: string };
  density: { label: string; comfortable: string; compact: string };
  view: { calendar: string; analytics: string };
  columns: { risk: string; renewal: string };
  filters: { department: string; tag: string; myContracts: string };
  advancedFilters: { label: string; hint: string; activeSuffix: string };
  rowActions: {
    view: string;
    changeStatus: string;
    preview: string;
    analyze: string;
    renew: string;
  };
  presets: { label: string };
  toast: {
    analyzing: string;
    analyzed: string;
    exported: string;
    exportFailed: string;
  };
}

const localExtras: { en: ContractExtras; ar: ContractExtras } = {
  en: {
    pageEyebrow: "Legal · Contract workspace",
    portfolio: {
      eyebrow: "Portfolio intelligence",
      title: "Contracts Overview",
      description:
        "Live commercial exposure, lifecycle health, renewal pressure, and execution risk.",
    },
    density: {
      label: "Density",
      comfortable: "Comfortable",
      compact: "Compact",
    },
    view: {
      calendar: "Calendar",
      analytics: "Analytics",
    },
    columns: {
      risk: "Risk",
      renewal: "Renewal",
    },
    filters: {
      department: "Department",
      tag: "Tag",
      myContracts: "My contracts",
    },
    advancedFilters: {
      label: "Advanced filters",
      hint: "Expiry range and legal-entity breakdown",
      activeSuffix: "active",
    },
    rowActions: {
      view: "View",
      changeStatus: "Change status",
      preview: "Preview",
      analyze: "Analyze",
      renew: "Renew",
    },
    presets: {
      label: "Quick filters",
    },
    toast: {
      analyzing: "Analysis started…",
      analyzed: "Contract analysis completed.",
      exported: "Contract report exported.",
      exportFailed: "Unable to export the contract report.",
    },
  },
  ar: {
    pageEyebrow: "الشؤون القانونية · مساحة عمل العقود",
    portfolio: {
      eyebrow: "معلومات المحفظة",
      title: "نظرة عامة على العقود",
      description:
        "عرض مباشر للقيمة التجارية وصحة دورة الحياة وضغط التجديد ومخاطر التنفيذ.",
    },
    density: {
      label: "الكثافة",
      comfortable: "مريحة",
      compact: "مدمجة",
    },
    view: {
      calendar: "التقويم",
      analytics: "التحليلات",
    },
    columns: {
      risk: "المخاطر",
      renewal: "التجديد",
    },
    filters: {
      department: "الإدارة",
      tag: "الوسم",
      myContracts: "عقودي",
    },
    advancedFilters: {
      label: "عوامل التصفية المتقدمة",
      hint: "نطاق الانتهاء والتفصيل حسب الكيان القانوني",
      activeSuffix: "نشطة",
    },
    rowActions: {
      view: "عرض",
      changeStatus: "تغيير الحالة",
      preview: "معاينة",
      analyze: "تحليل",
      renew: "تجديد",
    },
    presets: {
      label: "مرشّحات سريعة",
    },
    toast: {
      analyzing: "بدأ التحليل…",
      analyzed: "اكتمل تحليل العقد.",
      exported: "تم تصدير تقرير العقود.",
      exportFailed: "تعذّر تصدير تقرير العقود.",
    },
  },
};

export default function LexContractsPage() {
  const router = useRouter();
  const { hasPermission, hasAnyPermission, user } = useAuth();
  const { locale, direction } = useLocale();
  const archiveActionLabel =
    locale === "ar" ? "أرشيف العقود" : "Contract archive";
  const complianceActionLabel =
    locale === "ar" ? "الامتثال والتجديدات" : "Compliance & renewals";
  const f = useLexFormat();
  const labels = useContractsListLabels();
  const controlLabels = useContractsControlLabels();
  const typeLabels = useContractTypeLabels();
  const extras: ContractExtras =
    locale === "ar" ? localExtras.ar : localExtras.en;
  const currentUserId = user?.id ?? "";
  // Secondary filters (expiry range + legal-entity breakdown) collapse into one
  // disclosure to keep the workspace minimal; collapsed by default so the table
  // sits high on the page. The active-count badge keeps applied filters visible.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusIds, setBulkStatusIds] = useState<string[]>([]);
  const [bulkStatusScope, setBulkStatusScope] = useState<SelectionScope | null>(
    null,
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [auditContract, setAuditContract] = useState<LexContract | null>(null);
  const [sendReviewOpen, setSendReviewOpen] = useState(false);
  const [sendReviewIds, setSendReviewIds] = useState<string[]>([]);
  const [renewalQueueOpen, setRenewalQueueOpen] = useState(false);
  const [belowPlaybookOnly, setBelowPlaybookOnly] = useState(false);
  // Select-all-matching scope from the shared DataTable (spec #8). Bumping
  // `selectionResetKey` clears BOTH the row checkboxes and the scope from
  // outside — e.g. after a bulk action completes.
  const [selectionScope, setSelectionScope] = useState<SelectionScope>(
    EMPTY_SELECTION_SCOPE,
  );
  const [selectionResetKey, setSelectionResetKey] = useState(0);
  // §9/§18.4 — "can mutate contracts" gates the create/change-status/analyze/
  // renew controls + board drag. It is satisfied by the contract add OR edit
  // verb (both held by contract operator personas), NOT coarse lex:write. A
  // super-admin `lex:*` wildcard still satisfies either via the resolver.
  const canWrite = hasAnyPermission(["lex:contract:add", "lex:contract:edit"]);
  const canViewControlPanel = canAccessWith(
    hasPermission,
    LEX_ROUTE_PERMISSIONS["/lex/contracts/control"],
  );

  // `hiddenColumns` seeds the table's column visibility; `setHiddenColumns` is
  // wired to DataTable's onHiddenColumnsChange so user column toggles persist
  // across reloads, alongside the persisted `view`/`density` prefs.
  const {
    view,
    setView,
    density,
    setDensity,
    hiddenColumns,
    setHiddenColumns,
  } = useContractsViewPrefs();

  const openAnalyticsRecords = useCallback(
    (recordFilters: Record<string, string | string[]>) => {
      const params = new URLSearchParams();
      for (const [key, raw] of Object.entries(recordFilters)) {
        const values = Array.isArray(raw) ? raw : [raw];
        for (const value of values) {
          if (value) params.append(key, value);
        }
      }
      params.set("page", "1");
      setView("table");
      router.push(`/lex/contracts?${params.toString()}`);
    },
    [router, setView],
  );

  const statusTokenLabels = useMemo(
    () => resolveTokenRecord(lexContractStatusLabels, locale),
    [locale],
  );

  // Bilingual label bundles for the new list chrome (each follows the
  // canonical LexBilingual / label-object pattern inside its own module).
  const signatureLabels = useContractSignatureCellLabels();
  const playbookLabels = useContractPlaybookCellLabels();
  const obligationsCellLabels = useContractObligationsCellLabels();
  const sendReviewLabels = useSendForReviewLabels();
  const serverExport = useServerExportLabels();
  const entityLabels = useEntityRollupLabels();
  const auditLabels = useMemo(
    () => resolveLexBilingual(contractAuditDrawerLabels, locale),
    [locale],
  );
  const { options: entityOptions } = useOrgEntityOptions();

  const contractFilters = useMemo(() => {
    const typeRecord = resolveTokenRecord(contractTypeLabels, locale);
    const riskLabels = resolveTokenRecord(contractRiskLabels, locale);
    return [
      {
        key: "status",
        label: labels.filters.status,
        type: "select" as const,
        options: CONTRACT_STATUS_VALUES.map((value) => ({
          label: statusTokenLabels[value] ?? value,
          value,
        })),
      },
      {
        key: "type",
        label: labels.filters.type,
        type: "select" as const,
        options: CONTRACT_TYPE_VALUES.map((value) => ({
          label: typeRecord[value] ?? value,
          value,
        })),
      },
      {
        key: "risk_level",
        label: labels.filters.risk,
        type: "select" as const,
        options: CONTRACT_RISK_VALUES.map((value) => ({
          label: riskLabels[value] ?? value,
          value,
        })),
      },
      {
        key: "department",
        label: extras.filters.department,
        type: "text" as const,
        placeholder: extras.filters.department,
      },
      {
        key: "tag",
        label: extras.filters.tag,
        type: "text" as const,
        placeholder: extras.filters.tag,
      },
      {
        key: "org_entity_id",
        label: entityLabels.facetLabel,
        type: "select" as const,
        options: entityOptions,
      },
    ];
  }, [
    entityLabels.facetLabel,
    entityOptions,
    extras.filters.department,
    extras.filters.tag,
    labels.filters.risk,
    labels.filters.status,
    labels.filters.type,
    locale,
    statusTokenLabels,
  ]);

  const {
    tableProps,
    totalRows,
    searchValue,
    setSearch,
    activeFilters,
    setFilter,
    replaceQuery,
    sortColumn,
    sortDirection,
    refetch,
  } = useDataTable<LexContract>({
    queryKey: "lex-contracts",
    fetchFn: (params) =>
      fetchSuitePaginated<LexContract>(API_ENDPOINTS.LEX_CONTRACTS, params),
    defaultPageSize: 25,
    defaultSort: CONTRACTS_DEFAULT_SORT,
    wsTopics: ["lex.contracts"],
  });

  const contracts = tableProps.data;

  // ONE signature-rollup fetch per visible page (keyed on the sorted id set,
  // so re-sorts of the same page reuse the cache). Cells join client-side.
  const visibleContractIds = useMemo(
    () => contracts.map((row) => row.id),
    [contracts],
  );
  const signatureSummaries = useSignatureSummaries(visibleContractIds);
  const signatureReminderAction = useSignatureReminderRowAction<LexContract>({
    getSummary: signatureSummaries.getSummary,
    canSend: hasPermission("lex:contract:edit"),
  });

  // Bulk AI actions (compliance / analyze / extract obligations / categorize).
  // The hook returns [] unless canWrite and owns its own progress toasts.
  const bulkAi = useBulkAi({
    contracts,
    canWrite,
    onCompleted: () => {
      void refetch();
      setSelectedIds([]);
      setSelectionResetKey((k) => k + 1);
    },
  });

  // Playbook portfolio scores: one shared fetch joined by contract_id, plus
  // the below-threshold client-side narrowing behind the quick-filter chip.
  const playbook = usePlaybookScores();
  const playbookBulkAction = usePlaybookDeviationsBulkAction(
    playbook.scoresById,
  );
  const belowPlaybookRows = useMemo(
    () => filterBelowPlaybookThreshold(contracts, playbook.scoresById),
    [contracts, playbook.scoresById],
  );
  const visibleRows = belowPlaybookOnly ? belowPlaybookRows : contracts;

  // #14 — contract-text (document FTS) search. 'metadata' keeps the
  // pre-existing list search untouched; 'text' swaps the search box over to
  // the debounced /documents/search query and renders the results panel. The
  // hook is disabled outside text mode so mode switches never fire requests.
  const [searchMode, setSearchMode] = useState<ContractSearchMode>("metadata");
  const [textQuery, setTextQuery] = useState("");
  const textSearch = useContractTextSearch(textQuery, {
    enabled: searchMode === "text",
  });
  const textSearchLabels = useContractTextSearchLabels();
  // Visible rows keyed by id: the panel's "in current view" join AND the
  // client-side row highlight for contracts with text hits on this page.
  const contractsById = useMemo(
    () => new Map(visibleRows.map((row) => [row.id, row])),
    [visibleRows],
  );

  // Server-accurate KPI tiles. `getContractStats` returns tenant-wide counts so
  // the tiles are not limited to the loaded page.
  const statsQuery = useQuery({
    queryKey: ["lex-contracts", "stats"],
    queryFn: () => enterpriseApi.lex.getContractStats(),
    staleTime: 60_000,
  });

  const stats = statsQuery.data;
  const statsLoading = statsQuery.isLoading;
  const contractStats = useMemo(() => {
    const byStatus = stats?.by_status ?? {};
    const byRisk = stats?.by_risk_level ?? {};
    return {
      total: totalRows,
      active: byStatus.active ?? 0,
      expiring: stats?.expiring_30_days ?? 0,
      highRisk: (byRisk.high ?? 0) + (byRisk.critical ?? 0),
    };
  }, [stats, totalRows]);
  const activeContractShare = percent(
    contractStats.active,
    contractStats.total,
  );
  const expiringContractShare = percent(
    contractStats.expiring,
    contractStats.total,
  );
  const highRiskContractShare = percent(
    contractStats.highRisk,
    contractStats.total,
  );

  const expiryFrom =
    typeof activeFilters.expiry_from === "string"
      ? activeFilters.expiry_from
      : "";
  const expiryTo =
    typeof activeFilters.expiry_to === "string" ? activeFilters.expiry_to : "";
  const activeEntityId =
    typeof activeFilters.org_entity_id === "string"
      ? activeFilters.org_entity_id
      : undefined;
  // How many of the collapsed "advanced" filters are set — surfaced as a badge
  // on the disclosure header so applied filters stay visible while collapsed.
  const advancedActiveCount =
    (expiryFrom ? 1 : 0) + (expiryTo ? 1 : 0) + (activeEntityId ? 1 : 0);

  // Every filter hand-off on this page is triggered from above the fold (the
  // renewal banner, the insight feed, the KPI tiles) while the results they
  // filter sit well below it. Without this the click reads as dead — and when
  // the preset is ALREADY applied (arriving on `?expiring_in_days=30`, which is
  // exactly what the renewal banner's CTA sets) literally nothing changes.
  const scrollToResults = useCallback(() => {
    requestAnimationFrame(() => {
      document
        .getElementById("contract-results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const applySavedView = (params: Record<string, string | string[]>) => {
    // Replace the full filter set in ONE navigation. clearFilters() + a series
    // of setFilter() calls does NOT compose (see `replaceQuery`) — the clear
    // gets undone and stale filters survive the hand-off.
    replaceQuery({ filters: params });
    scrollToResults();
  };

  // The register's ordering, part of a KPI view's identity: the count tile "Out
  // for signature" and the money tile "Value pending signature" cover the same
  // rows and differ only by sort, so both must be matched on filters AND order.
  const currentSort = useMemo(
    () => ({ column: sortColumn, direction: sortDirection }),
    [sortColumn, sortDirection],
  );

  /** Narrow the register to one slice (filters + the ordering it owns). */
  const applyContractView = (spec: ContractViewSpec) => {
    replaceQuery({
      filters: spec.filters,
      // Filter-only views restore the default ordering, so selecting one never
      // leaves a previous tile's sort behind (which would light up two tiles).
      sort: spec.sort ?? null,
    });
    scrollToResults();
  };

  /**
   * Click to select, click again to deselect: re-selecting the slice already on
   * screen clears back to the unfiltered register. A tile that renders as
   * pressed has to be un-pressable, otherwise its `aria-pressed` state lies.
   */
  const toggleContractView = (spec: ContractViewSpec) =>
    applyContractView(
      isContractViewActive(spec, activeFilters, currentSort)
        ? CONTRACTS_ALL_VIEW
        : spec,
    );

  const presetView = (presetId: string): ContractViewSpec | null => {
    const preset = CONTRACT_PRESETS.find((entry) => entry.id === presetId);
    return preset
      ? { filters: buildPresetFilters(preset, currentUserId) }
      : null;
  };

  // Presets are default-sorted views: the same filter set ranked by value (a
  // money tile) is a DIFFERENT view and must not light the chip as well.
  const sortIsDefault =
    (sortColumn ?? CONTRACTS_DEFAULT_SORT.column) ===
      CONTRACTS_DEFAULT_SORT.column &&
    sortDirection === CONTRACTS_DEFAULT_SORT.direction;

  const activePresetId = useMemo(
    () =>
      sortIsDefault ? matchActivePreset(activeFilters, currentUserId) : null,
    [activeFilters, currentUserId, sortIsDefault],
  );

  const togglePreset = (presetId: string) => {
    const view = presetView(presetId);
    if (view) toggleContractView(view);
  };

  // Hand-offs from outside the KPI grid (the renewal banner) always APPLY —
  // "triage renewals" must land on the expiring slice, never toggle it away.
  const applyPreset = (presetId: string) => {
    const view = presetView(presetId);
    if (view) applyContractView(view);
  };

  const applyExpiringPreset = () => applyPreset("expiring_30d");

  // Insight-feed "View matching" hand-off: apply the server-faithful filter
  // mapping when one exists (replace-the-full-filter-set semantics, same as
  // applySavedView); otherwise fall back to opening the top matching contract.
  const applyInsightFilter = ({
    mapping,
    contractIds,
  }: ContractInsightViewMatchingRequest) => {
    if (mapping) {
      replaceQuery({
        filters: mapping.filters,
        // Always reset search so a stale query never compounds the filter.
        search: mapping.search ?? null,
      });
      scrollToResults();
      return;
    }
    if (contractIds.length > 0) {
      const match = contracts.find(
        (contract) => contract.id === contractIds[0],
      );
      router.push(
        match
          ? contractWorkspaceHref(match)
          : `/lex/contracts/${contractIds[0]}`,
      );
    }
  };

  const exportContracts = (rows: LexContract[]) => {
    const header = [
      labels.columns.contract,
      labels.filters.type,
      labels.columns.parties,
      labels.columns.status,
      labels.columns.value,
      labels.columns.expiry,
    ];
    const lines = rows.map((row) => [
      row.title,
      typeLabels[row.type] ?? row.type,
      [row.party_a_name, row.party_b_name].filter(Boolean).join(" / "),
      statusTokenLabels[row.status] ?? row.status,
      row.total_value != null
        ? f.formatCurrency(row.total_value, { currency: row.currency ?? "SAR" })
        : labels.undisclosed,
      row.expiry_date ? f.formatDate(row.expiry_date) : labels.noExpiry,
    ]);
    // UTF-8 BOM so Excel decodes the Arabic columns correctly (no mojibake).
    downloadBlob(csvBlobWithBom([header, ...lines]), "contracts.csv");
    showSuccess(labels.bulk.exported(rows.length));
  };

  // Header export: server-rendered CSV report over the FULL filtered set (not just
  // the loaded page). Falls back gracefully if the binding is unavailable.
  const exportFilteredReport = async () => {
    const asString = (key: string): string | undefined => {
      const value = activeFilters[key];
      return typeof value === "string" && value !== "" ? value : undefined;
    };
    const enumerated = new Set([
      "status",
      "type",
      "risk_level",
      "search",
      "expiry_from",
      "expiry_to",
      "owner_user_id",
      "department",
      "tag",
      "expiring_in_days",
    ]);
    const passthrough: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(activeFilters)) {
      if (!enumerated.has(key) && value !== undefined && value !== "") {
        passthrough[key] = value;
      }
    }
    const expiringRaw = asString("expiring_in_days");
    try {
      const blob = await enterpriseApi.lex.exportContractsReport({
        status: asString("status") as LexContractStatus | undefined,
        type: asString("type") as never,
        risk_level: asString("risk_level") as never,
        search: searchValue || undefined,
        expiry_from: asString("expiry_from"),
        expiry_to: asString("expiry_to"),
        owner_user_id: asString("owner_user_id"),
        department: asString("department"),
        tag: asString("tag"),
        expiring_in_days: expiringRaw ? Number(expiringRaw) : undefined,
        filters: Object.keys(passthrough).length > 0 ? passthrough : undefined,
      });
      downloadBlob(blob, contractsReportFilename());
      showSuccess(extras.toast.exported);
    } catch (error) {
      showApiError(error);
    }
  };

  const moveContractStatus = async (
    contractId: string,
    nextStatus: LexContractStatus,
  ) => {
    const current = contracts.find((row) => row.id === contractId);
    if (current && !isAllowedContractTransition(current.status, nextStatus)) {
      showError(labels.moveError);
      return;
    }
    setIsMoving(true);
    try {
      await enterpriseApi.lex.updateContractStatus(contractId, {
        status: nextStatus,
      });
      showSuccess(labels.bulk.statusUpdated(1));
      refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setIsMoving(false);
    }
  };

  const analyzeContract = async (contractId: string) => {
    showSuccess(extras.toast.analyzing);
    try {
      await enterpriseApi.lex.analyzeContract(contractId);
      showSuccess(extras.toast.analyzed);
      refetch();
    } catch (error) {
      showApiError(error);
    }
  };

  // `scope` is passed ONLY from the bulk toolbar while an all-matching claim
  // is live; the per-row action always addresses the single explicit id so a
  // background scope can never widen a row-level status change.
  const openBulkStatus = (ids: string[], scope?: SelectionScope) => {
    if (ids.length === 0 && scope?.mode !== "all-matching") return;
    setBulkStatusIds(ids);
    setBulkStatusScope(scope ?? null);
    setBulkStatusOpen(true);
  };

  const onBulkStatusApplied = () => {
    void refetch();
    setSelectedIds([]);
    setBulkStatusIds([]);
    setBulkStatusScope(null);
    // Clears the table checkboxes AND collapses the selection scope.
    setSelectionResetKey((k) => k + 1);
  };

  const openSendForReview = (ids: string[]) => {
    if (ids.length === 0) return;
    setSendReviewIds(ids);
    setSendReviewOpen(true);
  };

  const bulkActions: BulkAction[] = useMemo(() => {
    const actions: BulkAction[] = [
      {
        label: labels.bulk.exportSelected,
        icon: Download,
        onClick: async (ids) => {
          const selected = contracts.filter((row) => ids.includes(row.id));
          exportContracts(selected);
        },
      },
      // Hardened server-side report over the FULL filtered set (BOM + tenant
      // watermark + PDPL redaction applied in-Kingdom). Read tier — ungated,
      // consistent with the exportSelected entry above.
      {
        label: serverExport.serverExport,
        icon: ShieldCheck,
        onClick: async () => {
          await exportFilteredReport();
        },
      },
      // Read-tier clause-deviation CSV export — deliberately OUTSIDE the
      // canWrite gate so read-only personas keep it.
      playbookBulkAction,
    ];
    if (canWrite) {
      actions.push({
        label: labels.bulk.changeStatus,
        icon: RefreshCw,
        onClick: async (ids) => {
          // Hand the live all-matching scope to the dialog; a plain page
          // selection keeps the historical ids-only path.
          openBulkStatus(
            ids,
            selectionScope.mode === "all-matching" ? selectionScope : undefined,
          );
        },
      });
      actions.push({
        label: sendReviewLabels.actionBulk,
        icon: Send,
        onClick: async (ids) => {
          openSendForReview(ids);
        },
      });
      actions.push(...bulkAi.actions);
    }
    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canWrite,
    labels,
    contracts,
    selectionScope,
    serverExport,
    playbookBulkAction,
    sendReviewLabels,
    bulkAi.actions,
  ]);

  const rowActions: RowAction<LexContract>[] = useMemo(() => {
    const actions: RowAction<LexContract>[] = [
      {
        label: extras.rowActions.view,
        icon: Eye,
        onClick: (row) => router.push(contractWorkspaceHref(row)),
      },
      {
        label: extras.rowActions.preview,
        icon: FileText,
        onClick: (row) => setPreviewId(row.id),
      },
      // Read-tier audit/history drawer — available to every persona that can
      // see the list (GET timeline sits on lex:contract:view), so NOT gated.
      {
        label: auditLabels.title,
        icon: History,
        onClick: (row) => setAuditContract(row),
      },
    ];
    if (canWrite) {
      actions.push(
        {
          label: extras.rowActions.changeStatus,
          icon: RefreshCw,
          onClick: (row) => openBulkStatus([row.id]),
        },
        {
          label: extras.rowActions.analyze,
          icon: Sparkles,
          onClick: (row) => void analyzeContract(row.id),
        },
        {
          label: sendReviewLabels.actionRow,
          icon: Send,
          onClick: (row) => openSendForReview([row.id]),
          disabled: (row) => Boolean(row.workflow_instance_id),
        },
        {
          label: extras.rowActions.renew,
          icon: CalendarClock,
          onClick: (row) => router.push(contractWorkspaceHref(row)),
        },
        // Self-hiding: rendered only when the row's rollup has a live envelope
        // AND the persona holds lex:contract:edit (mutation never shown to a
        // persona that cannot perform it).
        signatureReminderAction,
      );
    }
    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canWrite,
    extras,
    router,
    auditLabels,
    sendReviewLabels,
    signatureReminderAction,
  ]);

  const boardColumns: BoardColumn[] = useMemo(
    () =>
      CONTRACT_BOARD_COLUMN_ORDER.map((status) => ({
        id: status,
        label: statusTokenLabels[status] ?? status,
        colorClass: CONTRACT_BOARD_COLUMN_COLOR[status],
      })),
    [statusTokenLabels],
  );

  const columns: ColumnDef<LexContract>[] = [
    // Selection checkbox column — required for the row checkboxes to render so
    // the multi-select bulk actions (export selected / change status) are
    // reachable. `enableSelection` alone only toggles TanStack selection state.
    selectColumn<LexContract>(),
    {
      id: "title",
      accessorKey: "title",
      header: labels.columns.contract,
      enableSorting: true,
      cell: ({ row }) => (
        <div
          className={cn(
            // #14 — client-side highlight for rows whose linked documents hit
            // the active contract-text search (symmetric spacing → RTL-safe).
            searchMode === "text" &&
              textSearch.matchedContractIds.has(row.original.id) &&
              "-mx-1.5 rounded-md bg-yellow-50 px-1.5 py-0.5 ring-1 ring-yellow-300/60 dark:bg-yellow-900/20 dark:ring-yellow-700/50",
          )}
        >
          <Link
            href={contractWorkspaceHref(row.original)}
            className="font-medium hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {typeLabels[row.original.type] ??
              row.original.type.replace(/_/g, " ")}
          </p>
        </div>
      ),
    },
    {
      id: "parties",
      header: labels.columns.parties,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {[row.original.party_a_name, row.original.party_b_name]
            .filter(Boolean)
            .join("، ") || labels.noParties}
        </span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: labels.columns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={contractStatusConfig}
          size="sm"
        />
      ),
    },
    {
      // Client-side join over the page's single rollup fetch — no server sort key.
      id: "signature",
      header: signatureLabels.columnHeader,
      cell: ({ row }) => (
        <ContractSignatureCell
          summary={signatureSummaries.getSummary(row.original.id)}
          loading={signatureSummaries.isLoading}
        />
      ),
    },
    {
      id: "risk_score",
      accessorKey: "risk_score",
      header: extras.columns.risk,
      enableSorting: true,
      cell: ({ row }) => (
        <ContractRiskCell
          riskLevel={row.original.risk_level}
          riskScore={row.original.risk_score}
        />
      ),
    },
    {
      // Client-side join against the playbook portfolio snapshot.
      id: "playbook",
      header: playbookLabels.columnHeader,
      cell: ({ row }) => {
        const portfolioRow = playbook.getRow(row.original.id);
        return (
          <ContractPlaybookCell
            score={portfolioRow?.compliance_score ?? null}
            playbookName={portfolioRow?.playbook_name}
            loading={playbook.isLoading}
          />
        );
      },
    },
    {
      id: "total_value",
      accessorKey: "total_value",
      header: labels.columns.value,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm font-medium tabular-nums text-foreground/90">
          {row.original.total_value != null
            ? f.formatCurrency(row.original.total_value, {
                currency: row.original.currency ?? "SAR",
              })
            : labels.undisclosed}
        </span>
      ),
    },
    {
      id: "renewal",
      header: extras.columns.renewal,
      cell: ({ row }) => (
        <ContractRenewalCell
          renewalDate={row.original.renewal_date}
          autoRenew={row.original.auto_renew}
          noticeDays={row.original.renewal_notice_days}
        />
      ),
    },
    {
      // Shares the tenant-wide obligations rollup fetch with the KPI + panel.
      id: "obligations",
      header: obligationsCellLabels.column,
      cell: ({ row }) => (
        <ContractObligationsCell contractId={row.original.id} />
      ),
    },
    {
      id: "expiry_date",
      accessorKey: "expiry_date",
      header: labels.columns.expiry,
      enableSorting: true,
      cell: ({ row }) =>
        row.original.expiry_date ? (
          <div className="leading-tight">
            <span className="text-sm text-foreground">
              {f.formatDate(row.original.expiry_date)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {f.formatRelative(row.original.expiry_date)}
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {labels.noExpiry}
          </span>
        ),
    },
  ];

  return (
    <LexRouteGuard route="/lex/contracts">
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          eyebrow={extras.pageEyebrow}
          title={labels.pageTitle}
          description={labels.pageDescription}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canViewControlPanel ? (
                <Button variant="outline" asChild>
                  <Link href="/lex/contracts/control">
                    <Gauge className="me-1.5 h-4 w-4" aria-hidden />
                    {controlLabels.page.navShort}
                  </Link>
                </Button>
              ) : null}
              <Button variant="outline" asChild>
                <Link href="/lex/contracts/archived">
                  <Archive className="me-1.5 h-4 w-4" aria-hidden />
                  {archiveActionLabel}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/lex/contracts/compliance">
                  <ShieldCheck className="me-1.5 h-4 w-4" aria-hidden />
                  {complianceActionLabel}
                </Link>
              </Button>
              {/* Read-tier audit-trail CSV export over the live filter set. */}
              <ContractAuditExportButton
                activeFilters={activeFilters}
                search={searchValue}
              />
              {canWrite ? (
                <Button asChild>
                  <Link href="/lex/contracts/new">
                    <Plus className="me-1.5 h-4 w-4" />
                    {labels.createContract}
                  </Link>
                </Button>
              ) : null}
            </div>
          }
        />

        <RenewalWarningsBanner
          onTriage={applyExpiringPreset}
          onOpenQueue={canWrite ? () => setRenewalQueueOpen(true) : undefined}
        />

        <ContractInsightFeed onViewMatching={applyInsightFilter} />

        <Surface
          as="section"
          variant="card"
          radius="softest"
          elevation={1}
          padding="lg"
          aria-labelledby="contract-portfolio-heading"
          className="contracts-portfolio-overview relative space-y-5 overflow-hidden border-border/70 bg-card"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-brand-accent-500"
          />
          <div className="relative flex items-start gap-3">
            <IconBadge icon={BarChart3} tone="primary" size="lg" />
            <div className="min-w-0 space-y-1">
              <p className="text-overline font-semibold uppercase tracking-caps text-primary">
                {extras.portfolio.eyebrow}
              </p>
              <h2
                id="contract-portfolio-heading"
                className="text-h3 font-semibold tracking-tight text-foreground"
              >
                {extras.portfolio.title}
              </h2>
              <p className="max-w-3xl text-body-sm text-muted-foreground">
                {extras.portfolio.description}
              </p>
            </div>
          </div>

          <div className="relative grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5">
            <KpiTile
              title={labels.stats.total}
              value={contractStats.total}
              tone="teal"
              icon={FileText}
              progress={contractStats.total > 0 ? 100 : 0}
              progressLabel={labels.statDetails.portfolioShare}
              detail={labels.statDetails.matchingFilters}
              detailValue={f.formatNumber(contractStats.total)}
              loading={
                statsLoading && tableProps.isLoading && contracts.length === 0
              }
              active={isContractViewActive(
                CONTRACTS_ALL_VIEW,
                activeFilters,
                currentSort,
              )}
              onClick={() => applyContractView(CONTRACTS_ALL_VIEW)}
            />
            <KpiTile
              title={labels.stats.active}
              value={contractStats.active}
              tone="emerald"
              icon={CheckCircle2}
              progress={activeContractShare}
              progressLabel={labels.statDetails.activeShare}
              detail={labels.stats.active}
              detailValue={`${f.formatNumber(activeContractShare)}%`}
              loading={statsLoading}
              active={activePresetId === "active"}
              onClick={() => togglePreset("active")}
            />
            <KpiTile
              title={labels.stats.expiring}
              value={contractStats.expiring}
              tone="gold"
              icon={CalendarClock}
              progress={expiringContractShare}
              progressLabel={labels.statDetails.renewalShare}
              detail={labels.statDetails.renewalWindow}
              detailValue={`${f.formatNumber(expiringContractShare)}%`}
              loading={statsLoading}
              active={activePresetId === "expiring_30d"}
              onClick={() => togglePreset("expiring_30d")}
            />
            <KpiTile
              title={labels.stats.highRisk}
              value={contractStats.highRisk}
              tone="rose"
              icon={ShieldAlert}
              progress={highRiskContractShare}
              progressLabel={labels.statDetails.riskShare}
              detail={labels.filters.risk}
              detailValue={`${f.formatNumber(highRiskContractShare)}%`}
              loading={statsLoading}
              active={activePresetId === "high_risk"}
              onClick={() => togglePreset("high_risk")}
            />
            {/* Tenant-wide envelopes out with signers; footer = stuck on this page. */}
            <PendingSignatureKpi
              stuckOnPage={signatureSummaries.counts.stuck}
              active={activePresetId === "for_signature"}
              onClick={() => togglePreset("for_signature")}
            />
            {/* Obligations due in 7 days over the visible rows; overdue footer. */}
            <ObligationsKpiTile contracts={contracts} />

            {/* Money metrics share this grid so all ten cards form two balanced
                rows on wide screens. Self-fetching; they toggle the register
                through the same view model as the count tiles above. */}
            <ContractMoneyKpis
              embedded
              onSelectView={toggleContractView}
              activeFilters={activeFilters}
              sort={currentSort}
            />
          </div>
        </Surface>

        <Surface
          variant="card"
          radius="softer"
          padding="sm"
          className="flex flex-wrap items-center gap-2 border-brand-accent/12 bg-gradient-to-r from-brand-accent/[0.06] via-card to-brand-gold/[0.04]"
          role="group"
          aria-label={extras.presets.label}
        >
          {CONTRACT_PRESETS.map((preset) => {
            const Icon = preset.icon;
            const presetLabel =
              locale === "ar" ? preset.labels.ar : preset.labels.en;
            const isActive = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => togglePreset(preset.id)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "border-brand-accent/45 bg-brand-accent/12 text-primary"
                    : "border-border bg-muted/40 text-muted-foreground hover:border-brand-accent/25 hover:text-foreground",
                )}
              >
                {Icon ? (
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isActive && "text-brand-accent",
                    )}
                    aria-hidden
                  />
                ) : null}
                {presetLabel}
              </button>
            );
          })}
          {/* Client-side narrowing to rows below the playbook-compliance threshold. */}
          <PlaybookThresholdChip
            active={belowPlaybookOnly}
            onToggle={() => setBelowPlaybookOnly((v) => !v)}
            count={belowPlaybookRows.length}
          />
        </Surface>

        {playbook.truncated ? (
          <p className="text-xs text-muted-foreground">
            {playbookLabels.truncatedNotice}
          </p>
        ) : null}

        <Surface
          variant="card"
          radius="softer"
          padding="sm"
          className="flex flex-wrap items-center justify-between gap-3 border-brand-accent/12 bg-card/80"
        >
          <SavedViewsBar
            namespace="lex-contracts"
            persistence={{ mode: "server", namespace: "lex-contracts" }}
            activeFilters={activeFilters}
            onApply={applySavedView}
            labels={{
              save: labels.savedViews.save,
              saved: labels.savedViews.saved,
              empty: labels.savedViews.empty,
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex items-center gap-0.5 rounded-lg border border-brand-accent/15 bg-muted/50 p-0.5"
              role="group"
              aria-label={extras.density.label}
            >
              <ViewToggle
                active={density === "comfortable"}
                onClick={() => setDensity("comfortable")}
                icon={Rows3}
                label={extras.density.comfortable}
              />
              <ViewToggle
                active={density === "compact"}
                onClick={() => setDensity("compact")}
                icon={Rows4}
                label={extras.density.compact}
              />
            </div>
            <div
              className="inline-flex items-center gap-0.5 rounded-lg border border-brand-accent/15 bg-muted/50 p-0.5"
              role="group"
              aria-label={labels.view.label}
            >
              <ViewToggle
                active={view === "table"}
                onClick={() => setView("table")}
                icon={TableIcon}
                label={labels.view.table}
              />
              <ViewToggle
                active={view === "board"}
                onClick={() => setView("board")}
                icon={LayoutGrid}
                label={labels.view.board}
              />
              <ViewToggle
                active={view === "calendar"}
                onClick={() => setView("calendar")}
                icon={CalendarDays}
                label={extras.view.calendar}
              />
              <ViewToggle
                active={view === "analytics"}
                onClick={() => setView("analytics")}
                icon={BarChart3}
                label={extras.view.analytics}
              />
            </div>
          </div>
        </Surface>

        {/* Secondary filters (expiry range + per-entity breakdown) fold into one
            collapsible section to keep the workspace minimal. Collapsed by
            default so the table sits high; the active-count badge keeps applied
            filters visible, and expanding reveals both panels unchanged. */}
        <Surface
          variant="card"
          radius="softer"
          padding="sm"
          className="space-y-3 border-border/80 bg-card/80"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdvancedOpen((open) => !open)}
              aria-expanded={advancedOpen}
              aria-controls="lex-contracts-advanced-filters"
              className="-m-1 h-auto gap-2 p-1 text-sm font-medium text-foreground hover:bg-transparent hover:text-primary"
            >
              <SlidersHorizontal
                className="h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <span>{extras.advancedFilters.label}</span>
              {advancedActiveCount > 0 ? (
                <Badge
                  variant="secondary"
                  className="tracking-normal normal-case"
                >
                  {f.formatNumber(advancedActiveCount)}{" "}
                  {extras.advancedFilters.activeSuffix}
                </Badge>
              ) : null}
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-fast",
                  advancedOpen && "rotate-180",
                )}
                aria-hidden
              />
            </Button>
            {!advancedOpen ? (
              <span className="text-xs text-muted-foreground">
                {extras.advancedFilters.hint}
              </span>
            ) : null}
          </div>

          {advancedOpen ? (
            <div id="lex-contracts-advanced-filters" className="space-y-3">
              <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
                <div className="space-y-1">
                  <Label
                    htmlFor="expiry-from"
                    className="text-xs text-muted-foreground"
                  >
                    {labels.filters.expiryFrom}
                  </Label>
                  <Input
                    id="expiry-from"
                    type="date"
                    value={expiryFrom}
                    onChange={(e) =>
                      setFilter("expiry_from", e.target.value || undefined)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="expiry-to"
                    className="text-xs text-muted-foreground"
                  >
                    {labels.filters.expiryTo}
                  </Label>
                  <Input
                    id="expiry-to"
                    type="date"
                    value={expiryTo}
                    onChange={(e) =>
                      setFilter("expiry_to", e.target.value || undefined)
                    }
                  />
                </div>
              </div>

              {/* Per-entity subtotals mirroring the live scope; click-to-filter via
                  the org_entity_id facet. Read-only — no canWrite gate. */}
              <ContractsEntityRollupPanel
                filters={activeFilters}
                search={searchValue || undefined}
                activeEntityId={activeEntityId}
                onSelectEntity={(id) => setFilter("org_entity_id", id)}
              />
            </div>
          ) : null}
        </Surface>

        {/* Main view + obligations command-center rail. Grid column order
            follows document direction, so the rail is start-side-correct under
            RTL; below xl it stacks under the active view. */}
        <div
          id="contract-results"
          className="grid scroll-mt-24 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]"
        >
          <div className="min-w-0 space-y-4">
            {view === "table" ? (
              <>
                {/* #14 — text-mode results render as a panel under the toolbar,
                    above the table. Metadata mode renders nothing extra. */}
                {searchMode === "text" ? (
                  <ContractTextSearchPanel
                    result={textSearch}
                    contractsById={contractsById}
                  />
                ) : null}
                <DataTable
                  {...tableProps}
                  data={visibleRows}
                  columns={columns}
                  filters={contractFilters}
                  enableSelection
                  getRowId={(row) => row.id}
                  onSelectionChange={setSelectedIds}
                  bulkActions={bulkActions}
                  rowActions={rowActions}
                  onRowClick={(row) => setPreviewId(row.id)}
                  compact={density === "compact"}
                  enableColumnToggle
                  defaultHiddenColumns={hiddenColumns}
                  onHiddenColumnsChange={setHiddenColumns}
                  enableExport
                  onExport={() => void exportFilteredReport()}
                  // Select-all-matching is suppressed while the playbook chip
                  // narrows rows client-side — an all-matching claim must never
                  // target rows the server query would include but the user
                  // cannot see.
                  selectAllMatching={belowPlaybookOnly ? undefined : {}}
                  onSelectionScopeChange={setSelectionScope}
                  selectionResetKey={selectionResetKey}
                  searchSlot={
                    // #14 — mode toggle beside the search box. Metadata mode
                    // renders the EXACT pre-existing SearchInput (unchanged
                    // props → zero regression); text mode swaps the input to
                    // the debounced document-FTS query.
                    <div className="flex flex-wrap items-center gap-2">
                      {searchMode === "metadata" ? (
                        <SearchInput
                          value={searchValue}
                          onChange={setSearch}
                          placeholder={labels.searchPlaceholder}
                          loading={tableProps.isLoading}
                        />
                      ) : (
                        <SearchInput
                          value={textQuery}
                          onChange={setTextQuery}
                          placeholder={textSearchLabels.placeholder}
                          loading={textSearch.isSearching}
                          // The hook owns the 400ms debounce — keep the input
                          // itself immediate so the windows do not stack.
                          debounceMs={0}
                        />
                      )}
                      <ContractSearchModeToggle
                        mode={searchMode}
                        onModeChange={setSearchMode}
                      />
                    </div>
                  }
                  emptyState={{
                    icon: FileText,
                    title: labels.emptyTitle,
                    description: labels.emptyDescription,
                  }}
                />
                <ContractsPortfolioTcvFooter
                  filters={activeFilters}
                  search={searchValue || undefined}
                />
              </>
            ) : view === "calendar" ? (
              <ContractsCalendarView
                contracts={visibleRows}
                onSelect={(id) => setPreviewId(id)}
              />
            ) : view === "analytics" ? (
              <ContractsAnalyticsView
                filters={activeFilters}
                onOpenRecords={openAnalyticsRecords}
              />
            ) : (
              <div className={cn("space-y-4")}>
                {/* #14 — same mode toggle + panel on the board view; metadata
                    mode keeps the original SearchInput props unchanged. */}
                <div className="flex flex-wrap items-center gap-2">
                  {searchMode === "metadata" ? (
                    <SearchInput
                      value={searchValue}
                      onChange={setSearch}
                      placeholder={labels.searchPlaceholder}
                      loading={tableProps.isLoading}
                      className="sm:max-w-sm"
                    />
                  ) : (
                    <SearchInput
                      value={textQuery}
                      onChange={setTextQuery}
                      placeholder={textSearchLabels.placeholder}
                      loading={textSearch.isSearching}
                      className="sm:max-w-sm"
                      debounceMs={0}
                    />
                  )}
                  <ContractSearchModeToggle
                    mode={searchMode}
                    onModeChange={setSearchMode}
                  />
                </div>
                {searchMode === "text" ? (
                  <ContractTextSearchPanel
                    result={textSearch}
                    contractsById={contractsById}
                  />
                ) : null}
                {tableProps.isLoading && contracts.length === 0 ? (
                  <div className="flex gap-4 overflow-x-auto pb-2">
                    {boardColumns.slice(0, 5).map((column) => (
                      <div
                        key={column.id}
                        className="w-72 shrink-0 space-y-3 rounded-xl border border-border bg-card/40 p-3"
                      >
                        <div
                          className={cn(
                            "h-1.5 w-full rounded-full",
                            column.colorClass ?? "bg-primary/40",
                          )}
                          aria-hidden
                        />
                        <LoadingSkeleton
                          variant="list"
                          count={3}
                          label={labels.searchPlaceholder}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <BoardView<LexContract>
                    columns={boardColumns}
                    items={visibleRows}
                    getItemId={(item) => item.id}
                    getItemColumnId={(item) => item.status}
                    isMoving={isMoving}
                    dir={direction}
                    emptyColumnLabel={labels.board.emptyColumn}
                    onMove={
                      canWrite
                        ? (itemId, toColumnId) =>
                            void moveContractStatus(
                              itemId,
                              toColumnId as LexContractStatus,
                            )
                        : undefined
                    }
                    renderCard={(item) => (
                      <ContractBoardCard
                        contract={item}
                        labels={{
                          noParties: labels.noParties,
                          noValue: labels.board.noValue,
                          noExpiry: labels.noExpiry,
                          typeLabel:
                            typeLabels[item.type] ??
                            item.type.replace(/_/g, " "),
                        }}
                      />
                    )}
                  />
                )}
              </div>
            )}
          </div>
          <ObligationsCommandCenter
            contracts={contracts}
            onSelectContract={(id) => setPreviewId(id)}
            className="xl:sticky xl:top-4"
          />
        </div>

        <BulkStatusDialog
          open={bulkStatusOpen}
          onOpenChange={(open) => {
            setBulkStatusOpen(open);
            if (!open) {
              setBulkStatusIds([]);
              setBulkStatusScope(null);
            }
          }}
          contracts={contracts}
          selectedIds={bulkStatusIds}
          scope={bulkStatusScope ?? undefined}
          onApplied={onBulkStatusApplied}
        />

        {/* Partial-failure summary for the bulk AI runs (self-toasting hook). */}
        <BulkAiActionsDialog
          summary={bulkAi.summary}
          open={bulkAi.dialogOpen}
          onOpenChange={bulkAi.setDialogOpen}
        />

        <SendForReviewDialog
          open={sendReviewOpen}
          onOpenChange={(open) => {
            setSendReviewOpen(open);
            // Clear ids only on close — the summary phase still reads them.
            if (!open) setSendReviewIds([]);
          }}
          contracts={contracts}
          selectedIds={sendReviewIds}
          onDone={() => {
            void refetch();
            setSelectedIds([]);
            setSelectionResetKey((k) => k + 1);
          }}
        />

        <RenewalDecisionQueue
          open={renewalQueueOpen}
          onOpenChange={setRenewalQueueOpen}
          canWrite={canWrite}
          onApplied={() => {
            void refetch();
          }}
        />

        <ContractAuditDrawer
          contractId={auditContract?.id ?? null}
          contractTitle={auditContract?.title ?? null}
          open={auditContract !== null}
          onOpenChange={(open) => {
            if (!open) setAuditContract(null);
          }}
        />

        <ContractPreviewDrawer
          contractId={previewId}
          open={previewId !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewId(null);
          }}
        />
      </div>
    </LexRouteGuard>
  );
}

function KpiTile({
  active,
  onClick,
  tone,
  ...props
}: {
  title: string;
  value: number;
  tone: "teal" | "emerald" | "gold" | "rose";
  icon: LucideIcon;
  loading?: boolean;
  active?: boolean;
  onClick: () => void;
  progress?: number;
  progressLabel?: string;
  detail?: string;
  detailValue?: string | number;
}) {
  return (
    <ContractKpiTile
      {...props}
      theme={tone}
      active={active}
      onClick={onClick}
    />
  );
}

function ViewToggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-brand-accent/15 text-primary shadow-sm ring-1 ring-inset ring-brand-accent/25"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon
        className={cn("h-3.5 w-3.5 shrink-0", active && "text-brand-accent")}
        aria-hidden
      />
      {label}
    </button>
  );
}

function resolveTokenRecord(
  bundle: { en: Record<string, string>; ar: Record<string, string> },
  locale: string,
): Record<string, string> {
  return locale === "ar" ? bundle.ar : bundle.en;
}
