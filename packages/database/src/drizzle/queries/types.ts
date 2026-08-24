/**
 * Shared query helper types.
 */

export type GlobalSettingsRow = {
  id: number;
  pollIntervalDefaultMinutes: number;
  telegramBotToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GlobalSettingsInput = {
  pollIntervalDefaultMinutes?: number;
  telegramBotToken?: string;
};
