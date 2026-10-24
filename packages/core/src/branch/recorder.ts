import { STACK_SOURCE } from "./stack.ts";

/**
 * Isolate-side runtime as source text: a function expression
 * `(host, names, lineMap, stateJSON, t0) => { run(prog) }` (core-branch §4). It defines `__t`, the
 * `console` and `__tools` handed to the program, allocates call ids, buffers events (flushed on
 * every tool call, every 256 events and at the end), maps stacks to lines and snapshots `state`.
 * `run(prog)` resolves to a JSON string `{ ok, value?, message?, line?, state, dropped }`.
 */
export const RECORDER_SOURCE =
  "(function (host, names, lineMap, stateJSON, t0) {\n" +
  STACK_SOURCE +
  String.raw`
  Error.stackTraceLimit = 30;
  const MAX_BUFFER = 256;
  const state = JSON.parse(stateJSON);
  let buf = [];
  let nextId = 0;

  const flush = () => {
    if (!buf.length) return;
    const events = buf;
    buf = [];
    host.flush(JSON.stringify(events));
  };
  const ev = (e) => {
    e.t = Date.now() - t0;
    buf.push(e);
    if (buf.length >= MAX_BUFFER) flush();
  };
  const lineOf = (stack) => mapStack(stack, lineMap)[0] || 0;
  // JSON copy for the trace; unserialisable values become a marker.
  const jcopy = (v) => {
    if (v === undefined) return undefined;
    try {
      const s = JSON.stringify(v);
      return s === undefined ? undefined : JSON.parse(s);
    } catch (e) {
      return "[unserialisable]";
    }
  };
  // Strict serialisation: functions, symbols, bigints and cycles anywhere inside throw.
  const ser = (v) =>
    JSON.stringify(v, (k, x) => {
      const ty = typeof x;
      if (ty === "function" || ty === "symbol" || ty === "bigint") throw new TypeError("not JSON");
      return x;
    });
  const snapshot = () => {
    const out = {};
    const dropped = [];
    for (const k of Object.keys(state)) {
      try {
        const s = ser(state[k]);
        if (s !== undefined) out[k] = JSON.parse(s);
      } catch (e) {
        dropped.push(k);
      }
    }
    return { state: out, dropped };
  };
  const fmt = (v) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.name + ": " + v.message;
    if (v === undefined) return "undefined";
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s;
    } catch (e) {
      return String(v);
    }
  };

  const __t = {
    cond(line, kind, value, pos, end) {
      ev({ type: "cond", line, kind, value: kind === "catch" ? true : Boolean(value), pos, end });
      return value;
    },
    case(line, pos, end) {
      ev({ type: "cond", line, kind: "switch", value: true, pos, end });
    },
    loopEnter(line, kind, endLine) {
      ev({ type: "loop", phase: "enter", line, kind, endLine });
    },
    loopIter(line) {
      ev({ type: "loop", phase: "iter", line });
    },
    loopExit(line) {
      ev({ type: "loop", phase: "exit", line });
    },
    ret(line, value) {
      ev({ type: "return", line, value: jcopy(value) });
      return value;
    },
  };

  const mkLog = (level) => (...a) => {
    ev({ type: "log", line: lineOf(new Error().stack), level, message: a.map(fmt).join(" ") });
  };
  const con = { log: mkLog("log"), info: mkLog("info"), warn: mkLog("warn"), error: mkLog("error"), debug: mkLog("log") };

  // Must stay synchronous up to the first await so the stack still shows the caller's line.
  const callTool = async (name, args) => {
    const id = ++nextId;
    const site = new Error().stack;
    ev({ type: "call", phase: "start", id, line: lineOf(site), name, args: jcopy(args) });
    const started = Date.now();
    let r;
    try {
      if (names.indexOf(name) < 0) {
        throw new Error("unknown tool: " + name + " (available: " + names.join(", ") + ")");
      }
      const s = snapshot();
      const payload = JSON.stringify({ id, name, args, state: s.state, dropped: s.dropped, events: buf });
      buf = [];
      r = JSON.parse(await host.call(payload));
    } catch (e) {
      r = { ok: false, error: { name: (e && e.name) || "Error", message: e && e.message !== undefined ? String(e.message) : String(e) } };
    }
    const ms = Date.now() - started;
    if (r.ok) {
      ev({ type: "call", phase: "end", id, ok: true, ms, result: r.value });
      return r.value;
    }
    ev({ type: "call", phase: "end", id, ok: false, ms, error: r.error.message });
    const err = new Error(r.error.message);
    err.name = r.error.name;
    // The host stack is meaningless here; the call-site stack is what maps to program lines.
    err.stack = err.name + ": " + err.message + "\n" + site.split("\n").slice(1).join("\n");
    Object.defineProperty(err, "__aiw", { value: { tool: name, id } });
    throw err;
  };
  const tools = new Proxy({}, {
    get(_, name) {
      if (typeof name !== "string" || name === "then") return undefined;
      return (args) => callTool(name, args);
    },
  });

  return {
    async run(prog) {
      let out;
      try {
        out = { ok: true, value: jcopy(await prog(__t, tools, state, con)) };
      } catch (e) {
        const obj = e !== null && typeof e === "object";
        const tag = obj ? e.__aiw : undefined;
        const lines = obj ? mapStack(e.stack, lineMap) : [];
        let message = fmt(e);
        if (obj && e.message !== undefined) {
          message = e.name && e.name !== "Error" ? e.name + ": " + e.message : String(e.message);
        }
        const event = { type: "error", message, lines };
        if (tag) {
          event.tool = tag.tool;
          event.callId = tag.id;
        }
        ev(event);
        out = { ok: false, message, line: lines[0] };
      }
      flush();
      const s = snapshot();
      out.state = s.state;
      out.dropped = s.dropped;
      return JSON.stringify(out);
    },
  };
})`;
