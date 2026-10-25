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
 * Builds the Docker image for a problem if it is not already present.
 * @param problemDir - path to the problem directory containing a Dockerfile
 * @param problem - problem id (used as the image tag)
 * @returns the image digest (sha256:...)
 */
export async function buildImage(problemDir: string, problem: string): Promise<string> {
  const tag = `aiw-problem-${problem}`;
  await execFile("docker", ["build", "-t", tag, problemDir], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const { stdout } = await execFile("docker", [
    "image",
    "inspect",
    "--format",
    "{{index .RepoDigests 0}}",
    tag,
  ]);
  const digest = stdout.trim();
  return digest || tag;
}

/**
 * Starts a problem container, mounting jobDir to /out and the server bundle to /opt/aiw/bundle.
 * @param problem - problem id (image tag)
 * @param jobDir - absolute path to the job output directory
 * @param serverBundle - absolute path to the server bundle
 * @param network - optional Docker network name (for orchestrate)
 * @returns container handle
 */
export async function startContainer(
  problem: string,
  jobDir: string,
  serverBundle: string,
  network?: string,
): Promise<Container> {
  const tag = `aiw-problem-${problem}`;
  const networkArg = network ?? "none";
  const { stdout } = await execFile("docker", [
    "run",
    "-d",
    "--network",
    networkArg,
    "--mount",
    `type=bind,src=${jobDir},dst=/out`,
    "--mount",
    `type=bind,src=${serverBundle},dst=/opt/aiw/bundle,readonly`,
    tag,
    "sleep",
    "infinity",
  ]);
  const id = stdout.trim();
  return { id, problem, jobDir, networkId: network };
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
    env: { ...process.env, ...(env ?? {}) } as Record<string, string>,
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
