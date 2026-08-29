'use client';

/**
 * home-illustrations.tsx — hand-drawn inline-SVG illustrations for the
 * Clario360 marketing homepage. Decorative (aria-hidden) except the ROI
 * chart, which carries a localized <title> for assistive tech.
 *
 * All artwork draws from the .clario-site brand vars (--navy-*, --gold-*,
 * --teal-*, --sec-*, --insight-*, --paper, --card, --line, --text-*) so it
 * follows any future re-theme automatically. Consistent 2px-family strokes.
 *
 * NOTE: .clario-site has a global `svg{width:1em;height:1em}` safety rule —
 * every root <svg> here therefore carries explicit inline sizing (except
 * ComplianceMark, which is sized by the contracted .mark-seal class).
 *
 * Animation is CSS-class driven only (.pulse-pin, .hero-shot etc.) so the
 * prefers-reduced-motion kill switch in clario-site.css (~line 98) applies.
 */

import { useId } from 'react';
import { useMarketingLocale } from '../marketing-locale';

/* ------------------------------------------------------------------ */
/* shared bits                                                         */
/* ------------------------------------------------------------------ */

const SUITE_COLORS = {
  ds: 'var(--teal-600)',
  bp: 'var(--navy-500)',
  sec: 'var(--sec-2)',
  insight: 'var(--insight-2)',
} as const;

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

function locDigits(n: number, ar: boolean): string {
  const s = String(n);
  if (!ar) return s;
  return s.replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);
}

/** Sanitized unique id fragment (useId emits colons, unsafe in url(#…)). */
function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

/* ------------------------------------------------------------------ */
/* 1. SprawlToPlatform — tool sprawl converging into one platform ring */
/* ------------------------------------------------------------------ */

type SprawlTile = { x: number; y: number; r: number; fill: string };

/* Muted semantic tokens identify third-party point tools in the metaphor. */
const SPRAWL_TILES: readonly SprawlTile[] = [
  { x: 40, y: 60, r: -6, fill: 'var(--sprawl-tool-1)' },
  { x: 150, y: 45, r: 4, fill: 'var(--sprawl-tool-2)' },
  { x: 265, y: 70, r: -3, fill: 'var(--sprawl-tool-3)' },
  { x: 370, y: 50, r: 7, fill: 'var(--sprawl-tool-1)' },
  { x: 60, y: 150, r: 5, fill: 'var(--sprawl-tool-3)' },
  { x: 180, y: 140, r: -8, fill: 'var(--sprawl-tool-1)' },
  { x: 300, y: 155, r: 6, fill: 'var(--sprawl-tool-2)' },
  { x: 395, y: 150, r: -4, fill: 'var(--sprawl-tool-3)' },
  { x: 45, y: 250, r: -5, fill: 'var(--sprawl-tool-2)' },
  { x: 165, y: 245, r: 7, fill: 'var(--sprawl-tool-1)' },
  { x: 290, y: 255, r: -7, fill: 'var(--sprawl-tool-2)' },
  { x: 390, y: 250, r: 3, fill: 'var(--sprawl-tool-1)' },
  { x: 115, y: 330, r: -4, fill: 'var(--sprawl-tool-3)' },
  { x: 255, y: 340, r: 5, fill: 'var(--sprawl-tool-2)' },
];

const TILE_W = 86;
const TILE_H = 54;

/** center of a sprawl tile */
function tc(i: number): { x: number; y: number } {
  return { x: SPRAWL_TILES[i].x + TILE_W / 2, y: SPRAWL_TILES[i].y + TILE_H / 2 };
}

/** tangled dashed connector between two tile centers */
function tangle(a: number, b: number, bendX: number, bendY: number): string {
  const p = tc(a);
  const q = tc(b);
  return `M${p.x} ${p.y} C${p.x + bendX} ${p.y + bendY}, ${q.x - bendX} ${q.y - bendY}, ${q.x} ${q.y}`;
}

const SPRAWL_LINKS: readonly [number, number, number, number][] = [
  [0, 5, 60, 40],
  [1, 6, -50, 70],
  [2, 7, 70, -30],
  [3, 6, -80, 60],
  [4, 9, 50, -45],
  [5, 10, -60, 55],
  [6, 11, 45, 60],
  [8, 13, 80, -40],
  [9, 12, -45, 60],
  [10, 13, 55, 35],
  [1, 8, -70, 80],
  [2, 4, 60, 50],
];

const PLATFORM_NODES: readonly { cx: number; cy: number; color: string }[] = [
  { cx: 880, cy: 150, color: SUITE_COLORS.ds },
  { cx: 1000, cy: 150, color: SUITE_COLORS.bp },
  { cx: 880, cy: 270, color: SUITE_COLORS.sec },
  { cx: 1000, cy: 270, color: SUITE_COLORS.insight },
];

export function SprawlToPlatform(): JSX.Element {
  const { locale } = useMarketingLocale();
  const rtl = locale === 'ar';

  return (
    <svg
      viewBox="0 0 1200 420"
      aria-hidden="true"
      focusable="false"
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        transform: rtl ? 'scaleX(-1)' : undefined,
      }}
    >
      {/* — LEFT: scattered point-tool tiles tangled together — */}
      <g fill="none" stroke="#94A3B8" strokeWidth={1.6} strokeDasharray="5 7" opacity={0.5}>
        {SPRAWL_LINKS.map(([a, b, bx, by]) => (
          <path key={`${a}-${b}`} d={tangle(a, b, bx, by)} />
        ))}
      </g>
      {SPRAWL_TILES.map((t, i) => (
        <g
          key={i}
          transform={`translate(${t.x} ${t.y}) rotate(${t.r} ${TILE_W / 2} ${TILE_H / 2})`}
        >
          <rect
            width={TILE_W}
            height={TILE_H}
            rx={10}
            fill={t.fill}
            stroke="#9AA5B4"
            strokeWidth={2}
          />
          {/* abstract UI detail — deliberately wordless */}
          <circle cx={14} cy={14} r={3.5} fill="#A9B4C2" />
          <g stroke="#A9B4C2" strokeWidth={2} strokeLinecap="round" opacity={0.8}>
            <path d={`M25 14 H${TILE_W - 14}`} />
            <path d={`M14 30 H${TILE_W - 13}`} />
            <path d={`M14 41 H${TILE_W - 31}`} />
          </g>
        </g>
      ))}

      {/* — CENTER: gold merge chevrons — */}
      <g fill="none" stroke="var(--gold-600)" strokeWidth={2.5} strokeLinecap="round" opacity={0.7}>
        <path d="M470 120 C512 132 528 184 556 202" />
        <path d="M470 210 H556" />
        <path d="M470 300 C512 288 528 236 556 218" />
      </g>
      <g
        fill="none"
        stroke="var(--gold-500)"
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M575 168 L622 210 L575 252" opacity={0.45} />
        <path d="M615 168 L662 210 L615 252" />
      </g>

      {/* — RIGHT: one clean platform ring with four suite nodes — */}
      <circle
        cx={940}
        cy={210}
        r={156}
        fill="none"
        stroke="var(--navy-300)"
        strokeWidth={1.5}
        strokeDasharray="2 8"
        opacity={0.55}
      />
      <circle cx={940} cy={210} r={138} fill="var(--card)" fillOpacity={0.7} stroke="var(--navy-600)" strokeWidth={2.5} />
      {/* clean orthogonal spokes */}
      <g fill="none" stroke="var(--navy-300)" strokeWidth={2}>
        <path d="M880 176 V210 H927" />
        <path d="M1000 176 V210 H953" />
        <path d="M880 244 V210 H927" />
        <path d="M1000 244 V210 H953" />
      </g>
      <circle cx={940} cy={210} r={13} fill="var(--gold-500)" />
      {PLATFORM_NODES.map((n) => (
        <g key={n.color}>
          <rect
            x={n.cx - 26}
            y={n.cy - 26}
            width={52}
            height={52}
            rx={12}
            fill="var(--card)"
            stroke={n.color}
            strokeWidth={2}
          />
          <circle cx={n.cx} cy={n.cy - 6} r={5.5} fill={n.color} />
          <path
            d={`M${n.cx - 12} ${n.cy + 10} H${n.cx + 12}`}
            stroke={n.color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.45}
            fill="none"
          />
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 2. SovereigntyKsaDiagram — data-never-leaves map + sovereign stack  */
/* ------------------------------------------------------------------ */

/* Stylized low-poly silhouette — artistic approximation, not a
   political map. Local frame ~480x400, placed via translate(30,50). */
const KSA_PATH =
  'M95 95 L150 55 L255 75 L330 105 L355 140 L345 175 L385 205 L420 225 ' +
  'L455 250 L415 330 L300 395 L215 370 L165 355 L120 300 L95 230 L70 160 Z';

const KSA_NODES: readonly { x: number; y: number }[] = [
  { x: 155, y: 265 },
  { x: 230, y: 120 },
  { x: 330, y: 175 },
  { x: 280, y: 330 },
];

const RIYADH = { x: 293, y: 208 } as const;

const STACK_TILES: readonly { x: number; color: string }[] = [
  { x: 600, color: SUITE_COLORS.ds },
  { x: 713, color: SUITE_COLORS.bp },
  { x: 826, color: SUITE_COLORS.sec },
  { x: 939, color: SUITE_COLORS.insight },
];

const SUBSTRATE_LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'var(--sans)',
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: '1.5px',
};

export function SovereigntyKsaDiagram(): JSX.Element {
  const id = useSvgId();
  const pinX = RIYADH.x + 30;
  const pinY = RIYADH.y + 50;

  return (
    <svg
      viewBox="0 0 1100 520"
      aria-hidden="true"
      focusable="false"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <defs>
        <pattern id={`${id}-grid`} width={26} height={26} patternUnits="userSpaceOnUse">
          <rect width={26} height={26} fill="var(--navy-600)" />
          <path d="M26 0 H0 V26" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={1} />
        </pattern>
      </defs>

      {/* — the Kingdom, data resident inside its border — */}
      <g transform="translate(30 50)">
        <path
          d={KSA_PATH}
          fill={`url(#${id}-grid)`}
          stroke="var(--navy-500)"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        {/* in-border data arcs — traffic stays inside */}
        <g
          fill="none"
          stroke="var(--gold-400)"
          strokeWidth={2}
          strokeDasharray="2 6"
          strokeLinecap="round"
          opacity={0.9}
        >
          {KSA_NODES.map((n) => (
            <path
              key={`${n.x}-${n.y}`}
              d={`M${n.x} ${n.y} Q${(n.x + RIYADH.x) / 2} ${(n.y + RIYADH.y) / 2 - 26} ${RIYADH.x} ${RIYADH.y}`}
            />
          ))}
          <path d="M155 265 Q210 315 280 330" />
          <path d="M230 120 Q290 130 330 175" />
        </g>
        {KSA_NODES.map((n) => (
          <g key={`${n.x}-${n.y}`}>
            <circle cx={n.x} cy={n.y} r={4} fill="var(--gold-400)" />
            <circle cx={n.x} cy={n.y} r={8} fill="none" stroke="var(--gold-400)" strokeWidth={1.5} opacity={0.5} />
          </g>
        ))}
      </g>

      {/* — pulsing pin at the capital — */}
      <circle cx={pinX} cy={pinY} r={24} fill="none" stroke="var(--gold-500)" strokeWidth={1.5} opacity={0.15} />
      <circle cx={pinX} cy={pinY} r={18} fill="none" stroke="var(--gold-500)" strokeWidth={1.5} opacity={0.3} />
      <circle
        className="pulse-pin"
        cx={pinX}
        cy={pinY}
        r={12}
        fill="none"
        stroke="var(--gold-500)"
        strokeWidth={2}
      />
      <path
        d={`M${pinX} ${pinY} C${pinX} ${pinY} ${pinX + 16} ${pinY - 15.4} ${pinX + 16} ${pinY - 27} A16 16 0 1 0 ${pinX - 16} ${pinY - 27} C${pinX - 16} ${pinY - 15.4} ${pinX} ${pinY} ${pinX} ${pinY} Z`}
        fill="var(--gold-500)"
      />
      <circle cx={pinX} cy={pinY - 27} r={6} fill="var(--ink)" />

      {/* — dashed ties: platform stack anchored to in-Kingdom soil — */}
      <g fill="none" stroke="var(--gold-500)" strokeWidth={2} strokeDasharray="7 7" strokeLinecap="round">
        <path d="M600 196 C500 180 430 208 338 246" opacity={0.6} />
        <path d="M600 320 C500 330 420 300 340 262" />
      </g>

      {/* — layer 1: app tiles — */}
      {STACK_TILES.map((t) => (
        <g key={t.x}>
          <rect x={t.x} y={70} width={100} height={64} rx={12} fill="var(--card)" stroke={t.color} strokeWidth={2} />
          <circle cx={t.x + 22} cy={90} r={5} fill={t.color} />
          <g stroke={t.color} strokeWidth={2} strokeLinecap="round" opacity={0.35} fill="none">
            <path d={`M${t.x + 38} 90 H${t.x + 84}`} />
            <path d={`M${t.x + 16} 112 H${t.x + 66}`} />
          </g>
          <path d={`M${t.x + 50} 134 V168`} stroke="var(--navy-300)" strokeWidth={2} fill="none" />
        </g>
      ))}

      {/* — layer 2: shared engine bar — */}
      <rect x={600} y={168} width={439} height={56} rx={12} fill="var(--navy-50)" stroke="var(--navy-500)" strokeWidth={2} />
      <g fill="none" stroke="var(--navy-500)" strokeWidth={2}>
        <circle cx={660} cy={196} r={7} />
        <circle cx={720} cy={196} r={7} />
        <circle cx={780} cy={196} r={7} />
        <path d="M667 196 H713 M727 196 H773" />
      </g>
      <g stroke="var(--navy-200)" strokeWidth={2.5} strokeLinecap="round" fill="none">
        <path d="M830 188 H1005" />
        <path d="M830 205 H952" />
      </g>
      <g stroke="var(--navy-300)" strokeWidth={2} fill="none">
        <path d="M720 224 V252 M820 224 V252 M920 224 V252" />
      </g>

      {/* — layer 3: sovereign substrate (BYOK / WORM / Audit) — */}
      <rect x={600} y={252} width={439} height={150} rx={14} fill="var(--card)" stroke="var(--navy-600)" strokeWidth={2.5} />

      {/* BYOK key */}
      <g fill="none" stroke="var(--navy-600)" strokeWidth={2.5} strokeLinecap="round">
        <circle cx={655} cy={298} r={13} />
        <path d="M668 298 H706 M694 298 V310 M704 298 V308" />
      </g>
      <circle cx={655} cy={298} r={5} fill="var(--gold-500)" />
      <text x={673} y={356} textAnchor="middle" fill="currentColor" opacity={0.8} style={SUBSTRATE_LABEL_STYLE}>
        BYOK
      </text>

      {/* WORM vault cylinder + lock */}
      <g fill="none" stroke="var(--navy-600)" strokeWidth={2.5}>
        <ellipse cx={815} cy={280} rx={26} ry={9} />
        <path d="M789 280 V316 A26 9 0 0 0 841 316 V280" />
        <path d="M789 298 A26 9 0 0 0 841 298" opacity={0.45} />
      </g>
      <g fill="var(--card)" stroke="var(--gold-600)" strokeWidth={2.5} strokeLinejoin="round">
        <path d="M834 312 V306 A7 7 0 0 1 848 306 V312" fill="none" />
        <rect x={830} y={312} width={22} height={16} rx={3.5} />
      </g>
      <text x={819} y={356} textAnchor="middle" fill="currentColor" opacity={0.8} style={SUBSTRATE_LABEL_STYLE}>
        WORM
      </text>

      {/* chain-link audit trail */}
      <g transform="translate(966 300)" fill="none" strokeWidth={2.5}>
        <rect x={-32} y={-9} width={34} height={18} rx={9} transform="rotate(-24)" stroke="var(--navy-600)" />
        <rect x={-6} y={-9} width={34} height={18} rx={9} transform="rotate(-24)" stroke="var(--gold-600)" />
      </g>
      <text x={966} y={356} textAnchor="middle" fill="currentColor" opacity={0.8} style={SUBSTRATE_LABEL_STYLE}>
        Audit
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 3. DeploymentModeIcon — saas / onprem / airgap mini illustrations   */
/* ------------------------------------------------------------------ */

export type DeploymentMode = 'saas' | 'onprem' | 'airgap';

export interface DeploymentModeIconProps {
  mode: DeploymentMode;
}

function RackGlyph({
  x,
  y,
  w,
  h,
  slats,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  slats: number;
}): JSX.Element {
  const step = h / slats;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke="var(--navy-600)" strokeWidth={2} />
      {Array.from({ length: slats - 1 }, (_, i) => (
        <path
          key={i}
          d={`M${x} ${y + step * (i + 1)} H${x + w}`}
          stroke="var(--navy-600)"
          strokeWidth={2}
          fill="none"
        />
      ))}
      {Array.from({ length: slats }, (_, i) => (
        <g key={i}>
          <circle cx={x + 6} cy={y + step * i + step / 2} r={2} fill="var(--gold-500)" />
          <path
            d={`M${x + 12} ${y + step * i + step / 2} H${x + w - 6}`}
            stroke="var(--navy-600)"
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.4}
            fill="none"
          />
        </g>
      ))}
    </g>
  );
}

export function DeploymentModeIcon({ mode }: DeploymentModeIconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
      style={{ width: 120, height: 120, display: 'block' }}
    >
      {mode === 'saas' && (
        <g>
          <path
            d="M34 74 C22 74 14 66 16 57 C17.5 50 24 45 31 46.5 C32 36 42 28 54 29 C65 30 72 37 74 45 C84 43 94 50 94 60 C94 69 87 74 77 74 Z"
            fill="none"
            stroke="var(--navy-600)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <path
            d="M60 106 C60 106 73 93.4 73 84 A13 13 0 1 0 47 84 C47 93.4 60 106 60 106 Z"
            fill="var(--card)"
            stroke="var(--gold-600)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <circle cx={60} cy={84} r={4.5} fill="var(--gold-500)" />
        </g>
      )}

      {mode === 'onprem' && (
        <g>
          <path d="M26 98 V38 H94 V98" fill="none" stroke="var(--navy-600)" strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M18 98 H102" stroke="var(--navy-600)" strokeWidth={2.5} strokeLinecap="round" fill="none" />
          <g fill="none" stroke="var(--navy-600)" strokeWidth={1.8} opacity={0.45}>
            <rect x={32} y={46} width={8} height={8} />
            <rect x={80} y={46} width={8} height={8} />
            <rect x={32} y={62} width={8} height={8} />
            <rect x={80} y={62} width={8} height={8} />
            <rect x={32} y={78} width={8} height={8} />
            <rect x={80} y={78} width={8} height={8} />
          </g>
          <RackGlyph x={47} y={50} w={26} h={42} slats={3} />
        </g>
      )}

      {mode === 'airgap' && (
        <g>
          {/* isolation ring */}
          <circle
            cx={60}
            cy={60}
            r={46}
            fill="none"
            stroke="var(--navy-600)"
            strokeWidth={2}
            strokeDasharray="5 9"
            opacity={0.7}
          />
          {/* severed inbound link */}
          <circle cx={8} cy={13} r={4} fill="none" stroke="var(--navy-600)" strokeWidth={2} />
          <path d="M12 16 L24 26" stroke="var(--navy-600)" strokeWidth={2} strokeLinecap="round" fill="none" />
          <g stroke="var(--gold-500)" strokeWidth={2.5} strokeLinecap="round" fill="none">
            <path d="M33 24 L25 36" />
            <path d="M40 30 L32 42" />
          </g>
          {/* shield + rack */}
          <path
            d="M60 24 L86 34 V58 C86 77 74.5 89.5 60 96 C45.5 89.5 34 77 34 58 V34 Z"
            fill="var(--card)"
            stroke="var(--navy-600)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <RackGlyph x={50} y={42} w={20} h={36} slats={3} />
        </g>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 4. ComplianceMark — in-house alignment seals (NOT regulator logos)  */
/* ------------------------------------------------------------------ */

export type ComplianceFramework = 'nca' | 'sama' | 'pdpl' | 'iso' | 'zatca' | 'najiz';

export interface ComplianceMarkProps {
  framework: ComplianceFramework;
}

const MARK_TEXT: Record<ComplianceFramework, string> = {
  nca: 'NCA ECC',
  sama: 'SAMA CSF',
  pdpl: 'PDPL',
  iso: 'ISO 27001',
  zatca: 'ZATCA',
  najiz: 'Najiz-ready',
};

const MARK_SUB = { en: 'ALIGNED', ar: 'متوافق' } as const;

function SealGlyph({ framework }: { framework: ComplianceFramework }): JSX.Element {
  const shield = 'M24 3 L42 10 V25 C42 37 34 45 24 49 C14 45 6 37 6 25 V10 Z';
  switch (framework) {
    case 'nca':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
          <path d={shield} />
          <path d="M16 25 L22 31 L33 18" strokeLinecap="round" />
        </g>
      );
    case 'pdpl':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
          <path d={shield} />
          <circle cx={24} cy={22} r={5} />
          <path d="M24 27 L21 34 H27 Z" fill="currentColor" />
        </g>
      );
    case 'sama':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={24} cy={26} r={21} />
          <path d="M15 24 L24 17 L33 24 M17 27 V33 M24 27 V33 M31 27 V33 M15 36 H33" />
        </g>
      );
    case 'iso':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx={24} cy={26} r={21} />
          <circle cx={24} cy={26} r={15} opacity={0.6} />
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            const x1 = 24 + Math.cos(a) * 16.5;
            const y1 = 26 + Math.sin(a) * 16.5;
            const x2 = 24 + Math.cos(a) * 19.5;
            const y2 = 26 + Math.sin(a) * 19.5;
            return <path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} strokeLinecap="round" />;
          })}
          <path d="M18 26 L23 31 L31 21" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case 'zatca':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
          <path d="M24 4 L42 14 V38 L24 48 L6 38 V14 Z" />
          <path d="M16 20 H32 M16 26 H32 M16 32 H26" strokeLinecap="round" />
        </g>
      );
    case 'najiz':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={24} cy={26} r={21} />
          <path d="M24 15 V34 M15 19 H33 M19 36 H29" />
          <path d="M10 26 A5 4 0 0 0 20 26 M15 19 L10 26 M15 19 L20 26" />
          <path d="M28 26 A5 4 0 0 0 38 26 M33 19 L28 26 M33 19 L38 26" />
        </g>
      );
  }
}

export function ComplianceMark({ framework }: ComplianceMarkProps): JSX.Element {
  const { locale } = useMarketingLocale();
  const ar = locale === 'ar';
  const isNajiz = framework === 'najiz';

  return (
    /* direction:ltr pins the glyph-left/text-right lockup geometry; under an
       inherited RTL base, text-anchor:start would flip and overlap the seal. */
    <svg
      viewBox="0 0 140 56"
      className="mark-seal"
      aria-hidden="true"
      focusable="false"
      style={{ direction: 'ltr' }}
    >
      <g transform="translate(4 2)">
        <SealGlyph framework={framework} />
      </g>
      <text
        x={58}
        y={isNajiz ? 32 : 26}
        fill="currentColor"
        style={{
          fontFamily: 'var(--display)',
          fontWeight: 700,
          fontSize: isNajiz ? 12.5 : 14.5,
          letterSpacing: '.5px',
        }}
      >
        {MARK_TEXT[framework]}
      </text>
      {!isNajiz && (
        <text
          x={58}
          y={43}
          fill="currentColor"
          opacity={0.62}
          style={{
            fontFamily: 'var(--sans)',
            fontWeight: 600,
            fontSize: ar ? 11 : 8.5,
            letterSpacing: ar ? 0 : '2.4px',
            direction: ar ? 'rtl' : undefined,
          }}
          textAnchor={ar ? 'end' : 'start'}
        >
          {ar ? MARK_SUB.ar : MARK_SUB.en}
        </text>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 5. RoiComparisonChart — point-tool cost stack vs flat pricing line  */
/* ------------------------------------------------------------------ */

const ROI_T = {
  en: {
    title:
      'Illustrative comparison: cumulative point-tool costs rise each year while flat platform pricing stays level.',
    pointTools: 'Point tools (cumulative)',
    flat: 'Flat platform pricing',
    years: ['Year 1', 'Year 2', 'Year 3'],
  },
  ar: {
    title: 'مقارنة توضيحية: تكاليف الأدوات المتفرقة تتراكم كل عام بينما يظل التسعير الثابت للمنصة مستقراً.',
    pointTools: 'أدوات متفرقة (تراكمي)',
    flat: 'تسعير ثابت للمنصة',
    years: ['السنة ١', 'السنة ٢', 'السنة ٣'],
  },
} as const;

/* muted grey/red cost segments (bottom → top); CVD-checked ΔE ≥ 14.9 */
const ROI_SEG_COLORS = ['#707D91', '#9AA3B2', '#AD5F5F'] as const;
const ROI_BARS: readonly { segs: [number, number, number]; total: number }[] = [
  { segs: [40, 34, 26], total: 100 },
  { segs: [64, 56, 50], total: 170 },
  { segs: [92, 76, 82], total: 250 },
];

const ROI_BASE = 306;
const ROI_SCALE = 0.9;
const ROI_CENTERS = [142, 298, 454] as const;
const ROI_BAR_W = 48;
const ROI_FLAT_Y = 212; /* the flat-pricing line (~ index 104, unitless) */

function roiTopRounded(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x} ${y + h} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h} Z`;
}

export function RoiComparisonChart(): JSX.Element {
  const { locale } = useMarketingLocale();
  const ar = locale === 'ar';
  const t = ROI_T[ar ? 'ar' : 'en'];
  const titleId = useSvgId();
  /* Chart geometry stays LTR (axis left, years left→right) even on the RTL
     page; Arabic strings get an explicit RTL bidi base + flipped anchor so
     each label still hangs off the same layout coordinate. */
  const arText: React.CSSProperties | undefined = ar ? { direction: 'rtl' } : undefined;

  return (
    <svg
      viewBox="0 0 560 360"
      role="img"
      aria-labelledby={titleId}
      focusable="false"
      style={{ width: '100%', height: 'auto', display: 'block', direction: 'ltr' }}
    >
      <title id={titleId}>{t.title}</title>

      {/* recessive grid + axis */}
      <g stroke="var(--line)" strokeWidth={1} fill="none">
        <path d="M64 216 H532" />
        <path d="M64 126 H532" />
      </g>
      <path d="M64 306 H532" stroke="var(--line-2)" strokeWidth={1.5} fill="none" />
      {[0, 100, 200].map((v) => (
        <text
          key={v}
          x={56}
          y={ROI_BASE - v * ROI_SCALE + 4}
          textAnchor="end"
          fill="var(--text-3)"
          style={{ fontFamily: 'var(--sans)', fontSize: 11 }}
        >
          {locDigits(v, ar)}
        </text>
      ))}

      {/* stacked cost bars with 2px surface gaps */}
      {ROI_BARS.map((bar, bi) => {
        const x = ROI_CENTERS[bi] - ROI_BAR_W / 2;
        let acc = 0;
        return (
          <g key={bi}>
            {bar.segs.map((v, si) => {
              const y = ROI_BASE - (acc + v) * ROI_SCALE;
              const h = v * ROI_SCALE - (si === 0 ? 0 : 2);
              acc += v;
              const isTop = si === bar.segs.length - 1;
              return isTop ? (
                <path key={si} d={roiTopRounded(x, y, ROI_BAR_W, h, 4)} fill={ROI_SEG_COLORS[si]} />
              ) : (
                <rect key={si} x={x} y={y} width={ROI_BAR_W} height={h} fill={ROI_SEG_COLORS[si]} />
              );
            })}
            {/* direct total label */}
            <text
              x={ROI_CENTERS[bi]}
              y={ROI_BASE - bar.total * ROI_SCALE - 8}
              textAnchor="middle"
              fill="var(--text-2)"
              style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}
            >
              {locDigits(bar.total, ar)}
            </text>
            {/* year label */}
            <text
              x={ROI_CENTERS[bi]}
              y={330}
              textAnchor="middle"
              fill="var(--text-2)"
              style={{ fontFamily: 'var(--sans)', fontSize: 12.5, ...arText }}
            >
              {t.years[bi]}
            </text>
          </g>
        );
      })}

      {/* the flat-pricing line */}
      <path
        d={`M64 ${ROI_FLAT_Y} H532`}
        stroke="var(--gold-500)"
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <circle cx={532} cy={ROI_FLAT_Y} r={5} fill="var(--gold-500)" stroke="var(--card)" strokeWidth={2} />

      {/* legend */}
      <g>
        <rect x={64} y={20} width={14} height={14} rx={3} fill="#707D91" />
        <text
          x={84}
          y={32}
          fill="var(--text-2)"
          textAnchor={ar ? 'end' : 'start'}
          style={{ fontFamily: 'var(--sans)', fontSize: 12, ...arText }}
        >
          {t.pointTools}
        </text>
        <path d="M300 27 H322" stroke="var(--gold-500)" strokeWidth={3} strokeLinecap="round" fill="none" />
        <text
          x={330}
          y={32}
          fill="var(--text-2)"
          textAnchor={ar ? 'end' : 'start'}
          style={{ fontFamily: 'var(--sans)', fontSize: 12, ...arText }}
        >
          {t.flat}
        </text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 6. GeometricBand — 8-fold star-and-cross tessellation divider       */
/* ------------------------------------------------------------------ */

export function GeometricBand(): JSX.Element {
  const id = useSvgId();

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ width: '100%', height: 64, display: 'block' }}
    >
      <defs>
        <pattern id={`${id}-star`} width={72} height={72} patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth={1.6} opacity={0.22}>
            {/* 8-point star: two overlapping squares, equal circumradius */}
            <rect x={17.6} y={17.6} width={36.8} height={36.8} />
            <path d="M36 10 L62 36 L36 62 L10 36 Z" />
            {/* corner crosses — wrap seamlessly across tile seams */}
            {(
              [
                [0, 0],
                [72, 0],
                [0, 72],
                [72, 72],
              ] as const
            ).map(([cx, cy]) => (
              <path
                key={`${cx}-${cy}`}
                d={`M${cx - 4} ${cy - 12} H${cx + 4} V${cy - 4} H${cx + 12} V${cy + 4} H${cx + 4} V${cy + 12} H${cx - 4} V${cy + 4} H${cx - 12} V${cy - 4} H${cx - 4} Z`}
              />
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height={64} fill={`url(#${id}-star)`} />
    </svg>
  );
}
