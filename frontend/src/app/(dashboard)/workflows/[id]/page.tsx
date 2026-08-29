import type { Metadata } from 'next';
import { getWorkflowInstancePageMetadata } from '@/lib/server-metadata';
import { WorkflowInstancePageClient } from './workflow-instance-page-client';

interface WorkflowInstancePageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata(
  { params }: WorkflowInstancePageProps,
): Promise<Metadata> {
  const { id } = await params;
  return getWorkflowInstancePageMetadata(id);
}

export default function WorkflowInstancePage() {
  return <WorkflowInstancePageClient />;
}
