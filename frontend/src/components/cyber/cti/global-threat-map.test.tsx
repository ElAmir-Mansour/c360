import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFlashingHotspotIds,
  buildHotspotFeatureCollection,
  GlobalThreatMap,
  mappableHotspots,
} from './global-threat-map';
import type { CTIGeoThreatHotspot, CTIThreatEvent } from '@/types/cti';

const maplibreMock = vi.hoisted(() => {
  class MockGeoJSONSource {
    data: unknown;

    constructor(data: unknown) {
      this.data = data;
    }

    setData(data: unknown): void {
      this.data = data;
    }
  }

  class MockLngLatBounds {
    points: unknown[] = [];

    extend(point: unknown): MockLngLatBounds {
      this.points.push(point);
      return this;
    }
  }

  class MockMap {
    sources = new Map<string, MockGeoJSONSource>();
    layers = new Set<string>();
    canvas = { style: {} as CSSStyleDeclaration };
    fitBounds = vi.fn();

    constructor() {
      instances.push(this);
    }

    addControl(): MockMap {
      return this;
    }

    addLayer(layer: { id: string }): MockMap {
      this.layers.add(layer.id);
      return this;
    }

    addSource(id: string, source: { data: unknown }): MockMap {
      this.sources.set(id, new MockGeoJSONSource(source.data));
      return this;
    }

    getLayer(id: string): { id: string } | undefined {
      return this.layers.has(id) ? { id } : undefined;
    }

    getSource(id: string): MockGeoJSONSource | undefined {
      return this.sources.get(id);
    }

    getCanvas(): { style: CSSStyleDeclaration } {
      return this.canvas;
    }

    once(event: string, handler: () => void): MockMap {
      if (event === 'load') {
        queueMicrotask(handler);
      }
      return this;
    }

    on(): MockMap {
      return this;
    }

    resize(): void {}

    remove(): void {}
  }

  const instances: MockMap[] = [];

  return {
    instances,
    MockAttributionControl: class MockAttributionControl {},
    MockLngLatBounds,
    MockMap,
    MockNavigationControl: class MockNavigationControl {},
  };
});

vi.mock('maplibre-gl', () => ({
  default: {
    AttributionControl: maplibreMock.MockAttributionControl,
    LngLatBounds: maplibreMock.MockLngLatBounds,
    Map: maplibreMock.MockMap,
    NavigationControl: maplibreMock.MockNavigationControl,
  },
  AttributionControl: maplibreMock.MockAttributionControl,
  LngLatBounds: maplibreMock.MockLngLatBounds,
  Map: maplibreMock.MockMap,
  NavigationControl: maplibreMock.MockNavigationControl,
}));

function makeHotspot(overrides: Partial<CTIGeoThreatHotspot> = {}): CTIGeoThreatHotspot {
  return {
    id: 'hotspot-1',
    tenant_id: 'tenant-1',
    country_code: 'RU',
    city: 'Moscow',
    latitude: 55.7558,
    longitude: 37.6173,
    severity_critical_count: 2,
    severity_high_count: 0,
    severity_medium_count: 0,
    severity_low_count: 0,
    total_count: 24,
    top_category_id: null,
    top_threat_type: 'C2 infrastructure',
    period_start: '2026-06-27T00:00:00.000Z',
    period_end: '2026-06-27T23:59:59.000Z',
    computed_at: '2026-06-27T12:00:00.000Z',
    ...overrides,
  };
}

describe('GlobalThreatMap helpers', () => {
  it('filters hotspots without valid coordinates before building GeoJSON', () => {
    const valid = makeHotspot();
    const invalid = makeHotspot({ id: 'hotspot-2', latitude: null, longitude: null });

    expect(mappableHotspots([valid, invalid])).toEqual([valid]);

    const collection = buildHotspotFeatureCollection([valid, invalid], valid.id);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].geometry.coordinates).toEqual([37.6173, 55.7558]);
    expect(collection.features[0].properties.selected).toBe(true);
    expect(collection.features[0].properties.severity).toBe('critical');
  });

  it('matches recent live events to mapped hotspots by country and city', () => {
    const now = Date.parse('2026-06-27T12:00:00.000Z');
    const hotspot = makeHotspot();
    const recentEvent = {
      id: 'event-1',
      created_at: '2026-06-27T11:59:45.000Z',
      first_seen_at: '2026-06-27T11:59:45.000Z',
      origin_country_code: 'ru',
      origin_city: 'moscow',
    } as CTIThreatEvent;

    expect(buildFlashingHotspotIds([hotspot], [recentEvent], now)).toEqual(new Set([hotspot.id]));
  });
});

describe('GlobalThreatMap', () => {
  afterEach(() => {
    maplibreMock.instances.length = 0;
  });

  it('renders the real map shell and pushes hotspot GeoJSON into MapLibre', async () => {
    render(
      <GlobalThreatMap
        hotspots={[makeHotspot(), makeHotspot({ id: 'hotspot-2', city: 'Unknown', latitude: null })]}
        period="24h"
        onPeriodChange={vi.fn()}
        onHotspotClick={vi.fn()}
        selectedHotspot={null}
        liveEvents={[]}
      />,
    );

    const mapShell = screen.getByTestId('cti-real-map');
    expect(mapShell.getAttribute('aria-label')).toContain('1 plotted hotspots');
    expect(screen.getByText(/1 plotted hotspots across current CTI telemetry/i)).toBeInTheDocument();
    expect(screen.getByText('1 unmapped')).toBeInTheDocument();

    await waitFor(() => {
      const source = maplibreMock.instances[0]?.getSource('cti-hotspots');
      expect(source?.data).toMatchObject({
        type: 'FeatureCollection',
        features: [
          {
            geometry: { coordinates: [37.6173, 55.7558] },
            properties: { city: 'Moscow', totalCount: 24 },
          },
        ],
      });
    });

    expect(maplibreMock.instances[0]?.fitBounds).toHaveBeenCalled();
  });
});
