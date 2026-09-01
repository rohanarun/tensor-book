import type { Prize, TaskStatus } from "./types";

export function formatStatus(status: TaskStatus): string {
  return status
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function relativeTime(value: string): string {
  const milliseconds = new Date(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];
  for (const [unit, duration] of ranges) {
    if (Math.abs(milliseconds) >= duration) return formatter.format(Math.round(milliseconds / duration), unit);
  }
  return "just now";
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPrize(prize: Prize): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: prize.currency,
    maximumFractionDigits: 0,
  }).format(prize.amount);
}

export function formatPrizeStatus(prize: Prize): string {
  return prize.status === "official" ? "Official external prize" : "Pledged · funding unverified";
}

export function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length).trim()}…` : value;
}
