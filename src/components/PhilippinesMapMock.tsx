import { Factory, MapPin, Recycle } from 'lucide-react';
import type { RegionActivity } from '../types';
import { Progress } from './ui/progress';

export function PhilippinesMapMock({ regions }: { regions: RegionActivity[] }) {
  const largestCollection = Math.max(...regions.map((region) => region.collectionKg));

  return (
    <div className="grid min-h-[420px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50/50 md:grid-cols-[0.85fr_1.15fr]">
      <div className="relative min-h-[390px] overflow-hidden border-b border-slate-200 bg-sky-50/40 md:border-b-0 md:border-r">
        <img src="/philippines-map.png" alt="Map of the Philippines" className="absolute inset-y-5 left-1/2 h-[350px] w-auto -translate-x-1/2 object-contain opacity-35 grayscale" />
        {regions.map((region) => (
          <span
            key={region.region}
            className="fade-enter absolute grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow ring-1 ring-emerald-700"
            style={{ left: `${region.x}%`, top: `${region.y}%` }}
            title={`${region.region}: ${region.collectionKg.toLocaleString()} kg collected`}
            aria-label={`${region.region}: ${region.collectionKg.toLocaleString()} kilograms collected`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
          </span>
        ))}
        <div className="absolute bottom-3 left-3 rounded-md border border-slate-200 bg-white/90 px-2.5 py-1.5 text-[11px] text-slate-500">Pilot activity locations</div>
      </div>

      <div className="stagger-grid divide-y divide-slate-200 bg-white px-5">
        {regions.map((region) => (
          <article key={region.region} className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{region.region}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} />{region.city}</p>
              </div>
              <p className="shrink-0 text-sm font-semibold text-slate-900">{Math.round(region.collectionKg).toLocaleString()} kg</p>
            </div>
            <Progress value={(region.collectionKg / largestCollection) * 100} className="mt-3 h-1.5" />
            <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Factory size={12} />{region.collectionPoints} collection points</span>
              <span className="flex items-center gap-1"><Recycle size={12} />{region.recyclers} recyclers</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
