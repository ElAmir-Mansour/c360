import type { Metadata } from 'next';
import { getRequestLocale } from '@/lib/i18n.server';
import { TemplateDetailClient } from './template-detail-client';

const METADATA_TITLE = {
  en: 'Template Detail',
  ar: 'تفاصيل القالب',
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: METADATA_TITLE[locale] ?? METADATA_TITLE.en };
}

export default function TemplateDetailPage() {
  return <TemplateDetailClient />;
}
