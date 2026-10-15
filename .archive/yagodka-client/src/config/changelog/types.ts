export interface ChangelogEntry {
  version: string; // semver without build hash
  date: string; // YYYY-MM-DD
  added?: string[];
  improved?: string[];
  fixed?: string[];
  notes?: string[];
}

