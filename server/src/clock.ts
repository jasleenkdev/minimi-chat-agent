export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock pinned to `iso` that still advances in real time, so messages in one run stay ordered. */
export function offsetClock(iso: string): Clock {
  const offset = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(offset)) throw new Error(`invalid DEV_NOW: ${iso}`);
  return { now: () => new Date(Date.now() + offset) };
}

export function createClock(devNow?: string): Clock {
  return devNow ? offsetClock(devNow) : systemClock;
}
