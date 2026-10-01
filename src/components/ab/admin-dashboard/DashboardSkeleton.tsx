import { cn } from "@/lib/utils";

function Block({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-2/80 motion-reduce:animate-none", className)}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="pb-8">
      <div className="flex flex-col gap-4 border-b border-border/60 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full max-w-md space-y-2">
          <Block className="h-3 w-40" />
          <Block className="h-7 w-64" />
          <Block className="h-3 w-72" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Block className="h-8 w-28" />
          <Block className="h-8 w-24" />
          <Block className="h-8 w-28" />
        </div>
      </div>

      <div className="grid gap-2 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-surface px-4 py-3.5 ring-1 ring-inset ring-border/50">
            <Block className="h-2.5 w-20" />
            <Block className="mt-3 h-7 w-24" />
            <Block className="mt-2 h-2.5 w-28" />
          </div>
        ))}
      </div>

      <div className="px-4 sm:px-6">
        <Block className="mb-3 h-5 w-40" />
        <div className="rounded-lg bg-surface p-3 ring-1 ring-inset ring-border/50 space-y-3">
          <Block className="h-10 w-full" />
          <Block className="h-10 w-full" />
          <Block className="h-10 w-3/4" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 px-4 sm:px-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div>
            <Block className="mb-3 h-5 w-44" />
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg bg-surface p-3 ring-1 ring-inset ring-border/50">
                  <Block className="h-2.5 w-16" />
                  <Block className="mt-2 h-6 w-10" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <Block className="mb-3 h-5 w-36" />
            <Block className="h-40 w-full rounded-lg" />
          </div>
          <div>
            <Block className="mb-3 h-5 w-48" />
            <Block className="h-28 w-full rounded-lg" />
          </div>
        </div>
        <div className="space-y-6">
          <div>
            <Block className="mb-3 h-5 w-32" />
            <Block className="h-40 w-full rounded-lg" />
          </div>
          <div>
            <Block className="mb-3 h-5 w-28" />
            <Block className="h-24 w-full rounded-lg" />
          </div>
          <div>
            <Block className="mb-3 h-5 w-36" />
            <Block className="h-48 w-full rounded-lg" />
          </div>
        </div>
      </div>
      <p className="sr-only">Loading operational overview…</p>
    </div>
  );
}
