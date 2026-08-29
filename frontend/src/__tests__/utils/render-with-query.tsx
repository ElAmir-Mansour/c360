import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getLocaleDirection, type AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export interface RenderWithQueryOptions {
  /**
   * Active locale for the wrapped LocaleProvider. Defaults to `en` so the
   * (now locale-aware) form renderers resolve bilingual labels to English in
   * existing tests without any per-test change. Pass `ar` to exercise the RTL /
   * Arabic path.
   */
  locale?: AppLocale;
}

export function renderWithQuery(
  ui: React.ReactElement,
  options: RenderWithQueryOptions = {},
) {
  const queryClient = createTestQueryClient();
  const locale = options.locale ?? 'en';
  const messages = getMessages(locale);
  const direction = getLocaleDirection(locale);

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider locale={locale} direction={direction} messages={messages}>
          <TooltipProvider>{ui}</TooltipProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  };
}
