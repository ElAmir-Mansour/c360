import type { MetadataRoute } from 'next';

import { MARKETING_SITE_URL } from '@/lib/marketing';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/console/', '/dashboard/'],
    },
    sitemap: new URL('/sitemap.xml', MARKETING_SITE_URL).toString(),
    host: MARKETING_SITE_URL,
  };
}
