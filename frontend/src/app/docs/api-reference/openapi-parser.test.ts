import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseOpenApiService } from './openapi-parser';

const SOURCES = [
  { id: 'watheeq', fileName: 'watheeq-lex-service.openapi.yaml' },
  { id: 'clario-dr', fileName: 'clario-dr-service.openapi.yaml' },
  { id: 'licensing', fileName: 'license-entitlement.openapi.yaml' },
] as const;

const apiDirectory = resolve(process.cwd(), '..', 'docs', 'api');

describe('OpenAPI reference parser', () => {
  it.each(SOURCES)('indexes every operation in $fileName', (source) => {
    const raw = readFileSync(resolve(apiDirectory, source.fileName), 'utf8');
    const document = parse(raw);
    const service = parseOpenApiService(source, document);
    const sourceOperationCount = Object.values(document.paths as Record<string, Record<string, unknown>>)
      .flatMap((path) => ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'].filter((method) => path[method]))
      .length;

    expect(service.operations).toHaveLength(sourceOperationCount);
    expect(new Set(service.operations.map((operation) => operation.slug)).size).toBe(sourceOperationCount);
    expect(service.tagGroups.flatMap((group) => group.operations).length).toBeGreaterThanOrEqual(sourceOperationCount);
    expect(service.operations.every((operation) => operation.responses.length > 0)).toBe(true);
  });

  it('resolves shared parameters and component response descriptions', () => {
    const raw = readFileSync(resolve(apiDirectory, 'license-entitlement.openapi.yaml'), 'utf8');
    const service = parseOpenApiService(SOURCES[2], parse(raw));
    const operation = service.operations.find((candidate) => candidate.operationId === 'getLicensePlan');

    expect(operation?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'key', location: 'path', required: true })]),
    );
    expect(operation?.responses).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: '404', description: 'Resource not found.' })]),
    );
  });

  it('keeps Watheeq tenant authentication claims source-grounded', () => {
    const raw = readFileSync(resolve(apiDirectory, 'watheeq-lex-service.openapi.yaml'), 'utf8');
    const service = parseOpenApiService(SOURCES[0], parse(raw));

    expect(service.servers.map((server) => server.url)).toEqual(['/api/v1/lex', '/api/v1/watheeq']);
    expect(service.securitySchemes.map((scheme) => scheme.id)).toEqual(['bearerAuth']);
  });
});
