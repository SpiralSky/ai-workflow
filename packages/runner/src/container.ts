/**
 * Docker container operations for the runner.
 * Runner architecture §4.1; server invocation §5.
 *
 * TODO: All functions are stubs. Implement by calling `docker` CLI commands via child_process.
 */

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
  // TODO: run `docker build -t aiw-problem-<problem> <problemDir>` and inspect digest
  console.error(`[container stub] buildImage: would build image for ${problem} from ${problemDir}`);
  return `sha256:stub-${problem}`;
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
  // TODO: run `docker run -d --network <none|network> --mount ... aiw-problem-<problem> sleep infinity`
  console.error(`[container stub] startContainer: would start container for ${problem}`);
  return { id: `stub-ctr-${problem}-${Date.now()}`, problem, jobDir, networkId: network };
}

/**
 * Starts the MCP server inside the container via docker exec.
 * @param ctr - container handle
 * @param serverArgs - extra arguments to pass to the server process
 * @returns the exec process (or a mock)
 */
export async function startServer(ctr: Container, serverArgs: string[]): Promise<void> {
  // TODO: run `docker exec -i <ctr.id> /opt/aiw-node/bin/node ... aiw-server.mjs <serverArgs>`
  console.error(`[container stub] startServer: would start server in ${ctr.id} with args ${serverArgs.join(" ")}`);
}

/**
 * Exports /work from the container to destDir on the host.
 * @param ctr - container handle
 * @param destDir - local destination directory
 */
export async function exportWork(ctr: Container, destDir: string): Promise<void> {
  // TODO: run `docker cp <ctr.id>:/work <destDir>`
  console.error(`[container stub] exportWork: would copy /work from ${ctr.id} to ${destDir}`);
}

/**
 * Removes the container (after job completion).
 * @param ctr - container handle
 */
export async function removeContainer(ctr: Container): Promise<void> {
  // TODO: run `docker rm -f <ctr.id>`
  console.error(`[container stub] removeContainer: would remove container ${ctr.id}`);
}

/**
 * Kills the container (for budget cancellation or wall-clock timeout).
 * @param ctr - container handle
 */
export async function killContainer(ctr: Container): Promise<void> {
  // TODO: run `docker kill <ctr.id>`
  console.error(`[container stub] killContainer: would kill container ${ctr.id}`);
}
