/**
 * React state store for index and per-job data.
 * Provides useIndex() and useJob() hooks backed by the script-tag loader.
 */

import { useState, useEffect } from "react";
import { loadIndex, loadJob } from "./loader.js";
import type { RunIndex, JobData } from "../types.js";

type Status = "idle" | "loading" | "ready" | "error";

interface IndexState {
  status: Status;
  data: RunIndex | null;
  error: string | null;
}

interface JobState {
  status: Status;
  data: JobData | null;
  error: string | null;
}

// Module-level cache so multiple components share the same load
let indexState: IndexState = { status: "idle", data: null, error: null };
const indexListeners = new Set<() => void>();
const jobCache = new Map<string, JobState>();
const jobListeners = new Map<string, Set<() => void>>();

function notifyIndex(): void {
  for (const fn of indexListeners) fn();
}

function notifyJob(key: string): void {
  const listeners = jobListeners.get(key);
  if (listeners) for (const fn of listeners) fn();
}

function fetchIndex(): void {
  if (indexState.status === "loading" || indexState.status === "ready") return;
  indexState = { status: "loading", data: null, error: null };
  notifyIndex();
  loadIndex()
    .then((raw) => {
      indexState = { status: "ready", data: raw as RunIndex, error: null };
      notifyIndex();
    })
    .catch((err: unknown) => {
      indexState = { status: "error", data: null, error: String(err) };
      notifyIndex();
    });
}

function fetchJob(runId: string, jobName: string): void {
  const key = `${runId}/${jobName}`;
  const current = jobCache.get(key);
  if (current?.status === "loading" || current?.status === "ready") return;
  jobCache.set(key, { status: "loading", data: null, error: null });
  notifyJob(key);
  loadJob(runId, jobName)
    .then((raw) => {
      jobCache.set(key, { status: "ready", data: raw as JobData, error: null });
      notifyJob(key);
    })
    .catch((err: unknown) => {
      jobCache.set(key, { status: "error", data: null, error: String(err) });
      notifyJob(key);
    });
}

/** Returns the run index, triggering a load on first call. */
export function useIndex(): IndexState {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    indexListeners.add(listener);
    fetchIndex();
    return () => { indexListeners.delete(listener); };
  }, []);
  return indexState;
}

/**
 * Returns job data for the given run and job, triggering a load on demand.
 * @param runId - run id
 * @param jobName - job directory name
 */
export function useJob(runId: string, jobName: string): JobState {
  const [, forceUpdate] = useState(0);
  const key = `${runId}/${jobName}`;
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    if (!jobListeners.has(key)) jobListeners.set(key, new Set());
    jobListeners.get(key)!.add(listener);
    fetchJob(runId, jobName);
    return () => { jobListeners.get(key)?.delete(listener); };
  }, [key, runId, jobName]);
  return jobCache.get(key) ?? { status: "idle", data: null, error: null };
}

/** Reload the index from scratch (used in watch mode). */
export function invalidateIndex(): void {
  indexState = { status: "idle", data: null, error: null };
  fetchIndex();
}
