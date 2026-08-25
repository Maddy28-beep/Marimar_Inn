"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { useAuth } from "@/context/auth-context";
import {
  deleteStaffUser,
  resetStaffPassword,
  setStaffActive,
  subscribeToUsers,
  type StaffUser,
} from "@/lib/users";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  KeyRoundIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  TrashIcon,
} from "lucide-react";

function ManageStaffContent() {
  const { appUser } = useAuth();
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<StaffUser | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToUsers(setUsers);
  }, []);

  async function handleResetPassword(user: StaffUser) {
    setBusyUid(user.uid);
    try {
      await resetStaffPassword(user.email);
      toast.success(`Password reset email sent to ${user.email}.`);
    } catch {
      toast.error("Couldn't send the reset email — please try again.");
    } finally {
      setBusyUid(null);
    }
  }

  async function handleToggleActive(user: StaffUser) {
    const isActive = user.active !== false;
    if (isActive && user.uid === appUser?.uid) {
      toast.error("You can't deactivate your own account.");
      return;
    }
    if (
      isActive &&
      !window.confirm(`Deactivate ${user.displayName}? They won't be able to sign in until reactivated.`)
    ) {
      return;
    }
    setBusyUid(user.uid);
    try {
      await setStaffActive(user.uid, !isActive);
      toast.success(isActive ? `${user.displayName} deactivated.` : `${user.displayName} reactivated.`);
    } catch {
      toast.error("Couldn't update this account — please try again.");
    } finally {
      setBusyUid(null);
    }
  }

  async function handleDelete(user: StaffUser) {
    if (user.uid === appUser?.uid) {
      toast.error("You can't delete your own account.");
      return;
    }
    if (!window.confirm(`Delete ${user.displayName}'s account? This can't be undone.`)) return;
    setBusyUid(user.uid);
    try {
      await deleteStaffUser(user.uid);
      toast.success(`${user.displayName} removed.`);
    } catch {
      toast.error("Couldn't delete the account — please try again.");
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Manage Staff</h1>
          <p className="text-sm text-muted-foreground">
            Create sign-ins for Owner, Admin, and Cashier accounts.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <PlusIcon className="size-4" />
          Add staff
        </Button>
      </div>

      <div className="rounded-xl border">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user) => {
              const isActive = user.active !== false;
              return (
              <tr key={user.uid} className={cn("border-t", !isActive && "opacity-60")}>
                <td className="px-4 py-2 font-medium">{user.displayName}</td>
                <td className="px-4 py-2 text-muted-foreground">{user.email}</td>
                <td className="px-4 py-2">
                  <Badge variant="secondary" className="capitalize">
                    {roleLabel(user.role)}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  {isActive ? (
                    <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">
                      Inactive
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingUser(user)}
                      disabled={busyUid === user.uid}
                      title="Edit name or role"
                    >
                      <PencilIcon className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResetPassword(user)}
                      disabled={busyUid === user.uid}
                      title="Send password reset email"
                    >
                      {busyUid === user.uid ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        <KeyRoundIcon className="size-3.5" />
                      )}
                      Reset password
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(user)}
                      disabled={busyUid === user.uid || (isActive && user.uid === appUser?.uid)}
                      title={isActive ? "Deactivate — blocks sign-in until reactivated" : "Reactivate"}
                    >
                      {isActive ? (
                        <PowerOffIcon className="size-3.5" />
                      ) : (
                        <PowerIcon className="size-3.5" />
                      )}
                      {isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(user)}
                      disabled={busyUid === user.uid || user.uid === appUser?.uid}
                      className="text-destructive hover:text-destructive"
                      title="Delete account"
                    >
                      <TrashIcon className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
              );
            })}
            {users?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {dialogOpen && <UserFormDialog onClose={() => setDialogOpen(false)} />}
      {editingUser && (
        <UserFormDialog user={editingUser} onClose={() => setEditingUser(null)} />
      )}
    </div>
  );
}

export default function ManageStaffPage() {
  return (
    <ProtectedRoute allowedRoles={["owner", "admin", "superadmin"]}>
      <ManageStaffContent />
    </ProtectedRoute>
  );
}
