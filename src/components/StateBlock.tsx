import { AlertCircle, Loader2 } from 'lucide-react';

export function LoadingBlock({ label = 'Loading sample dashboard data' }: { label?: string }) {
  return (
    <div className="section-enter grid min-h-80 place-items-center rounded-md border border-slate-200 bg-white">
      <div className="flex items-center gap-3 text-sm font-medium text-textile-ink/70">
        <Loader2 className="animate-spin" size={18} />
        {label}
      </div>
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="section-enter grid min-h-80 place-items-center rounded-lg border border-red-200 bg-red-50/60">
      <div className="flex items-center gap-3 text-sm font-medium text-red-700">
        <AlertCircle size={18} />
        {message}
      </div>
    </div>
  );
}

export function EmptyBlock({ label = 'No matching sample records.' }: { label?: string }) {
  return (
    <div className="section-enter rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}
