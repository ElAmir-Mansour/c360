import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceOverview } from '../../api-reference/api-ui';
import { getApiService, getApiServices } from '../../api-reference/openapi';

export function generateStaticParams() {
  return getApiServices().map((service) => ({ service: service.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ service: string }>;
}): Promise<Metadata> {
  const { service: serviceId } = await params;
  const service = getApiService(serviceId);
  if (!service) return {};
  return {
    title: `${service.title} — Clario360 API Reference`,
    description: service.summary,
    alternates: { canonical: `/docs/api/${service.id}` },
  };
}

export default async function ApiServicePage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  const { service: serviceId } = await params;
  const service = getApiService(serviceId);
  if (!service) notFound();
  return <ServiceOverview service={service} />;
}
