"use client";

import { useAuth } from "@/context/auth-context";
import { RoomGrid } from "@/components/rooms/room-grid";
import { LogExpenseButton } from "@/components/expenses/log-expense-button";
import { isOwnerLikeRole } from "@/lib/roles";

export default function DashboardPage() {
  const { appUser } = useAuth();
  const isOwnerLike = isOwnerLikeRole(appUser?.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Welcome, {appUser?.displayName ?? appUser?.email}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isOwnerLike
              ? "Store-wide overview and controls."
              : "Front-desk overview for today's shift."}
          </p>
        </div>
        <LogExpenseButton />
      </div>

      <RoomGrid />
    </div>
  );
}
