import { issues } from "./issues.ts";
import { pullRequests } from "./pullRequests.ts";
import { ciStatus } from "./ciStatus.ts";
import { httpRequest } from "./httpRequest.ts";
import { fetchUrl } from "./fetchUrl.ts";
import { webSearch } from "./webSearch.ts";
import { sqlQuery } from "./sqlQuery.ts";
import { packageInfo } from "./packageInfo.ts";
import { installPackage } from "./installPackage.ts";
import { docsSearch } from "./docsSearch.ts";
import { notify } from "./notify.ts";
import { containerLogs } from "./containerLogs.ts";
import { metrics } from "./metrics.ts";
import { featureFlags } from "./featureFlags.ts";
import type { ToolDef } from "../../types.ts";

/** The 14 `external` tools in tools.md §6.8 order. */
export const externalTools: ToolDef[] = [issues, pullRequests, ciStatus, httpRequest, fetchUrl, webSearch, sqlQuery, packageInfo, installPackage, docsSearch, notify, containerLogs, metrics, featureFlags];
