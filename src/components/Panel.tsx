export function Panel({ children }: { children: React.ReactNode }) {
  return <section className="dashboard-panel surface-panel min-w-0 overflow-hidden rounded-md p-4 sm:p-6">{children}</section>;
}
