// paddy-handoff relay — zero-dependency local portal server.
// The Figma plugin (UI iframe) POSTs live snapshots here and polls for
// commands. Agents talk HTTP to this relay; they never touch Figma directly.
//
//   Plugin  -> POST /snapshot { snapshot }        (live read, always present while open)
//   Agent   -> GET  /snapshot                     (latest live read)
//   Agent   -> POST /command { kind, ... }        (enqueue creation; kind: create-spec | create-template | snapshot)
//   Plugin  -> GET  /commands?after=<id>          (poll)
//   Plugin  -> POST /result { id, ok, data, error }
//   Agent   -> GET  /result/<id>                  (poll for completion)
//   Anyone  -> GET  /health
//
// Run:  node relay.js [port]   (default 8787, localhost only)

const http = require("http");
const PORT = parseInt(process.argv[2] || process.env.PORT || "8787", 10);

let latestSnapshot = null;
let snapshotAt = 0;
let nextId = 1;
const commands = [];
const results = new Map();

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on("data", (c) => {
      chunks.push(c);
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error("body too large (5MB cap)"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      return res.end();
    }
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      const age = snapshotAt ? Math.round((Date.now() - snapshotAt) / 1000) : null;
      return send(res, 200, {
        ok: true,
        pluginConnected: age !== null && age < 20,
        snapshotAgeSec: age,
        pendingCommands: commands.filter((c) => !results.has(c.id)).length,
        totalCommands: commands.length
      });
    }

    if (req.method === "POST" && url.pathname === "/snapshot") {
      const body = await readBody(req);
      if (!body.snapshot) return send(res, 400, { ok: false, error: "missing snapshot" });
      latestSnapshot = body.snapshot;
      snapshotAt = Date.now();
      return send(res, 200, { ok: true, at: new Date(snapshotAt).toISOString() });
    }

    if (req.method === "GET" && url.pathname === "/snapshot") {
      if (!latestSnapshot) {
        return send(res, 404, {
          ok: false,
          error: "no snapshot yet — open the file, run the plugin, press Connect"
        });
      }
      return send(res, 200, {
        ok: true,
        at: new Date(snapshotAt).toISOString(),
        snapshot: latestSnapshot
      });
    }

    if (req.method === "POST" && url.pathname === "/command") {
      const body = await readBody(req);
      const KINDS = ["create-spec", "create-template", "snapshot", "get-subtree",
        "update-text", "set-fill", "resize", "move", "rename", "delete-node"];
      if (!body.kind || !KINDS.includes(body.kind)) {
        return send(res, 400, {
          ok: false,
          error: "kind must be one of: " + KINDS.join(" | ")
        });
      }
      const cmd = { id: nextId++, at: new Date().toISOString(), command: body };
      commands.push(cmd);
      if (commands.length > 200) commands.splice(0, commands.length - 200);
      return send(res, 200, { ok: true, id: cmd.id });
    }

    if (req.method === "GET" && url.pathname === "/commands") {
      const after = parseInt(url.searchParams.get("after") || "0", 10) || 0;
      const pending = commands.filter((c) => c.id > after).slice(-50);
      const age = snapshotAt ? Math.round((Date.now() - snapshotAt) / 1000) : null;
      return send(res, 200, {
        ok: true,
        snapshotAge: age === null ? "no snapshot yet" : age + "s ago",
        commands: pending.map((c) => ({ id: c.id, command: c.command }))
      });
    }

    if (req.method === "POST" && url.pathname === "/result") {
      const body = await readBody(req);
      if (typeof body.id !== "number") return send(res, 400, { ok: false, error: "missing numeric id" });
      results.set(body.id, {
        ok: body.ok !== false,
        data: body.data || null,
        error: body.error || null,
        at: new Date().toISOString()
      });
      return send(res, 200, { ok: true });
    }

    const m = url.pathname.match(/^\/result\/(\d+)$/);
    if (req.method === "GET" && m) {
      const id = parseInt(m[1], 10);
      if (!results.has(id)) return send(res, 200, { ok: true, pending: true, id });
      return send(res, 200, { ok: true, pending: false, id, result: results.get(id) });
    }

    return send(res, 404, { ok: false, error: "unknown route" });
  } catch (e) {
    return send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("paddy-handoff relay on http://localhost:" + PORT);
  console.log("  plugin -> POST /snapshot | GET /commands?after=0 | POST /result");
  console.log("  agent  -> GET /snapshot  | POST /command | GET /result/<id>");
});
