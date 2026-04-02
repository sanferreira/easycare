import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmVariant = "default" | "destructive" | "warning";

type ConfirmDialogOptions = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  pendingText?: string;
  variant?: ConfirmVariant;
  onConfirm?: () => unknown | Promise<unknown>;
};

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const [isPending, setIsPending] = useState(false);

  const confirm = useCallback((nextOptions: ConfirmDialogOptions) => {
    setOptions(nextOptions);
  }, []);

  const closeDialog = useCallback(() => {
    if (isPending) return;
    setOptions(null);
  }, [isPending]);

  const actionClassName = useMemo(() => {
    if (options?.variant === "destructive") {
      return "bg-destructive text-destructive-foreground hover:bg-destructive/90";
    }
    if (options?.variant === "warning") {
      return "bg-amber-600 text-white hover:bg-amber-700";
    }
    return undefined;
  }, [options?.variant]);

  const handleConfirm = useCallback(async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!options) return;

    try {
      setIsPending(true);
      await options.onConfirm?.();
      setOptions(null);
    } finally {
      setIsPending(false);
    }
  }, [options]);

  const confirmDialog = (
    <AlertDialog
      open={!!options}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title ?? "Confirmar acao"}</AlertDialogTitle>
          {options?.description ? (
            <AlertDialogDescription>{options.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {options?.cancelText ?? "Cancelar"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={actionClassName}
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isPending ? options?.pendingText ?? "Processando..." : options?.confirmText ?? "Confirmar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    confirm,
    confirmDialog,
    isPending,
  };
}
