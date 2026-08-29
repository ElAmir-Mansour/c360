import type { Metadata } from 'next';
import { Braces, FileCheck2, ShieldCheck } from 'lucide-react';
import { Breadcrumbs, ServiceCard } from '../api-reference/api-ui';
import { getApiServices } from '../api-reference/openapi';

export const metadata: Metadata = {
  title: 'API Reference — Clario360 Documentation',
  description: 'Browse the reviewed OpenAPI contracts for Watheeq, ClarioDR, and Licensing.',
  alternates: { canonical: '/docs/api' },
};

export default function ApiCatalogPage() {
  const services = getApiServices();
  const operationCount = services.reduce((total, service) => total + service.operations.length, 0);

  return (
    <>
      <Breadcrumbs />
      <section className="max-w-4xl">
        <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-primary">
          <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
          Generated from reviewed contracts
        </span>
        <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">API reference</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          Browse every operation declared by the platform&apos;s three reviewed OpenAPI contracts.
          Paths, permissions, parameters, request bodies, and responses are read directly from the repository sources.
        </p>
      </section>

      <dl className="mt-10 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-5">
          <Braces className="h-5 w-5 text-primary" aria-hidden />
          <dt className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Reviewed services</dt>
          <dd className="mt-1 text-2xl font-bold">{services.length}</dd>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <FileCheck2 className="h-5 w-5 text-primary" aria-hidden />
          <dt className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Documented operations</dt>
          <dd className="mt-1 text-2xl font-bold">{operationCount}</dd>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
          <dt className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Contract format</dt>
          <dd className="mt-1 text-2xl font-bold">OpenAPI 3.1</dd>
        </div>
      </dl>

      <section className="mt-12">
        <div className="mb-5">
          <h2 className="text-2xl font-semibold">Services</h2>
          <p className="mt-2 text-sm text-muted-foreground">Choose a service to browse its operations by resource group.</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {services.map((service) => <ServiceCard service={service} key={service.id} />)}
        </div>
      </section>

      <aside className="mt-12 rounded-xl border border-primary/20 bg-primary/5 p-5 text-sm leading-6">
        <strong>Deployment-specific origins.</strong>{' '}
        <span className="text-muted-foreground">
          The contracts define gateway-relative server prefixes. Request examples use <code>CLARIO360_ORIGIN</code> and do not invent a public hostname.
        </span>
      </aside>
    </>
  );
}
