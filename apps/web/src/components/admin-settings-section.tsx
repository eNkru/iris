"use client";

import { useState, type FormEvent } from "react";
import { useTransientFlag } from "../hooks/use-transient-flag";
import { useOneShotSeed } from "../hooks/use-one-shot-seed";
import { useGlobalSettings, useUpdateGlobalSettings } from "../hooks/use-settings";
import { useI18n } from "../lib/i18n";
import { hasValidationIssue } from "../lib/orpc-validation";
import { Button, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Instance-level global settings (R6/R7, admin only): default poll interval +
 * Telegram bot token. Price extraction runs in the external argus service
 * since 2026-08-25, so there is no in-app AI config anymore. The bot token is
 * write-only (masked on read); submitting an empty value leaves the stored
 * secret unchanged.
 */
export function AdminSettingsSection() {
  const { t } = useI18n();
  const { data, isLoading, isError, error } = useGlobalSettings();
  const updateGlobalSettings = useUpdateGlobalSettings();

  const [pollInterval, setPollInterval] = useState("");
  const [botToken, setBotToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmingClearToken, setConfirmingClearToken] = useState(false);
  const [savedFlash, triggerSavedFlash] = useTransientFlag();

  // Seed the form once settings arrive from the server (never re-seeds on
  // later refetches, so user edits survive background refreshes).
  useOneShotSeed(data, (d) => {
    setPollInterval(d.settings.pollIntervalDefaultMinutes.toString());
    setBotToken("");
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    const parsedInterval = Number(pollInterval);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 1) {
      setErrorMessage(t("adminSettings.intervalInvalid"));
      return;
    }

    try {
      await updateGlobalSettings.mutateAsync({
        pollIntervalDefaultMinutes: parsedInterval,
        telegramBotToken: botToken.trim() === "" ? undefined : botToken.trim(),
      });
      setBotToken("");
      triggerSavedFlash();
    } catch (err) {
      // Point at the interval field when the server rejected the input.
      setErrorMessage(
        hasValidationIssue(err, "pollIntervalDefaultMinutes")
          ? t("validation.pollInterval")
          : t("adminSettings.saveError"),
      );
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? <Spinner label={t("adminSettings.loading")} /> : null}
      {isError ? (
        <ErrorBox
          message={
            error instanceof Error ? error.message : t("adminSettings.loadError")
          }
        />
      ) : null}
      {!isLoading && !isError ? (
        <form onSubmit={onSubmit} className="max-w-md space-y-3">
          <div>
            <Label htmlFor="global-interval">
              {t("adminSettings.intervalLabel")}
            </Label>
            <Input
              id="global-interval"
              type="number"
              min="1"
              step="1"
              required
              value={pollInterval}
              onChange={(e) => {
                setPollInterval(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {t("adminSettings.intervalHint")}
            </p>
          </div>

          <div>
            <Label htmlFor="bot-token">{t("adminSettings.botTokenLabel")}</Label>
            <Input
              id="bot-token"
              type="password"
              autoComplete="off"
              placeholder={t("adminSettings.botTokenPlaceholder")}
              value={botToken}
              onChange={(e) => {
                setBotToken(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {data?.settings.telegramBotToken
                ? t("adminSettings.botTokenStored", {
                    token: data.settings.telegramBotToken,
                  })
                : t("adminSettings.botTokenNone")}
            </p>
            {data?.settings.telegramBotToken ? (
              confirmingClearToken ? (
                <span className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs font-medium text-red-700 underline transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                    disabled={updateGlobalSettings.isPending}
                    onClick={async () => {
                      setConfirmingClearToken(false);
                      setErrorMessage(null);
                      try {
                        await updateGlobalSettings.mutateAsync({
                          telegramBotToken: null,
                        });
                        setBotToken("");
                        triggerSavedFlash();
                      } catch {
                        setErrorMessage(t("adminSettings.saveError"));
                      }
                    }}
                  >
                    {t("adminSettings.clearTokenConfirm")}
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-stone-500 underline transition-colors hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-200"
                    disabled={updateGlobalSettings.isPending}
                    onClick={() => setConfirmingClearToken(false)}
                  >
                    {t("productList.cancel")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-stone-500 underline transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-400 dark:hover:text-red-400"
                  disabled={updateGlobalSettings.isPending}
                  onClick={() => setConfirmingClearToken(true)}
                >
                  {t("adminSettings.clearToken")}
                </button>
              )
            ) : null}
          </div>

          {errorMessage ? <ErrorBox message={errorMessage} /> : null}
          {savedFlash ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {t("adminSettings.saved")}
            </p>
          ) : null}
          <Button type="submit" disabled={updateGlobalSettings.isPending}>
            {updateGlobalSettings.isPending ? (
              <Spinner label={t("adminSettings.saving")} />
            ) : (
              t("adminSettings.submit")
            )}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
