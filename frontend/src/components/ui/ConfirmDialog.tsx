"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Button } from "./Button";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

/**
 * Ask the user to confirm before a destructive action.
 *
 *   const { confirm, dialog } = useConfirm();
 *   if (await confirm({ title: "Delete project?" })) { ... }
 *   return <>{dialog}...</>
 */
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useT();

  useEffect(() => {
    const el = ref.current;
    if (state && el && !el.open) el.showModal();
  }, [state]);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );

  const close = (ok: boolean) => {
    ref.current?.close();
    state?.resolve(ok);
    setState(null);
  };

  const dialog = state ? (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
      className="m-auto w-[min(92vw,420px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl"
    >
      <div className="p-6">
        <h2 className="font-display text-xl">{state.title}</h2>
        {state.message && <p className="mt-2 text-sm text-muted">{state.message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => close(false)}>{t("common.cancel")}</Button>
          <Button variant={state.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
            {state.confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </dialog>
  ) : null;

  return { confirm, dialog };
}
