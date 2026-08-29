import type { Metadata } from 'next';
import { AnalyticsHeader } from './_components/analytics-header';
import { WorkflowKpiCards } from './_components/workflow-kpi-cards';
import { InstanceStatusChart } from './_components/instance-status-chart';
import { TaskWorkloadTable } from './_components/task-workload-table';

export const metadata: Metadata = {
  title: 'Workflow Analytics',
};

export default function WorkflowAnalyticsPage() {
  return (
    <div className="space-y-8">
      <AnalyticsHeader />

      <WorkflowKpiCards />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InstanceStatusChart />
        <TaskWorkloadTable />
      </div>
    </div>
  );
}
