'use client';

import * as React from 'react';
import type {
  DashboardAlertThreshold,
  DashboardHorizon,
  DashboardScope,
} from './layout-utils';

export interface DashboardViewPreferences {
  scope: DashboardScope;
  horizonDays: DashboardHorizon;
  alertThreshold: DashboardAlertThreshold;
  /** Page headers can place customization in their action overflow. */
  openCustomizer?: () => void;
}

const DEFAULT_PREFERENCES: DashboardViewPreferences = {
  scope: 'all',
  horizonDays: 30,
  alertThreshold: 'high',
};

const DashboardPreferencesContext = React.createContext(DEFAULT_PREFERENCES);

export function DashboardPreferencesProvider({
  value,
  children,
}: {
  value: DashboardViewPreferences;
  children: React.ReactNode;
}) {
  return (
    <DashboardPreferencesContext.Provider value={value}>
      {children}
    </DashboardPreferencesContext.Provider>
  );
}

export function useDashboardViewPreferences(): DashboardViewPreferences {
  return React.useContext(DashboardPreferencesContext);
}
