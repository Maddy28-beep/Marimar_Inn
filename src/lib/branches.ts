import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import type { UserRole } from "@/lib/types";

export interface Branch {
  id: string;
  name: string;
}

// The first branch is the original, live Marimar Inn — its data stays in the
// root collections (bookings, rooms, ...) exactly where it already is, so
// adding branches needs no migration of production data. Every other branch
// keeps its own copy of the same collections under branches/{id}/....
export const DEFAULT_BRANCH_ID = "marimar-1";

export const BRANCHES: Branch[] = [
  { id: "marimar-1", name: "Marimar 1" },
  { id: "marimar-2", name: "Marimar 2" },
  { id: "marimar-3", name: "Marimar 3" },
];

const STORAGE_KEY = "marimar.activeBranch";

export function isValidBranchId(id: string | null | undefined): id is string {
  return !!id && BRANCHES.some((b) => b.id === id);
}

export function branchName(id: string): string {
  return BRANCHES.find((b) => b.id === id)?.name ?? id;
}

let activeBranchId = DEFAULT_BRANCH_ID;

// Hydrate from the last-used branch on this device so a tablet stays on the
// branch it's physically in across reloads.
if (typeof window !== "undefined") {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isValidBranchId(saved)) activeBranchId = saved;
  } catch {
    // localStorage can be blocked; fall back to the default branch.
  }
}

export function getActiveBranchId(): string {
  return activeBranchId;
}

export function setActiveBranchId(id: string) {
  if (!isValidBranchId(id)) return;
  activeBranchId = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Non-fatal — just won't be remembered next load.
  }
}

/** Owner/Admin/Superadmin see every branch; others only the ones assigned
 *  to them (accounts with none assigned stay on the original branch). */
export function allowedBranchIds(role: UserRole, branchIds?: string[]): string[] {
  if (role === "owner" || role === "admin" || role === "superadmin") {
    return BRANCHES.map((b) => b.id);
  }
  const assigned = (branchIds ?? []).filter(isValidBranchId);
  return assigned.length > 0 ? assigned : [DEFAULT_BRANCH_ID];
}

function pathFor(name: string, branchId: string = activeBranchId): string {
  return branchId === DEFAULT_BRANCH_ID ? name : `branches/${branchId}/${name}`;
}

/** Branch-scoped stand-in for collection(firestore, name). */
export function bCollection(
  firestore: Firestore,
  name: string,
  branchId?: string
): CollectionReference {
  return collection(firestore, pathFor(name, branchId));
}

/** Branch-scoped stand-in for doc(firestore, name, id). */
export function bDoc(firestore: Firestore, name: string, id: string): DocumentReference {
  return doc(firestore, pathFor(name), id);
}
