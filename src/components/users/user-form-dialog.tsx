"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createStaffUser, updateStaffUser, type StaffUser } from "@/lib/users";
import type { UserRole } from "@/lib/types";
import { canManageStaff, roleLabel, STAFF_ROLE_OPTIONS } from "@/lib/roles";
import { useAuth } from "@/context/auth-context";
import { Loader2Icon } from "lucide-react";

interface UserFormDialogProps {
  user?: StaffUser;
  onClose: () => void;
}

export function UserFormDialog({ user, onClose }: UserFormDialogProps) {
  const { appUser } = useAuth();
  const isEditing = !!user;
  const isEditingSelf = isEditing && user.uid === appUser?.uid;
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState<UserRole>(user?.role ?? "cashier");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!displayName.trim()) {
      toast.error("Name is required.");
      return;
    }

    if (isEditing) {
      if (isEditingSelf && !canManageStaff(role)) {
        toast.error("You can't remove your own Manage Staff access this way.");
        return;
      }
      setSubmitting(true);
      try {
        await updateStaffUser(user.uid, { displayName: displayName.trim(), role });
        toast.success(`${displayName.trim()} updated.`);
        onClose();
      } catch {
        toast.error("Couldn't update the account — please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!email.trim()) {
      toast.error("Email is required.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await createStaffUser({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        role,
      });
      toast.success(`${displayName} added as ${roleLabel(role)}.`);
      onClose();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "auth/email-already-in-use") {
        toast.error("An account with that email already exists.");
      } else {
        toast.error("Couldn't create the account — please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit staff account" : "Add staff account"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update their name or role."
              : "Creates their sign-in and assigns their role — nothing else needed."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting || isEditing}
            />
            {isEditing && (
              <p className="text-xs text-muted-foreground">
                Email is the sign-in address and can&apos;t be changed here — delete and re-add
                the account if it&apos;s wrong.
              </p>
            )}
          </div>
          {!isEditing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Temporary password</Label>
              <Input
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder="At least 6 characters"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)} disabled={submitting}>
              <SelectTrigger className="w-full">
                <SelectValue>{roleLabel(role)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STAFF_ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            {isEditing ? "Save changes" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
