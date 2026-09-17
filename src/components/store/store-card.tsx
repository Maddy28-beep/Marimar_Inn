"use client";

import { cn } from "@/lib/utils";

// Pre-resized/compressed to ~105KB (was a 2.4MB source) — see the same
// note in room-card.tsx.
const STORE_PHOTO_SRC = "/logo/store.jpg";

export function StoreCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Same fixed h-72 as room cards, so the Store card lines up in
        // the same grid row instead of standing out as a different height.
        "relative flex h-72 w-full flex-col overflow-hidden rounded-2xl border border-sky-500/30 bg-card text-left shadow-lg shadow-black/5 ring-1 ring-inset ring-white/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:shadow-black/20 dark:ring-white/10"
      )}
    >
      <div className="relative h-28 w-full shrink-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={STORE_PHOTO_SRC} alt="" className="h-full w-full object-cover" />
        <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white uppercase shadow">
          Walk-in
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
        <div className="h-10 shrink-0">
          <div className="truncate font-heading text-base leading-tight font-bold tracking-wide uppercase">
            Walk-in Store
          </div>
          <div className="truncate text-xs leading-tight text-muted-foreground">Guest Essentials</div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
          <div className="truncate text-sm font-medium text-sky-700 dark:text-sky-300">
            Colgate • Shampoo • Water • Snacks
          </div>
        </div>
        <div className="flex h-8 shrink-0 items-center justify-center rounded-lg border border-sky-600/40 text-sm font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10">
          Open Store
        </div>
      </div>
    </button>
  );
}
