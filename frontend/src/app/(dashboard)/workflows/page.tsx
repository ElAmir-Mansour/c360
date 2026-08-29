import type { Metadata } from 'next';
import { getWorkflowsPageMetadata } from '@/lib/server-metadata';
import { WorkflowsPageClient } from './workflows-page-client';

export function generateMetadata(): Promise<Metadata> {
  return getWorkflowsPageMetadata();
}

export default function WorkflowsPage() {
  return <WorkflowsPageClient />;
}
