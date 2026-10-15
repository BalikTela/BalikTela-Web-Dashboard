import { useId, type InputHTMLAttributes } from 'react';

export function Switch({ id, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <span className="relative inline-flex h-5 w-9 shrink-0">
      <input id={inputId} type="checkbox" className="peer sr-only" {...props} />
      <span className="absolute inset-0 rounded-full bg-slate-200 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </span>
  );
}
