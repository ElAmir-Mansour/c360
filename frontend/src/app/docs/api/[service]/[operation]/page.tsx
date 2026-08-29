import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OperationReference } from '../../../api-reference/api-ui';
import { getApiOperation, getApiService, getApiServices } from '../../../api-reference/openapi';

export function generateStaticParams() {
  return getApiServices().flatMap((service) =>
    service.operations.map((operation) => ({ service: service.id, operation: operation.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ service: string; operation: string }>;
}): Promise<Metadata> {
  const { service: serviceId, operation: operationSlug } = await params;
  const service = getApiService(serviceId);
  const operation = getApiOperation(serviceId, operationSlug);
  if (!service || !operation) return {};
  return {
    title: `${operation.operationId} — ${service.title}`,
    description: operation.summary,
    alternates: { canonical: `/docs/api/${service.id}/${operation.slug}` },
  };
}

export default async function ApiOperationPage({
  params,
}: {
  params: Promise<{ service: string; operation: string }>;
}) {
  const { service: serviceId, operation: operationSlug } = await params;
  const service = getApiService(serviceId);
  const operation = getApiOperation(serviceId, operationSlug);
  if (!service || !operation) notFound();
  const index = service.operations.findIndex((candidate) => candidate.slug === operation.slug);
  return (
    <OperationReference
      service={service}
      operation={operation}
      previous={service.operations[index - 1]}
      next={service.operations[index + 1]}
    />
  );
}
