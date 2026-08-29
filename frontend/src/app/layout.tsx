import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { QueryProvider } from '@/components/providers/query-provider';
import { ToastProvider } from '@/components/providers/toast-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getRequestLocaleAttributes } from '@/lib/i18n.server';
import { getMessages } from '@/lib/i18n/messages';
import {
  MARKETING_VIEWPORT,
  createMarketingMetadata,
} from '@/lib/marketing/metadata';

// Latin FALLBACK face behind the client-licensed DIN Next LT Pro. Loaded
// through next/font so the app and marketing surfaces share one optimized file.
// It is exposed as `--font-inter` (NOT `--font-sans`): globals.css :root points
// `--font-sans` at DIN-first with `var(--font-inter)` as the fallback, so until
// the licensed DIN .woff2 files land in public/fonts the interface renders in
// Inter with no build break. No `weight` array: Inter is a variable font, so
// omitting it makes next/font serve ONE variable woff2 covering every weight.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  fallback: ['Segoe UI', 'system-ui', 'Arial', 'sans-serif'],
});

// Display variable now points at Inter as well (Fraunces retired): headings
// share the interface family and differentiate via weight + tight tracking.
// Same options as `inter` above so next/font resolves to the same underlying
// variable file — only the CSS variable name differs.
const interDisplay = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-display',
  fallback: ['Segoe UI', 'system-ui', 'Arial', 'sans-serif'],
});

// Arabic FALLBACK face behind the client-licensed DIN Next LT Arabic. Served as
// a webfont so `ar` pages don't depend on a locally installed IBM Plex Sans
// Arabic. Exposed as `--font-ibm-arabic` (NOT `--font-arabic`): globals.css
// :root points `--font-arabic` at DIN-Arabic-first with `var(--font-ibm-arabic)`
// as the fallback, so `ar` pages render in IBM Plex until the DIN files land.
const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-ibm-arabic',
  fallback: ['Noto Sans Arabic', 'Tahoma', 'sans-serif'],
});

const ibmPlexMono = localFont({
  src: [
    {
      path: '../../public/fonts/ibm-plex-mono-400-latin.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/fonts/ibm-plex-mono-500-latin.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../public/fonts/ibm-plex-mono-600-latin.woff2',
      weight: '600',
      style: 'normal',
    },
  ],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  ...createMarketingMetadata({
    title: 'Clario360 — The Sovereign Enterprise Platform',
  }),
  // Clario360 brand favicon / app icon — the new aperture-mark art. The assets
  // are served by the App Router convention files (app/icon.svg = leaf aperture,
  // app/apple-icon.svg = green app icon, app/favicon.ico); these entries make
  // the wiring explicit and supersede any earlier favicon reference.
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: [{ url: '/apple-icon.svg' }],
  },
};

export const viewport = MARKETING_VIEWPORT;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const localeAttributes = await getRequestLocaleAttributes();
  const messages = getMessages(localeAttributes.lang);

  return (
    <html
      lang={localeAttributes.lang}
      dir={localeAttributes.dir}
      data-locale={localeAttributes.lang}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body
        className={`${inter.variable} ${interDisplay.variable} ${ibmPlexMono.variable} ${ibmPlexSansArabic.variable} antialiased`}
      >
        <LocaleProvider
          locale={localeAttributes.lang}
          direction={localeAttributes.dir}
          messages={messages}
        >
          <ThemeProvider>
            <QueryProvider>
              <TooltipProvider delayDuration={200}>
                {children}
                <ToastProvider />
              </TooltipProvider>
            </QueryProvider>
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
