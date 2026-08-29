import type { MetadataRoute } from 'next';

import {
  MARKETING_SITE_URL,
  getMarketingPublicRoutes,
} from '@/lib/marketing';
import { docArticles } from '@/app/docs/docs-content';
import { getApiServices } from '@/app/docs/api-reference/openapi';

export default function sitemap(): MetadataRoute.Sitemap {
  const marketingRoutes = getMarketingPublicRoutes();
  const documentationRoutes = [
    '/docs',
    '/docs/watheeq',
    ...docArticles.map((article) => `/docs/${article.slug}`),
    '/docs/api',
    ...getApiServices().flatMap((service) => [
      `/docs/api/${service.id}`,
      ...service.operations.map(
        (operation) => `/docs/api/${service.id}/${operation.slug}`,
      ),
    ]),
  ];

  return [...marketingRoutes, ...documentationRoutes].map((path) => ({
    url: new URL(path, MARKETING_SITE_URL).toString(),
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority:
      path === '/'
        ? 1
        : path === '/docs' || path === '/docs/watheeq'
          ? 0.85
          : path.startsWith('/platform')
            ? 0.8
            : path.startsWith('/docs')
              ? 0.65
              : 0.7,
  }));
}
