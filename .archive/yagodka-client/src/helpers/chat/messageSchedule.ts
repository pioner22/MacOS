const DAY_MS = 24 * 60 * 60 * 1000;

// Telegram-like: scheduling window up to ~1 year.
export const MESSAGE_SCHEDULE_MAX_DAYS = 365;

export function maxMessageScheduleDelayMs(): number {
  return MESSAGE_SCHEDULE_MAX_DAYS * DAY_MS;
}

