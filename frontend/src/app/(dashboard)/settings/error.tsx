'use client';

import { RouteError } from '@/components/common/route-error';
import { useSettingsT } from './_lib/settings-i18n';

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useSettingsT();
  return <RouteError {...props} segment={t.segmentLabel} />;
}
