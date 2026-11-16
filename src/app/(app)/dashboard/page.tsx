"use client";

import { useAuth } from "@/context/auth-context";
import { RoomGrid } from "@/components/rooms/room-grid";
import { LogExpenseButton } from "@/components/expenses/log-expense-button";
import { isOwnerLikeRole } from "@/lib/roles";
import { SparklesIcon } from "lucide-react";

export default function DashboardPage() {
  const { appUser } = useAuth();
  const isOwnerLike = isOwnerLikeRole(appUser?.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="christmas-welcome flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="christmas-eyebrow"><SparklesIcon aria-hidden="true" /> A little Christmas at Marimar Inn</div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Welcome, {appUser?.displayName ?? appUser?.email}!
          </h1>
          <p className="christmas-welcome-copy">Celebrate the season with a warm and wonderful stay at Marimar Inn.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isOwnerLike
              ? "Store-wide overview and controls."
              : "Front-desk overview for today's shift."}
          </p>
          <p className="christmas-welcome-signoff">Merry Christmas!</p>
        </div>
        <div className="christmas-welcome-actions">
          <span>Warm welcomes. Wonderful stays.</span>
        <LogExpenseButton />
        </div>
      </div>

      <RoomGrid />
    </div>
  );
}
