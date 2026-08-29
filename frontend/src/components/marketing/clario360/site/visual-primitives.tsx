'use client';

/**
 * Visual primitives for the Clario360 marketing site uplift.
 *
 * BrowserFrame — decorative browser-chrome mockup wrapping product screenshots.
 * Shot         — plain <img> with explicit intrinsic dimensions (no next/image).
 * CountUp      — IntersectionObserver-triggered animated counter, locale-aware
 *                (Arabic-Indic numerals for `ar`), reduced-motion safe.
 * Reveal       — scroll-reveal wrapper mirroring the `.fade-up` / `.in` pattern
 *                used by ScrollReveal in widgets.tsx (per-element observer so it
 *                also works for nodes mounted after the global pass).
 *
 * Presentation classes (.browser-frame, .count-stat, .fade-up, …) resolve inside
 * the .clario-site wrapper styled by clario-site.css.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';
import { useMarketingLocale } from '../marketing-locale';

/* ============================================================
   BrowserFrame — browser-chrome mockup.
   The URL is a decorative, neutral string — never a real
   deployment URL.
   ============================================================ */

export interface BrowserFrameProps {
  children: ReactNode;
  url?: string;
  dark?: boolean;
}

export function BrowserFrame({
  children,
  url = 'app.clario360.sa',
  dark = false,
}: BrowserFrameProps) {
  return (
    <div className={'browser-frame' + (dark ? ' dark' : '')}>
      <div className="browser-bar">
        <div className="browser-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="browser-url">{url}</div>
      </div>
      <div className="browser-body">{children}</div>
    </div>
  );
}

/* ============================================================
   Shot — plain <img> with explicit width/height so the browser
   reserves layout space (no CLS). next/image is deliberately
   avoided (no sharp on the box).
   ============================================================ */

export interface ShotProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  eager?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Shot({
  src,
  alt,
  width,
  height,
  eager = false,
  className,
  style,
}: ShotProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : undefined}
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block', ...style }}
    />
  );
}

/* ============================================================
   CountUp — animated stat counter.
   Starts when ≥40% visible (once); eases out cubically over
   `duration` ms. Respects prefers-reduced-motion by rendering
   the final value immediately. Formats via Intl.NumberFormat so
   the Arabic locale gets Arabic-Indic numerals.
   ============================================================ */

export interface CountUpProps {
  to: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  decimals?: number;
}

export function CountUp({
  to,
  suffix = '',
  prefix = '',
  duration = 1400,
  decimals = 0,
}: CountUpProps) {
  const { locale } = useMarketingLocale();
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);
  const [value, setValue] = useState(0);

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-arab' : 'en-US', {
        maximumFractionDigits: decimals,
      }),
    [locale, decimals],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Already ran (or target changed after the run) → pin the final value.
    if (started.current) {
      setValue(to);
      return;
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      started.current = true;
      setValue(to);
      return;
    }

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || started.current) return;
          started.current = true;
          io.unobserve(entry.target);
          const t0 = performance.now();
          const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
            setValue(to * eased);
            if (p < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return (
    <span className="count-stat" ref={ref}>
      {prefix}
      {formatter.format(value)}
      {suffix}
    </span>
  );
}

/* ============================================================
   Reveal — scroll-reveal wrapper.
   Mirrors the observeFade() pattern used by ScrollReveal in
   widgets.tsx (same threshold/rootMargin, reveal-once, reduced-
   motion and no-IO fallbacks) but observes its own element, so
   it also covers nodes mounted after the global pass. `delay`
   staggers the entrance via transition-delay.
   ============================================================ */

export interface RevealProps {
  children?: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
}

export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  const setRef = useCallback((node: HTMLElement | null) => {
    ref.current = node;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      setShown(true);
      return;
    }

    // Already within (or near) the viewport on mount → reveal immediately.
    const vh = window.innerHeight || 800;
    if (el.getBoundingClientRect().top < vh * 1.1) {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShown(true);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);

    return () => io.disconnect();
  }, [shown]);

  const cls = ['fade-up', shown ? 'in' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      ref={setRef}
      className={cls}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
