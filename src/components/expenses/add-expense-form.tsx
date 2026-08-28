"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";
import { recordShiftExpenses } from "@/lib/expenses";
import { PlusIcon, Trash2Icon } from "lucide-react";

interface ExpenseLine {
  id: string;
  description: string;
  amount: string;
}

function newLine(): ExpenseLine {
  return { id: crypto.randomUUID(), description: "", amount: "" };
}

export function AddExpenseForm({
  onSaved,
  submitLabel,
}: {
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const { appUser } = useAuth();
  const [lines, setLines] = useState<ExpenseLine[]>(() => [newLine(), newLine(), newLine()]);
  const [saving, setSaving] = useState(false);

  const filled = useMemo(
    () =>
      lines
        .map((line) => ({
          description: line.description.trim(),
          amount: Number(line.amount),
        }))
        .filter((line) => line.description || (Number.isFinite(line.amount) && line.amount > 0)),
    [lines]
  );
  const complete = filled.filter(
    (line) => line.description && Number.isFinite(line.amount) && line.amount > 0
  );
  const total = complete.reduce((sum, line) => sum + line.amount, 0);
  const hasPartial = filled.length !== complete.length;

  function updateLine(id: string, patch: Partial<ExpenseLine>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  async function handleSave() {
    if (!appUser) return;
    if (hasPartial) {
      toast.error("Fill both what it was for and the amount on each line you started.");
      return;
    }
    if (complete.length === 0) {
      toast.error("Add at least one expense.");
      return;
    }
    setSaving(true);
    try {
      const count = await recordShiftExpenses({
        items: complete,
        cashierId: appUser.uid,
        cashierName: appUser.displayName || appUser.email || "Staff",
        cashierRole: appUser.role,
      });
      setLines([newLine(), newLine(), newLine()]);
      toast.success(
        count === 1
          ? "Expense recorded. It will show on this shift's report."
          : `${count} expenses recorded. They will show on this shift's report.`
      );
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the expenses.");
    } finally {
      setSaving(false);
    }
  }

  const saveLabel =
    submitLabel ??
    (complete.length > 1 ? `Save ${complete.length} expenses` : "Add expense");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div key={line.id} className="flex items-center gap-2">
            <Input
              placeholder={index === 0 ? "What for (e.g. water, fare)" : "What for"}
              value={line.description}
              onChange={(e) => updateLine(line.id, { description: e.target.value })}
              maxLength={120}
              className="min-w-0 flex-1"
            />
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="₱"
              value={line.amount}
              onChange={(e) => updateLine(line.id, { amount: e.target.value })}
              className="w-28 shrink-0"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                setLines((current) =>
                  current.length === 1 ? [newLine()] : current.filter((row) => row.id !== line.id)
                )
              }
              disabled={saving || (lines.length === 1 && !line.description && !line.amount)}
              aria-label="Remove line"
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="font-semibold"
          onClick={() => setLines((current) => [...current, newLine()])}
          disabled={saving}
        >
          <PlusIcon className="size-4" />
          Add another item
        </Button>
        <div className="text-sm font-semibold tabular-nums">
          Total ₱{total.toFixed(2)}
        </div>
      </div>

      <Button
        className="font-semibold sm:self-end"
        onClick={() => void handleSave()}
        disabled={saving || complete.length === 0 || hasPartial}
      >
        {saveLabel}
      </Button>
    </div>
  );
}
