'use client';

/**
 * /ui-gallery — the UNIFIED-KIT audit / story surface.
 *
 * A single-page, at-a-glance visual-regression board that renders EVERY shared
 * primitive from the kit through its real module, so a global regression shows
 * up here before it ripples across the ~70 routes that consume these parts.
 *
 * Toolbar toggles (top): light/dark, LTR/RTL, density (compact/comfortable) and
 * a mobile/desktop preview width. Theme + direction are mirrored onto
 * <html> as well as the preview frame so PORTALED overlays (dialog / sheet /
 * dropdown / popover / tooltip / command render to document.body) stay
 * theme-correct and direction-correct when opened.
 *
 * English labels only (internal dev tool). Token-only, RTL-/dark-/AA-safe.
 */

import * as React from 'react';
import {
  Bell,
  Download,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  Moon,
  Trash2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { type Density } from '@/components/ui/ui-system';
import { DensityProvider } from '@/components/ui/use-density';

import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableActionCell,
  TableEmpty,
  TableLoadingRows,
} from '@/components/ui/table';
import { VirtualTable, type VirtualTableColumn } from '@/components/ui/virtual-table';
import { Badge } from '@/components/ui/badge';
import {
  StatusBadge,
  severityMap,
  caseStatusMap,
  slaMap,
} from '@/components/shared/status-badge';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { FeedbackState } from '@/components/shared/feedback-state';
import { LegalDirectorPrimitivesGallery } from './legal-director-primitives-gallery';
import { LegalDirectorPanelsGallery } from './legal-director-panels-gallery';
import { LegalDirectorDashboardGallery } from './legal-director-dashboard-gallery';
import { WorkforceTeamGallery } from './workforce-team-gallery';

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';

/* -------------------------------------------------------------------------- */
/* Toolbar primitives (local — a dev tool, not part of the kit)               */
/* -------------------------------------------------------------------------- */

type Theme = 'light' | 'dark';
type Dir = 'ltr' | 'rtl';
type Width = 'mobile' | 'desktop';

const LEGAL_DIRECTOR_GALLERY_DEV_COPY: {
  title: string;
  path: string;
  description: string;
  panelsTitle: string;
  panelsDescription: string;
  dashboardTitle: string;
  dashboardDescription: string;
  workforceTitle: string;
  workforceDescription: string;
} = {
  title: 'Watheeq Legal Director primitives',
  path: 'src/app/(dashboard)/lex/_components/role-dashboard/widgets',
  description:
    'Step 3 state matrix: loading, empty, error-with-retry, and true numeric zero. Internal development copy only.',
  panelsTitle: 'Watheeq Legal Director composed panels',
  panelsDescription:
    'Step 4 bilingual state matrix: populated, loading, empty, error-with-retry, zero, partial data, and overflow. Internal development fixtures only.',
  dashboardTitle: 'Watheeq Legal Director full-page composition',
  dashboardDescription:
    'Step 5 bilingual full-composition matrix: ready, loading, empty, error-with-retry, zero, partial data, and overflow. Internal development fixtures only.',
  workforceTitle: 'Legal Director Workforce Contract States',
  workforceDescription:
    'Typed workforce payload states in English and Arabic. Presentation-only; not wired to the production /lex landing page.',
};

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-overline uppercase text-muted-foreground">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="inline-flex items-center gap-1 rounded-soft border border-border/70 bg-card/80 p-1 shadow-elevation-1"
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-softest px-3 py-1.5 text-body-sm font-medium',
                'outline-none transition-[color,background-color,box-shadow] duration-fast ease-standard',
                'focus-visible:shadow-focus-ring',
                active
                  ? 'bg-primary text-primary-foreground shadow-elevation-1'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Section wrapper — labels every specimen block with name + source path. */
function Section({
  title,
  path,
  description,
  children,
}: {
  title: string;
  path: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Surface
      as="section"
      variant="panel"
      radius="soft-lg"
      padding="xl"
      className="scroll-mt-24"
    >
      <header className="mb-5 border-b border-border/60 pb-4">
        <h2 className="text-h4 font-semibold text-foreground">{title}</h2>
        <code className="mt-1 block text-caption text-muted-foreground">{path}</code>
        {description && (
          <p className="mt-2 max-w-2xl text-body-sm text-muted-foreground">
            {description}
          </p>
        )}
      </header>
      {children}
    </Surface>
  );
}

/** Sub-group inside a section with a small caption label. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="text-caption font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sample data                                                                */
/* -------------------------------------------------------------------------- */

interface DemoRow {
  id: string;
  name: string;
  owner: string;
  status: string;
  updated: string;
}

const DEMO_ROWS: DemoRow[] = [
  { id: 'c-1042', name: 'Master services agreement', owner: 'A. Othaim', status: 'open', updated: '2h ago' },
  { id: 'c-1043', name: 'NDA — vendor onboarding', owner: 'L. Haddad', status: 'pending_approval', updated: '5h ago' },
  { id: 'c-1044', name: 'SOW — data migration', owner: 'R. Nasser', status: 'approved', updated: '1d ago' },
  { id: 'c-1045', name: 'DPA amendment', owner: 'M. Faris', status: 'rejected', updated: '2d ago' },
  { id: 'c-1046', name: 'License renewal', owner: 'S. Qadir', status: 'resolved', updated: '3d ago' },
];

const VIRTUAL_ROWS: DemoRow[] = Array.from({ length: 200 }, (_, i) => ({
  id: `v-${1000 + i}`,
  name: `Matter record #${1000 + i}`,
  owner: ['A. Othaim', 'L. Haddad', 'R. Nasser', 'M. Faris'][i % 4],
  status: ['open', 'pending_approval', 'approved', 'resolved', 'rejected'][i % 5],
  updated: `${(i % 12) + 1}d ago`,
}));

const VIRTUAL_COLUMNS: VirtualTableColumn<DemoRow>[] = [
  { key: 'id', header: 'ID', width: '120px' },
  { key: 'name', header: 'Name', width: 'minmax(0, 2fr)' },
  { key: 'owner', header: 'Owner', width: 'minmax(0, 1fr)' },
  {
    key: 'status',
    header: 'Status',
    width: '180px',
    render: (row) => <StatusBadge status={row.status} map={caseStatusMap} size="sm" />,
  },
  { key: 'updated', header: 'Updated', width: '120px', align: 'right' },
];

const BADGE_VARIANTS = [
  'default',
  'secondary',
  'success',
  'warning',
  'destructive',
  'info',
  'neutral',
  'outline',
] as const;

const STATUS_TONE_SAMPLES: { status: string; map?: typeof severityMap }[] = [
  { status: 'critical', map: severityMap },
  { status: 'high', map: severityMap },
  { status: 'warning', map: severityMap },
  { status: 'low', map: severityMap },
  { status: 'open', map: caseStatusMap },
  { status: 'pending_approval', map: caseStatusMap },
  { status: 'approved', map: caseStatusMap },
  { status: 'resolved', map: caseStatusMap },
  { status: 'breached', map: slaMap },
  { status: 'on_track', map: slaMap },
];

/* -------------------------------------------------------------------------- */
/* Field demo — a single labelled control                                     */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="w-full max-w-xs space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-caption text-status-error">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overlays demo — kept in its own component so the CommandDialog state is     */
/* colocated.                                                                  */
/* -------------------------------------------------------------------------- */

function OverlaysDemo() {
  const [cmdOpen, setCmdOpen] = React.useState(false);
  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-3">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm publish</DialogTitle>
              <DialogDescription>
                This publishes the workflow to every tenant. Shared overlay chrome
                (bg / border / radius / elevation-3) via OVERLAY_SURFACE.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button variant="cta">Publish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>
                Edge-anchored panel sharing the same overlay surface, squared off.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <Field label="Search">
                <Input withIcon="leading" placeholder="Find a matter" />
              </Field>
            </div>
          </SheetContent>
        </Sheet>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              Dropdown
              <MoreHorizontal className="ms-2 h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Pencil className="me-2 h-4 w-4" aria-hidden /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Download className="me-2 h-4 w-4" aria-hidden /> Export
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-status-error">
              <Trash2 className="me-2 h-4 w-4" aria-hidden /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <div className="space-y-2">
              <p className="text-body-sm font-medium text-foreground">Quick note</p>
              <p className="text-caption text-muted-foreground">
                Floating panel on the shared overlay surface, side-aware slide.
              </p>
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">Hover for tooltip</Button>
          </TooltipTrigger>
          <TooltipContent>Shared overlay surface, tighter radius</TooltipContent>
        </Tooltip>

        <Button variant="outline" onClick={() => setCmdOpen(true)}>
          <Search className="me-2 h-4 w-4" aria-hidden /> Command palette
        </Button>
        <CommandDialog
          open={cmdOpen}
          onOpenChange={setCmdOpen}
          title="Command palette"
          description="Type a command or search the gallery"
        >
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Navigation">
              <CommandItem>
                <Settings className="me-2 h-4 w-4" aria-hidden /> Settings
              </CommandItem>
              <CommandItem>
                <Bell className="me-2 h-4 w-4" aria-hidden /> Notifications
              </CommandItem>
              <CommandItem>
                <Mail className="me-2 h-4 w-4" aria-hidden /> Inbox
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function UiGalleryPage() {
  const [theme, setTheme] = React.useState<Theme>('light');
  const [dir, setDir] = React.useState<Dir>('ltr');
  const [density, setDensity] = React.useState<Density>('comfortable');
  const [width, setWidth] = React.useState<Width>('desktop');

  // Mirror theme + direction onto <html> so portaled overlays (which render to
  // document.body, OUTSIDE the preview frame) stay theme-/direction-correct.
  // Snapshot + restore so leaving the page does not leak state into the app.
  React.useEffect(() => {
    const root = document.documentElement;
    const prevDark = root.classList.contains('dark');
    const prevDir = root.getAttribute('dir');
    root.classList.toggle('dark', theme === 'dark');
    root.setAttribute('dir', dir);
    return () => {
      root.classList.toggle('dark', prevDark);
      if (prevDir) root.setAttribute('dir', prevDir);
      else root.removeAttribute('dir');
    };
  }, [theme, dir]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Toolbar — outside the preview frame; not itself flipped/themed. */}
      <div className="sticky top-0 z-30 border-b border-border/70 bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-6 px-6 py-4">
          <div className="me-auto">
            <h1 className="text-h3 font-semibold text-foreground">UI Kit Gallery</h1>
            <p className="text-caption text-muted-foreground">
              src/app/(dev)/ui-gallery/page.tsx — visual-regression surface
            </p>
          </div>
          <Segmented<Theme>
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" aria-hidden /> },
              { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" aria-hidden /> },
            ]}
          />
          <Segmented<Dir>
            label="Direction"
            value={dir}
            onChange={setDir}
            options={[
              { value: 'ltr', label: 'LTR' },
              { value: 'rtl', label: 'RTL' },
            ]}
          />
          <Segmented<Density>
            label="Density"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
          <Segmented<Width>
            label="Frame"
            value={width}
            onChange={setWidth}
            options={[
              { value: 'desktop', label: 'Desktop' },
              { value: 'mobile', label: 'Mobile' },
            ]}
          />
        </div>
      </div>

      {/* Preview frame — carries the theme class, direction and width constraint. */}
      <div className="px-4 py-8">
        <div
          className={cn(
            'mx-auto transition-[max-width] duration-normal ease-standard',
            theme === 'dark' && 'dark',
            width === 'mobile' ? 'max-w-sm' : 'max-w-6xl',
          )}
          dir={dir}
        >
          <div className="rounded-softest border border-border bg-background p-4 shadow-elevation-2 sm:p-6">
            <DensityProvider density={density}>
              <div className="space-y-8">
                {/* ----------------------- Watheeq Legal Director primitives */}
                <Section
                  title={LEGAL_DIRECTOR_GALLERY_DEV_COPY.title}
                  path={LEGAL_DIRECTOR_GALLERY_DEV_COPY.path}
                  description={LEGAL_DIRECTOR_GALLERY_DEV_COPY.description}
                >
                  <LegalDirectorPrimitivesGallery />
                </Section>

                <Section
                  title={LEGAL_DIRECTOR_GALLERY_DEV_COPY.panelsTitle}
                  path={LEGAL_DIRECTOR_GALLERY_DEV_COPY.path}
                  description={LEGAL_DIRECTOR_GALLERY_DEV_COPY.panelsDescription}
                >
                  <LegalDirectorPanelsGallery />
                </Section>

                <Section
                  title={LEGAL_DIRECTOR_GALLERY_DEV_COPY.dashboardTitle}
                  path="src/app/(dashboard)/lex/_components/role-dashboard/legal-director-dashboard-view.tsx"
                  description={LEGAL_DIRECTOR_GALLERY_DEV_COPY.dashboardDescription}
                >
                  <LegalDirectorDashboardGallery />
                </Section>

                <Section
                  title={LEGAL_DIRECTOR_GALLERY_DEV_COPY.workforceTitle}
                  path="src/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-team-panel.tsx"
                  description={LEGAL_DIRECTOR_GALLERY_DEV_COPY.workforceDescription}
                >
                  <WorkforceTeamGallery />
                </Section>

                {/* -------------------------------------------------- Buttons */}
                <Section
                  title="Buttons"
                  path="src/components/ui/button.tsx"
                  description="'default' is now a calm solid primary; the strong gradient/glow moved to the opt-in 'cta' variant. Density reshapes only the 'default' size."
                >
                  <div className="space-y-5">
                    <Row label="Variants">
                      <Button variant="default">Default</Button>
                      <Button variant="cta">CTA</Button>
                      <Button variant="secondary">Secondary</Button>
                      <Button variant="outline">Outline</Button>
                      <Button variant="ghost">Ghost</Button>
                      <Button variant="destructive">Destructive</Button>
                      <Button variant="link">Link</Button>
                    </Row>
                    <Row label="Sizes">
                      <Button size="sm">Small</Button>
                      <Button size="default">Default</Button>
                      <Button size="lg">Large</Button>
                      <Button size="icon" aria-label="Add">
                        <Plus className="h-4 w-4" aria-hidden />
                      </Button>
                    </Row>
                    <Row label="Loading / disabled">
                      <Button loading>Saving</Button>
                      <Button variant="cta" loading>
                        Publishing
                      </Button>
                      <Button disabled>Disabled</Button>
                      <Button variant="outline" disabled>
                        Disabled
                      </Button>
                    </Row>
                    <Row label="Density (explicit override)">
                      <Button density="comfortable">Comfortable</Button>
                      <Button density="compact">Compact</Button>
                    </Row>
                    <Row label="With leading icon">
                      <Button>
                        <Download className="me-2 h-4 w-4" aria-hidden /> Export
                      </Button>
                      <Button variant="outline">
                        <Plus className="me-2 h-4 w-4" aria-hidden /> New
                      </Button>
                    </Row>
                  </div>
                </Section>

                {/* --------------------------------------------- Surfaces */}
                <Section
                  title="Surfaces & Cards"
                  path="src/components/ui/surface.tsx · src/components/ui/card.tsx"
                  description="One elevation/radius/background system. <Surface variant='card'> === the .card class used by <Card>."
                >
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Surface variant="card" padding="lg">
                      <p className="text-body-sm font-medium text-foreground">
                        Surface — card
                      </p>
                      <p className="mt-1 text-caption text-muted-foreground">
                        Default resting surface.
                      </p>
                    </Surface>
                    <Surface variant="panel" padding="lg">
                      <p className="text-body-sm font-medium text-foreground">
                        Surface — panel
                      </p>
                      <p className="mt-1 text-caption text-muted-foreground">
                        Frosted section shell.
                      </p>
                    </Surface>
                    <Surface variant="stat" padding="lg">
                      <p className="text-caption uppercase text-muted-foreground">
                        Open matters
                      </p>
                      <p className="mt-1 text-display font-semibold text-foreground">
                        128
                      </p>
                    </Surface>
                    <Surface variant="glass" padding="lg" blur="sm">
                      <p className="text-body-sm font-medium text-foreground">
                        Surface — glass
                      </p>
                    </Surface>
                    <Surface variant="raised" padding="lg">
                      <p className="text-body-sm font-medium text-foreground">
                        Surface — raised
                      </p>
                    </Surface>
                    <Surface variant="card" padding="lg" interactive tabIndex={0}>
                      <p className="text-body-sm font-medium text-foreground">
                        Interactive surface
                      </p>
                      <p className="mt-1 text-caption text-muted-foreground">
                        Hover lift + focus ring.
                      </p>
                    </Surface>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Card</CardTitle>
                        <CardDescription>
                          Header / content / footer composition.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-body-sm text-muted-foreground">
                          The materialized .card class — same tokens as the card
                          surface preset.
                        </p>
                      </CardContent>
                      <CardFooter className="gap-2">
                        <Button size="sm" variant="outline">
                          Cancel
                        </Button>
                        <Button size="sm">Save</Button>
                      </CardFooter>
                    </Card>
                    <Card interactive tabIndex={0}>
                      <CardHeader>
                        <CardTitle>Interactive card</CardTitle>
                        <CardDescription>
                          Hover lift + focus-visible ring.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-body-sm text-muted-foreground">
                          Opt-in via the `interactive` prop.
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </Section>

                {/* --------------------------------------------- Form controls */}
                <Section
                  title="Form controls"
                  path="src/components/ui/input.tsx · textarea.tsx · select.tsx"
                  description="Shared controlBase chrome: focus ring, aria-invalid status styling, density, RTL-safe icon padding."
                >
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Default">
                      <Input placeholder="Enter a value" />
                    </Field>
                    <Field label="With leading icon">
                      <div className="relative">
                        <Search
                          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                        <Input withIcon="leading" placeholder="Search…" />
                      </div>
                    </Field>
                    <Field label="Invalid" hint="This field is required.">
                      <Input aria-invalid placeholder="Invalid value" defaultValue="—" />
                    </Field>
                    <Field label="Disabled">
                      <Input disabled placeholder="Disabled" />
                    </Field>
                    <Field label="Select">
                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose owner" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="a">A. Othaim</SelectItem>
                          <SelectItem value="l">L. Haddad</SelectItem>
                          <SelectItem value="r">R. Nasser</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Select (invalid)">
                      <Select>
                        <SelectTrigger aria-invalid>
                          <SelectValue placeholder="Required" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="a">Option A</SelectItem>
                          <SelectItem value="b">Option B</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Textarea">
                      <Textarea placeholder="Multi-line notes…" />
                    </Field>
                    <Field label="Textarea (invalid)">
                      <Textarea aria-invalid defaultValue="Too short" />
                    </Field>
                    <Field label="Textarea (disabled)">
                      <Textarea disabled placeholder="Disabled" />
                    </Field>
                  </div>
                </Section>

                {/* --------------------------------------------- Tables */}
                <Section
                  title="Tables"
                  path="src/components/ui/table.tsx"
                  description="Sticky header, calm hover, selected accent, empty + loading rows, hover-reveal row actions. Follows the ambient density."
                >
                  <Surface variant="card" radius="soft" className="overflow-hidden">
                    <div className="max-h-80 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>ID</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-end">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {DEMO_ROWS.map((r, i) => (
                            <TableRow
                              key={r.id}
                              aria-selected={i === 1 ? true : undefined}
                              data-state={i === 1 ? 'selected' : undefined}
                            >
                              <TableCell className="font-mono text-caption">
                                {r.id}
                              </TableCell>
                              <TableCell className="font-medium">{r.name}</TableCell>
                              <TableCell>{r.owner}</TableCell>
                              <TableCell>
                                <StatusBadge
                                  status={r.status}
                                  map={caseStatusMap}
                                  size="sm"
                                />
                              </TableCell>
                              <TableActionCell>
                                <Button size="icon" variant="ghost" aria-label="Edit">
                                  <Pencil className="h-4 w-4" aria-hidden />
                                </Button>
                                <Button size="icon" variant="ghost" aria-label="Delete">
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                </Button>
                              </TableActionCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Surface>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                      <span className="text-caption font-medium text-muted-foreground">
                        Loading rows
                      </span>
                      <Surface variant="card" radius="soft" className="mt-2 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Owner</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableLoadingRows rows={4} cols={3} />
                          </TableBody>
                        </Table>
                      </Surface>
                    </div>
                    <div>
                      <span className="text-caption font-medium text-muted-foreground">
                        Empty state
                      </span>
                      <Surface variant="card" radius="soft" className="mt-2 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Owner</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableEmpty
                              colSpan={3}
                              illustration="search"
                              title="No matters found"
                              description="Try adjusting your filters."
                            />
                          </TableBody>
                        </Table>
                      </Surface>
                    </div>
                  </div>

                  <div className="mt-4">
                    <span className="text-caption font-medium text-muted-foreground">
                      VirtualTable — src/components/ui/virtual-table.tsx (200 rows)
                    </span>
                    <div className="mt-2">
                      <VirtualTable<DemoRow>
                        columns={VIRTUAL_COLUMNS}
                        data={VIRTUAL_ROWS}
                        maxHeight={280}
                        getRowKey={(row) => row.id}
                        isRowSelected={(_, i) => i === 2}
                        ariaLabel="Matter records"
                      />
                    </div>
                  </div>
                </Section>

                {/* --------------------------------------------- Badges + status */}
                <Section
                  title="Badges & Status"
                  path="src/components/ui/badge.tsx · src/components/shared/status-badge.tsx"
                  description="StatusBadge is the canonical status primitive — tone always pairs with an icon + label (never colour alone). StatusPill (ui/status-pill.tsx) is DEPRECATED; use StatusBadge."
                >
                  <div className="space-y-5">
                    <Row label="Badge variants">
                      {BADGE_VARIANTS.map((v) => (
                        <Badge key={v} variant={v}>
                          {v}
                        </Badge>
                      ))}
                    </Row>
                    <Row label="Badge sizes">
                      <Badge size="sm">Small</Badge>
                      <Badge size="md">Medium</Badge>
                      <Badge size="lg">Large</Badge>
                    </Row>
                    <Row label="StatusBadge — tones (icon + label)">
                      {STATUS_TONE_SAMPLES.map((s) => (
                        <StatusBadge key={s.status} status={s.status} map={s.map} />
                      ))}
                    </Row>
                    <Row label="StatusBadge — sizes">
                      <StatusBadge status="critical" map={severityMap} size="sm" />
                      <StatusBadge status="critical" map={severityMap} size="md" />
                      <StatusBadge status="critical" map={severityMap} size="lg" />
                    </Row>
                    <Row label="StatusBadge — appearances">
                      <StatusBadge status="approved" map={caseStatusMap} variant="default" />
                      <StatusBadge status="approved" map={caseStatusMap} variant="outline" />
                      <StatusBadge status="approved" map={caseStatusMap} variant="dot" />
                    </Row>
                    <Row label="StatusPill (deprecated adapter)">
                      <StatusPill status="running" />
                      <StatusPill status="passed" />
                      <StatusPill status="failed" />
                      <StatusPill status="degraded" />
                    </Row>
                  </div>
                </Section>

                {/* --------------------------------------------- Tabs */}
                <Section
                  title="Tabs"
                  path="src/components/ui/tabs.tsx"
                  description="'solid' (DEFAULT) is a quiet raised chip for dashboard filters; 'nav' is the opt-in strong gradient/glow for major navigation."
                >
                  <div className="space-y-6">
                    <div>
                      <span className="text-caption font-medium text-muted-foreground">
                        variant=&quot;solid&quot; (default, quiet)
                      </span>
                      <Tabs defaultValue="all" className="mt-2">
                        <TabsList variant="solid">
                          <TabsTrigger value="all">All</TabsTrigger>
                          <TabsTrigger value="open">Open</TabsTrigger>
                          <TabsTrigger value="closed">Closed</TabsTrigger>
                        </TabsList>
                        <TabsContent value="all">
                          <p className="text-body-sm text-muted-foreground">
                            Calm active chip — no gradient, no glow.
                          </p>
                        </TabsContent>
                        <TabsContent value="open">
                          <p className="text-body-sm text-muted-foreground">Open items.</p>
                        </TabsContent>
                        <TabsContent value="closed">
                          <p className="text-body-sm text-muted-foreground">Closed items.</p>
                        </TabsContent>
                      </Tabs>
                    </div>
                    <div>
                      <span className="text-caption font-medium text-muted-foreground">
                        variant=&quot;nav&quot; (opt-in, strong)
                      </span>
                      <Tabs defaultValue="overview" className="mt-2">
                        <TabsList variant="nav">
                          <TabsTrigger value="overview">Overview</TabsTrigger>
                          <TabsTrigger value="activity">Activity</TabsTrigger>
                          <TabsTrigger value="settings">Settings</TabsTrigger>
                        </TabsList>
                        <TabsContent value="overview">
                          <p className="text-body-sm text-muted-foreground">
                            Bold active state with gradient + glow.
                          </p>
                        </TabsContent>
                        <TabsContent value="activity">
                          <p className="text-body-sm text-muted-foreground">Activity feed.</p>
                        </TabsContent>
                        <TabsContent value="settings">
                          <p className="text-body-sm text-muted-foreground">Settings.</p>
                        </TabsContent>
                      </Tabs>
                    </div>
                  </div>
                </Section>

                {/* --------------------------------------------- Overlays */}
                <Section
                  title="Overlays"
                  path="dialog · sheet · dropdown-menu · popover · tooltip · command"
                  description="All share OVERLAY_SURFACE / OVERLAY_BACKDROP / OVERLAY_CLOSE. Open them to verify the floating chrome is theme- and direction-correct (portals mirror <html>)."
                >
                  <OverlaysDemo />
                </Section>

                {/* --------------------------------------------- Feedback states */}
                <Section
                  title="Feedback states"
                  path="src/components/shared/feedback-state.tsx · src/components/ui/skeleton.tsx"
                  description="One scaffold for loading / success / warning / error / info / empty (icon + title + description, correct ARIA role). Plus the skeleton shimmer family."
                >
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {(['loading', 'success', 'warning', 'error', 'info', 'empty'] as const).map(
                      (tone) => (
                        <Surface key={tone} variant="card" radius="soft">
                          <FeedbackState
                            size="compact"
                            tone={tone}
                            title={`${tone[0].toUpperCase()}${tone.slice(1)} state`}
                            description={`FeedbackState tone="${tone}".`}
                          />
                        </Surface>
                      ),
                    )}
                  </div>

                  <div className="mt-5 space-y-4">
                    <span className="text-caption font-medium text-muted-foreground">
                      Skeleton shapes
                    </span>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Skeleton variant="kpi" />
                      <Skeleton variant="chart" />
                    </div>
                    <Skeleton variant="text" />
                    <div className="flex flex-wrap items-center gap-3">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-10 w-32 rounded-soft" />
                    </div>
                    <Skeleton variant="table" rows={3} cols={4} />
                  </div>
                </Section>
              </div>
            </DensityProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
