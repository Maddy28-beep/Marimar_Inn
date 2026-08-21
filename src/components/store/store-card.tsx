"use client";

import { cn } from "@/lib/utils";

export function StoreCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-36 w-full flex-col gap-1 overflow-hidden rounded-2xl border p-3 pl-3.5 text-left shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1.5",
        "border-sky-500/30 bg-sky-500/10 before:bg-sky-500"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-heading text-xl leading-none font-semibold tracking-tight">Store</span>
        <span className="mt-1 size-2.5 shrink-0 rounded-full bg-sky-500" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="rounded-full bg-sky-600/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-sky-800 uppercase dark:text-sky-300">
          Walk-in
        </span>
        <span className="truncate text-xs text-muted-foreground">No room</span>
      </div>
      <div className="mt-auto text-sm font-medium text-sky-800 dark:text-sky-300">
        Colgate, shampoo, water…
      </div>
    </button>
  );
}
