'use client';

/**
 * React-query hooks wrapping the canonical Dynamic Form Engine client in
 * {@link import('@/lib/forms-api')}. They list / create / update / delete
 * {@link FormDefinition}s with consistent cache invalidation, mirroring the
 * style of {@link import('@/hooks/use-workflow-definitions')}.
 *
 * The forms-api client already enforces the TWO-SIDED contract (request body is
 * exactly `{name, version?, locales, default_locale, fields}` with object-form
 * bilingual labels; list reads the `{forms,total}` envelope; single-resource
 * endpoints return the bare definition), so these hooks stay thin.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listFormDefinitions,
  getFormDefinition,
  createFormDefinition,
  updateFormDefinition,
  deleteFormDefinition,
  type FormDefinitionDraft,
} from '@/lib/forms-api';
import { showSuccess, showApiError } from '@/lib/toast';
import type { FormDefinition } from '@/types/forms';

/** Shared react-query cache key for the form-definition list. */
export const FORMS_QUERY_KEY = 'workflow-forms';

/** useFormsList loads all form definitions for the tenant (`{forms,total}` envelope). */
export function useFormsList() {
  return useQuery<FormDefinition[]>({
    queryKey: [FORMS_QUERY_KEY],
    queryFn: () => listFormDefinitions(),
  });
}

/** useForm loads a single form definition by id (bare object response). */
export function useForm(id: string | undefined) {
  return useQuery<FormDefinition>({
    queryKey: [FORMS_QUERY_KEY, id],
    queryFn: () => getFormDefinition(id as string),
    enabled: Boolean(id),
  });
}

/** useCreateForm POSTs a new definition then invalidates the list. */
export function useCreateForm() {
  const queryClient = useQueryClient();
  return useMutation<FormDefinition, unknown, FormDefinitionDraft>({
    mutationFn: (draft) => createFormDefinition(draft),
    onSuccess: () => {
      showSuccess('Form created.');
      queryClient.invalidateQueries({ queryKey: [FORMS_QUERY_KEY] });
    },
    onError: (error) => showApiError(error),
  });
}

/** useUpdateForm PUTs an existing definition (version included) then invalidates. */
export function useUpdateForm() {
  const queryClient = useQueryClient();
  return useMutation<
    FormDefinition,
    unknown,
    { id: string; draft: FormDefinitionDraft }
  >({
    mutationFn: ({ id, draft }) => updateFormDefinition(id, draft),
    onSuccess: (_data, variables) => {
      showSuccess('Form updated.');
      queryClient.invalidateQueries({ queryKey: [FORMS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [FORMS_QUERY_KEY, variables.id] });
    },
    onError: (error) => showApiError(error),
  });
}

/** useDeleteForm removes a definition then invalidates the list. */
export function useDeleteForm() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (id) => deleteFormDefinition(id),
    onSuccess: () => {
      showSuccess('Form deleted.');
      queryClient.invalidateQueries({ queryKey: [FORMS_QUERY_KEY] });
    },
    onError: (error) => showApiError(error),
  });
}
