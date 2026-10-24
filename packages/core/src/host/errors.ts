/** Transport or infrastructure failure of a host (not a tool's own error). */
export class HostError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HostError";
  }
}
