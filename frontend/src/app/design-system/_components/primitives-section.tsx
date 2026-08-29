'use client';

/**
 * Primitives section — every canonical building block rendered live from its
 * real implementation (nothing is re-styled here), so this page is executable
 * documentation: if a primitive changes, the catalog changes with it.
 */

import * as React from 'react';
import {
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  Gauge,
  Plus,
  Scale,
  Settings2,
  ShieldAlert,
  Undo2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  StatusBadge,
  severityMap,
  caseStatusMap,
  slaMap,
  genericStatusMap,
  type StatusToneMap,
} from '@/components/shared/status-badge';
import { StatTile } from '@/components/shared/stat-tile';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { cn } from '@/lib/utils';

import { DsSection, Specimen, SpecimenRow } from './specimen';
import { DemoDataTable } from './demo-data-table';

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

function ButtonsSpecimen() {
  return (
    <Specimen
      id="primitive-button"
      title="Button"
      description="@/components/ui/button — one import, six variants"
      code={`<Button>Primary</Button>\n<Button variant="outline" size="sm">Filter</Button>`}
    >
      <div className="flex flex-col gap-5">
        <SpecimenRow label="Variants">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </SpecimenRow>
        <SpecimenRow label="Sizes">
          <Button size="lg">Large</Button>
          <Button>Default</Button>
          <Button size="sm">Small</Button>
          <Button size="icon" aria-label="Settings">
            <Settings2 className="h-4 w-4" aria-hidden />
          </Button>
        </SpecimenRow>
        <SpecimenRow label="States">
          <Button disabled>Disabled</Button>
          <Button variant="outline">
            <Plus className="me-2 h-4 w-4" aria-hidden />
            With icon
          </Button>
        </SpecimenRow>
      </div>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges & status                                                             */
/* -------------------------------------------------------------------------- */

const DOMAIN_MAPS: ReadonlyArray<{
  label: string;
  importName: string;
  map: StatusToneMap;
}> = [
  { label: 'Severity', importName: 'severityMap', map: severityMap },
  { label: 'Case lifecycle', importName: 'caseStatusMap', map: caseStatusMap },
  { label: 'SLA health', importName: 'slaMap', map: slaMap },
  { label: 'Generic entity / run', importName: 'genericStatusMap', map: genericStatusMap },
];

function StatusBadgesSpecimen() {
  return (
    <Specimen
      id="primitive-status-badge"
      title="StatusBadge — the one badge system"
      description="@/components/shared/status-badge — pass the raw backend token; the domain map resolves tone, label and icon"
      code={`<StatusBadge status="pending_approval" map={caseStatusMap} />\n<StatusBadge status="critical" />  // built-in lookup, severity wins`}
    >
      <div className="flex flex-col gap-5">
        {DOMAIN_MAPS.map(({ label, importName, map }) => (
          <SpecimenRow key={importName} label={`${label} — ${importName}`}>
            {Object.keys(map).map((key) => (
              <StatusBadge key={key} status={key} map={map} />
            ))}
          </SpecimenRow>
        ))}
        <SpecimenRow label="Appearances & sizes">
          <StatusBadge status="breached" map={slaMap} variant="outline" />
          <StatusBadge status="running" variant="dot" />
          <StatusBadge status="critical" size="sm" />
          <StatusBadge status="critical" size="md" />
          <StatusBadge status="critical" size="lg" />
        </SpecimenRow>
        <SpecimenRow label="Generic Badge (non-status labels only)">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </SpecimenRow>
      </div>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* StatTile                                                                    */
/* -------------------------------------------------------------------------- */

function StatTilesSpecimen() {
  return (
    <Specimen
      id="primitive-stat-tile"
      title="StatTile"
      description="@/components/shared/stat-tile — the canonical KPI tile (KpiCard/StatCard/MetricTile are deprecated delegates)"
      code={`<StatTile label="Open cases" value={128} icon={Scale} tone="primary" delta={4.2} />`}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Open cases"
          value={128}
          icon={Scale}
          tone="primary"
          delta={4.2}
          helper="vs last week"
        />
        <StatTile
          label="SLA compliance"
          value={96.4}
          unit="%"
          icon={Gauge}
          tone="success"
          progress={96.4}
          progressLabel="Target 95%"
        />
        <StatTile
          label="Escalations"
          value={7}
          icon={ShieldAlert}
          tone="warning"
          delta={{ value: 2, direction: 'up', sentiment: 'bad', label: 'this week' }}
        />
        <StatTile
          label="Active reviewers"
          value={23}
          icon={Users}
          tone="info"
          detail="Across 4 suites"
          detailValue="4"
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatTile size="sm" label="Dense strip" value={1204} icon={Activity} delta={-1.8} />
        <StatTile label="Loading" loading />
        <StatTile label="Failed to load" error icon={Activity} />
      </div>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* EmptyState + Skeleton                                                       */
/* -------------------------------------------------------------------------- */

function EmptyStatesSpecimen() {
  return (
    <Specimen
      id="primitive-empty-state"
      title="EmptyState"
      description="@/components/common/empty-state — built-in illustrations + up to two actions"
      code={`<EmptyState illustration="search" title="No results" action={{ label: 'Clear filters', onClick }} />`}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border/60">
          <EmptyState
            illustration="search"
            title="No results found"
            description="Try a broader query or clear the active filters."
            action={{ label: 'Clear filters', onClick: () => toast('Filters cleared (demo)') }}
            secondaryAction={{ label: 'View all', onClick: () => toast('Showing all (demo)') }}
          />
        </div>
        <div className="rounded-xl border border-border/60">
          <EmptyState
            illustration="inbox"
            title="Inbox zero"
            description="New assignments will land here."
          />
        </div>
        <div className="rounded-xl border border-border/60">
          <EmptyState
            illustration="lock"
            size="compact"
            title="No access"
            description="Ask an admin for the lex:approval:read permission."
          />
        </div>
        <div className="rounded-xl border border-border/60">
          <EmptyState
            icon={FileSearch}
            size="compact"
            title="Compact, icon variant"
            description="For in-card and in-section empties."
          />
        </div>
      </div>
    </Specimen>
  );
}

const SKELETON_SHAPES = ['text', 'kpi', 'card', 'list', 'detail', 'form'] as const;

function SkeletonsSpecimen() {
  return (
    <Specimen
      id="primitive-skeleton"
      title="Skeleton"
      description="@/components/ui/skeleton — one shimmer language, shaped variants; reduced-motion safe"
      code={`<Skeleton className="h-4 w-24" />\n<Skeleton variant="kpi" />\n<Skeleton.Table rows={4} cols={4} />`}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SKELETON_SHAPES.map((shape) => (
          <div key={shape} className="flex flex-col gap-1.5">
            <span className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
              variant=&quot;{shape}&quot;
            </span>
            <Skeleton variant={shape} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
          Skeleton.Table rows={'{3}'} cols={'{4}'}
        </span>
        <Skeleton.Table rows={3} cols={4} />
      </div>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* Overlays                                                                    */
/* -------------------------------------------------------------------------- */

function OverlaysSpecimen() {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [destructiveOpen, setDestructiveOpen] = React.useState(false);

  return (
    <Specimen
      id="primitive-overlays"
      title="Overlay surfaces"
      description="Dialog / AlertDialog (via ConfirmDialog) / Tooltip / Popover — all on the token overlay surface"
    >
      <TooltipProvider delayDuration={200}>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog title</DialogTitle>
                <DialogDescription>
                  Standard modal for focused create/edit flows. Escape and the
                  close affordance both dismiss it; focus is trapped inside.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="ds-dialog-name">Name</Label>
                <Input id="ds-dialog-name" placeholder="e.g. Quarterly review" />
              </div>
              <DialogFooter>
                <Button onClick={() => toast.success('Saved (demo)')}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button variant="outline" onClick={() => setConfirmOpen(true)}>
            Confirm dialog
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Publish this version?"
            description="Reviewers will be notified and the draft becomes read-only."
            confirmLabel="Publish"
            onConfirm={() => {
              toast.success('Published (demo)');
            }}
          />

          <Button variant="destructive" onClick={() => setDestructiveOpen(true)}>
            Destructive + type-to-confirm
          </Button>
          <ConfirmDialog
            open={destructiveOpen}
            onOpenChange={setDestructiveOpen}
            title="Delete workspace?"
            description="This permanently removes the workspace and its history."
            confirmLabel="Delete"
            variant="destructive"
            typeToConfirm="DELETE"
            onConfirm={() => {
              toast.success('Deleted (demo)');
            }}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">Hover for tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Short, single-purpose hint text.</TooltipContent>
          </Tooltip>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <p className="text-sm font-medium text-foreground">Popover surface</p>
              <p className="mt-1 text-sm text-muted-foreground">
                For lightweight, non-blocking settings — like the saved-views
                naming form or a column picker.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </TooltipProvider>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* PageHeader                                                                  */
/* -------------------------------------------------------------------------- */

function PageHeaderSpecimen() {
  return (
    <Specimen
      id="primitive-page-header"
      title="PageHeader"
      description="@/components/common/page-header — quiet flat header: eyebrow, tags, inline stats, end-aligned actions"
      code={`<PageHeader title="Legal cases" eyebrow="Watheeq" tags={[…]} stats={[…]} actions={<Button>New case</Button>} />`}
    >
      <div className="rounded-xl border border-dashed border-border/70 p-4">
        <PageHeader
          eyebrow="Watheeq — Legal affairs"
          title="Legal cases"
          description="Track litigation, hearings and SLA posture across every entity."
          tags={[
            { label: 'Production', tone: 'success' },
            { label: '3 breached SLAs', tone: 'danger' },
            { label: 'Riyadh region', tone: 'neutral' },
          ]}
          stats={[
            { label: 'Open', value: 128 },
            { label: 'Hearings this week', value: 9 },
            { label: 'Avg. age', value: '41d' },
          ]}
          actions={
            <>
              <Button variant="outline" size="sm">
                Export
              </Button>
              <Button size="sm">
                <Plus className="me-2 h-4 w-4" aria-hidden />
                New case
              </Button>
            </>
          }
        />
      </div>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* Wizard (pattern-level demo — no shared primitive extracted yet)             */
/* -------------------------------------------------------------------------- */

const WIZARD_STEPS = [
  { id: 'details', label: 'Details' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'review', label: 'Review' },
] as const;

function WizardSpecimen() {
  const [step, setStep] = React.useState(0);
  const isLast = step === WIZARD_STEPS.length - 1;

  return (
    <Specimen
      id="primitive-wizard"
      title="Wizard / stepper"
      description="the multi-step grammar (onboarding setup, cyber rule-wizard, lex settlement-stepper) — composed here from Button + tokens; a shared primitive is still to be extracted"
    >
      <div className="mx-auto max-w-xl">
        <ol className="flex items-center gap-2" aria-label="Wizard progress">
          {WIZARD_STEPS.map((s, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <li key={s.id} className="flex flex-1 items-center gap-2">
                <span
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-fast ease-standard',
                    done && 'border-primary bg-primary text-primary-foreground',
                    current && 'border-primary bg-primary/10 text-primary',
                    !done && !current && 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </span>
                <span
                  className={cn(
                    'truncate text-xs font-medium',
                    current ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {s.label}
                </span>
                {i < WIZARD_STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      'h-px min-w-4 flex-1 transition-colors duration-fast ease-standard',
                      done ? 'bg-primary/60' : 'bg-border',
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-5">
          <p className="text-sm font-medium text-foreground">
            Step {step + 1}: {WIZARD_STEPS[step].label}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === 0 && 'Collect the minimum identity of the thing being created.'}
            {step === 1 && 'Progressive disclosure: only the options this choice needs.'}
            {step === 2 && 'A read-only summary the user explicitly commits to.'}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ChevronLeft className="me-1 h-4 w-4 rtl:rotate-180" aria-hidden />
            Back
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (isLast) {
                toast.success('Wizard finished (demo)');
                setStep(0);
              } else {
                setStep((s) => s + 1);
              }
            }}
          >
            {isLast ? 'Finish' : 'Next'}
            {!isLast && <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />}
          </Button>
        </div>
      </div>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */

function ToastsSpecimen() {
  return (
    <Specimen
      id="primitive-toasts"
      title="Toasts (sonner)"
      description="the app-wide Toaster is mounted by ToastProvider — import { toast } from 'sonner' anywhere"
      code={`toast.success('Saved');\ntoast('Deleted', { action: { label: 'Undo', onClick: restore } });`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => toast('Neutral message')}>
          Default
        </Button>
        <Button variant="outline" size="sm" onClick={() => toast.success('Change saved')}>
          Success
        </Button>
        <Button variant="outline" size="sm" onClick={() => toast.warning('Approaching SLA breach')}>
          Warning
        </Button>
        <Button variant="outline" size="sm" onClick={() => toast.error('Request failed — try again')}>
          Error
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            toast('Case archived', {
              icon: <Undo2 className="h-4 w-4" aria-hidden />,
              action: { label: 'Undo', onClick: () => toast.success('Restored') },
            })
          }
        >
          With undo action
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            toast.promise(new Promise((resolve) => setTimeout(resolve, 1400)), {
              loading: 'Publishing…',
              success: 'Published',
              error: 'Publish failed',
            })
          }
        >
          Promise lifecycle
        </Button>
      </div>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

export function PrimitivesSection() {
  return (
    <DsSection
      id="primitives"
      title="Primitives"
      description="The canonical components. Import these — never re-implement them per suite. Each specimen renders the live component from its real module path."
    >
      <ButtonsSpecimen />
      <StatusBadgesSpecimen />
      <StatTilesSpecimen />
      <EmptyStatesSpecimen />
      <SkeletonsSpecimen />
      <Specimen
        id="primitive-data-table"
        title="DataTable"
        description="@/components/shared/data-table — search, filters, sorting, selection + bulk actions, row actions, column toggle/reorder/drag-resize, persisted density, saved views"
      >
        <DemoDataTable />
      </Specimen>
      <OverlaysSpecimen />
      <PageHeaderSpecimen />
      <WizardSpecimen />
      <ToastsSpecimen />
    </DsSection>
  );
}
