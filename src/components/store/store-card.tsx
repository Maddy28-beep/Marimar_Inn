"use client";

import { cn } from "@/lib/utils";

export function StoreCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // display:block with the layout on the inner <div> — see CARD_SHELL
        // in room-card.tsx (WebKit shrink-wraps a flex <button>'s children).
        // Same three-band structure as the room cards (top band, sheet row,
        // body) at the same h-36 so the grid reads as one set, but with a
        // single wide label instead of two pillows — it's a counter, not a bed.
        "relative block h-36 w-full overflow-hidden rounded-2xl border text-left shadow-lg shadow-black/5 backdrop-blur-md backdrop-saturate-150 ring-1 ring-inset ring-white/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:shadow-black/20 dark:ring-white/10",
        "border-sky-500/30 bg-sky-500/10"
      )}
    >
      <div className="flex h-full w-full flex-col">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-sky-500/30 bg-sky-600/25 px-2 py-1">
          <div className="flex h-6 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/85 shadow-sm ring-1 ring-black/5 dark:bg-white/15 dark:ring-white/10">
            <span className="font-heading text-lg leading-none font-semibold tracking-tight">Store</span>
            <span className="size-2.5 shrink-0 rounded-full bg-sky-500" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border-b border-white/50 bg-white/40 px-3 py-0.5 dark:border-white/10 dark:bg-white/5">
          <span className="rounded-full bg-sky-600/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-sky-800 uppercase dark:text-sky-300">
            Walk-in
          </span>
          <span className="truncate text-xs text-muted-foreground">No room</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-end px-3 pt-1 pb-2">
          <div className="text-sm font-medium text-sky-800 dark:text-sky-300">Colgate, shampoo, water…</div>
        </div>
      </div>
    </button>
  );
}
