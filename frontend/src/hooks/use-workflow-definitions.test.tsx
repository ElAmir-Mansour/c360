import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useWorkflowDefinitionVersions } from './use-workflow-definitions';
import { useWorkflowDefinitionVersionList } from '@/app/(dashboard)/admin/workflows/definitions/[defId]/designer/use-workflow-lifecycle';

const API_URL = 'http://localhost:8080';
const DEFINITION_ID = 'definition-1';
const versions = [
  {
    id: DEFINITION_ID,
    name: 'Contract approval',
    version: 3,
    status: 'draft' as const,
  },
];

let requestCount = 0;

const server = setupServer(
  http.get(
    `${API_URL}/api/v1/workflows/definitions/${DEFINITION_ID}/versions`,
    () => {
      requestCount += 1;
      return HttpResponse.json({ versions });
    },
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  requestCount = 0;
});
afterAll(() => server.close());

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

describe('workflow definition version cache contract', () => {
  it('keeps an array when the definition detail loads before the designer', async () => {
    const { queryClient, wrapper } = createHarness();
    const detail = renderHook(
      () => useWorkflowDefinitionVersions(DEFINITION_ID),
      { wrapper },
    );

    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(detail.result.current.data).toEqual(versions);

    const designer = renderHook(
      () => useWorkflowDefinitionVersionList(DEFINITION_ID),
      { wrapper },
    );

    await waitFor(() => expect(designer.result.current.isSuccess).toBe(true));
    expect(designer.result.current.data).toEqual(versions);
    expect(
      queryClient.getQueryData([
        'workflow-definitions',
        DEFINITION_ID,
        'versions',
      ]),
    ).toEqual(versions);
    expect(requestCount).toBe(1);
  });

  it('keeps an array when the designer loads before the definition detail', async () => {
    const { wrapper } = createHarness();
    const designer = renderHook(
      () => useWorkflowDefinitionVersionList(DEFINITION_ID),
      { wrapper },
    );

    await waitFor(() => expect(designer.result.current.isSuccess).toBe(true));
    expect(designer.result.current.data).toEqual(versions);

    const detail = renderHook(
      () => useWorkflowDefinitionVersions(DEFINITION_ID),
      { wrapper },
    );

    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(detail.result.current.data).toEqual(versions);
    expect(requestCount).toBe(1);
  });

  it('unwraps a pre-fix envelope already held in the query cache', async () => {
    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(
      ['workflow-definitions', DEFINITION_ID, 'versions'],
      { versions },
    );

    const detail = renderHook(
      () => useWorkflowDefinitionVersions(DEFINITION_ID),
      { wrapper },
    );
    const designer = renderHook(
      () => useWorkflowDefinitionVersionList(DEFINITION_ID),
      { wrapper },
    );

    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(designer.result.current.isSuccess).toBe(true));
    expect(detail.result.current.data).toEqual(versions);
    expect(designer.result.current.data).toEqual(versions);
    expect(requestCount).toBe(0);
  });
});
