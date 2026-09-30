"use client";

import { createContext, Fragment, useCallback, useContext, useMemo, useState } from "react";
import { useAuth } from "@/context/auth-context";
import {
  allowedBranchIds,
  branchName,
  getActiveBranchId,
  setActiveBranchId,
} from "@/lib/branches";

interface BranchContextValue {
  branchId: string;
  branchLabel: string;
  allowed: string[];
  switchBranch: (id: string) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

/**
 * Holds the branch the signed-in user is working in. The data layer reads
 * the active branch from a module-level value (lib/branches.ts), so the
 * subtree is keyed by branch id: switching remounts every page and provider
 * beneath it, which re-subscribes all listeners against the new branch's
 * collections instead of leaving stale data from the old one on screen.
 */
export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { appUser } = useAuth();
  const [selected, setSelected] = useState(getActiveBranchId);

  const allowed = useMemo(
    () => (appUser ? allowedBranchIds(appUser.role, appUser.branchIds) : []),
    [appUser]
  );
  const branchId = allowed.includes(selected) ? selected : (allowed[0] ?? selected);
  // Must be in place before any child renders and subscribes.
  setActiveBranchId(branchId);

  const switchBranch = useCallback(
    (id: string) => {
      if (allowed.includes(id)) setSelected(id);
    },
    [allowed]
  );

  const value = useMemo(
    () => ({ branchId, branchLabel: branchName(branchId), allowed, switchBranch }),
    [branchId, allowed, switchBranch]
  );

  return (
    <BranchContext.Provider value={value}>
      <Fragment key={branchId}>{children}</Fragment>
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const context = useContext(BranchContext);
  if (!context) throw new Error("useBranch must be used within a BranchProvider");
  return context;
}
