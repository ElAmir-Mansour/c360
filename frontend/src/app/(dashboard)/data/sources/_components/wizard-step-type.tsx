'use client';

import { useMemo, useState } from 'react';
import {
  BarChart3,
  Cloud,
  Database,
  FileSpreadsheet,
  Flame,
  GitBranch,
  GitCommit,
  Globe,
  HardDrive,
  Warehouse,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SourceTypeValue } from '@/lib/data-suite/forms';
import { useDataLabels, type DataLabels, type StringKeys } from '@/app/(dashboard)/data/_lib/data-i18n';

type SourceCategory = 'all' | 'database' | 'hadoop' | 'orchestration' | 'file_api';

type SourcesLabelKey = StringKeys<DataLabels['sources']>;

const CATEGORIES: Array<{ value: SourceCategory; key: SourcesLabelKey }> = [
  { value: 'all', key: 'catAll' },
  { value: 'database', key: 'catDatabases' },
  { value: 'hadoop', key: 'catHadoop' },
  { value: 'orchestration', key: 'catOrchestration' },
  { value: 'file_api', key: 'catFilesApi' },
];

const TYPES: Array<{
  value: Exclude<SourceTypeValue, 'stream'>;
  title: string;
  descKey: SourcesLabelKey;
  icon: typeof Database;
  category: Exclude<SourceCategory, 'all'>;
}> = [
  { value: 'postgresql', title: 'PostgreSQL', descKey: 'descPostgres', icon: Database, category: 'database' },
  { value: 'mysql', title: 'MySQL', descKey: 'descMysql', icon: Database, category: 'database' },
  { value: 'clickhouse', title: 'ClickHouse', descKey: 'descClickhouse', icon: BarChart3, category: 'database' },
  { value: 'dolt', title: 'Dolt', descKey: 'descDolt', icon: GitCommit, category: 'database' },
  { value: 'impala', title: 'Apache Impala', descKey: 'descImpala', icon: Zap, category: 'hadoop' },
  { value: 'hive', title: 'Apache Hive', descKey: 'descHive', icon: Warehouse, category: 'hadoop' },
  { value: 'hdfs', title: 'HDFS', descKey: 'descHdfs', icon: HardDrive, category: 'hadoop' },
  { value: 'spark', title: 'Apache Spark', descKey: 'descSpark', icon: Flame, category: 'hadoop' },
  { value: 'dagster', title: 'Dagster', descKey: 'descDagster', icon: GitBranch, category: 'orchestration' },
  { value: 'api', title: 'REST API', descKey: 'descApi', icon: Globe, category: 'file_api' },
  { value: 'csv', title: 'CSV / File', descKey: 'descCsv', icon: FileSpreadsheet, category: 'file_api' },
  { value: 's3', title: 'S3 / MinIO', descKey: 'descS3', icon: Cloud, category: 'file_api' },
];

interface WizardStepTypeProps {
  value?: SourceTypeValue;
  onSelect: (value: SourceTypeValue) => void;
}

export function WizardStepType({ value, onSelect }: WizardStepTypeProps) {
  const labels = useDataLabels();
  const [category, setCategory] = useState<SourceCategory>('all');

  const categoryBadgeLabels: Record<Exclude<SourceCategory, 'all'>, string> = {
    database: labels.sources.catDatabases,
    hadoop: labels.sources.catHadoop,
    orchestration: labels.sources.catOrchestration,
    file_api: labels.sources.filesApiBadge,
  };

  const visibleTypes = useMemo(
    () => TYPES.filter((type) => category === 'all' || type.category === category),
    [category],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((item) => (
          <Button
            key={item.value}
            type="button"
            variant={category === item.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCategory(item.value)}
          >
            {labels.sources[item.key]}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleTypes.map((type) => {
          const Icon = type.icon;
          const selected = value === type.value;

          return (
            <Card key={type.value} className={selected ? 'border-primary shadow-sm' : ''}>
              <CardHeader className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="rounded-full bg-primary/10 p-3 text-primary">
                    <Icon className="h-6 w-6" />
                  </div>
                  <Badge variant="outline">
                    {categoryBadgeLabels[type.category]}
                  </Badge>
                </div>
                <div>
                  <CardTitle className="text-lg">{type.title}</CardTitle>
                  <CardDescription>{labels.sources[type.descKey]}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  className="w-full"
                  variant={selected ? 'default' : 'outline'}
                  onClick={() => onSelect(type.value)}
                >
                  {labels.sources.select}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
