"use client";

import { useBranch } from "@/context/branch-context";
import { branchName } from "@/lib/branches";

export function BranchSwitcher() {
  const { branchId, allowed, switchBranch } = useBranch();

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
      value={branchId}
      onChange={(e) => switchBranch(e.target.value)}
      className="h-8 shrink-0 rounded-md border bg-background px-2 text-sm font-medium"
    >
      {allowed.map((id) => (
        <option key={id} value={id}>
          {branchName(id)}
        </option>
      ))}
    </select>
  );
}
