import fs from "node:fs";

/** Destination for JSON records, one line per record. */
export interface Sink {
  write(line: object): void;
}

/**
 * Append-only JSONL file sink. Each record is exactly one `writeSync` of one line, unbuffered, so
 * a crash loses at most the in-flight line and concurrent `O_APPEND` writers never interleave.
 */
export class FileSink implements Sink {
  private readonly fd: number;
  constructor(path: string) {
    this.fd = fs.openSync(path, "a");
  }
  write(line: object): void {
    fs.writeSync(this.fd, JSON.stringify(line) + "\n");
  }
  /** Closes the file descriptor. */
  close(): void {
    fs.closeSync(this.fd);
  }
}

/** Sink that discards everything. */
export class NoopSink implements Sink {
  write(_line: object): void {}
}
