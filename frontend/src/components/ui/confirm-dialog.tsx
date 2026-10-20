import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red button and warning icon: for deleting/removing things. */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (confirmed: boolean) => void };

let show: ((pending: Pending) => void) | null = null;

/**
 * Replacement for window.confirm with the app's dialog. Resolves true when the
 * user confirms and false when they cancel or close it.
 * Needs <ConfirmDialogHost /> mounted once (see main.tsx).
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (!show) return Promise.resolve(window.confirm(options.title));
  return new Promise((resolve) => show?.({ ...options, resolve }));
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    show = (next) => {
      setPending((current) => {
        // A new confirmation replaces one still open: the old one counts as cancelled.
        current?.resolve(false);
        return next;
      });
      setOpen(true);
    };
    return () => {
      show = null;
    };
  }, []);

  function close(confirmed: boolean) {
    pending?.resolve(confirmed);
    // Keeps the text while the closing animation runs.
    setPending((current) => (current ? { ...current, resolve: () => undefined } : current));
    setOpen(false);
  }

  const Icon = pending?.destructive ? AlertTriangle : HelpCircle;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="items-start gap-3">
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full",
              pending?.destructive ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <DialogTitle>{pending?.title}</DialogTitle>
          {pending?.description ? (
            <DialogDescription>{pending.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Confirme para continuar.</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {pending?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            autoFocus
            variant={pending?.destructive ? "destructive" : "default"}
            onClick={() => close(true)}
          >
            {pending?.confirmLabel ?? "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
