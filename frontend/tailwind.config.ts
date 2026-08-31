import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import {
  dsColors,
  dsSpacing,
  dsBorderRadius,
  dsBoxShadow,
  dsFontFamily,
  dsFontSize,
  dsLetterSpacing,
  dsTransitionDuration,
  dsTransitionTimingFunction,
} from './src/styles/tokens/tailwind';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    '!./src/**/*.{test,spec}.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Clario360 public-site palette. These legacy aliases remain for older
        // call sites; the generated token system below is authoritative.
        brand: {
          gold: {
            DEFAULT: '#ABB705',
            light: '#ABB705',
            dark: '#ABB705',
          },
          teal: {
            DEFAULT: '#005E5E',
            light: '#0DA7A8',
            dark: '#06352F',
          },
        },
        // shadcn/ui CSS variable colors
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Semantic data-viz tokens — re-theme automatically in dark mode.
        // For SVG/canvas/recharts contexts use src/lib/design-tokens.ts.
        severity: {
          critical: 'hsl(var(--severity-critical))',
          high: 'hsl(var(--severity-high))',
          medium: 'hsl(var(--severity-medium))',
          low: 'hsl(var(--severity-low))',
          info: 'hsl(var(--severity-info))',
        },
        status: {
          success: 'hsl(var(--status-success))',
          warning: 'hsl(var(--status-warning))',
          error: 'hsl(var(--status-error))',
          info: 'hsl(var(--status-info))',
          neutral: 'hsl(var(--status-neutral))',
          pending: 'hsl(var(--status-pending))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
          6: 'hsl(var(--chart-6))',
        },
        // ClarioDR design-system tokens (generated from src/styles/tokens).
        // Brand ramps (brand-primary/brand-gold/brand-teal/neutral), semantic
        // state ramps (success/warning/error/info), and theme-aware semantic
        // groups (bg/surface/content/outline/state) that re-theme via --ds-* vars.
        ...dsColors,
      },
      fontFamily: {
        // Token-driven families. DIN Next (client-licensed) LEADS every stack;
        // `--font-sans` / `--font-arabic` (globals.css :root) are already
        // DIN-first with Inter / IBM Plex Sans Arabic as the fallback, and the
        // literal DIN family is prepended here too so the intent is explicit.
        // The Arabic stack (leads in `ar`) is spread in from the token set below.
        sans: ['DIN Next LT Pro', 'var(--font-sans)', 'Inter', 'Segoe UI', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'Arial', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Tahoma', 'ui-sans-serif', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        ...dsFontFamily,
        // Display headings lead with DIN Next LT Pro, then the dedicated
        // --font-display variable (Inter via next/font). Placed AFTER the token
        // spread so it wins cleanly.
        display: ['DIN Next LT Pro', 'var(--font-display)', 'var(--font-sans)', 'Iowan Old Style', 'Palatino Linotype', 'Georgia', 'serif'],
      },
      spacing: {
        // Named layout rhythm tokens (8pt) — gutter / section-x / section-y / card-padding.
        ...dsSpacing,
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        // Normalized large radii — replaces ad-hoc rounded-[24px] usage.
        xl: 'calc(var(--radius) + 4px)',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
        panel: '1.5rem',
        // Canonical "soft surface" radii — names for the ad-hoc rounded-[NNpx]
        // values that recur on cards/panels/shells, so the consistency migration
        // can drop `rounded-[22px|26px|28px|30px]` for `rounded-soft|softer|
        // soft-lg|softest`. Values match the existing pixels exactly.
        soft: '1.375rem', // 22px — was rounded-[22px]
        softer: '1.625rem', // 26px — was rounded-[26px] (most common card radius)
        'soft-lg': '1.75rem', // 28px — was rounded-[28px]
        softest: '1.875rem', // 30px — was rounded-[30px] (shell frame)
        // Design-system named component radii: input / button / card / pill.
        ...dsBorderRadius,
      },
      boxShadow: {
        // Layered soft-elevation set (theme-aware via --ds-elevation-* vars).
        ...dsBoxShadow,
      },
      transitionDuration: {
        // Motion durations: instant/fast/normal/slow/reveal/status.
        ...dsTransitionDuration,
      },
      transitionTimingFunction: {
        // Motion easings: standard/emphasized/decelerate/accelerate/spring.
        ...dsTransitionTimingFunction,
        // Explicit `spring` alias (Stream A / F2) — same gentle-overshoot curve as
        // the token spread above; named here so `ease-spring` is guaranteed.
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      fontSize: {
        // The COMPLETE type scale (display/h1–h4 headings + body/caption/overline)
        // is token-driven via dsFontSize, built from the token source of truth
        // (src/styles/tokens/index.ts). No hardcoded type sizes here.
        ...dsFontSize,
      },
      letterSpacing: {
        // Named uppercase-label tracking (label / caps / caps-wide) — additive to
        // Tailwind's default tracking-* scale; replaces ad-hoc tracking-[Nem].
        ...dsLetterSpacing,
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // Logo strip marquee — translates one track-width toward the start edge.
        // Direction-agnostic: pairs with an RTL-aware duplicate placed at `start-full`.
        'logo-marquee': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-100%)' },
        },
        // Stream A / F2 — entrance + emphasis keyframes (mirrored in globals.css).
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'spring-pop': {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '60%': { opacity: '1', transform: 'scale(1.03)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        shake: 'shake 0.5s ease-in-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'fade-in-up': 'fade-in-up 0.3s ease-out',
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        'logo-marquee': 'logo-marquee 30s linear infinite',
        // Stream A / F2 — token-wired entrance + emphasis animations. Durations
        // map to --ds-duration-* (reveal 480ms / slow 320ms / normal 220ms) and
        // easings to --ds-ease-* (decelerate for entrances, spring for pop).
        'fade-up': 'fade-up var(--ds-duration-reveal) var(--ds-ease-decelerate) both',
        'scale-in': 'scale-in var(--ds-duration-normal) var(--ds-ease-decelerate) both',
        'slide-in-right': 'slide-in-right var(--ds-duration-slow) var(--ds-ease-decelerate) both',
        'spring-pop': 'spring-pop var(--ds-duration-slow) var(--ds-ease-spring) both',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    plugin(({ addVariant }) => {
      addVariant('rtl', '&:where([dir="rtl"], [dir="rtl"] *)');
      addVariant('ltr', '&:where([dir="ltr"], [dir="ltr"] *)');
    }),
  ],
};

export default config;
