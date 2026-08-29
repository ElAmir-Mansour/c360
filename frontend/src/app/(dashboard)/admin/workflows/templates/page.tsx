import type { Metadata } from 'next';
import { getRequestLocale } from '@/lib/i18n.server';
import { TemplateGallery } from './components/template-gallery';

const METADATA_TITLE = {
  en: 'Workflow Templates',
  ar: 'قوالب سير العمل',
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: METADATA_TITLE[locale] ?? METADATA_TITLE.en };
}

export default function TemplatesPage() {
  return <TemplateGallery />;
}
