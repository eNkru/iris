"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useGlobalSettings, useUpdateGlobalSettings } from "../hooks/use-settings";
import { useI18n } from "../lib/i18n";
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
  const [hasLoaded, setHasLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Transient "Saved." feedback (R8): clears after ~3s.
  useEffect(() => {
    if (savedAt === null) {
      return;
    }
    const timer = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  useEffect(() => {
    if (data && !hasLoaded) {
      setPollInterval(data.settings.pollIntervalDefaultMinutes.toString());
      setBotToken("");
      setHasLoaded(true);
    }
  }, [data, hasLoaded]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setSavedAt(null);

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
      setSavedAt(Date.now());
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t("adminSettings.saveError"),
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
                setSavedAt(null);
                setPollInterval(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
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
                setSavedAt(null);
                setBotToken(e.target.value);
              }}
              disabled={updateGlobalSettings.isPending}
            />
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
              {data?.settings.telegramBotToken
                ? t("adminSettings.botTokenStored", {
                    token: data.settings.telegramBotToken,
                  })
                : t("adminSettings.botTokenNone")}
            </p>
            {data?.settings.telegramBotToken ? (
              <button
                type="button"
                className="mt-1 text-xs font-medium text-stone-500 underline transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-400 dark:hover:text-red-400"
                disabled={updateGlobalSettings.isPending}
                onClick={async () => {
                  if (
                    !window.confirm(t("adminSettings.clearTokenConfirm"))
                  ) {
                    return;
                  }
                  setErrorMessage(null);
                  setSavedAt(null);
                  try {
                    await updateGlobalSettings.mutateAsync({
                      telegramBotToken: null,
                    });
                    setBotToken("");
                    setSavedAt(Date.now());
                  } catch (err) {
                    setErrorMessage(
                      err instanceof Error
                        ? err.message
                        : t("adminSettings.saveError"),
                    );
                  }
                }}
              >
                {t("adminSettings.clearToken")}
              </button>
            ) : null}
          </div>

          {errorMessage ? <ErrorBox message={errorMessage} /> : null}
          {savedAt !== null ? (
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
