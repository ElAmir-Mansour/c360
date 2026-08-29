import 'server-only';

import { cache } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { ApiOperation, ApiService, ApiSource } from './model';
import { parseOpenApiService } from './openapi-parser';

export const API_SOURCES = [
  { id: 'watheeq', fileName: 'watheeq-lex-service.openapi.yaml' },
  { id: 'clario-dr', fileName: 'clario-dr-service.openapi.yaml' },
  { id: 'licensing', fileName: 'license-entitlement.openapi.yaml' },
] as const satisfies readonly ApiSource[];

function apiSourceDirectory(): string {
  const candidates = [
    resolve(process.cwd(), '..', 'docs', 'api'),
    resolve(process.cwd(), 'docs', 'api'),
    resolve(process.cwd(), '..', '..', 'docs', 'api'),
  ];
  const directory = candidates.find((candidate) =>
    API_SOURCES.every((source) => existsSync(resolve(candidate, source.fileName))),
  );
  if (!directory) {
    throw new Error('Unable to locate the reviewed OpenAPI contracts in docs/api.');
  }
  return directory;
}

const loadServices = cache((): ApiService[] => {
  const directory = apiSourceDirectory();
  return API_SOURCES.map((source) => {
    // The filename comes only from the compile-time allowlist above. Route
    // parameters are never passed to the filesystem.
    const yaml = readFileSync(resolve(directory, source.fileName), 'utf8');
    return parseOpenApiService(source, parse(yaml, { maxAliasCount: 50 }));
  });
});

export function getApiServices(): ApiService[] {
  return loadServices();
}

export function getApiService(id: string): ApiService | undefined {
  return getApiServices().find((service) => service.id === id);
}

export function getApiOperation(serviceId: string, operationSlug: string): ApiOperation | undefined {
  return getApiService(serviceId)?.operations.find((operation) => operation.slug === operationSlug);
}

export function readApiSource(id: string): { service: ApiService; yaml: string } | undefined {
  const source = API_SOURCES.find((candidate) => candidate.id === id);
  const service = getApiService(id);
  if (!source || !service) return undefined;
  return {
    service,
    yaml: readFileSync(resolve(apiSourceDirectory(), source.fileName), 'utf8'),
  };
}
