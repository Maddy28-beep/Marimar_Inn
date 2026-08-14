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
import { createStaffUser } from "@/lib/users";
import type { UserRole } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

interface UserFormDialogProps {
  onClose: () => void;
}

export function UserFormDialog({ onClose }: UserFormDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("cashier");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !displayName.trim()) {
      toast.error("Email and display name are required.");
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
      toast.success(`${displayName} added as ${role}.`);
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add staff account</DialogTitle>
          <DialogDescription>
            Creates their sign-in and assigns their role — nothing else needed.
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
              disabled={submitting}
            />
          </div>
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
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)} disabled={submitting}>
              <SelectTrigger className="w-full">
                <SelectValue>{role === "owner" ? "Owner" : "Cashier"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cashier">Cashier</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
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
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
