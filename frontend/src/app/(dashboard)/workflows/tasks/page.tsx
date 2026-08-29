import type { Metadata } from 'next';
import { getWorkflowTasksPageMetadata } from '@/lib/server-metadata';
import { WorkflowTasksPageClient } from './tasks-page-client';

export function generateMetadata(): Promise<Metadata> {
  return getWorkflowTasksPageMetadata();
}

export default function WorkflowTasksPage() {
  return <WorkflowTasksPageClient />;
}
