import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-app-panel-muted/80", className)}
      aria-hidden
      {...props}
    />
  );
}

export function PageSkeleton({ rows = 6, title = true, kpis = 0, className }) {
  return (
    <div className={cn("animate-fadein space-y-4", className)} role="status" aria-live="polite" aria-label="Loading">
      {title ? (
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
      ) : null}
      {kpis > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : null}
      <div className="space-y-2 rounded-xl border border-app-border bg-app-panel p-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="animate-fadein nx-ledger space-y-4" role="status" aria-live="polite" aria-label="Loading dashboard">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}

export function ListSkeleton({ rows = 8 }) {
  return <PageSkeleton rows={rows} kpis={0} />;
}
