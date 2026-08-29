import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocsArticlePortal } from './docs-article-portal';
import { docArticles, findDoc } from '../docs-content';

export function generateStaticParams() {
  return docArticles.map((article) => ({ slug: article.slug.split('/') }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = findDoc(slug.join('/'));
  if (!article) return {};
  return {
    title: `${article.title} — Clario360 Documentation`,
    description: article.description,
  };
}

export default async function DocumentationArticlePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const article = findDoc(slug.join('/'));
  if (!article) notFound();
  return <DocsArticlePortal slug={article.slug} />;
}
