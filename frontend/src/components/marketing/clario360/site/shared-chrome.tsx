'use client';

import Link from 'next/link';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';

/* ============================================================
   Shared, LOCALE-AWARE interior chrome for the Clario360 site.

   These two blocks (the closing CTA band + the cross-suite event-
   bus diagram) carry their own prose, so — unlike the structural
   primitives in `shared.tsx`, which just pass caller strings — they
   read the active marketing locale and pull copy from `m.chrome`.
   They are re-exported from `shared.tsx` so existing imports
   (`import { CtaBand, BusDiagram } from './shared'`) keep working.
   ============================================================ */

/* ----------------------------------------------------------------
   CtaBand — port of ctaBand() (HTML 1436-1455). Copy is localised
   via `m.chrome.cta`; `title`/`sub` may be overridden per instance.
   ---------------------------------------------------------------- */
export function CtaBand({ title, sub }: { title?: string; sub?: string }) {
  const { messages: m } = useMarketingLocale();
  const c = m.chrome.cta;
  return (
    <section className="section">
      <div className="wrap">
        <div className="cta-band">
          <div className="hero-grad" />
          <h2>{title ?? c.title}</h2>
          <p>{sub ?? c.sub}</p>
          <div className="cta-actions">
            <Link className="btn btn-gold btn-lg" href="/contact">
              {c.requestDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark btn-lg" href="/platform">
              {c.exploreArchitecture}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------
   BusDiagram — port of busSection() (HTML 1400-1435). Node and
   event identifiers below are product/technical names and stay
   as-is; only the descriptive prose is localised (`m.chrome.bus`).
   ---------------------------------------------------------------- */
const BUS_TOP_NODES: { name: string; event: string }[] = [
  { name: 'EHKAM', event: 'risk.events' },
  { name: 'MahamaTech', event: 'delivery.events' },
  { name: 'WatheeqTech', event: 'legal.events' },
  { name: 'DataStream', event: 'data.cdc' },
  { name: 'Platform Core', event: 'automation.triggers' },
];

const BUS_BOTTOM_NODES: { name: string; event: string }[] = [
  { name: 'BOSALAH', event: 'exec views' },
  { name: 'ClarioDWH', event: 'analytics' },
  { name: 'Automation', event: 'runbooks' },
  { name: 'Notifications', event: 'alerts' },
  { name: 'Audit Service', event: 'attest' },
];

const BUS_SPINE_EVENTS = [
  'risk.events',
  'delivery.events',
  'legal.events',
  'data.cdc',
  'audit.*',
];

export function BusDiagram({ compact = false }: { compact?: boolean }) {
  const { messages: m } = useMarketingLocale();
  const b = m.chrome.bus;
  return (
    <section className="section bus-section">
      <div className="wrap">
        <div className="sec-head center">
          <div className="eyebrow" style={{ justifyContent: 'center' }}>
            {b.eyebrow}
          </div>
          <h2>{b.title}</h2>
          <p className="lede">{b.lede}</p>
        </div>
        <div className="bus-diagram">
          <div className="bus-row">
            {BUS_TOP_NODES.map((n) => (
              <div className="bus-node" key={n.name}>
                <h6>{n.name}</h6>
                <span>{n.event}</span>
              </div>
            ))}
          </div>
          <div className="bus-spine">
            <span className="bl">{b.spineLabel}</span>
            <span className="bt">{b.spineSub}</span>
            <div className="bus-events">
              {BUS_SPINE_EVENTS.map((e) => (
                <em key={e}>{e}</em>
              ))}
            </div>
          </div>
          <div className="bus-row">
            {BUS_BOTTOM_NODES.map((n) => (
              <div className="bus-node" key={n.name}>
                <h6>{n.name}</h6>
                <span>{n.event}</span>
              </div>
            ))}
          </div>
        </div>
        {compact ? null : (
          <p
            className="center"
            style={{
              marginTop: '34px',
              color: 'var(--text-3)',
              fontSize: '.9rem',
              maxWidth: '620px',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {b.footnote}
          </p>
        )}
      </div>
    </section>
  );
}
