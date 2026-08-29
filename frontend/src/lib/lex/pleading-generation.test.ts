import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readPleadingGenerationStream,
  startPleadingGeneration,
} from './pleading-generation';

vi.mock('@/lib/auth', () => ({
  getAccessToken: () => 'access-token',
}));
vi.mock('@/stores/impersonation-store', () => ({
  getActiveImpersonationToken: () => null,
}));
vi.mock('@/lib/csrf', () => ({
  getCSRFToken: () => 'csrf-token',
  CSRF_HEADER: 'X-CSRF-Token',
}));
vi.mock('@/lib/env', () => ({
  getApiUrl: () => 'https://api.example.test',
}));

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('pleading generation stream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes progress, deltas, completion, and event cursors across chunks', async () => {
    const events: string[] = [];
    let body = '';

    await readPleadingGenerationStream(
      sseStream([
        'id: 1\nevent: generation_started\ndata: {"job_id":"job-1","progress":5}\n\n',
        'id: 2\nevent: section\ndata: {"heading":"Facts","progress":30}\n',
        '\nid: 3\nevent: delta\ndata: {"text":"First ","progress":40}\n\n',
        'id: 4\nevent: delta\ndata: {"text":"draft","progress":70}\n\n',
        'id: 5\nevent: generation_completed\ndata: {"body":"First draft","progress":100}\n\n',
      ]),
      {
        onEventId: (id) => events.push(id),
        onStarted: (event) => events.push(event.job_id ?? ''),
        onSection: (event) => events.push(event.heading ?? ''),
        onDelta: (event) => {
          body += event.text;
        },
        onCompleted: (event) => events.push(String(event.progress)),
      },
    );

    expect(body).toBe('First draft');
    expect(events).toEqual(['1', 'job-1', '2', 'Facts', '3', '4', '5', '100']);
  });

  it('starts an authenticated SSE request at the pleading generation endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        sseStream([
          'event: generation_completed\ndata: {"body":"Generated pleading"}\n\n',
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onCompleted = vi.fn();

    await startPleadingGeneration(
      'case/1',
      'pleading/1',
      { language: 'en', draft_prompt: 'Draft the response' },
      { onCompleted },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/lex/legal-cases/case%2F1/pleadings/pleading%2F1/generation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'X-CSRF-Token': 'csrf-token',
          Accept: 'text/event-stream',
        }),
        body: JSON.stringify({
          language: 'en',
          draft_prompt: 'Draft the response',
        }),
      }),
    );
    expect(onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Generated pleading' }),
    );
  });
});
