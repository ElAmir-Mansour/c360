import { ApiShell } from '../api-reference/api-ui';
import { getApiServices } from '../api-reference/openapi';

export default function ApiReferenceLayout({ children }: { children: React.ReactNode }) {
  return <ApiShell services={getApiServices()}>{children}</ApiShell>;
}
