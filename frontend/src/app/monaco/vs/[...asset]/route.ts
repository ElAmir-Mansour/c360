import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const monacoRoot = path.resolve(process.cwd(), 'node_modules', 'monaco-editor', 'min', 'vs');

type RouteContext = {
  params: Promise<{ asset: string[] }>;
};

function resolveMonacoAsset(asset: string[]): string | null {
  const filePath = path.resolve(monacoRoot, ...asset);
  if (filePath === monacoRoot || !filePath.startsWith(`${monacoRoot}${path.sep}`)) {
    return null;
  }
  return filePath;
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { asset } = await context.params;
  const filePath = resolveMonacoAsset(asset);
  if (!filePath) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const body = await readFile(filePath);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Cache-Control': 'public, max-age=604800',
        'Content-Type': contentTypeFor(filePath),
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
