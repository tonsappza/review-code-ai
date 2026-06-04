import type { ReviewMode } from "./core/types.js";

export function parseBool(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function parseReviewMode(value: string | undefined): ReviewMode {
  const v = value?.trim().toLowerCase();
  return v === "explore" ? "explore" : "diff";
}

export function resolveReviewMode(
  input?: string,
  env = process.env.REVIEW_MODE,
): ReviewMode {
  return parseReviewMode(input ?? env);
}
