import { PLATFORM_ENGINES } from './engines';
import { getMarketingAppPath, getMarketingSuitePath, getPlatformEnginePath } from './routes';
import { MARKETING_SUITES } from './suites';

export const MARKETING_NAVIGATION = {
  brand: {
    name: 'Clario360',
    href: '/',
    homeLabel: 'Clario360 — home',
  },
  primary: [
    {
      id: 'platform',
      label: 'Platform',
      href: '/platform',
      items: PLATFORM_ENGINES.map((engine) => ({
        id: engine.id,
        label: engine.name,
        href: getPlatformEnginePath(engine.id),
        description: engine.description,
      })),
    },
    {
      id: 'suites',
      label: 'Suites',
      href: '/solutions',
      items: MARKETING_SUITES.map((suite) => ({
        id: suite.id,
        label: suite.name,
        href: getMarketingSuitePath(suite.id),
        description: suite.tagline,
        items: suite.apps.map((app) => ({
          id: app.id,
          label: app.name,
          href: getMarketingAppPath(suite.id, app.id),
          description: app.role,
        })),
      })),
    },
    { id: 'sovereignty', label: 'Sovereignty', href: '/sovereignty' },
    { id: 'compare', label: 'Compare', href: '/compare' },
    { id: 'pricing', label: 'Pricing', href: '/pricing' },
    { id: 'resources', label: 'Resources', href: '/resources' },
  ],
  secondary: [
    { id: 'about', label: 'About', href: '/about' },
    { id: 'contact', label: 'Contact', href: '/contact' },
  ],
  ctas: {
    requestDemo: { label: 'Request a demo', href: '/contact' },
    signIn: { label: 'Sign in', href: '/login' },
  },
} as const;

