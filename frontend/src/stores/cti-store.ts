'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  fetchCategories,
  fetchExecutiveDashboard,
  fetchGlobalThreatMap,
  fetchSectorThreatOverview,
  fetchSeverityLevels,
  fetchSectors,
} from '@/lib/cti-api';
import type {
  CTICampaign,
  CTIExecutiveDashboardResponse,
  CTIExecutiveSnapshot,
  CTIGeoThreatHotspot,
  CTIIndustrySector,
  CTIPeriod,
  CTISectorThreatSummary,
  CTISeverityLevel,
  CTIThreatCategory,
  CTIThreatEvent,
} from '@/types/cti';

interface MapViewport {
  zoom: number;
  center: [number, number];
}

interface CTIState {
  severityLevels: CTISeverityLevel[];
  categories: CTIThreatCategory[];
  sectors: CTIIndustrySector[];
  referenceDataLoaded: boolean;

  dashboardPeriod: Extract<CTIPeriod, '24h' | '7d' | '30d'>;
  executiveSnapshot: CTIExecutiveSnapshot | null;
  geoHotspots: CTIGeoThreatHotspot[];
  sectorSummaries: CTISectorThreatSummary[];
  topCampaigns: CTICampaign[];
  criticalBrands: CTIExecutiveDashboardResponse['critical_brands'];
  recentEvents: CTIThreatEvent[];
  isLoadingDashboard: boolean;

  selectedHotspot: CTIGeoThreatHotspot | null;
  mapViewport: MapViewport;

  liveEvents: CTIThreatEvent[];
  liveEventCount: number;

  loadReferenceData: () => Promise<void>;
  setDashboardPeriod: (period: Extract<CTIPeriod, '24h' | '7d' | '30d'>) => void;
  loadDashboard: () => Promise<void>;
  loadThreatMap: (period?: Extract<CTIPeriod, '24h' | '7d' | '30d'>) => Promise<void>;
  refreshExecutiveSnapshot: () => Promise<void>;
  setSelectedHotspot: (hotspot: CTIGeoThreatHotspot | null) => void;
  setMapViewport: (viewport: Partial<MapViewport>) => void;
  pushLiveEvent: (event: CTIThreatEvent) => void;
}

function dedupeEvents(events: CTIThreatEvent[], limit = 50): CTIThreatEvent[] {
  const seen = new Set<string>();
  const next: CTIThreatEvent[] = [];

  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    next.push(event);
    if (next.length >= limit) {
      break;
    }
  }

  return next;
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function attachSectorLabel(
  snapshot: CTIExecutiveSnapshot | null,
  sectors: CTIIndustrySector[],
): CTIExecutiveSnapshot | null {
  if (!snapshot) {
    return null;
  }

  if (!snapshot.top_targeted_sector_id) {
    return {
      ...snapshot,
      top_targeted_sector_label: null,
    };
  }

  const sector = sectors.find((item) => item.id === snapshot.top_targeted_sector_id);
  return {
    ...snapshot,
    top_targeted_sector_label: sector?.label ?? null,
  };
}

export const useCTIStore = create<CTIState>()(
  devtools(
    (set, get) => ({
      severityLevels: [],
      categories: [],
      sectors: [],
      referenceDataLoaded: false,

      dashboardPeriod: '24h',
      executiveSnapshot: null,
      geoHotspots: [],
      sectorSummaries: [],
      topCampaigns: [],
      criticalBrands: [],
      recentEvents: [],
      isLoadingDashboard: false,

      selectedHotspot: null,
      mapViewport: { zoom: 2, center: [20, 0] },

      liveEvents: [],
      liveEventCount: 0,

      loadReferenceData: async () => {
        if (get().referenceDataLoaded) {
          return;
        }

        const [severityLevels, categories, sectors] = await Promise.all([
          fetchSeverityLevels(),
          fetchCategories(),
          fetchSectors(),
        ]);
        const normalizedSectors = arrayOrEmpty(sectors);

        set((state) => ({
          severityLevels: arrayOrEmpty(severityLevels),
          categories: arrayOrEmpty(categories),
          sectors: normalizedSectors,
          referenceDataLoaded: true,
          executiveSnapshot: attachSectorLabel(state.executiveSnapshot, normalizedSectors),
        }));
      },

      setDashboardPeriod: (period) => {
        set({ dashboardPeriod: period });
        void get().loadDashboard();
      },

      loadDashboard: async () => {
        set({ isLoadingDashboard: true });
        try {
          await get().loadReferenceData();
          const period = get().dashboardPeriod;
          const [mapData, sectorData, execData] = await Promise.all([
            fetchGlobalThreatMap(period),
            fetchSectorThreatOverview(period),
            fetchExecutiveDashboard(),
          ]);

          const sectors = arrayOrEmpty(get().sectors);
          const recentEvents = arrayOrEmpty(execData?.recent_events);
          set((state) => ({
            geoHotspots: arrayOrEmpty(mapData?.hotspots),
            sectorSummaries: arrayOrEmpty(sectorData?.sectors),
            executiveSnapshot: attachSectorLabel(execData?.snapshot ?? null, sectors),
            topCampaigns: arrayOrEmpty(execData?.top_campaigns),
            criticalBrands: arrayOrEmpty(execData?.critical_brands),
            recentEvents,
            liveEvents:
              state.liveEvents.length > 0
                ? dedupeEvents([...state.liveEvents, ...recentEvents], 50)
                : dedupeEvents(recentEvents, 50),
            isLoadingDashboard: false,
          }));
        } catch {
          // A data-less tenant (CTI aggregations not provisioned) returns 404s.
          // Stop the loading state so the dashboard shows a clean empty view
          // instead of perpetual skeletons + an unhandled rejection.
          set({ isLoadingDashboard: false });
        }
      },

      loadThreatMap: async (period) => {
        const requestedPeriod = period ?? get().dashboardPeriod;
        try {
          const mapData = await fetchGlobalThreatMap(requestedPeriod);
          set({
            dashboardPeriod: requestedPeriod,
            geoHotspots: arrayOrEmpty(mapData?.hotspots),
          });
        } catch {
          set({ dashboardPeriod: requestedPeriod, geoHotspots: [] });
        }
      },

      refreshExecutiveSnapshot: async () => {
        try {
          await get().loadReferenceData();
          const data = await fetchExecutiveDashboard();
          const sectors = arrayOrEmpty(get().sectors);
          const recentEvents = arrayOrEmpty(data?.recent_events);
          set((state) => ({
            executiveSnapshot: attachSectorLabel(data?.snapshot ?? null, sectors),
            topCampaigns: arrayOrEmpty(data?.top_campaigns),
            criticalBrands: arrayOrEmpty(data?.critical_brands),
            recentEvents,
            liveEvents: dedupeEvents([...state.liveEvents, ...recentEvents], 50),
          }));
        } catch {
          // Non-fatal refresh (e.g. CTI data not provisioned for this tenant).
        }
      },

      setSelectedHotspot: (hotspot) => set({ selectedHotspot: hotspot }),

      setMapViewport: (viewport) =>
        set((state) => ({
          mapViewport: {
            ...state.mapViewport,
            ...viewport,
          },
        })),

      pushLiveEvent: (event) =>
        set((state) => {
          const liveEvents = dedupeEvents([event, ...state.liveEvents], 50);
          const recentEvents = dedupeEvents([event, ...state.recentEvents], 12);
          return {
            liveEvents,
            recentEvents,
            liveEventCount: state.liveEventCount + 1,
          };
        }),
    }),
    { name: 'cti-store' },
  ),
);
