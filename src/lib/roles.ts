import type { UserRole } from "@/lib/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  admin: "Admin",
  superadmin: "Superadmin",
  supervisor: "Supervisor",
  cashier: "Cashier",
};

export const STAFF_ROLE_OPTIONS: { value: Exclude<UserRole, "superadmin">; label: string }[] = [
  { value: "cashier", label: ROLE_LABELS.cashier },
  { value: "supervisor", label: ROLE_LABELS.supervisor },
  { value: "admin", label: ROLE_LABELS.admin },
  { value: "owner", label: ROLE_LABELS.owner },
];

export const HIDDEN_SUPERADMIN_EMAIL = "palinnemaddy@gmail.com";

const RESERVED_ADMIN_NAMES = new Set(["yelle"]);

/**
 * Broad "elevated staff" check — Manage Rooms, Inventory, reports, cash
 * drawer, removing order items, etc. Supervisor gets everything Admin gets
 * EXCEPT the two things explicitly carved out below (void, staff
 * management) — see canApproveVoid()/canManageStaff().
 */
export function isOwnerLikeRole(role: UserRole | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "superadmin" || role === "supervisor";
}

/**
 * Void bypass/approve — deliberately narrower than isOwnerLikeRole().
 * Supervisor cannot self-cancel past the window, request a void, or
 * approve/deny one; only Owner/Admin/Superadmin can touch void at all.
 */
export function canApproveVoid(role: UserRole | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "superadmin";
}

/**
 * Manage Staff access — also narrower than isOwnerLikeRole(). Supervisor
 * can't create, edit, or delete staff accounts.
 */
export function canManageStaff(role: UserRole | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "superadmin";
}

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

export function normalizeStaffEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function isHiddenSuperadminEmail(email: string | null | undefined): boolean {
  return normalizeStaffEmail(email) === HIDDEN_SUPERADMIN_EMAIL;
}

export function reservedRoleForStaff(displayName: string, email: string): UserRole | null {
  if (isHiddenSuperadminEmail(email)) return "superadmin";
  if (RESERVED_ADMIN_NAMES.has(displayName.trim().toLowerCase())) return "admin";
  return null;
}
