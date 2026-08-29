'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { PeriodSelector } from './period-selector';
import { SEVERITY_COLORS, severityVar, type SeverityLevel } from '@/lib/design-tokens';
import { brandHex } from '@/styles/tokens';
import { cn } from '@/lib/utils';
import type { CTIGeoThreatHotspot, CTIThreatEvent } from '@/types/cti';

interface GlobalThreatMapProps {
  hotspots: CTIGeoThreatHotspot[];
  period: string;
  onPeriodChange: (period: string) => void;
  onHotspotClick: (hotspot: CTIGeoThreatHotspot) => void;
  selectedHotspot: CTIGeoThreatHotspot | null;
  liveEvents?: CTIThreatEvent[];
  className?: string;
}

type HotspotFeatureProperties = {
  id: string;
  city: string;
  countryCode: string;
  totalCount: number;
  severity: SeverityLevel;
  color: string;
  radius: number;
  selected: boolean;
  flashing: boolean;
  topThreatType: string;
};

type RouteFeatureProperties = {
  id: string;
  color: string;
  totalCount: number;
};

type MappableGeoThreatHotspot = CTIGeoThreatHotspot & {
  latitude: number;
  longitude: number;
};

const HOTSPOT_SOURCE_ID = 'cti-hotspots';
const HOTSPOT_HALO_LAYER_ID = 'cti-hotspot-halo';
const HOTSPOT_CIRCLE_LAYER_ID = 'cti-hotspot-circle';
const ROUTE_SOURCE_ID = 'cti-routes';
const ROUTE_LAYER_ID = 'cti-routes-line';
const TARGET_SOURCE_ID = 'cti-target';
const TARGET_HALO_LAYER_ID = 'cti-target-halo';
const TARGET_CIRCLE_LAYER_ID = 'cti-target-circle';

const TARGET_LOCATION = {
  name: 'Riyadh operations center',
  coordinates: [46.6753, 24.7136] as [number, number],
};

const MAP_TILE_URL_TEMPLATE =
  process.env.NEXT_PUBLIC_MAP_TILE_URL_TEMPLATE ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const MAP_TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ??
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const EMPTY_HOTSPOTS: FeatureCollection<Point, HotspotFeatureProperties> = {
  type: 'FeatureCollection',
  features: [],
};

const EMPTY_ROUTES: FeatureCollection<LineString, RouteFeatureProperties> = {
  type: 'FeatureCollection',
  features: [],
};

function createMapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [MAP_TILE_URL_TEMPLATE],
        tileSize: 256,
        attribution: MAP_TILE_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        paint: {
          'raster-opacity': 0.78,
          'raster-saturation': -0.35,
          'raster-contrast': 0.08,
        },
      },
    ],
  };
}

function hasValidCoordinates(hotspot: CTIGeoThreatHotspot): hotspot is MappableGeoThreatHotspot {
  return (
    Number.isFinite(hotspot.latitude) &&
    Number.isFinite(hotspot.longitude) &&
    hotspot.latitude !== null &&
    hotspot.longitude !== null &&
    hotspot.latitude >= -90 &&
    hotspot.latitude <= 90 &&
    hotspot.longitude >= -180 &&
    hotspot.longitude <= 180
  );
}

export function hotspotSeverity(hotspot: CTIGeoThreatHotspot): SeverityLevel {
  if (hotspot.severity_critical_count > 0) return 'critical';
  if (hotspot.severity_high_count > 0) return 'high';
  if (hotspot.severity_medium_count > 0) return 'medium';
  return 'low';
}

function hotspotColor(hotspot: CTIGeoThreatHotspot): string {
  return SEVERITY_COLORS[hotspotSeverity(hotspot)];
}

function hotspotRadius(total: number): number {
  return Math.min(Math.max(6, Math.log2(total + 1) * 3.25), 22);
}

export function mappableHotspots(hotspots: CTIGeoThreatHotspot[]): MappableGeoThreatHotspot[] {
  return hotspots.filter(hasValidCoordinates);
}

export function buildFlashingHotspotIds(
  hotspots: CTIGeoThreatHotspot[],
  liveEvents: CTIThreatEvent[],
  now = Date.now(),
): Set<string> {
  const flashIds = new Set<string>();

  for (const event of liveEvents.slice(0, 12)) {
    const timestamp = Date.parse(event.created_at || event.first_seen_at);
    if (Number.isNaN(timestamp) || now - timestamp > 30_000) {
      continue;
    }

    const match = hotspots.find((hotspot) =>
      hotspot.country_code.toLowerCase() === (event.origin_country_code ?? '').toLowerCase()
        && hotspot.city.toLowerCase() === (event.origin_city ?? '').toLowerCase(),
    );

    if (match) {
      flashIds.add(match.id);
    }
  }

  return flashIds;
}

export function buildHotspotFeatureCollection(
  hotspots: CTIGeoThreatHotspot[],
  selectedHotspotId: string | null,
  flashingHotspotIds = new Set<string>(),
): FeatureCollection<Point, HotspotFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: mappableHotspots(hotspots).map((hotspot) => {
      const severity = hotspotSeverity(hotspot);

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [hotspot.longitude, hotspot.latitude],
        },
        properties: {
          id: hotspot.id,
          city: hotspot.city,
          countryCode: hotspot.country_code,
          totalCount: hotspot.total_count,
          severity,
          color: SEVERITY_COLORS[severity],
          radius: hotspotRadius(hotspot.total_count),
          selected: selectedHotspotId === hotspot.id,
          flashing: flashingHotspotIds.has(hotspot.id),
          topThreatType: hotspot.top_threat_type ?? 'Unclassified',
        },
      };
    }),
  };
}

export function buildRouteFeatureCollection(
  hotspots: CTIGeoThreatHotspot[],
): FeatureCollection<LineString, RouteFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: mappableHotspots(hotspots)
      .sort((a, b) => b.total_count - a.total_count)
      .slice(0, 5)
      .map((hotspot): Feature<LineString, RouteFeatureProperties> => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[hotspot.longitude, hotspot.latitude], TARGET_LOCATION.coordinates],
        },
        properties: {
          id: `${hotspot.id}-route`,
          color: hotspotColor(hotspot),
          totalCount: hotspot.total_count,
        },
      })),
  };
}

function targetFeatureCollection(): FeatureCollection<Point, { name: string }> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: TARGET_LOCATION.coordinates,
        },
        properties: {
          name: TARGET_LOCATION.name,
        },
      },
    ],
  };
}

function addSourceIfMissing(
  map: maplibregl.Map,
  id: string,
  data: FeatureCollection<Point | LineString, Record<string, unknown>>,
): void {
  if (!map.getSource(id)) {
    map.addSource(id, { type: 'geojson', data });
  }
}

function addMapLayers(map: maplibregl.Map): void {
  addSourceIfMissing(map, ROUTE_SOURCE_ID, EMPTY_ROUTES);
  addSourceIfMissing(map, TARGET_SOURCE_ID, targetFeatureCollection());
  addSourceIfMissing(map, HOTSPOT_SOURCE_ID, EMPTY_HOTSPOTS);

  if (!map.getLayer(ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['get', 'totalCount'], 1, 1, 50, 2, 500, 3.5],
        'line-opacity': 0.36,
        'line-dasharray': [2, 2],
      },
    });
  }

  if (!map.getLayer(TARGET_HALO_LAYER_ID)) {
    map.addLayer({
      id: TARGET_HALO_LAYER_ID,
      type: 'circle',
      source: TARGET_SOURCE_ID,
      paint: {
        'circle-radius': 15,
        'circle-color': brandHex.primary,
        'circle-opacity': 0.18,
        'circle-stroke-color': brandHex.accent,
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.7,
      },
    });
  }

  if (!map.getLayer(TARGET_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: TARGET_CIRCLE_LAYER_ID,
      type: 'circle',
      source: TARGET_SOURCE_ID,
      paint: {
        'circle-radius': 5,
        'circle-color': brandHex.primary,
        'circle-stroke-color': brandHex.accent,
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 1,
      },
    });
  }

  if (!map.getLayer(HOTSPOT_HALO_LAYER_ID)) {
    map.addLayer({
      id: HOTSPOT_HALO_LAYER_ID,
      type: 'circle',
      source: HOTSPOT_SOURCE_ID,
      paint: {
        'circle-radius': [
          '+',
          ['get', 'radius'],
          ['case', ['==', ['get', 'selected'], true], 11, ['==', ['get', 'flashing'], true], 13, 7],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': [
          'case',
          ['==', ['get', 'selected'], true],
          0.26,
          ['==', ['get', 'flashing'], true],
          0.34,
          ['==', ['get', 'severity'], 'critical'],
          0.2,
          ['==', ['get', 'severity'], 'high'],
          0.18,
          0.1,
        ],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.45,
      },
    });
  }

  if (!map.getLayer(HOTSPOT_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: HOTSPOT_CIRCLE_LAYER_ID,
      type: 'circle',
      source: HOTSPOT_SOURCE_ID,
      paint: {
        'circle-radius': [
          '+',
          ['get', 'radius'],
          ['case', ['==', ['get', 'selected'], true], 2.5, ['==', ['get', 'flashing'], true], 1.5, 0],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.88,
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], true], '#ffffff', '#0f172a'],
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2.5, 1],
        'circle-stroke-opacity': ['case', ['==', ['get', 'selected'], true], 0.95, 0.55],
      },
    });
  }
}

function setGeoJsonData(
  map: maplibregl.Map,
  sourceId: string,
  data: FeatureCollection<Point | LineString, Record<string, unknown>>,
): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

function getHotspotIdFromEvent(event: MapLayerMouseEvent): string | null {
  const id = event.features?.[0]?.properties?.id;
  return typeof id === 'string' ? id : null;
}

function HotspotSummary({ hotspot }: { hotspot: CTIGeoThreatHotspot }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[260px] rounded-lg border border-border/70 bg-background/92 px-3 py-2 text-xs shadow-sm backdrop-blur">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: severityVar(hotspotSeverity(hotspot)) }}
        />
        <span className="truncate font-semibold">{hotspot.city}, {hotspot.country_code}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
        <span>{hotspot.total_count.toLocaleString()} events</span>
        <span>{hotspot.top_threat_type ?? 'Unclassified'}</span>
      </div>
    </div>
  );
}

function MapLegend({ unmappedCount }: { unmappedCount: number }) {
  return (
    <div className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/86 px-2.5 py-1.5 text-[10px] text-foreground shadow-sm backdrop-blur">
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityVar('critical') }} /> Critical</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityVar('high') }} /> High</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityVar('medium') }} /> Medium</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityVar('low') }} /> Low</span>
      <span className="flex items-center gap-1.5 border-l border-border/70 pl-3">
        <span className="h-2 w-2 rounded-full border border-brand-gold-500 bg-primary" /> KSA
      </span>
      {unmappedCount > 0 && (
        <span className="border-l border-border/70 pl-3 text-muted-foreground">
          {unmappedCount} unmapped
        </span>
      )}
    </div>
  );
}

export function GlobalThreatMap({
  hotspots,
  period,
  onPeriodChange,
  onHotspotClick,
  selectedHotspot,
  liveEvents = [],
  className,
}: GlobalThreatMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hotspotByIdRef = useRef<Map<string, CTIGeoThreatHotspot>>(new Map());
  const onHotspotClickRef = useRef(onHotspotClick);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [hoveredHotspot, setHoveredHotspot] = useState<CTIGeoThreatHotspot | null>(null);

  const plottedHotspots = useMemo(() => mappableHotspots(hotspots), [hotspots]);
  const unmappedCount = hotspots.length - plottedHotspots.length;
  const selectedHotspotId = selectedHotspot?.id ?? null;

  const flashingHotspotIds = useMemo(
    () => buildFlashingHotspotIds(plottedHotspots, liveEvents),
    [plottedHotspots, liveEvents],
  );

  const hotspotData = useMemo(
    () => buildHotspotFeatureCollection(plottedHotspots, selectedHotspotId, flashingHotspotIds),
    [flashingHotspotIds, plottedHotspots, selectedHotspotId],
  );

  const routeData = useMemo(
    () => buildRouteFeatureCollection(plottedHotspots),
    [plottedHotspots],
  );

  const fitBoundsKey = useMemo(
    () => plottedHotspots.map((hotspot) => `${hotspot.id}:${hotspot.latitude}:${hotspot.longitude}`).join('|'),
    [plottedHotspots],
  );

  useEffect(() => {
    hotspotByIdRef.current = new Map(plottedHotspots.map((hotspot) => [hotspot.id, hotspot]));
  }, [plottedHotspots]);

  useEffect(() => {
    onHotspotClickRef.current = onHotspotClick;
  }, [onHotspotClick]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;

    try {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: createMapStyle(),
        center: TARGET_LOCATION.coordinates,
        zoom: 1.45,
        minZoom: 1,
        maxZoom: 8,
        attributionControl: false,
        cooperativeGestures: true,
      });

      mapRef.current = map;

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

      const handleLoad = () => {
        addMapLayers(map);
        setMapReady(true);
      };

      const handleClick = (event: MapLayerMouseEvent) => {
        const id = getHotspotIdFromEvent(event);
        const hotspot = id ? hotspotByIdRef.current.get(id) : null;
        if (hotspot) {
          onHotspotClickRef.current(hotspot);
        }
      };

      const handleMove = (event: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const id = getHotspotIdFromEvent(event);
        setHoveredHotspot(id ? hotspotByIdRef.current.get(id) ?? null : null);
      };

      const handleLeave = () => {
        map.getCanvas().style.cursor = '';
        setHoveredHotspot(null);
      };

      map.once('load', handleLoad);
      map.on('click', HOTSPOT_CIRCLE_LAYER_ID, handleClick);
      map.on('mousemove', HOTSPOT_CIRCLE_LAYER_ID, handleMove);
      map.on('mouseleave', HOTSPOT_CIRCLE_LAYER_ID, handleLeave);

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(mapContainerRef.current);
      }

      return () => {
        resizeObserver?.disconnect();
        map.remove();
        mapRef.current = null;
      };
    } catch {
      setMapError('Map rendering is unavailable in this browser.');
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }

    setGeoJsonData(map, HOTSPOT_SOURCE_ID, hotspotData);
    setGeoJsonData(map, ROUTE_SOURCE_ID, routeData);
  }, [hotspotData, mapReady, routeData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || plottedHotspots.length === 0) {
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    bounds.extend(TARGET_LOCATION.coordinates);

    for (const hotspot of plottedHotspots) {
      bounds.extend([hotspot.longitude, hotspot.latitude]);
    }

    map.fitBounds(bounds, {
      padding: { top: 56, right: 56, bottom: 56, left: 56 },
      maxZoom: 3.6,
      duration: 650,
    });
  }, [fitBoundsKey, mapReady, plottedHotspots]);

  const activeHotspot = hoveredHotspot ?? selectedHotspot;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Global Threat Map</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {plottedHotspots.length.toLocaleString()} plotted hotspots across current CTI telemetry
          </p>
        </div>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </div>

      <div className="relative overflow-hidden rounded-lg border bg-slate-950 shadow-sm">
        <div
          ref={mapContainerRef}
          role="img"
          aria-label={`Global threat map with ${plottedHotspots.length} plotted hotspots`}
          data-testid="cti-real-map"
          className="cti-map h-[420px] min-h-[360px] w-full sm:h-[480px] [&_.maplibregl-canvas]:outline-none [&_.maplibregl-ctrl-attrib]:text-[10px] [&_.maplibregl-ctrl-group]:overflow-hidden [&_.maplibregl-ctrl-group]:rounded-md [&_.maplibregl-ctrl-group]:border [&_.maplibregl-ctrl-group]:border-border/70 [&_.maplibregl-ctrl-group]:shadow-sm"
        />

        {!mapReady && !mapError && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 text-sm text-muted-foreground backdrop-blur-sm">
            Loading threat map...
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/88 p-6 text-center backdrop-blur-sm">
            <div>
              <p className="text-sm font-semibold">Map unavailable</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">{mapError}</p>
            </div>
          </div>
        )}

        {mapReady && plottedHotspots.length === 0 && !mapError && (
          <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-border/70 bg-background/90 px-3 py-2 text-sm shadow-sm backdrop-blur">
            No mapped hotspots for this period.
          </div>
        )}

        {activeHotspot && <HotspotSummary hotspot={activeHotspot} />}
        <MapLegend unmappedCount={unmappedCount} />
      </div>
    </div>
  );
}
