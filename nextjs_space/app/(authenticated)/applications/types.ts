/**
 * Shared types for the /applications pages.
 */

export type OsType = "WINDOWS" | "LINUX";

export interface ApplicationRow {
  id: string;
  name: string;
  osType: OsType;
  description: string | null;
  hostname: string | null;
  environment: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { dataSources: number; logFiles: number };
}

export function osBadgeColor(os: OsType): string {
  return os === "WINDOWS" ? "bg-sky-600" : "bg-emerald-600";
}

export function osLabel(os: OsType): string {
  return os === "WINDOWS" ? "Windows" : "Linux";
}
