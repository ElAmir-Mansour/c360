'use client';

// Pricing & Quoting console (Phase-2 deliverable): a live calculator that prices
// the 4 commercial tiers (Standard / Growth / Professional / Customized) from a
// set of client-supplied drivers. It POSTs to /api/v1/pricing/compute, debounced
// ~300ms on input change via TanStack Query.
//
// MARGIN IS INTERNAL-ONLY. The internal cost / gross profit / realized margin /
// guardrail panel is requested (?include_internal=true) AND rendered ONLY when
// the user holds pricing:admin. A pricing:read / pricing:write user never asks
// for it and never sees it. The backend also structurally masks the block, so
// this is defence in depth, not the sole control.
//
// Save-Quote is now LIVE (Phase-3b): pricing:write+ can open the Save-Quote
// dialog to persist a quote for the currently-selected tier. Export stays on the
// quote DETAIL page (a quote must exist first).
//
// Additive: new route + nav entry. The page self-gates on pricing:read via
// <PermissionRedirect> (the platform layout also gates on admin:console); a
// platform operator who lacks any pricing verb is redirected out.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Calculator, Save, ListChecks, GitCompareArrows } from 'lucide-react';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { HelpTip } from '@/components/shared/help-tip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useT } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { PricingInputs, type PricingInputState } from './_components/pricing-inputs';
import { TierComparison } from './_components/tier-comparison';
import { DealSummary } from './_components/deal-summary';
import { CostBreakdownChart } from './_components/cost-breakdown-chart';
import { MarginCockpit } from './_components/margin-cockpit';
import { PricingResultSkeleton } from './_components/pricing-skeletons';
import { SaveQuoteDialog } from './_components/save-quote-dialog';
import { SaveScenarioDialog } from './_components/save-scenario-dialog';
import { ScenarioDrawer } from './_components/scenario-drawer';
import { usePricingCompute } from './_lib/use-pricing-compute';
import { TIER_ORDER, type ComputeRequest, type PricingTier } from './_lib/types';
import { TIER_LABEL_KEY } from './_lib/quote-format';
import { RECOMMENDED_TIER } from './_lib/pricing-derive';
import {
  usePricingScenarios,
  type PricingScenario,
} from './_lib/use-pricing-scenarios';

const DEFAULT_INPUTS: PricingInputState = {
  model: 'per_user',
  deployment: 1,
  termMonths: 12,
  users: 50,
  cores: 8,
  vms: 4,
  hotStorageGb: 100,
  coldStorageGb: 500,
  salesDiscountPct: 0,
};

function PricingBody() {
  const t = useT();
  const { hasPermission, user } = useAuth();

  // RBAC verbs. read = view; write = compute + the sales-discount lever;
  // admin = the internal margin view (and, server-side, config authoring).
  const canWrite = hasPermission('pricing:write') || hasPermission('pricing:admin');
  const canSeeMargin = hasPermission('pricing:admin');

  const [inputs, setInputs] = useState<PricingInputState>(DEFAULT_INPUTS);

  // SCENARIO BUILDER (Wave C #6) — ephemeral what-if snapshots kept in
  // localStorage, scoped per-user. Never a backend quote; the captured tiers are
  // masked (no margin) inside the hook.
  const scenarios = usePricingScenarios(user?.id ?? null);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [saveScenarioOpen, setSaveScenarioOpen] = useState(false);

  // The tier the Save-Quote flow targets. Confirmed again inside the dialog; the
  // server recomputes from the active config for this selected_tier. Defaults to
  // the recommended tier so the deal-summary strip and the pre-selected quote
  // agree out of the box.
  const [selectedTier, setSelectedTier] = useState<PricingTier>(RECOMMENDED_TIER);
  const [saveOpen, setSaveOpen] = useState(false);

  // A tier card's "Quote this tier" CTA: preselect that tier and open the
  // Save-Quote dialog (write+ only — the CTA is inert for read-only viewers,
  // who never see the dialog). Reuses the EXISTING Save-Quote flow verbatim.
  const handleQuoteTier = (tier: PricingTier) => {
    setSelectedTier(tier);
    if (canWrite) setSaveOpen(true);
  };

  // Restore a scenario's captured inputs + selected tier back into the live
  // calculator (and close the drawer). Recompute happens automatically off the
  // new inputs — the persisted masked figures are only for the compare surface.
  const handleLoadScenario = (scenario: PricingScenario) => {
    setInputs(scenario.inputs);
    setSelectedTier(scenario.selectedTier);
    setScenariosOpen(false);
  };

  // A tasteful default scenario name from the current config, e.g.
  // "SaaS · 12mo · per-user". The rep can override it in the dialog.
  const suggestedScenarioName = useMemo(() => {
    const deployKey =
      inputs.deployment === 2
        ? 'platformConsole.pricing.deployOnPrem'
        : inputs.deployment === 3
          ? 'platformConsole.pricing.deployAirGapped'
          : 'platformConsole.pricing.deploySaas';
    const modelLabel =
      inputs.model === 'per_core'
        ? t('platformConsole.pricing.modelPerCore')
        : t('platformConsole.pricing.modelPerUser');
    const monthsUnit = t('platformConsole.pricing.inputs.monthsUnit');
    return `${t(deployKey)} · ${inputs.termMonths}${monthsUnit} · ${modelLabel}`;
  }, [inputs.deployment, inputs.model, inputs.termMonths, t]);

  // Debounce the whole input state ~300ms so keystrokes don't spam /compute.
  const debounced = useDebounce(inputs, 300);

  // Build the request body from the debounced state. Volume drivers are
  // model-conditional; the sales discount is a 0-1 fraction on the wire and is
  // only sent for write+ users (a read-only viewer sees list price).
  const body = useMemo<ComputeRequest>(() => {
    const base: ComputeRequest = {
      model: debounced.model,
      deployment: debounced.deployment,
      term_months: debounced.termMonths,
      hot_storage_gb: debounced.hotStorageGb,
      cold_storage_gb: debounced.coldStorageGb,
    };
    if (debounced.model === 'per_user') {
      base.users = debounced.users;
    } else {
      base.cores = debounced.cores;
      base.vms = debounced.vms;
    }
    if (canWrite && debounced.salesDiscountPct > 0) {
      base.sales_discount = debounced.salesDiscountPct / 100;
    }
    return base;
  }, [debounced, canWrite]);

  // Only ask for the internal block when the user may see margin. The server
  // masks anyway, but we never even request it otherwise.
  const includeInternal = canSeeMargin;

  // Enabled only when the term + the model's volume driver are present.
  const validVolume =
    debounced.model === 'per_user' ? debounced.users > 0 : debounced.cores > 0;
  const enabled = debounced.termMonths > 0 && validVolume;

  const { data, isLoading, isError, error, isFetching, refetch } = usePricingCompute({
    body,
    includeInternal,
    enabled,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('platformConsole.eyebrow')}
        title={t('platformConsole.pricing.title')}
        description={t('platformConsole.pricing.description')}
        tags={[
          {
            label: t('platformConsole.pricing.tag'),
            icon: <Calculator className="h-3.5 w-3.5" aria-hidden />,
            tone: 'primary',
          },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <HelpTip
              title={{ en: 'Using the calculator', ar: 'استخدام الحاسبة' }}
              content={{
                en: 'Adjust the deal drivers to price all four tiers live — results recompute as you type. Save scenarios for what-if comparisons, then save a quote for the selected tier. Internal cost and margin panels appear only for pricing admins; exports stay client-safe.',
                ar: 'عدّل مُدخلات الصفقة لتسعير المستويات الأربعة مباشرة — تُعاد الحسابات أثناء الكتابة. احفظ السيناريوهات لمقارنات «ماذا لو»، ثم احفظ عرض السعر للمستوى المحدد. لا تظهر لوحات التكلفة والهامش الداخلية إلا لمسؤولي التسعير؛ وتبقى الملفات المصدَّرة آمنة للعميل.',
              }}
            />
            {/* Scenarios drawer — client-side what-if snapshots (any pricing:read
                viewer; the surface is client-safe, no margin). */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScenariosOpen(true)}
              data-testid="open-scenarios"
            >
              <GitCompareArrows className="me-1.5 h-4 w-4" aria-hidden />
              {t('platformConsole.pricing.scenarios.button')}
              {scenarios.scenarios.length > 0 ? (
                <span className="ms-1.5 rounded-pill bg-primary/10 px-1.5 text-xs font-medium tabular-nums text-primary">
                  {scenarios.scenarios.length}
                </span>
              ) : null}
            </Button>
            {/* Quotes history — any pricing verb (gated at the nav + route too). */}
            <Button variant="outline" size="sm" asChild>
              <Link href="/platform/pricing/quotes">
                <ListChecks className="me-1.5 h-4 w-4" aria-hidden />
                {t('platformConsole.pricing.quotesTab')}
              </Link>
            </Button>
            {/* Save-Quote — pricing:write+ (LIVE). */}
            {canWrite ? (
              <Button size="sm" onClick={() => setSaveOpen(true)}>
                <Save className="me-1.5 h-4 w-4" aria-hidden />
                {t('platformConsole.pricing.saveQuote')}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-1">
          <PricingInputs value={inputs} onChange={setInputs} canDiscount={canWrite} />

          {/* Tier-select affordance: which tier the saved quote is for. */}
          {canWrite ? (
            <div className="space-y-1.5 rounded-card border border-border bg-card p-4 shadow-elevation-1">
              <Label htmlFor="pricing-quote-tier">
                {t('platformConsole.pricing.tierSelectLabel')}
              </Label>
              <Select
                value={selectedTier}
                onValueChange={(v) => setSelectedTier(v as PricingTier)}
              >
                <SelectTrigger id="pricing-quote-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_ORDER.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      {t(TIER_LABEL_KEY[tier])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('platformConsole.pricing.tierSelectHint')}
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-6 xl:col-span-2">
          {isError ? (
            <ErrorState
              error={error}
              onRetry={() => void refetch()}
              message={t('platformConsole.pricing.computeError')}
            />
          ) : !enabled ? (
            // Zero / empty state — a driver is missing (e.g. users = 0), so we
            // don't compute. Prompt the rep to fill in the volume driver.
            <Card data-testid="pricing-empty-state">
              <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                <Calculator className="h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium text-foreground">
                  {t('platformConsole.pricing.emptyTitle')}
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {t('platformConsole.pricing.emptyHint')}
                </p>
              </CardContent>
            </Card>
          ) : isLoading || !data ? (
            <PricingResultSkeleton />
          ) : (
            <>
              {/* Deal-summary strip for the highlighted (selected) tier. */}
              {(() => {
                const row =
                  data.tiers.find((r) => r.tier === selectedTier) ?? data.tiers[0];
                return row ? (
                  <DealSummary
                    row={row}
                    model={data.model}
                    users={debounced.users}
                    cores={debounced.cores}
                    currency={data.currency}
                    fetching={isFetching}
                  />
                ) : null;
              })()}

              {/* Capture the current config as a named what-if scenario. Any
                  pricing:read viewer — the snapshot is client-safe (no margin). */}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSaveScenarioOpen(true)}
                  data-testid="save-as-scenario"
                >
                  <GitCompareArrows className="me-1.5 h-4 w-4" aria-hidden />
                  {t('platformConsole.pricing.scenarios.saveAs')}
                </Button>
              </div>

              <TierComparison
                tiers={data.tiers}
                model={data.model}
                currency={data.currency}
                // The margin block on the comparison table is superseded by the
                // richer Margin Cockpit below (admin-only). Keep it off here so
                // margin renders in exactly ONE admin surface.
                showMargin={false}
                fetching={isFetching}
                termMonths={debounced.termMonths}
                users={debounced.users}
                cores={debounced.cores}
                recommendedTier={RECOMMENDED_TIER}
                onQuoteTier={handleQuoteTier}
              />

              {/* CLIENT-SAFE cost-breakdown charts — masked ClientTier fields
                  only, no margin. Rendered for every pricing:read viewer. */}
              <CostBreakdownChart
                tiers={data.tiers}
                model={data.model}
                currency={data.currency}
                fetching={isFetching}
              />

              {/* MARGIN COCKPIT — the SOLE admin-only margin surface. Gated on
                  pricing:admin (canSeeMargin). It reads the internal block
                  legitimately; a non-admin never mounts it. */}
              {canSeeMargin ? (
                <MarginCockpit
                  tiers={data.tiers}
                  currency={data.currency}
                  computeBody={body}
                  fetching={isFetching}
                  onRequestOverride={(tier) => {
                    if (tier) setSelectedTier(tier);
                    if (canWrite) setSaveOpen(true);
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Save-Quote dialog — only mounted for pricing:write+. */}
      {canWrite ? (
        <SaveQuoteDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          inputs={inputs}
          selectedTier={selectedTier}
          canDiscount={canWrite}
        />
      ) : null}

      {/* Save-as-scenario dialog — captures the live computed (masked) tiers. Only
          mountable when a compute result exists so the snapshot has figures. */}
      {data ? (
        <SaveScenarioDialog
          open={saveScenarioOpen}
          onOpenChange={setSaveScenarioOpen}
          inputs={inputs}
          selectedTier={selectedTier}
          model={data.model}
          currency={data.currency}
          pricingVersion={data.pricing_version}
          tiers={data.tiers}
          onSave={(input) => scenarios.save(input)}
          suggestedName={suggestedScenarioName}
        />
      ) : null}

      {/* Scenarios drawer — list / compare / load / rename / delete. */}
      <ScenarioDrawer
        open={scenariosOpen}
        onOpenChange={setScenariosOpen}
        scenarios={scenarios.scenarios}
        onRename={scenarios.rename}
        onRemove={scenarios.remove}
        onLoad={handleLoadScenario}
      />
    </div>
  );
}

export default function PricingPage() {
  // Self-gate on pricing:read (matched by pricing:* and *). The platform layout
  // additionally gates the whole console on admin:console.
  return (
    <PermissionRedirect permission="pricing:read">
      <PricingBody />
    </PermissionRedirect>
  );
}
