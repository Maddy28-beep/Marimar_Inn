"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { canManageStaff } from "@/lib/roles";
import { useBranch } from "@/context/branch-context";
import { branchName } from "@/lib/branches";

const ALL_BRANCHES = "__all__";

export function BranchSwitcher() {
  const { branchId, allowed, switchBranch } = useBranch();
  const { appUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const viewingAll = canManageStaff(appUser?.role) && pathname === "/branches";
  const canSeeAll = canManageStaff(appUser?.role);

  // Staff with a single branch just see its name, no dropdown.
  if (allowed.length <= 1) {
    return (
      <span className="shrink-0 whitespace-nowrap rounded-md bg-muted px-2 py-1 text-sm font-medium">
        {branchName(branchId)}
      </span>
    );
  }

  return (
    <select
      aria-label="Branch"
      value={viewingAll ? ALL_BRANCHES : branchId}
      onChange={(e) => {
        // "All Branches" isn't a branch to work in — it opens the combined
        // totals page. Picking a real branch from there goes back to rooms.
        if (e.target.value === ALL_BRANCHES) {
          router.push("/branches");
          return;
        }
        switchBranch(e.target.value);
        if (viewingAll) router.push("/dashboard");
      }}
      className="h-8 shrink-0 rounded-md border bg-background px-2 text-sm font-medium"
    >
      {allowed.map((id) => (
        <option key={id} value={id}>
          {branchName(id)}
        </option>
      ))}
      {canSeeAll && <option value={ALL_BRANCHES}>All Branches</option>}
    </select>
  );
}
