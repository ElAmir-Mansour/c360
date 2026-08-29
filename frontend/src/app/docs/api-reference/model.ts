export const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export type ApiParameter = {
  name: string;
  location: string;
  required: boolean;
  description?: string;
  schemaLabel: string;
  example?: unknown;
};

export type ApiMediaType = {
  mediaType: string;
  schemaLabel: string;
  example?: unknown;
};

export type ApiResponse = {
  status: string;
  description: string;
  mediaTypes: ApiMediaType[];
};

export type ApiSecurityScheme = {
  id: string;
  type: string;
  label: string;
  description?: string;
  location?: string;
  parameterName?: string;
};

export type ApiOperation = {
  operationId: string;
  slug: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  permission?: string;
  parameters: ApiParameter[];
  requestBodyRequired: boolean;
  requestMediaTypes: ApiMediaType[];
  responses: ApiResponse[];
  security: string[][];
};

export type ApiTagGroup = {
  name: string;
  description?: string;
  operations: ApiOperation[];
};

export type ApiService = {
  id: string;
  sourceFile: string;
  title: string;
  version: string;
  openapiVersion: string;
  summary: string;
  description?: string;
  servers: Array<{ url: string; description?: string }>;
  securitySchemes: ApiSecurityScheme[];
  tagGroups: ApiTagGroup[];
  operations: ApiOperation[];
};

export type ApiSource = {
  id: string;
  fileName: string;
};
