import type { Metadata } from 'next';
import { getWorkflowDefinitionsPageMetadata } from '@/lib/server-metadata';
import { DefinitionsBrowserClient } from './definitions-browser-client';

export function generateMetadata(): Promise<Metadata> {
  return getWorkflowDefinitionsPageMetadata();
}

export default function WorkflowDefinitionsBrowserPage() {
  return <DefinitionsBrowserClient />;
}
