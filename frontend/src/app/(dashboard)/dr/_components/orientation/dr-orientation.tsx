'use client';

/**
 * ClarioDR orientation landing — the "map, not a metrics wall" band that sits
 * ABOVE the live operations dashboard on `/dr`.
 *
 * New users arriving at ClarioDR previously hit a live operations console that
 * assumed product knowledge. This band gives them a mental model first:
 *   - A hero that names the product and states the Protect → Recover → Rehearse →
 *     Prove → Readiness lifecycle in one line.
 *   - A lifecycle row: one feature card per stage with a one-line "what it does"
 *     and a deep link into the matching `/dr/*` route.
 *   - A capabilities grid: one card per real ClarioDR capability (replication /
 *     data-mover, runbooks, failover, RTO/RPO SLOs, recovery asset registry,
 *     drills, attestation ledger, ransomware cleanroom, integrations, BYOK), each
 *     deep-linking to where that capability is operated.
 *
 * Returning operators still get the full live dashboard immediately below; this
 * band is read-and-route only (no data fetching). Bilingual (English + MSA) and
 * RTL-safe — copy is resolved against the active locale via the DR bilingual
 * contract (`resolveDRBilingual`, English fallback), and every chevron/affordance
 * uses logical (`start`/`end`, `rtl:`) classes so the Arabic surface mirrors.
 */

import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  DatabaseZap,
  FileCheck2,
  Gauge,
  KeyRound,
  type LucideIcon,
  Map as MapIcon,
  Network,
  Plug,
  Server,
  Shield,
  ShieldCheck,
  Siren,
  Sparkles,
  Timer,
} from 'lucide-react';

import { SectionCard } from '@/components/suites/section-card';
import { SectionGrid } from '@/components/layout/section-grid';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';

import { useDRPosture } from '../../_hooks/use-dr-queries';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';

/** A single routable orientation tile (lifecycle stage or capability). */
interface OrientationTile {
  id: string;
  /** Sequence chip shown for lifecycle stages (e.g. "1"). Omitted for capabilities. */
  step?: string;
  title: string;
  blurb: string;
  href: string;
  icon: LucideIcon;
}

interface OrientationCopy {
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    lifecycleChip: string;
  };
  lifecycle: {
    heading: string;
    description: string;
    tiles: OrientationTile[];
  };
  capabilities: {
    heading: string;
    description: string;
    tiles: OrientationTile[];
  };
  openCta: string;
  /**
   * Shown only while the tenant has zero protection groups: a one-line nudge so
   * deep-links into operational stages don't drop users onto empty, all-disabled
   * pages without context.
   */
  noGroupsHint: string;
}

const orientationLabels: DRBilingual<OrientationCopy> = {
  en: {
    hero: {
      eyebrow: 'ClarioDR · Disaster Recovery',
      title: 'Recover with proof, not hope',
      subtitle:
        'Sovereign replication, gated failover and regulator-ready evidence in one console. Start anywhere on the recovery lifecycle.',
      lifecycleChip: 'Protect → Recover → Rehearse → Prove → Readiness',
    },
    lifecycle: {
      heading: 'The recovery lifecycle',
      description: 'Five stages, end to end. Open any stage to see and act on it.',
      tiles: [
        {
          id: 'protect',
          step: '1',
          title: 'Protect',
          blurb: 'Replicate sites and data into protection groups with RPO/RTO objectives.',
          href: '/dr/protect',
          icon: Shield,
        },
        {
          id: 'recover',
          step: '2',
          title: 'Recover',
          blurb: 'Declare and run a gated failover, or restore instantly from a sealed point.',
          href: '/dr/recover',
          icon: Siren,
        },
        {
          id: 'rehearse',
          step: '3',
          title: 'Rehearse',
          blurb: 'Run non-disruptive drills and game-days to prove recovery before you need it.',
          href: '/dr/rehearse',
          icon: CalendarClock,
        },
        {
          id: 'prove',
          step: '4',
          title: 'Prove',
          blurb: 'Seal each recovery into a hash-chained, WORM attestation ledger for regulators.',
          href: '/dr/prove',
          icon: FileCheck2,
        },
        {
          id: 'readiness',
          step: '5',
          title: 'Readiness',
          blurb: 'Score continuity readiness and close the gaps before the next test.',
          href: '/dr/readiness',
          icon: Gauge,
        },
      ],
    },
    capabilities: {
      heading: 'What ClarioDR does',
      description: 'The capabilities behind the lifecycle. Jump straight to where each one is run.',
      tiles: [
        {
          id: 'replication',
          title: 'Replication & data mover',
          blurb: 'Continuous, sovereign replication of workloads with live RPO tracking.',
          href: '/dr/protect',
          icon: DatabaseZap,
        },
        {
          id: 'runbooks',
          title: 'Runbooks',
          blurb: 'Dependency-aware recovery runbooks (DAGs) that orchestrate every step.',
          href: '/dr/runbooks',
          icon: Server,
        },
        {
          id: 'failover',
          title: 'Gated failover',
          blurb: 'Approval-gated failover and failback with a full gate timeline.',
          href: '/dr/recover',
          icon: Siren,
        },
        {
          id: 'slo',
          title: 'RTO / RPO SLOs',
          blurb: 'Set and monitor recovery-time and recovery-point objectives per group.',
          href: '/dr/readiness',
          icon: Timer,
        },
        {
          id: 'registry',
          title: 'Recovery asset registry',
          blurb: 'Sites, consistency groups, targets and network maps in one inventory.',
          href: '/dr/topology',
          icon: Network,
        },
        {
          id: 'drills',
          title: 'Drills & game-days',
          blurb: 'Schedule, run and score non-disruptive recovery rehearsals.',
          href: '/dr/rehearse',
          icon: CalendarClock,
        },
        {
          id: 'ledger',
          title: 'Attestation ledger',
          blurb: 'Hash-chained, WORM evidence — NCA-ready and exportable to regulators.',
          href: '/dr/prove/ledger',
          icon: FileCheck2,
        },
        {
          id: 'cleanroom',
          title: 'Ransomware cleanroom',
          blurb: 'Recover into an isolated, scanned cleanroom to break the malware chain.',
          href: '/dr/recover',
          icon: ShieldCheck,
        },
        {
          id: 'integrations',
          title: 'Integrations',
          blurb: 'Connect hypervisors, storage, identity and notification systems.',
          href: '/dr/integrations',
          icon: Plug,
        },
        {
          id: 'byok',
          title: 'BYOK sovereign keys',
          blurb: 'Bring your own keys; encryption and evidence stay under your control.',
          href: '/dr/integrations',
          icon: KeyRound,
        },
      ],
    },
    openCta: 'Open',
    noGroupsHint:
      'Set up protection first — Recover, Rehearse, Prove and Readiness need a protection group before they can act.',
  },
  ar: {
    hero: {
      eyebrow: 'ClarioDR · التعافي من الكوارث',
      title: 'تعافٍ بالدليل، لا بالأمل',
      subtitle:
        'نسخ متماثل سيادي، وتجاوز فشل خاضع للموافقة، وأدلة جاهزة للجهات التنظيمية في وحدة تحكّم واحدة. ابدأ من أي مرحلة في دورة التعافي.',
      lifecycleChip: 'الحماية ← الاسترداد ← التمرين ← الإثبات ← الجاهزية',
    },
    lifecycle: {
      heading: 'دورة حياة التعافي',
      description: 'خمس مراحل من البداية إلى النهاية. افتح أي مرحلة لعرضها واتخاذ الإجراء عليها.',
      tiles: [
        {
          id: 'protect',
          step: '١',
          title: 'الحماية',
          blurb: 'انسخ المواقع والبيانات إلى مجموعات حماية بأهداف نقطة الاسترداد (RPO) وزمن الاسترداد (RTO).',
          href: '/dr/protect',
          icon: Shield,
        },
        {
          id: 'recover',
          step: '٢',
          title: 'الاسترداد',
          blurb: 'أعلِن ونفّذ تجاوز فشل خاضعًا للموافقة، أو استعِد فورًا من نقطة مختومة.',
          href: '/dr/recover',
          icon: Siren,
        },
        {
          id: 'rehearse',
          step: '٣',
          title: 'التمرين',
          blurb: 'نفّذ تمارين غير معطِّلة وأيام محاكاة لإثبات التعافي قبل الحاجة إليه.',
          href: '/dr/rehearse',
          icon: CalendarClock,
        },
        {
          id: 'prove',
          step: '٤',
          title: 'الإثبات',
          blurb: 'اختم كل عملية تعافٍ في سجل إثبات مُتسلسل التجزئة وغير قابل للتعديل للجهات التنظيمية.',
          href: '/dr/prove',
          icon: FileCheck2,
        },
        {
          id: 'readiness',
          step: '٥',
          title: 'الجاهزية',
          blurb: 'قِس جاهزية الاستمرارية وعالِج الثغرات قبل الاختبار التالي.',
          href: '/dr/readiness',
          icon: Gauge,
        },
      ],
    },
    capabilities: {
      heading: 'ماذا يفعل ClarioDR',
      description: 'القدرات الكامنة وراء دورة الحياة. انتقل مباشرة إلى حيث تُشغَّل كل قدرة.',
      tiles: [
        {
          id: 'replication',
          title: 'النسخ المتماثل وناقل البيانات',
          blurb: 'نسخ متماثل سيادي مستمر للأحمال مع تتبّع مباشر لنقطة الاسترداد (RPO).',
          href: '/dr/protect',
          icon: DatabaseZap,
        },
        {
          id: 'runbooks',
          title: 'أدلة التشغيل',
          blurb: 'أدلة تعافٍ مدركة للتبعيات (رسوم بيانية موجَّهة) تنسّق كل خطوة.',
          href: '/dr/runbooks',
          icon: Server,
        },
        {
          id: 'failover',
          title: 'تجاوز الفشل الخاضع للموافقة',
          blurb: 'تجاوز فشل واسترجاع خاضعان للموافقة مع خط زمني كامل للبوابات.',
          href: '/dr/recover',
          icon: Siren,
        },
        {
          id: 'slo',
          title: 'أهداف RTO / RPO',
          blurb: 'حدِّد وراقب أهداف زمن الاسترداد ونقطة الاسترداد لكل مجموعة.',
          href: '/dr/readiness',
          icon: Timer,
        },
        {
          id: 'registry',
          title: 'سجل أصول التعافي',
          blurb: 'المواقع ومجموعات الاتساق والأهداف وخرائط الشبكة في جرد واحد.',
          href: '/dr/topology',
          icon: Network,
        },
        {
          id: 'drills',
          title: 'التمارين وأيام المحاكاة',
          blurb: 'جدوِل ونفّذ وقيِّم تمارين التعافي غير المعطِّلة.',
          href: '/dr/rehearse',
          icon: CalendarClock,
        },
        {
          id: 'ledger',
          title: 'سجل الإثبات',
          blurb: 'أدلة مُتسلسلة التجزئة وغير قابلة للتعديل — جاهزة للهيئة الوطنية للأمن السيبراني وقابلة للتصدير للجهات التنظيمية.',
          href: '/dr/prove/ledger',
          icon: FileCheck2,
        },
        {
          id: 'cleanroom',
          title: 'غرفة نظيفة لبرامج الفدية',
          blurb: 'تعافَ داخل غرفة نظيفة معزولة ومفحوصة لقطع سلسلة البرمجيات الخبيثة.',
          href: '/dr/recover',
          icon: ShieldCheck,
        },
        {
          id: 'integrations',
          title: 'التكاملات',
          blurb: 'اربط أنظمة المحاكاة الافتراضية والتخزين والهوية والإشعارات.',
          href: '/dr/integrations',
          icon: Plug,
        },
        {
          id: 'byok',
          title: 'مفاتيح سيادية (BYOK)',
          blurb: 'استخدم مفاتيحك الخاصة؛ يبقى التشفير والأدلة تحت سيطرتك.',
          href: '/dr/integrations',
          icon: KeyRound,
        },
      ],
    },
    openCta: 'فتح',
    noGroupsHint:
      'ابدأ بإعداد الحماية أولًا — تحتاج مراحل الاسترداد والتمرين والإثبات والجاهزية إلى مجموعة حماية قبل أن تتمكّن من العمل.',
  },
};

/** Resolve the orientation copy against the active locale (English fallback). */
function useOrientationLabels(): OrientationCopy {
  const { locale } = useLocaleOrDefault();
  return resolveDRBilingual(orientationLabels, locale);
}

/**
 * A single routable orientation card. Whole card is the link target (large hit
 * area); the icon, optional step chip, title, one-line blurb and a trailing
 * affordance compose a scannable tile. RTL-safe via logical spacing + `rtl:`
 * chevron flip.
 */
function OrientationCard({ tile, openCta }: { tile: OrientationTile; openCta: string }) {
  const Icon = tile.icon;
  return (
    <Link
      href={tile.href}
      className={cn(
        'group relative flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-start',
        'transition-colors hover:border-primary/40 hover:bg-muted/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        {tile.step ? (
          <Badge variant="outline" className="tabular-nums">
            {tile.step}
          </Badge>
        ) : null}
      </div>
      <div className="space-y-1">
        <p className="font-medium leading-tight">{tile.title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{tile.blurb}</p>
      </div>
      <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        {openCta}
        <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      </span>
    </Link>
  );
}

/**
 * The full orientation band: hero → lifecycle row → capabilities grid. Rendered
 * once at the top of `/dr` above the live operations dashboard.
 */
export function DROrientation() {
  const labels = useOrientationLabels();
  const postureQuery = useDRPosture();
  // Only show the "set up protection first" nudge once posture has resolved with
  // zero protection groups (never while loading or on error).
  const hasNoGroups =
    postureQuery.isSuccess &&
    (postureQuery.data?.groups?.length ?? postureQuery.data?.group_count ?? 0) === 0;

  return (
    <section aria-label={labels.hero.title} className="space-y-5">
      {/* Hero band */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-caps-xwide text-primary rtl:tracking-normal">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {labels.hero.eyebrow}
            </div>
            <h1 className="text-h2 font-semibold">{labels.hero.title}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{labels.hero.subtitle}</p>
          </div>
          <Badge variant="secondary" className="gap-2 self-start whitespace-nowrap py-1.5 md:self-center">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {labels.hero.lifecycleChip}
          </Badge>
        </div>
      </div>

      {/* Lifecycle stages */}
      <SectionCard
        title={
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
            {labels.lifecycle.heading}
          </span>
        }
        description={labels.lifecycle.description}
        contentClassName="pt-0"
      >
        {hasNoGroups ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="leading-relaxed text-foreground">{labels.noGroupsHint}</span>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {labels.lifecycle.tiles.map((tile) => (
            <OrientationCard key={tile.id} tile={tile} openCta={labels.openCta} />
          ))}
        </div>
      </SectionCard>

      {/* Capabilities */}
      <SectionCard
        title={
          <span className="inline-flex items-center gap-2">
            <MapIcon className="h-4 w-4 text-primary" aria-hidden />
            {labels.capabilities.heading}
          </span>
        }
        description={labels.capabilities.description}
        contentClassName="pt-0"
      >
        <SectionGrid cols={4} gap={3}>
          {labels.capabilities.tiles.map((tile) => (
            <OrientationCard key={tile.id} tile={tile} openCta={labels.openCta} />
          ))}
        </SectionGrid>
      </SectionCard>
    </section>
  );
}

export default DROrientation;
