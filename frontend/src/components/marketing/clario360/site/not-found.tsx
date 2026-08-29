'use client';

import Link from 'next/link';
import { useMarketingLocale } from '../marketing-locale';

/* ============================================================
   PAGE: 404 — port of page404() (HTML ~2481-2495).
   Nav + footer chrome are provided by Clario360MarketingShell;
   copy is localised via `m.notFound`.
   ============================================================ */
export function NotFoundSite() {
  const { messages: m } = useMarketingLocale();
  const nf = m.notFound;
  return (
    <header
      className="page-hero"
      style={{ minHeight: '70vh', display: 'flex', alignItems: 'center' }}
    >
      <div className="grid-overlay" />
      <div className="wrap page-hero-inner center" style={{ margin: '0 auto' }}>
        <div className="eyebrow" style={{ justifyContent: 'center' }}>
          {nf.code}
        </div>
        <h1>{nf.title}</h1>
        <p className="lede" style={{ margin: '0 auto 30px' }}>
          {nf.lede}
        </p>
        <div
          style={{
            display: 'flex',
            gap: '14px',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link className="btn btn-gold" href="/">
            {nf.backHome}
          </Link>
          <Link className="btn btn-ondark" href="/platform">
            {nf.explorePlatform}
          </Link>
        </div>
      </div>
    </header>
  );
}
