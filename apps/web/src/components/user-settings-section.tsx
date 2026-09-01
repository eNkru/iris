"use client";

import { useState, type FormEvent } from "react";
import { useTransientFlag } from "../hooks/use-transient-flag";
import { useOneShotSeed } from "../hooks/use-one-shot-seed";
import { useUpdateUserSettings, useUserSettings } from "../hooks/use-settings";
import { useI18n } from "../lib/i18n";
import { hasValidationIssue } from "../lib/orpc-validation";
import { Button, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Per-user settings (R7): the default poll interval applied to products that
 * have no per-product override. Empty = fall back to the instance default.
 */
export function UserSettingsSection() {
  const { t } = useI18n();
  const { data, isLoading, isError } = useUserSettings();
  const updateUserSettings = useUpdateUserSettings();

  const [pollInterval, setPollInterval] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedFlash, triggerSavedFlash] = useTransientFlag();

  // Seed the form once settings arrive from the server (never re-seeds on
  // later refetches, so user edits survive background refreshes).
  useOneShotSeed(data, (d) => {
    setPollInterval(d.settings.pollIntervalDefaultMinutes?.toString() ?? "");
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    const parsed = pollInterval === "" ? null : Number(pollInterval);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      setErrorMessage(t("userSettings.intervalInvalid"));
      return;
    }

    try {
      await updateUserSettings.mutateAsync({ pollIntervalDefaultMinutes: parsed });
      triggerSavedFlash();
    } catch (err) {
      // Point at the interval field when the server rejected the input.
      setErrorMessage(
        hasValidationIssue(err, "pollIntervalDefaultMinutes")
          ? t("validation.pollInterval")
          : t("userSettings.saveError"),
      );
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? <Spinner label={t("userSettings.loading")} /> : null}
      {isError ? (
        <ErrorBox message={t("userSettings.loadError")} />
      ) : null}
      {!isLoading && !isError ? (
        <form onSubmit={onSubmit} className="max-w-md space-y-3">
          <div>
            <Label htmlFor="default-interval">
              {t("userSettings.intervalLabel")}
            </Label>
            <Input
              id="default-interval"
              type="number"
              min="1"
              step="1"
              placeholder={t("userSettings.intervalPlaceholder")}
              value={pollInterval}
              onChange={(e) => {
                setPollInterval(e.target.value);
              }}
              disabled={updateUserSettings.isPending}
            />
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {t("userSettings.intervalHint")}
            </p>
          </div>
          {errorMessage ? <ErrorBox message={errorMessage} /> : null}
          {savedFlash ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {t("userSettings.saved")}
            </p>
          ) : null}
          <Button type="submit" disabled={updateUserSettings.isPending}>
            {updateUserSettings.isPending ? (
              <Spinner label={t("userSettings.saving")} />
            ) : (
              t("userSettings.submit")
            )}
          </Button>
        </form>
      ) : null}
    </div>
  );
}