import { notFound } from 'next/navigation';
import { readApiSource } from '../../../api-reference/openapi';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return [
    { service: 'watheeq' },
    { service: 'clario-dr' },
    { service: 'licensing' },
  ];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service: serviceId } = await params;
  const source = readApiSource(serviceId);
  if (!source) notFound();

  return new Response(source.yaml, {
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Content-Disposition': `inline; filename="${source.service.sourceFile}"`,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
