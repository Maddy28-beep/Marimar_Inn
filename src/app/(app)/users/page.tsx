"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { subscribeToUsers, type StaffUser } from "@/lib/users";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { PlusIcon } from "lucide-react";

function ManageStaffContent() {
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    return subscribeToUsers(setUsers);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Manage Staff</h1>
          <p className="text-sm text-muted-foreground">
            Create sign-ins for Owner and Cashier accounts.
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
            </tr>
          </thead>
          <tbody>
            {users?.map((user) => (
              <tr key={user.uid} className="border-t">
                <td className="px-4 py-2 font-medium">{user.displayName}</td>
                <td className="px-4 py-2 text-muted-foreground">{user.email}</td>
                <td className="px-4 py-2">
                  <Badge variant="secondary" className="capitalize">
                    {user.role}
                  </Badge>
                </td>
              </tr>
            ))}
            {users?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {dialogOpen && <UserFormDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}

export default function ManageStaffPage() {
  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <ManageStaffContent />
    </ProtectedRoute>
  );
}
