import { Filter, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { Filters } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select as SelectControl } from './ui/select';

const initialFilters: Filters = {
  dateRange: 'Last 90 days', region: 'All regions', city: '', textileType: 'All textiles',
  transactionType: 'All types', stakeholderType: 'All stakeholders', producer: '', recycler: '',
  wasteSource: 'All sources', circularPathway: 'All pathways', weightStatus: 'All weight statuses', facilityId: 'All facilities', organizationId: 'All organizations', transactionStatus: 'All statuses',
};

export { initialFilters };

export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (filters: Filters) => void }) {
  const [expanded, setExpanded] = useState(false);
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const activeCount = Object.entries(filters).filter(([key, value]) => value !== initialFilters[key as keyof Filters]).length;

  return (
    <section className="surface-panel rounded-md p-3 sm:p-3.5">
      <div className="mb-3 flex items-center justify-between border-b border-[#edf0ee] pb-3 xl:hidden">
        <div className="flex items-center gap-2 text-xs font-medium text-[#53615c]"><Filter size={14} />Global view</div>
        <span className="text-[11px] text-[#8b9893]">Updates all page data</span>
      </div>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
        <div className="hidden h-9 items-center gap-2 self-end pr-2 text-xs font-medium text-[#53615c] xl:flex"><Filter size={14} />Global view</div>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Date range" value={filters.dateRange} onChange={(value) => update('dateRange', value)} options={['Last 30 days', 'Last 90 days', 'Year to date', 'Pilot period']} />
          <Select label="Region" value={filters.region} onChange={(value) => update('region', value as Filters['region'])} options={['All regions', 'Metro Manila', 'Central Visayas', 'Western Visayas', 'Davao Region']} />
          <Select label="Textile type" value={filters.textileType} onChange={(value) => update('textileType', value as Filters['textileType'])} options={['All textiles', 'Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms', 'Household linen']} />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setExpanded((value) => !value)} className="flex-1 border-[#cfd8d4] xl:flex-none"><SlidersHorizontal size={16} />More filters{activeCount > 0 ? <Badge className="ml-1 h-5 min-w-5 justify-center px-1.5">{activeCount}</Badge> : null}</Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(initialFilters)} title="Reset filters" aria-label="Reset filters"><RotateCcw size={16} /></Button>
        </div>
      </div>
      {expanded ? (
        <div className="expand-enter mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          <Text label="City" value={filters.city} placeholder="Any city" onChange={(value) => update('city', value)} />
          <Select label="Transaction" value={filters.transactionType} onChange={(value) => update('transactionType', value as Filters['transactionType'])} options={['All types', 'Barter', 'Return', 'Donation', 'Collection', 'Recycling', 'Redistribution']} />
          <Select label="Stakeholder" value={filters.stakeholderType} onChange={(value) => update('stakeholderType', value as Filters['stakeholderType'])} options={['All stakeholders', 'Administrator', 'Government', 'Researcher', 'Producer', 'Recycler', 'Consumer', 'NGO', 'LGU/Collection Point', 'Upcycler']} />
          <Select label="Waste source" value={filters.wasteSource} onChange={(value) => update('wasteSource', value as Filters['wasteSource'])} options={['All sources', 'Pre-consumer', 'Post-consumer', 'Obsolete inventory', 'Household', 'Institutional', 'Unknown']} />
          <Select label="Circular pathway" value={filters.circularPathway} onChange={(value) => update('circularPathway', value as Filters['circularPathway'])} options={['All pathways', 'Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'For assessment']} />
          <Select label="Weight status" value={filters.weightStatus} onChange={(value) => update('weightStatus', value as Filters['weightStatus'])} options={['All weight statuses', 'Estimated', 'Measured', 'Verified']} />
          <Text label="Facility" value={filters.facilityId === 'All facilities' ? '' : filters.facilityId} placeholder="Facility ID" onChange={(value) => update('facilityId', value || 'All facilities')} />
          <Text label="Organization" value={filters.organizationId === 'All organizations' ? '' : filters.organizationId} placeholder="Organization ID" onChange={(value) => update('organizationId', value || 'All organizations')} />
          <Select label="Workflow status" value={filters.transactionStatus} onChange={(value) => update('transactionStatus', value)} options={['All statuses', 'Reserved', 'Handed over', 'Received', 'Validated', 'Completed', 'Cancelled', 'Rejected', 'Disputed', 'Recorded', 'Flagged']} />
          <Text label="Producer" value={filters.producer} placeholder="Search producer" onChange={(value) => update('producer', value)} />
          <Text label="Recycler" value={filters.recycler} placeholder="Search recycler" onChange={(value) => update('recycler', value)} />
        </div>
      ) : null}
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) { return <span className="mb-1.5 block text-[11px] font-medium text-[#66736e]">{children}</span>; }

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="block"><FieldLabel>{label}</FieldLabel><SelectControl value={value} onChange={(event) => onChange(event.target.value)}>{options.map((item) => <option key={item}>{item}</option>)}</SelectControl></label>;
}

function Text({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="block"><FieldLabel>{label}</FieldLabel><Input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}
