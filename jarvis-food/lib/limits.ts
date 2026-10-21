// Safety limits. These are enforced on the server; the UI only mirrors them.
export const MAX_CALLS_PER_DAY = 5;
export const DEFAULT_MAX_BUDGET_CZK = 600;
/** Upper bound for the "max budget" setting itself, so a typo can't allow a 60 000 CZK order. */
export const MAX_BUDGET_SETTING_CEILING_CZK = 5000;
export const MIN_BUDGET_CZK = 50;
/** A summary must be confirmed with "Yes, call" within this window, otherwise it expires. */
export const DRAFT_TTL_MINUTES = 30;
/** A call still marked active after this long is treated as stuck and closed. */
export const STUCK_CALL_MINUTES = 15;
export const TIME_ZONE = "Europe/Prague";
