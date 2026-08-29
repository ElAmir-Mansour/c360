import {
  HTTP_METHODS,
  type ApiMediaType,
  type ApiOperation,
  type ApiParameter,
  type ApiResponse,
  type ApiSecurityScheme,
  type ApiService,
  type ApiSource,
  type HttpMethod,
} from './model';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function resolveLocalRef(document: JsonObject, value: unknown): JsonObject {
  const candidate = asObject(value);
  const reference = asString(candidate.$ref);
  if (!reference.startsWith('#/')) return candidate;

  const resolved = reference
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((current, part) => asObject(current)[part], document);

  return { ...asObject(resolved), ...Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== '$ref')) };
}

function schemaLabel(document: JsonObject, value: unknown, seen = new Set<string>()): string {
  const schema = asObject(value);
  const reference = asString(schema.$ref);
  if (reference) {
    const name = reference.split('/').at(-1) ?? reference;
    return Array.isArray(schema.nullable) || schema.nullable === true ? `${name} | null` : name;
  }

  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((item) => schemaLabel(document, item, seen)).join(' | ');
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map((item) => schemaLabel(document, item, seen)).join(' | ');
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.map((item) => schemaLabel(document, item, seen)).join(' & ');
  }

  const type = asString(schema.type, isObject(schema.properties) ? 'object' : 'unknown');
  if (type === 'array') return `array<${schemaLabel(document, schema.items, seen)}>`;

  const format = asString(schema.format);
  if (format) return `${type}<${format}>`;

  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
  if (enumValues.length > 0 && enumValues.length <= 5) {
    return enumValues.map((item) => JSON.stringify(item)).join(' | ');
  }
  return type;
}

function schemaExample(
  document: JsonObject,
  value: unknown,
  depth = 0,
  seen = new Set<string>(),
): unknown {
  if (depth > 4) return undefined;
  const original = asObject(value);
  if ('example' in original) return original.example;
  if ('default' in original) return original.default;
  if (Array.isArray(original.examples) && original.examples.length > 0) return original.examples[0];
  if (Array.isArray(original.enum) && original.enum.length > 0) return original.enum[0];

  const reference = asString(original.$ref);
  if (reference) {
    if (seen.has(reference)) return undefined;
    const nextSeen = new Set(seen);
    nextSeen.add(reference);
    return schemaExample(document, resolveLocalRef(document, original), depth + 1, nextSeen);
  }

  if (Array.isArray(original.allOf)) {
    const parts = original.allOf
      .map((item) => schemaExample(document, item, depth + 1, seen))
      .filter(isObject);
    return parts.length > 0 ? Object.assign({}, ...parts) : undefined;
  }
  const alternative = Array.isArray(original.oneOf)
    ? original.oneOf[0]
    : Array.isArray(original.anyOf)
      ? original.anyOf[0]
      : undefined;
  if (alternative) return schemaExample(document, alternative, depth + 1, seen);

  const type = asString(original.type, isObject(original.properties) ? 'object' : '');
  if (type === 'object') {
    const properties = asObject(original.properties);
    const entries = Object.entries(properties)
      .slice(0, 12)
      .map(([key, child]) => [key, schemaExample(document, child, depth + 1, seen)] as const)
      .filter((entry) => entry[1] !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : {};
  }
  if (type === 'array') {
    const item = schemaExample(document, original.items, depth + 1, seen);
    return item === undefined ? [] : [item];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') {
    const format = asString(original.format);
    if (format === 'uuid') return '00000000-0000-0000-0000-000000000000';
    if (format === 'date') return '2026-01-01';
    if (format === 'date-time') return '2026-01-01T00:00:00Z';
    return 'string';
  }
  return undefined;
}

function parseMediaTypes(document: JsonObject, value: unknown): ApiMediaType[] {
  return Object.entries(asObject(value)).map(([mediaType, rawDefinition]) => {
    const definition = asObject(rawDefinition);
    const schema = definition.schema;
    const example = 'example' in definition
      ? definition.example
      : schemaExample(document, schema);
    return {
      mediaType,
      schemaLabel: schemaLabel(document, schema),
      ...(example === undefined ? {} : { example }),
    };
  });
}

function parseParameter(document: JsonObject, value: unknown): ApiParameter {
  const parameter = resolveLocalRef(document, value);
  const example = 'example' in parameter
    ? parameter.example
    : schemaExample(document, parameter.schema);
  return {
    name: asString(parameter.name, 'unnamed'),
    location: asString(parameter.in, 'unknown'),
    required: parameter.required === true,
    ...(asString(parameter.description) ? { description: asString(parameter.description) } : {}),
    schemaLabel: schemaLabel(document, parameter.schema),
    ...(example === undefined ? {} : { example }),
  };
}

function parseResponses(document: JsonObject, value: unknown): ApiResponse[] {
  return Object.entries(asObject(value)).map(([status, rawResponse]) => {
    const response = resolveLocalRef(document, rawResponse);
    return {
      status,
      description: asString(response.description, 'No description provided.'),
      mediaTypes: parseMediaTypes(document, response.content),
    };
  });
}

function parseSecurity(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((requirement) => Object.keys(requirement));
}

function operationSlug(operationId: string): string {
  return operationId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function securitySchemeLabel(id: string, scheme: JsonObject): string {
  if (asString(scheme.type) === 'http') {
    return [asString(scheme.scheme), asString(scheme.bearerFormat)].filter(Boolean).join(' ').toUpperCase();
  }
  if (asString(scheme.type) === 'apiKey') {
    return `${asString(scheme.name, id)} ${asString(scheme.in)}`.trim();
  }
  if (asString(scheme.type) === 'mutualTLS') return 'Mutual TLS';
  return asString(scheme.type, id);
}

function parseSecuritySchemes(document: JsonObject): ApiSecurityScheme[] {
  const components = asObject(document.components);
  return Object.entries(asObject(components.securitySchemes)).map(([id, rawScheme]) => {
    const scheme = asObject(rawScheme);
    return {
      id,
      type: asString(scheme.type, 'unknown'),
      label: securitySchemeLabel(id, scheme),
      ...(asString(scheme.description) ? { description: asString(scheme.description) } : {}),
      ...(asString(scheme.in) ? { location: asString(scheme.in) } : {}),
      ...(asString(scheme.name) ? { parameterName: asString(scheme.name) } : {}),
    };
  });
}

export function parseOpenApiService(source: ApiSource, rawDocument: unknown): ApiService {
  const document = asObject(rawDocument);
  const info = asObject(document.info);
  const globalSecurity = parseSecurity(document.security);
  const declaredTags = Array.isArray(document.tags) ? document.tags.filter(isObject) : [];
  const operations: ApiOperation[] = [];

  for (const [path, rawPathItem] of Object.entries(asObject(document.paths))) {
    const pathItem = asObject(rawPathItem);
    const sharedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const method of HTTP_METHODS) {
      const rawOperation = pathItem[method];
      if (!isObject(rawOperation)) continue;

      const operationId = asString(rawOperation.operationId, `${method}-${path}`);
      const operationParameters = Array.isArray(rawOperation.parameters) ? rawOperation.parameters : [];
      const requestBody = resolveLocalRef(document, rawOperation.requestBody);
      const tags = asStringArray(rawOperation.tags);
      operations.push({
        operationId,
        slug: operationSlug(operationId),
        method: method as HttpMethod,
        path,
        summary: asString(rawOperation.summary, operationId),
        ...(asString(rawOperation.description) ? { description: asString(rawOperation.description) } : {}),
        tags: tags.length > 0 ? tags : ['Other'],
        ...(asString(rawOperation['x-required-permission'])
          ? { permission: asString(rawOperation['x-required-permission']) }
          : {}),
        parameters: [...sharedParameters, ...operationParameters].map((item) => parseParameter(document, item)),
        requestBodyRequired: requestBody.required === true,
        requestMediaTypes: parseMediaTypes(document, requestBody.content),
        responses: parseResponses(document, rawOperation.responses),
        security: 'security' in rawOperation ? parseSecurity(rawOperation.security) : globalSecurity,
      });
    }
  }

  const duplicateSlugs = operations
    .map((operation) => operation.slug)
    .filter((slug, index, all) => all.indexOf(slug) !== index);
  if (duplicateSlugs.length > 0) {
    throw new Error(`Duplicate operation slugs in ${source.fileName}: ${[...new Set(duplicateSlugs)].join(', ')}`);
  }

  const declaredTagNames = declaredTags.map((tag) => asString(tag.name)).filter(Boolean);
  const operationTagNames = operations.flatMap((operation) => operation.tags);
  const tagNames = [...new Set([...declaredTagNames, ...operationTagNames])];

  return {
    id: source.id,
    sourceFile: source.fileName,
    title: asString(info.title, source.id),
    version: asString(info.version, 'unknown'),
    openapiVersion: asString(document.openapi, 'unknown'),
    summary: asString(info.summary, asString(info.description, 'OpenAPI service contract.')),
    ...(asString(info.description) ? { description: asString(info.description) } : {}),
    servers: (Array.isArray(document.servers) ? document.servers : [])
      .filter(isObject)
      .map((server) => ({
        url: asString(server.url),
        ...(asString(server.description) ? { description: asString(server.description) } : {}),
      }))
      .filter((server) => server.url),
    securitySchemes: parseSecuritySchemes(document),
    tagGroups: tagNames.map((name) => ({
      name,
      ...(asString(declaredTags.find((tag) => tag.name === name)?.description)
        ? { description: asString(declaredTags.find((tag) => tag.name === name)?.description) }
        : {}),
      operations: operations.filter((operation) => operation.tags.includes(name)),
    })),
    operations,
  };
}
