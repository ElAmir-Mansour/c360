import type { Metadata } from 'next';
import { DocsPortal } from './docs-portal';

export const metadata: Metadata = {
  title: 'Clario360 Developer Portal — APIs, SDKs & Guides',
  description:
    'Build secure integrations on Clario360 with API guides, real code examples, SDKs and sovereign deployment documentation.',
  alternates: { canonical: '/docs' },
  openGraph: {
    title: 'Clario360 Developer Portal',
    description: 'APIs, SDKs and guides for the sovereign enterprise platform.',
    type: 'website',
  },
};

export default function DocsPage() {
  return <DocsPortal />;
}
