export interface Clock {
  now(): Date;
  /** ISO-8601 UTC timestamp, the format every domain schema expects. */
  nowIso(): string;
}
