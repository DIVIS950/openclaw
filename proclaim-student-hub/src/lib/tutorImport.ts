// A message about what a tutor's link brought in, shown once the app is up.
let pending: string | null = null;

export const tutorImport = {
  set(message: string) {
    pending = message;
  },
  take(): string | null {
    const m = pending;
    pending = null;
    return m;
  },
};
