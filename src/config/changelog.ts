export type { ChangelogEntry } from "./changelog/types";

import type { ChangelogEntry } from "./changelog/types";
import { CHANGELOG_PART_00 } from "./changelog/part00";
import { CHANGELOG_PART_01 } from "./changelog/part01";
import { CHANGELOG_PART_02 } from "./changelog/part02";
import { CHANGELOG_PART_03 } from "./changelog/part03";

// Keep newest first. This list is shown in Info and acts as user-facing release notes.
export const CHANGELOG: ChangelogEntry[] = [
  ...CHANGELOG_PART_00,
  ...CHANGELOG_PART_01,
  ...CHANGELOG_PART_02,
  ...CHANGELOG_PART_03,
];
