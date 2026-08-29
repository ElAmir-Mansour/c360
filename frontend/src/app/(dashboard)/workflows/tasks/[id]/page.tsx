import type { Metadata } from 'next';
import { getTaskPageMetadata } from '@/lib/server-metadata';
import { TaskDetailPageClient } from './task-detail-page-client';

interface TaskDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata(
  { params }: TaskDetailPageProps,
): Promise<Metadata> {
  const { id } = await params;
  return getTaskPageMetadata(id);
}

export default function TaskDetailPage() {
  return <TaskDetailPageClient />;
}
