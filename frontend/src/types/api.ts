/** A single structured validation problem returned by the backend, optionally
 *  scoped to a workflow step. Mirrors the Go dto.ValidationError shape. */
export interface ApiValidationError {
  field: string;
  message: string;
  step_id?: string;
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string[]>;
  /** Structured validation problems (e.g. workflow definition publish failures).
   *  Present when the backend returns an `error.errors` list. */
  errors?: ApiValidationError[];
  request_id?: string;
  plan_required?: string;
  upgrade_url?: string;
  /** The single permission a 403'd route demanded (RequirePermission). */
  required_permission?: string;
  /** The any-of permission set a 403'd route demanded (RequireAnyPermission). */
  required_permissions?: string[];
}

export interface EntitlementRequiredEventDetail {
  status: number;
  code: string;
  message: string;
  request_id?: string;
  plan_required?: string;
  upgrade_url?: string;
}

/** Detail for the global permission-denied (403 FORBIDDEN) toast. */
export interface PermissionDeniedEventDetail {
  status: number;
  code: string;
  message: string;
  request_id?: string;
  required_permission?: string;
  required_permissions?: string[];
}

export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'code' in error &&
    'message' in error
  );
}
