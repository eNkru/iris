"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import type { ProductOutput } from "../hooks/use-products";
import { useUpdateProduct } from "../hooks/use-products";
import { useI18n } from "../lib/i18n";
import { Button, ButtonSecondary, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Product detail edit form: poll interval override (R7), alert rules (R10),
 * and the active/paused toggle. Saves via `products.update`.
 */
export function ProductEditForm({ product }: { product: ProductOutput }) {
  const { t } = useI18n();
  // Two mutation instances so Save and pause/resume have independent pending
  // state: saving doesn't disable the pause button and vice versa. Both
  // invalidate the same product query, so invalidation is harmless when both
  // run (idempotent).
  const updateProduct = useUpdateProduct();
  const pauseProduct = useUpdateProduct();
  const intervalId = useId();
  const risePctId = useId();
  const fallPctId = useId();
  const riseAbsId = useId();
  const fallAbsId = useId();

  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(
    product.pollIntervalMinutes?.toString() ?? "",
  );
  const [anyChange, setAnyChange] = useState(product.alertRules?.anyChange ?? true);
  const [risePct, setRisePct] = useState(product.alertRules?.risePct?.toString() ?? "");
  const [fallPct, setFallPct] = useState(product.alertRules?.fallPct?.toString() ?? "");
  const [riseAbs, setRiseAbs] = useState(product.alertRules?.riseAbs?.toString() ?? "");
  const [fallAbs, setFallAbs] = useState(product.alertRules?.fallAbs?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Transient "Saved." feedback (R8): clears after ~3s.
  useEffect(() => {
    if (savedAt === null) {
      return;
    }
    const timer = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const silentConfig =
    !anyChange &&
    risePct === "" &&
    fallPct === "" &&
    riseAbs === "" &&
    fallAbs === "";

  /** A threshold is valid when empty (optional) or a positive number. */
  const isThresholdValid = (value: string): boolean =>
    value === "" || (Number.isFinite(Number(value)) && Number(value) > 0);
  const thresholdInvalid =
    !isThresholdValid(risePct) ||
    !isThresholdValid(fallPct) ||
    !isThresholdValid(riseAbs) ||
    !isThresholdValid(fallAbs);
  const thresholdError = thresholdInvalid ? t("editForm.thresholdInvalid") : null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSavedAt(null);
    if (thresholdInvalid) {
      setError(thresholdError);
      return;
    }

    const parsedInterval = pollIntervalMinutes === "" ? null : Number(pollIntervalMinutes);
    if (parsedInterval !== null && (!Number.isInteger(parsedInterval) || parsedInterval < 1)) {
      setError(t("editForm.intervalInvalid"));
      return;
    }

    const alertRules = {
      anyChange,
      risePct: risePct === "" ? undefined : Number(risePct),
      fallPct: fallPct === "" ? undefined : Number(fallPct),
      riseAbs: riseAbs === "" ? undefined : Number(riseAbs),
      fallAbs: fallAbs === "" ? undefined : Number(fallAbs),
    };

    try {
      await updateProduct.mutateAsync({
        id: product.id,
        pollIntervalMinutes: parsedInterval,
        alertRules,
        active: product.active,
      });
      setSavedAt(Date.now());
    } catch {
      setError(t("editForm.saveError"));
    }
  };

  const numberField = (
    id: string,
    label: string,
    value: string,
    setValue: (v: string) => void,
    invalid: boolean,
  ) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min="0"
        step="any"
        value={value}
        aria-invalid={invalid}
        onChange={(e) => {
          setSavedAt(null);
          setValue(e.target.value);
        }}
      />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor={intervalId}>{t("editForm.intervalLabel")}</Label>
        <Input
          id={intervalId}
          type="number"
          min="1"
          step="1"
          placeholder={t("editForm.intervalPlaceholder")}
          value={pollIntervalMinutes}
          onChange={(e) => {
            setSavedAt(null);
            setPollIntervalMinutes(e.target.value);
          }}
        />
        <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
          {t("editForm.intervalHint")}
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900/50">
        <div className="flex items-center gap-2">
          <input
            id="any-change"
            type="checkbox"
            checked={anyChange}
            onChange={(e) => {
              setSavedAt(null);
              setAnyChange(e.target.checked);
            }}
            className="h-4 w-4 rounded border-stone-300 dark:border-stone-700"
          />
          <Label htmlFor="any-change" className="mb-0">
            {t("editForm.anyChange")}
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {numberField(risePctId, t("editForm.risePct"), risePct, setRisePct, !isThresholdValid(risePct))}
          {numberField(fallPctId, t("editForm.fallPct"), fallPct, setFallPct, !isThresholdValid(fallPct))}
          {numberField(riseAbsId, t("editForm.riseAbs"), riseAbs, setRiseAbs, !isThresholdValid(riseAbs))}
          {numberField(fallAbsId, t("editForm.fallAbs"), fallAbs, setFallAbs, !isThresholdValid(fallAbs))}
        </div>
        <p className="text-xs text-stone-400 dark:text-stone-500">
          {t("editForm.thresholdsHint")}
        </p>
        {silentConfig ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {t("editForm.silent")}
          </div>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}
      {thresholdError && !error ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">{thresholdError}</p>
      ) : null}
      {savedAt !== null ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {t("editForm.saved")}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={updateProduct.isPending || thresholdInvalid}>
          {updateProduct.isPending ? (
            <Spinner label={t("editForm.saving")} />
          ) : (
            t("editForm.saveChanges")
          )}
        </Button>
        <ButtonSecondary
          type="button"
          onClick={() => {
            setError(null);
            pauseProduct.mutate({ id: product.id, active: !product.active }, {
              onError: () => setError(t("editForm.updateError")),
            });
          }}
          disabled={pauseProduct.isPending}
        >
          {pauseProduct.isPending ? (
            <Spinner label={t("editForm.saving")} />
          ) : (
            product.active ? t("editForm.pause") : t("editForm.resume")
          )}
        </ButtonSecondary>
      </div>
    </form>
  );
}