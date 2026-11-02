import { snippet as seed0 } from "./grep-empty-widen.ts";
import { snippet as seed1 } from "./find-files-empty-widen.ts";
import { snippet as seed2 } from "./read-not-found-locate.ts";
import { snippet as seed3 } from "./edit-missing-reread.ts";
import { snippet as seed4 } from "./edit-ambiguous-reread.ts";
import { snippet as seed5 } from "./read-truncated-range.ts";
import { snippet as seed6 } from "./command-nonzero-summary.ts";
import { snippet as seed7 } from "./test-failure-summary.ts";
import { snippet as seed8 } from "./edit-then-narrow-test.ts";
import { snippet as seed9 } from "./rename-zero-references.ts";
import { snippet as seed10 } from "./move-cycle-diagnose.ts";
import { snippet as seed11 } from "./check-errors-read.ts";

/** Generic, authored recovery patterns; no task-specific hints or LLM-backed tools. */
export const HOT_PATH_SEEDS = Object.freeze([seed0, seed1, seed2, seed3, seed4, seed5, seed6, seed7, seed8, seed9, seed10, seed11]);
