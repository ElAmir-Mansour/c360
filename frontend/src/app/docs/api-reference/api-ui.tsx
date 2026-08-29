import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Braces,
  ChevronRight,
  Code2,
  Download,
  FileCode2,
  KeyRound,
  LockKeyhole,
  Server,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  ApiMediaType,
  ApiOperation,
  ApiParameter,
  ApiResponse,
  ApiService,
  HttpMethod,
} from './model';

const METHOD_STYLES: Record<HttpMethod, string> = {
  get: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  post: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  put: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  patch: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  delete: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  options: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  head: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  trace: 'border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300',
};

function prose(value?: string) {
  if (!value) return null;
  return value
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph, index) => (
      <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground" key={index}>
        {paragraph.trim()}
      </p>
    ));
}

export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={`inline-flex min-w-[4.25rem] items-center justify-center rounded-md border px-2 py-1 font-mono text-xs font-bold uppercase tracking-wider ${METHOD_STYLES[method]}`}
    >
      {method}
    </span>
  );
}

export function ApiShell({
  services,
  children,
}: {
  services: ApiService[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground" dir="ltr">
      <a
        href="#api-reference-content"
        className="sr-only left-px z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to API reference
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/docs" className="flex items-center gap-3 font-semibold">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Braces className="h-5 w-5" aria-hidden />
            </span>
            <span>Clario360 <span className="font-normal text-muted-foreground">API reference</span></span>
          </Link>
          <nav className="ms-auto flex items-center gap-1 text-sm" aria-label="Documentation">
            <Link className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground" href="/docs">
              Guides
            </Link>
            <Link className="rounded-md bg-muted px-3 py-2 font-medium" href="/docs/api" aria-current="page">
              APIs
            </Link>
            <Link className="hidden rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:block" href="/login">
              Console
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto grid min-w-0 max-w-[1600px] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="min-w-0 max-w-full border-b bg-muted/20 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:border-b-0 lg:border-r">
          <nav className="flex min-w-0 max-w-full gap-2 overflow-x-auto p-4 lg:block lg:space-y-6 lg:overflow-y-auto lg:p-6" aria-label="API services">
            <div className="hidden lg:block">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Reference</p>
              <Link className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted" href="/docs/api">
                <BookOpen className="h-4 w-4" aria-hidden />
                API catalog
              </Link>
            </div>
            <div className="flex gap-2 lg:block lg:space-y-1">
              <p className="mb-2 hidden text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground lg:block">Services</p>
              {services.map((service) => (
                <Link
                  className="flex shrink-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:border-primary/40 hover:bg-muted lg:border-transparent lg:bg-transparent"
                  href={`/docs/api/${service.id}`}
                  key={service.id}
                >
                  <Server className="h-4 w-4 text-primary" aria-hidden />
                  <span className="max-w-44 truncate">{service.title.replace(/^Clario360\s+/i, '')}</span>
                  <span className="ms-auto rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {service.operations.length}
                  </span>
                </Link>
              ))}
            </div>
          </nav>
        </aside>
        <main id="api-reference-content" className="min-w-0 px-4 py-8 sm:px-6 lg:px-10 lg:py-12 xl:px-14">
          {children}
        </main>
      </div>
    </div>
  );
}

export function Breadcrumbs({
  service,
  operation,
}: {
  service?: ApiService;
  operation?: ApiOperation;
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Link className="hover:text-foreground" href="/docs">Docs</Link>
      <ChevronRight className="h-3 w-3" aria-hidden />
      <Link className="hover:text-foreground" href="/docs/api">API reference</Link>
      {service ? (
        <>
          <ChevronRight className="h-3 w-3" aria-hidden />
          {operation ? (
            <Link className="hover:text-foreground" href={`/docs/api/${service.id}`}>{service.title}</Link>
          ) : <span className="text-foreground">{service.title}</span>}
        </>
      ) : null}
      {operation ? (
        <>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <span className="text-foreground">{operation.operationId}</span>
        </>
      ) : null}
    </nav>
  );
}

export function ServiceCard({ service }: { service: ApiService }) {
  return (
    <article className="group flex h-full flex-col rounded-xl border bg-card p-6 shadow-sm transition hover:border-primary/30 hover:shadow-md">
      <div className="mb-5 flex items-start justify-between gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-primary">
          <Code2 className="h-5 w-5" aria-hidden />
        </span>
        <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">v{service.version}</span>
      </div>
      <h2 className="text-lg font-semibold">{service.title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{service.summary}</p>
      <dl className="mt-6 grid grid-cols-2 gap-3 border-t pt-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Operations</dt>
          <dd className="mt-1 font-semibold">{service.operations.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Resource groups</dt>
          <dd className="mt-1 font-semibold">{service.tagGroups.length}</dd>
        </div>
      </dl>
      <Link className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary" href={`/docs/api/${service.id}`}>
        Browse endpoints <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </article>
  );
}

export function ServiceOverview({ service }: { service: ApiService }) {
  return (
    <>
      <Breadcrumbs service={service} />
      <div className="max-w-4xl">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">OpenAPI {service.openapiVersion}</span>
          <span className="rounded-full border px-2.5 py-1 text-muted-foreground">Contract v{service.version}</span>
          <span className="rounded-full border px-2.5 py-1 text-muted-foreground">{service.operations.length} operations</span>
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{service.title}</h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">{service.summary}</p>
        {service.description ? <div className="mt-6 space-y-3">{prose(service.description)}</div> : null}
      </div>

      <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label="Contract details">
        <div className="rounded-xl border bg-card p-5">
          <Server className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="mt-3 text-sm font-semibold">Server prefixes</h2>
          <div className="mt-2 space-y-2">
            {service.servers.map((server) => (
              <code className="block break-all text-xs text-muted-foreground" key={server.url}>{server.url}</code>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <LockKeyhole className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="mt-3 text-sm font-semibold">Security schemes</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {service.securitySchemes.length > 0
              ? service.securitySchemes.map((scheme) => scheme.label).join(' · ')
              : 'No service-level scheme declared.'}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <FileCode2 className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="mt-3 text-sm font-semibold">Source contract</h2>
          <p className="mt-2 break-all text-xs text-muted-foreground">{service.sourceFile}</p>
          <a className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary" href={`/docs/api/${service.id}/spec`}>
            <Download className="h-3.5 w-3.5" aria-hidden /> Download YAML
          </a>
        </div>
      </section>

      <div className="mt-12 space-y-12">
        {service.tagGroups.filter((group) => group.operations.length > 0).map((group) => (
          <section id={`tag-${group.name.toLowerCase()}`} className="scroll-mt-24" key={group.name}>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold">{group.name}</h2>
                {group.description ? <p className="mt-1 text-sm text-muted-foreground">{group.description}</p> : null}
              </div>
              <span className="text-xs text-muted-foreground">{group.operations.length} operations</span>
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              {group.operations.map((operation, index) => (
                <Link
                  className={`grid gap-3 p-4 transition hover:bg-muted/60 sm:grid-cols-[5rem_minmax(12rem,0.8fr)_minmax(14rem,1fr)_1rem] sm:items-center ${index ? 'border-t' : ''}`}
                  href={`/docs/api/${service.id}/${operation.slug}`}
                  key={operation.operationId}
                >
                  <MethodBadge method={operation.method} />
                  <code className="min-w-0 break-all text-xs text-foreground">{operation.path}</code>
                  <span className="text-sm text-muted-foreground">{operation.summary}</span>
                  <ChevronRight className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function formatExample(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function ParametersTable({ parameters }: { parameters: ApiParameter[] }) {
  if (parameters.length === 0) {
    return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">This operation declares no parameters.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table className="min-w-[42rem] text-start text-sm" aria-label="Operation parameters">
        <TableHeader className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <TableRow>
            <TableHead className="px-4 py-3 font-semibold">Name</TableHead>
            <TableHead className="px-4 py-3 font-semibold">Location</TableHead>
            <TableHead className="px-4 py-3 font-semibold">Type</TableHead>
            <TableHead className="px-4 py-3 font-semibold">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y">
          {parameters.map((parameter, index) => (
            <TableRow className="align-top" key={`${parameter.location}-${parameter.name}-${index}`}>
              <TableCell className="px-4 py-4">
                <code className="font-semibold text-foreground">{parameter.name}</code>
                {parameter.required ? <span className="ms-2 text-xs font-bold uppercase text-red-600 dark:text-red-400">required</span> : null}
              </TableCell>
              <TableCell className="px-4 py-4 text-muted-foreground">{parameter.location}</TableCell>
              <TableCell className="px-4 py-4"><code className="text-xs">{parameter.schemaLabel}</code></TableCell>
              <TableCell className="max-w-md px-4 py-4 text-muted-foreground">
                {parameter.description ?? '—'}
                {parameter.example !== undefined ? (
                  <div className="mt-2 text-xs"><span className="font-medium text-foreground">Example: </span><code>{formatExample(parameter.example)}</code></div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MediaTypes({ mediaTypes }: { mediaTypes: ApiMediaType[] }) {
  return (
    <div className="space-y-3">
      {mediaTypes.map((media) => (
        <div className="rounded-xl border bg-card" key={media.mediaType}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-xs">
            <code className="font-semibold">{media.mediaType}</code>
            <span className="text-muted-foreground">Schema: <code>{media.schemaLabel}</code></span>
          </div>
          {media.example !== undefined ? (
            <pre className="max-h-[30rem] overflow-auto p-4 font-mono text-xs leading-6"><code>{formatExample(media.example)}</code></pre>
          ) : <p className="p-4 text-sm text-muted-foreground">No example is defined or derivable from this schema.</p>}
        </div>
      ))}
    </div>
  );
}

function Responses({ responses }: { responses: ApiResponse[] }) {
  return (
    <div className="space-y-3">
      {responses.map((response) => (
        <details className="group rounded-xl border bg-card open:shadow-sm" key={response.status}>
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4">
            <span className={`grid min-w-12 place-items-center rounded-md px-2 py-1 font-mono text-xs font-bold ${response.status.startsWith('2') ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
              {response.status}
            </span>
            <span className="flex-1 text-sm">{response.description}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition group-open:rotate-90" aria-hidden />
          </summary>
          {response.mediaTypes.length > 0 ? (
            <div className="border-t p-4"><MediaTypes mediaTypes={response.mediaTypes} /></div>
          ) : <p className="border-t p-4 text-sm text-muted-foreground">No response body is declared.</p>}
        </details>
      ))}
    </div>
  );
}

function createCurl(service: ApiService, operation: ApiOperation): string {
  const baseUrl = service.servers[0]?.url ?? '';
  const requiredQuery = operation.parameters.filter((parameter) => parameter.location === 'query' && parameter.required);
  const query = requiredQuery.length
    ? `?${requiredQuery.map((parameter) => `${parameter.name}=<${parameter.name}>`).join('&')}`
    : '';
  const lines = [`curl --request ${operation.method.toUpperCase()} \\`, `  --url "\${CLARIO360_ORIGIN}${baseUrl}${operation.path}${query}"`];
  const selectedSecurity = operation.security[0] ?? [];
  for (const schemeId of selectedSecurity) {
    const scheme = service.securitySchemes.find((candidate) => candidate.id === schemeId);
    if (scheme?.type === 'http' && scheme.label.includes('BEARER')) {
      lines[lines.length - 1] += ' \\';
      lines.push('  --header "Authorization: Bearer ${CLARIO360_TOKEN}"');
    } else if (scheme?.type === 'apiKey' && scheme.location === 'header' && scheme.parameterName) {
      lines[lines.length - 1] += ' \\';
      lines.push(`  --header "${scheme.parameterName}: <${scheme.parameterName.toLowerCase()}>"`);
    }
  }
  const body = operation.requestMediaTypes[0];
  if (body) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --header "Content-Type: ${body.mediaType}"`);
    if (body.example !== undefined && body.mediaType.includes('json')) {
      lines[lines.length - 1] += ' \\';
      const compact = JSON.stringify(body.example);
      lines.push(`  --data '${compact}'`);
    }
  }
  return lines.join('\n');
}

export function OperationReference({
  service,
  operation,
  previous,
  next,
}: {
  service: ApiService;
  operation: ApiOperation;
  previous?: ApiOperation;
  next?: ApiOperation;
}) {
  const schemes = operation.security.flatMap((requirement) =>
    requirement.map((id) => service.securitySchemes.find((scheme) => scheme.id === id)).filter(Boolean),
  );
  return (
    <>
      <Breadcrumbs service={service} operation={operation} />
      <article className="max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <MethodBadge method={operation.method} />
          {operation.tags.map((tag) => <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground" key={tag}>{tag}</span>)}
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{operation.summary}</h1>
        <p className="mt-3 font-mono text-sm text-muted-foreground">{operation.operationId}</p>
        {operation.description ? <div className="mt-6 space-y-3">{prose(operation.description)}</div> : null}

        <div className="mt-8 overflow-x-auto rounded-xl border bg-slate-950 p-4 text-slate-100 shadow-sm dark:bg-black">
          <div className="flex min-w-max items-center gap-3">
            <MethodBadge method={operation.method} />
            <code className="text-sm">{service.servers[0]?.url}{operation.path}</code>
          </div>
        </div>

        <section className="mt-12 scroll-mt-24" id="authorization">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden />
            <h2 className="text-xl font-semibold">Authorization</h2>
          </div>
          <div className="rounded-xl border bg-card p-5">
            {operation.permission ? (
              <p className="mb-4 text-sm">
                Required permission: <code className="rounded bg-muted px-1.5 py-1 text-xs font-semibold">{operation.permission}</code>
              </p>
            ) : null}
            {operation.security.length === 0 ? (
              <p className="text-sm text-muted-foreground">This operation declares no security requirement.</p>
            ) : (
              <div className="space-y-3">
                {operation.security.map((requirement, index) => (
                  <div className="flex flex-wrap items-center gap-2 text-sm" key={index}>
                    <span className="text-muted-foreground">{operation.security.length > 1 ? `Option ${index + 1}:` : 'Required:'}</span>
                    {requirement.map((id, schemeIndex) => {
                      const scheme = service.securitySchemes.find((candidate) => candidate.id === id);
                      return (
                        <span className="inline-flex items-center gap-2" key={id}>
                          {schemeIndex > 0 ? <span className="text-muted-foreground">and</span> : null}
                          <code className="rounded bg-muted px-2 py-1 text-xs">{scheme?.label ?? id}</code>
                        </span>
                      );
                    })}
                  </div>
                ))}
                {[...new Map(schemes.map((scheme) => [scheme?.id, scheme])).values()].map((scheme) =>
                  scheme?.description ? <p className="text-xs leading-5 text-muted-foreground" key={scheme.id}>{scheme.description}</p> : null,
                )}
              </div>
            )}
          </div>
        </section>

        <section className="mt-12 scroll-mt-24" id="parameters">
          <h2 className="mb-4 text-xl font-semibold">Parameters</h2>
          <ParametersTable parameters={operation.parameters} />
        </section>

        {operation.requestMediaTypes.length > 0 ? (
          <section className="mt-12 scroll-mt-24" id="request-body">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Request body</h2>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {operation.requestBodyRequired ? 'Required' : 'Optional'}
              </span>
            </div>
            <MediaTypes mediaTypes={operation.requestMediaTypes} />
          </section>
        ) : null}

        <section className="mt-12 scroll-mt-24" id="example">
          <h2 className="mb-4 text-xl font-semibold">Request example</h2>
          <div className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-slate-100 dark:bg-black">
            <pre className="font-mono text-xs leading-6"><code>{createCurl(service, operation)}</code></pre>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Replace placeholders with values for your deployment. The origin is intentionally deployment-specific.
          </p>
        </section>

        <section className="mt-12 scroll-mt-24" id="responses">
          <h2 className="mb-4 text-xl font-semibold">Responses</h2>
          <Responses responses={operation.responses} />
        </section>

        <nav className="mt-14 grid gap-3 border-t pt-8 sm:grid-cols-2" aria-label="Adjacent operations">
          {previous ? (
            <Link className="group rounded-xl border p-4 hover:border-primary/40 hover:bg-muted/40" href={`/docs/api/${service.id}/${previous.slug}`}>
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Previous</span>
              <span className="mt-2 block text-sm font-medium">{previous.summary}</span>
            </Link>
          ) : <span />}
          {next ? (
            <Link className="group rounded-xl border p-4 text-end hover:border-primary/40 hover:bg-muted/40" href={`/docs/api/${service.id}/${next.slug}`}>
              <span className="flex items-center justify-end gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next <ArrowRight className="h-3.5 w-3.5" aria-hidden /></span>
              <span className="mt-2 block text-sm font-medium">{next.summary}</span>
            </Link>
          ) : null}
        </nav>
      </article>
    </>
  );
}
