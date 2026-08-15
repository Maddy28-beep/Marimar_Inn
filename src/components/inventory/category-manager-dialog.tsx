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
import { createCategory, deleteCategory } from "@/lib/inventory";
import type { InventoryCategory } from "@/lib/types";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";

interface CategoryManagerDialogProps {
  categories: InventoryCategory[];
  onClose: () => void;
}

export function CategoryManagerDialog({ categories, onClose }: CategoryManagerDialogProps) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await createCategory(trimmed);
      toast.success(`"${trimmed}" added.`);
      setName("");
    } catch {
      toast.error("Couldn't add that category — please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(category: InventoryCategory) {
    if (
      !window.confirm(
        `Remove the "${category.name}" category? Items already using it keep their category label.`
      )
    ) {
      return;
    }
    setDeletingId(category.categoryId);
    try {
      await deleteCategory(category.categoryId);
    } catch {
      toast.error("Couldn't remove that category — please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage categories</DialogTitle>
          <DialogDescription>
            Set up categories here so they&apos;re ready to pick from when adding an item.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              placeholder="New category name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              disabled={adding}
            />
            <Button type="button" onClick={handleAdd} disabled={adding || !name.trim()}>
              {adding ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              Add
            </Button>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border">
            {categories.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No categories yet.</p>
            ) : (
              categories.map((c) => (
                <div
                  key={c.categoryId}
                  className="flex items-center justify-between gap-2 border-b p-2 text-sm last:border-b-0"
                >
                  <span>{c.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(c)}
                    disabled={deletingId === c.categoryId}
                  >
                    {deletingId === c.categoryId ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-3.5" />
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
