# paddy-handoff portal — agent contract

Live bridge between AI agents and the `Housing Platform` Figma file.
The plugin (open in Figma Desktop) is Figma's hands + eyes; the relay
(`relay.js`, `http://localhost:8787`) is the HTTP surface agents use.
Agents never talk to Figma or its REST API directly through this portal.

## Bring-up (human does this once per work session)

1. `node figma-plugin/paddy-handoff/relay.js` (defaults to port 8787, localhost only)
2. Figma Desktop → run plugin `paddy-handoff` → press **Connect**
3. Agent verifies: `GET /health` shows `"pluginConnected": true`

While the plugin stays open it pushes a whole-file snapshot on Connect,
every 8s, and on every selection change. It polls `/commands` every 1.5s
and executes whatever agents enqueue.

## Read

- `GET /snapshot` → `{ ok, at, snapshot }`. Snapshot shape:
  `{ file, exportedAt, currentPage: {id,name}, selection: [{id,name,type}], pageCount, pages }`.
  Nodes: `{ id, name, type, size?, pos?, fills?, characters? (TEXT, 300ch), fontSize?, componentRef?, children?, truncated? }`.
  Caps: depth 3, 60 children/node. 8 pages: Page 1, Base, Tokens, Brand, components, icons, Design, References.
- `GET /health` → `{ ok, pluginConnected, snapshotAgeSec, pendingCommands, totalCommands }`
- Targeted re-read: `POST /command {"kind":"get-subtree","nodeId":"<id>","depth":3}` (depth 0–6)

## Write (all agent-driven, explicit node IDs only)

| kind | fields | notes |
|---|---|---|
| `create-spec` | `spec` (object or JSON string: `{frames:[{name,w,h,fill,texts:[{text,size,color,bold,x,y}],rects:[{w,h,fill,x,y}]}]}`) | max 20 frames/run |
| `create-template` | `template`: `listing-card` \| `text-input` \| `auth-form`, or `{"template":"prompt","prompt":"..."}` (keyword-routed) | draws on `Agent Output — <date>` page |
| `update-text` | `nodeId`, `characters` | TEXT nodes only, 2000ch cap |
| `set-fill` | `nodeId`, `fill` (`#hex`) | solid fills |
| `resize` | `nodeId`, `w`, `h` | clamped 1–4000 |
| `move` | `nodeId`, `x?`, `y?` | no-op under auto-layout (layout owns position) |
| `rename` | `nodeId`, `name` | |
| `delete-node` | `nodeId` or `nodeIds[]` | max 50/call; refuses document root only |
| `snapshot` | — | forces a fresh snapshot into the next result |

Every command: `POST /command` → `{ ok, id }`, then poll `GET /result/<id>` →
`{ pending:true }` or `{ pending:false, result:{ ok, data|error, at } }`.
Mutations return before/after receipts — quote node IDs from the receipt, not memory.

## Rules for agents

1. Read before writing: `GET /snapshot` (or `get-subtree`) first; use exact node IDs from it. Never guess IDs, never match by name (names repeat).
2. Scope: new work goes to the `Agent Output` page via create commands. Touch existing pages only on explicit human instruction.
3. Undo is human-side: Cmd/Ctrl+Z or File → Show version history. Announce destructive calls before making them.
4. Image renders and variable-value resolution are NOT portal jobs — use the Figma REST API (`GET /v1/images/:key`, `GET /v1/files/:key/variables/local` with a token) for those.
5. Relay is in-memory and localhost-trusted: snapshots vanish on restart, no auth. Keep the token/relay off the public network.

## Worked example

```bash
curl -s http://localhost:8787/health
curl -s http://localhost:8787/snapshot -o snap.json
curl -s -X POST http://localhost:8787/command \
  -H "Content-Type: application/json" \
  -d '{"kind":"create-template","template":"listing-card"}'
# → {"ok":true,"id":7}
curl -s http://localhost:8787/result/7
```
