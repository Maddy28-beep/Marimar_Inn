"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";
import { recordShiftExpense } from "@/lib/expenses";

export function AddExpenseForm({
  onSaved,
  submitLabel = "Add expense",
}: {
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const { appUser } = useAuth();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!appUser) return;
    setSaving(true);
    try {
      await recordShiftExpense({
        amount: Number(amount),
        description,
        cashierId: appUser.uid,
        cashierName: appUser.displayName || appUser.email || "Staff",
      });
      setAmount("");
      setDescription("");
      toast.success("Expense recorded. It will show on this shift's report.");
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the expense.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Input
        placeholder="What for (e.g. water, fare)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={120}
        className="sm:flex-1"
      />
      <Input
        type="number"
        min="0.01"
        step="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-32"
      />
      <Button size="sm" onClick={handleSave} disabled={saving || !amount || !description.trim()}>
        {submitLabel}
      </Button>
    </div>
  );
}
