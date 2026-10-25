/**
 * Root application component.
 * Hash routing: #/g/<run-id>/f/<framework>/<view>  or  #/g/<run-id>/f/<framework>/job/<jobname>
 */

import { useState, useEffect } from "react";
import { useIndex } from "../data/store.js";
import { Sidebar } from "./Sidebar.js";
import { FrameworkTabs } from "./FrameworkTabs.js";
import { Summary } from "../views/Summary.js";
import { JobsMatrix } from "../views/JobsMatrix.js";
import { Job } from "../views/Job.js";

type ViewKind = "summary" | "jobs" | "job";

interface Route {
  runId: string | null;
  framework: string | null;
  view: ViewKind;
  jobName: string | null;
}

/** Parse the hash into a Route. */
function parseHash(hash: string): Route {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  const parts = path.split("/").filter(Boolean);
  // #/g/<run-id>/f/<framework>/summary|jobs|job/<jobname>
  if (parts[0] === "g" && parts[2] === "f") {
    const runId = parts[1] ?? null;
    const framework = parts[3] ?? null;
    const view = parts[4];
    if (view === "job" && parts[5]) {
      return { runId, framework, view: "job", jobName: decodeURIComponent(parts[5]) };
    }
    if (view === "jobs") return { runId, framework, view: "jobs", jobName: null };
    return { runId, framework, view: "summary", jobName: null };
  }
  return { runId: null, framework: null, view: "summary", jobName: null };
}

/** Build a hash path for a route. */
function buildHash(runId: string, framework: string, view: ViewKind, jobName?: string): string {
  if (view === "job" && jobName) {
    return `#/g/${encodeURIComponent(runId)}/f/${encodeURIComponent(framework)}/job/${encodeURIComponent(jobName)}`;
  }
  return `#/g/${encodeURIComponent(runId)}/f/${encodeURIComponent(framework)}/${view}`;
}

function navigate(hash: string): void {
  window.location.hash = hash;
}

export function App() {
  const { status, data, error } = useIndex();
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // Auto-select first run and framework when index loads
  useEffect(() => {
    if (status !== "ready" || !data) return;
    if (route.runId) return;
    const first = [...data.runs].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];
    if (!first) return;
    const fw = first.frameworks[0] ?? "";
    navigate(buildHash(first.id, fw, "summary"));
  }, [status, data, route.runId]);

  if (status === "idle" || status === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--fg3)" }}>
        Loading index…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={{ padding: 24, color: "var(--fail)" }}>
        <strong>Failed to load index:</strong> {error}
        <p style={{ marginTop: 8, color: "var(--fg3)", fontSize: 13 }}>
          Run <code>aiw view</code> to generate the index, then reload this page.
        </p>
      </div>
    );
  }

  const runs = data?.runs ?? [];
  const selectedRun = runs.find((r) => r.id === route.runId) ?? null;
  const selectedFramework = route.framework ?? selectedRun?.frameworks[0] ?? null;

  function selectRun(runId: string) {
    const run = runs.find((r) => r.id === runId);
    const fw = run?.frameworks[0] ?? "";
    navigate(buildHash(runId, fw, "summary"));
  }

  function selectFramework(fw: string) {
    if (!route.runId) return;
    navigate(buildHash(route.runId, fw, "summary"));
  }

  function selectView(view: ViewKind) {
    if (!route.runId || !selectedFramework) return;
    navigate(buildHash(route.runId, selectedFramework, view));
  }

  function selectJob(jobName: string) {
    if (!route.runId || !selectedFramework) return;
    navigate(buildHash(route.runId, selectedFramework, "job", jobName));
  }

  function backFromJob() {
    if (!route.runId || !selectedFramework) return;
    navigate(buildHash(route.runId, selectedFramework, "jobs"));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Top toolbar */}
      <div
        style={{
          padding: "8px 16px",
          background: "var(--bg2)",
          borderBottom: "1px solid var(--border)",
          fontWeight: 700,
          fontSize: 14,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ color: "var(--accent)" }}>AI Workflow Viewer</span>
      </div>

      {/* Body: sidebar + main */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar runs={runs} selectedRunId={route.runId} onSelect={selectRun} />

        {/* Main area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {selectedRun ? (
            <>
              {/* Framework tabs */}
              <FrameworkTabs
                run={selectedRun}
                selectedFramework={selectedFramework}
                onSelect={selectFramework}
              />

              {/* View selector */}
              {route.view !== "job" && (
                <div
                  style={{
                    display: "flex",
                    gap: 0,
                    padding: "0 16px",
                    background: "var(--bg3)",
                    borderBottom: "1px solid var(--border)",
                    flexShrink: 0,
                  }}
                >
                  {(["summary", "jobs"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => selectView(v)}
                      style={{
                        padding: "7px 14px",
                        fontSize: 12,
                        color: route.view === v ? "var(--accent)" : "var(--fg2)",
                        fontWeight: route.view === v ? 700 : 400,
                        borderBottom: route.view === v ? "2px solid var(--accent)" : "2px solid transparent",
                        textTransform: "capitalize",
                      }}
                    >
                      {v === "jobs" ? "Jobs matrix" : v}
                    </button>
                  ))}
                </div>
              )}

              {/* View content */}
              <div style={{ flex: 1, overflow: "auto" }}>
                {route.view === "job" && route.runId && route.jobName ? (
                  <Job runId={route.runId} jobName={route.jobName} onBack={backFromJob} />
                ) : route.view === "jobs" && selectedFramework ? (
                  <JobsMatrix run={selectedRun} framework={selectedFramework} onJobClick={selectJob} />
                ) : selectedFramework ? (
                  <Summary run={selectedRun} framework={selectedFramework} />
                ) : null}
              </div>
            </>
          ) : (
            <div style={{ padding: 24, color: "var(--fg3)" }}>
              {runs.length === 0 ? "No runs found. Run " : "Select a run from the sidebar."}
              {runs.length === 0 && <code>aiw view</code>}
              {runs.length === 0 && " to index runs."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
