'use client';

import { AlertTriangle, CheckCircle2, CircleX } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useT } from '@/components/providers/locale-provider';
import type { AIValidationResult } from '@/types/ai-governance';

interface RecommendationBannerProps {
  result: AIValidationResult;
}

export function RecommendationBanner({ result }: RecommendationBannerProps) {
  const t = useT('admin');
  switch (result.recommendation) {
    case 'promote':
      return (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{t('rcb.recommended')}</AlertTitle>
          <AlertDescription>{result.recommendation_reason}</AlertDescription>
        </Alert>
      );
    case 'reject':
      return (
        <Alert variant="destructive">
          <CircleX className="h-4 w-4" />
          <AlertTitle>{t('rcb.reject')}</AlertTitle>
          <AlertDescription>{result.recommendation_reason}</AlertDescription>
        </Alert>
      );
    default:
      return (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('rcb.keepTesting')}</AlertTitle>
          <AlertDescription>{result.recommendation_reason}</AlertDescription>
        </Alert>
      );
  }
}
