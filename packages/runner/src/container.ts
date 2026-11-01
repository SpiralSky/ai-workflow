/**
 * Docker container operations for the runner.
 * Runner architecture §4.1; server invocation §5.
 */

import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(_execFile);

/** Opaque handle returned by startContainer. */
export interface Container {
  id: string;
  problem: string;
  jobDir: string;
  networkId?: string;
}

/**
 * Map a canonical case-sensitive task ID injectively to a Docker reference.
 * Repository names are lowercase, but tags permit ASCII letters in either case.
 * Reject path/options/overlong IDs instead of normalizing them into collisions.
 */
export function problemImageRef(problem: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(problem)) {
    throw new Error("Invalid problem ID for Docker image tag");
  }
  return `aiw-problem:${problem}`;
}

/** Injectable Docker command boundary; production uses execFile without a shell. */
export type DockerImageCommand = (
  command: string, args: string[], options: { maxBuffer: number },
) => Promise<{ stdout: string }>;

/**
 * Builds a problem image and returns a validated immutable identity, never its mutable tag.
 * Registry RepoDigests identify a repository manifest; a locally built image's .Id instead
 * identifies its image configuration. These are distinct Docker identities, not equivalent hashes.
 * @param problemDir - path to the problem directory containing a Dockerfile
 * @param problem - problem id (used as the image tag)
 * @param run - injectable command boundary for offline tests
 * @throws if build/inspection fails or Docker returns a missing or malformed identity
 */
export async function buildImage(
  problemDir: string,
  problem: string,
  run: DockerImageCommand = (command, args, options) => execFile(command, args, options),
): Promise<string> {
  const tag = problemImageRef(problem);
  const options = { maxBuffer: 10 * 1024 * 1024 };
  await run("docker", ["build", "-t", tag, problemDir], options);
  const { stdout } = await run("docker", ["image", "inspect", tag], options);
  const images: unknown = JSON.parse(stdout);
  if (!Array.isArray(images) || images.length !== 1 ||
      !images[0] || typeof images[0] !== "object") {
    throw new Error("Docker inspection must return exactly one image");
  }
  const { Id: id, RepoDigests: repoDigests } = images[0] as Record<string, unknown>;
  if (typeof id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(id) ||
      !Array.isArray(repoDigests) || repoDigests.some(digest =>
        typeof digest !== "string" || !/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(digest))) {
    throw new Error("Docker inspection returned a missing or malformed immutable image identity");
  }
  return repoDigests[0] ?? id;
}

/**
 * Starts a problem container, mounting jobDir to /out and the server bundle to /opt/aiw/bundle.
 * @param problem - problem id (image tag)
 * @param jobDir - absolute path to the job output directory
 * @param serverBundle - absolute path to the server bundle
 * @param network - optional Docker network name (for orchestrate)
 * @param run - injectable command boundary for offline tests
 * @returns container handle
 */
export async function startContainer(
  problem: string,
  jobDir: string,
  serverBundle: string,
  network?: string,
  run: DockerImageCommand = (command, args, options) => execFile(command, args, options),
): Promise<Container> {
  const tag = problemImageRef(problem);
  const networkArg = network ?? "none";
  // bridge network needs explicit DNS; Docker's embedded DNS doesn't forward to external resolvers
  // on all host configurations (observed: bridge resolves LAN but not internet hostnames).
  const dnsArgs = network === "bridge" ? ["--dns", "8.8.8.8"] : [];
  const { stdout } = await run("docker", [
    "run",
    "-d",
    "--network",
    networkArg,
    ...dnsArgs,
    "--mount",
    `type=bind,src=${jobDir},dst=/out`,
    "--mount",
    `type=bind,src=${serverBundle},dst=/opt/aiw/bundle,readonly`,
    tag,
    "sleep",
    "infinity",
  ], { maxBuffer: 10 * 1024 * 1024 });
  const id = stdout.trim();
  return { id, problem, jobDir, networkId: network };
}

/** Minimal host Docker-client environment; provider credentials and endpoints never enter descriptors. */
export function dockerClientEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const allowed = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR",
    "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];
  return Object.fromEntries(allowed.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]!]]));
}

/**
 * Returns a spawn descriptor for starting the MCP server inside the container via docker exec.
 * The descriptor is passed to openMCPSession in mcp.ts, which spawns the process as a stdio transport.
 * @param ctr - container handle
 * @param serverArgs - extra arguments to pass to the server process
 * @param env - optional extra environment variables
 * @returns spawn descriptor with command, args, and env
 */
export async function startServer(
  ctr: Container,
  serverArgs: string[],
  env?: Record<string, string>,
): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
  return {
    command: "docker",
    args: [
      "exec",
      "-i",
      ctr.id,
      "/opt/aiw-node/bin/node",
      "--no-node-snapshot",
      "/opt/aiw/bundle/aiw-server.mjs",
      ...serverArgs,
    ],
    env: { ...dockerClientEnvironment(), ...dockerClientEnvironment(env ?? {}) },
  };
}

/**
 * Exports /work from the container to destDir on the host.
 * @param ctr - container handle
 * @param destDir - local destination directory
 */
export async function exportWork(ctr: Container, destDir: string): Promise<void> {
  await execFile("docker", ["cp", `${ctr.id}:/work`, destDir]);
}

/**
 * Removes the container (after job completion).
 * @param ctr - container handle
 */
export async function removeContainer(ctr: Container): Promise<void> {
  await execFile("docker", ["rm", "-f", ctr.id]);
}

/**
 * Kills the container (for budget cancellation or wall-clock timeout).
 * @param ctr - container handle
 */
export async function killContainer(ctr: Container): Promise<void> {
  await execFile("docker", ["kill", ctr.id]);
}
