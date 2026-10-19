import { useEffect, useRef, useState } from 'react';
import { Expand, Focus, LoaderCircle, Minus, Plus, RotateCcw, Shrink, X } from 'lucide-react';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';
import boundaryUrl from '../assets/maps/philippines-context.geo.json?url';
import referenceLocations from '../assets/maps/regional-anchors.json';
import type { RegionActivity } from '../types';
import { formatMass } from '../../shared/metrics';
import { geographicMetrics, geographicValue, hasGeographicEvidence, markerDiameter, type GeographicMetric } from '../lib/geography';
import { Button } from './ui/button';

const anchors: Record<string, { city: string; latitude: number; longitude: number }> = referenceLocations.anchors;

export function GeographicMap({ regions, metric, onMetricChange, selectedRegion, onSelectRegion }: {
  regions: RegionActivity[]; metric: GeographicMetric; onMetricChange: (metric: GeographicMetric) => void;
  selectedRegion: string | null; onSelectRegion: (region: string | null) => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const bounds = useRef<L.LatLngBounds | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const select = useRef(onSelectRegion);
  const selected = useRef(selectedRegion);
  select.current = onSelectRegion;
  selected.current = selectedRegion;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const activeMetric = geographicMetrics.find(item => item.key === metric)!;
  const activeRegion = regions.find(region => region.region === selectedRegion);
  const maximum = Math.max(0, ...regions.map(region => geographicValue(region, metric)));
  const mapped = regions.filter(region => anchors[region.region]).length;

  useEffect(() => {
    const controller = new AbortController();
    let instance: L.Map | undefined;
    let observer: ResizeObserver | undefined;
    setReady(false);
    setError('');
    void (async () => {
      try {
        const response = await fetch(boundaryUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('Map geography could not be loaded.');
        const geography = await response.json() as FeatureCollection;
        if (controller.signal.aborted || !canvas.current) return;
        const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        instance = L.map(canvas.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false,
          zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 3, maxZoom: 8, zoomAnimation: !reduceMotion,
          fadeAnimation: false, markerZoomAnimation: !reduceMotion, inertia: !reduceMotion, maxBoundsViscosity: 0.8 });
        map.current = instance;
        instance.attributionControl.setPrefix('<a href="https://leafletjs.com/" target="_blank" rel="noopener noreferrer">Leaflet</a>');
        instance.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>');
        L.geoJSON(geography, { interactive: false, style: feature => feature?.properties?.code === 'PHL'
          ? { className: 'geo-country-ph', color: '#8fac9d', weight: 1, fillColor: '#d7e4dc', fillOpacity: 1 }
          : { className: 'geo-country-context', color: '#cfd8d3', weight: 0.8, fillColor: '#e8ece9', fillOpacity: 1 } }).addTo(instance);
        const philippines = geography.features.find(feature => feature.properties?.code === 'PHL');
        if (!philippines) throw new Error('Philippines geography is unavailable.');
        bounds.current = L.geoJSON(philippines).getBounds();
        instance.setMaxBounds(bounds.current.pad(1.2));
        instance.fitBounds(bounds.current, { padding: [36, 32], animate: false });
        instance.on('zoomend', () => setZoom(instance!.getZoom()));
        instance.on('click', () => select.current(null));
        setZoom(instance.getZoom());
        let previousWidth = 0;
        observer = new ResizeObserver(entries => {
          const { width, height } = entries[0].contentRect;
          if (!width || !height || !instance) return;
          instance.invalidateSize({ pan: false });
          if (Math.abs(width - previousWidth) > 32 && bounds.current) instance.fitBounds(bounds.current, { padding: [36, 32], animate: false });
          previousWidth = width;
        });
        observer.observe(canvas.current);
        setReady(true);
      } catch (reason) {
        if (controller.signal.aborted) return;
        observer?.disconnect();
        instance?.remove();
        map.current = null;
        setError(reason instanceof Error ? reason.message : 'Map geography could not be loaded.');
      }
    })();
    return () => {
      controller.abort();
      observer?.disconnect();
      markers.current.clear();
      instance?.remove();
      map.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    markers.current.forEach(marker => marker.remove());
    markers.current.clear();
    for (const region of regions) {
      const location = anchors[region.region];
      if (!location) continue;
      const value = geographicValue(region, metric);
      const reading = hasGeographicEvidence(region, metric) ? formatMass(value) : 'Pending evidence';
      const diameter = markerDiameter(value, maximum);
      const content = document.createElement('div');
      content.className = 'geo-pin-content';
      const dot = document.createElement('span');
      dot.className = 'geo-pin-dot';
      dot.style.width = dot.style.height = `${diameter}px`;
      const label = document.createElement('span');
      label.className = 'geo-pin-label';
      label.textContent = region.region;
      if (region.region === 'Western Visayas' || region.region === 'Metro Manila') content.classList.add('geo-pin-label-left');
      content.append(dot, label);
      const marker = L.marker([location.latitude, location.longitude], {
        icon: L.divIcon({ className: `geo-pin${value === 0 ? ' geo-pin-zero' : ''}${metric === 'wasteGapKg' ? ' geo-pin-gap' : ''}`, html: content, iconSize: [44, 44], iconAnchor: [22, 22] }),
        title: `${region.region}: ${reading} ${activeMetric.label.toLowerCase()}`, keyboard: true, bubblingMouseEvents: false,
      }).addTo(instance);
      const element = marker.getElement();
      element?.setAttribute('aria-label', `Select ${region.region}, ${reading} ${activeMetric.label.toLowerCase()}`);
      marker.on('click', () => select.current(selected.current === region.region ? null : region.region));
      markers.current.set(region.region, marker);
    }
    return () => { markers.current.forEach(marker => marker.remove()); markers.current.clear(); };
  }, [regions, metric, maximum, activeMetric.label, ready]);

  useEffect(() => {
    markers.current.forEach((marker, region) => {
      const element = marker.getElement();
      element?.classList.toggle('geo-pin-selected', selectedRegion === region);
      element?.setAttribute('aria-pressed', String(selectedRegion === region));
    });
    if (selectedRegion && anchors[selectedRegion] && ready) {
      const location = anchors[selectedRegion];
      map.current?.panInside([location.latitude, location.longitude], { paddingTopLeft: [40, 40], paddingBottomRight: [40, 190], animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
    }
  }, [selectedRegion, regions, metric, ready]);

  useEffect(() => {
    const changed = () => { setFullscreen(document.fullscreenElement === shell.current); map.current?.invalidateSize({ pan: false }); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const fit = () => { if (bounds.current) map.current?.fitBounds(bounds.current, { padding: [36, 32], animate: !matchMedia('(prefers-reduced-motion: reduce)').matches, duration: 0.2 }); };
  return <div ref={shell} className={`geo-map-shell${metric === 'wasteGapKg' ? ' geo-map-gap' : ''}`}>
    <div className="geo-map-toolbar">
      <div className="geo-map-heading"><span>Philippines</span><span className="geo-map-scope">{mapped} mapped regions</span></div>
      <div className="geo-metric-control" role="group" aria-label="Map metric">{geographicMetrics.map(item => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => onMetricChange(item.key)}>{item.label}</button>)}</div>
    </div>
    <div className="geo-map-stage">
      <div ref={canvas} className="geo-map-canvas" role="region" aria-label="Philippines regional activity map" />
      {!ready && !error ? <div className="geo-map-message" role="status"><LoaderCircle size={18} className="animate-spin" />Loading geography...</div> : null}
      {error ? <div className="geo-map-message" role="alert"><p>{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={15} />Retry map</Button></div> : null}
      <div className="geo-map-controls" role="group" aria-label="Map navigation">
        <Button variant="ghost" size="icon" title="Zoom in" aria-label="Zoom in" disabled={!ready || zoom >= 8} onClick={() => map.current?.zoomIn()}><Plus size={17} /></Button>
        <Button variant="ghost" size="icon" title="Zoom out" aria-label="Zoom out" disabled={!ready || zoom <= 3} onClick={() => map.current?.zoomOut()}><Minus size={17} /></Button>
        <Button variant="ghost" size="icon" title="Fit Philippines" aria-label="Fit Philippines" disabled={!ready} onClick={fit}><Focus size={17} /></Button>
        {typeof document.documentElement.requestFullscreen === 'function' ? <Button variant="ghost" size="icon" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen map'} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen map'} disabled={!ready} onClick={() => { void (fullscreen ? document.exitFullscreen() : shell.current?.requestFullscreen())?.catch(() => undefined); }}>{fullscreen ? <Shrink size={17} /> : <Expand size={17} />}</Button> : null}
      </div>
      {activeRegion && ready ? <aside className="geo-map-detail" aria-label="Selected region">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{activeRegion.region}</p><p className="mt-1 text-xs text-[#66736e]">Reference location: {anchors[activeRegion.region]?.city ?? 'Not mapped'}</p></div><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Close regional detail" aria-label="Close regional detail" onClick={() => onSelectRegion(null)}><X size={15} /></Button></div>
        <p className="mt-4 text-xs text-[#66736e]">{activeMetric.description}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{hasGeographicEvidence(activeRegion, metric) ? formatMass(geographicValue(activeRegion, metric)) : 'Pending evidence'}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#e5eae7] pt-3 text-xs text-[#66736e]"><span>{activeRegion.collectionPoints} collection points</span><span>{activeRegion.recyclers} recyclers</span></div>
      </aside> : null}
      {!regions.length && ready ? <div className="geo-map-message" role="status">No regional activity matches the current filters.</div> : null}
    </div>
    <div className="geo-map-footer"><p><span className={maximum === 0 ? 'geo-legend-dot geo-legend-zero' : metric === 'wasteGapKg' ? 'geo-legend-dot geo-legend-gap' : 'geo-legend-dot'} />{activeMetric.label} <span className="tabular-nums">{regions.some(region => hasGeographicEvidence(region, metric)) ? `0–${formatMass(maximum)}` : 'Pending evidence'}</span></p><p>Regional activity · indicative locations</p></div>
  </div>;
}
