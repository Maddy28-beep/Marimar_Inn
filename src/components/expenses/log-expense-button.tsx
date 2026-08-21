"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AddExpenseForm } from "@/components/expenses/add-expense-form";
import { WalletIcon } from "lucide-react";

export function LogExpenseButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <WalletIcon className="size-4" />
        Log expense
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Log expense</DialogTitle>
            <DialogDescription>
              Cash taken from the drawer. Add several items at once — water,
              fare, supplies — then save. They are deducted from this
              shift&apos;s cash and net sales.
            </DialogDescription>
          </DialogHeader>
          <AddExpenseForm onSaved={() => setOpen(false)} submitLabel="Save expenses" />
        </DialogContent>
      </Dialog>
    </>
  );
}
