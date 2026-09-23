// paddy-handoff v3 — live portal.
// The plugin stays open and acts as Figma's hands + eyes:
//   READ (always present): pushes whole-file snapshots + selection to the
//     local relay (via the UI iframe, which owns network). Auto-pushes on
//     selection change and on a timer while connected.
//   CREATE / EDIT / DELETE (agent-driven): executes commands the relay hands
//     it and reports before/after receipts back. All commands take explicit
//     node IDs the agent read from a snapshot — nothing is name-matched.
// No REST token, no rate limits.

// ---------- read: serialize ----------

function serializeFills(node) {
  if (!node.fills || node.fills === figma.mixed) return undefined;
  try {
    return node.fills.map(function (f) {
      if (f.type === "SOLID") {
        var c = f.color || {};
        return { type: "SOLID", r: round2(c.r), g: round2(c.g), b: round2(c.b), opacity: f.opacity };
      }
      return { type: f.type };
    });
  } catch (e) {
    return undefined;
  }
}

function round2(n) {
  return typeof n === "number" ? Math.round(n * 100) / 100 : n;
}

function serializeNode(node, depth, maxDepth) {
  var out = { id: node.id, name: node.name, type: node.type };
  if ("width" in node && "height" in node) {
    out.size = { w: Math.round(node.width), h: Math.round(node.height) };
  }
  if ("x" in node && "y" in node) {
    out.pos = { x: Math.round(node.x), y: Math.round(node.y) };
  }
  var fills = serializeFills(node);
  if (fills) out.fills = fills;
  if (node.type === "TEXT") {
    try {
      out.characters = String(node.characters).slice(0, 300);
      out.fontSize = node.fontSize === figma.mixed ? "mixed" : node.fontSize;
    } catch (e) {}
  }
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET" || node.type === "INSTANCE") {
    out.componentRef = true;
  }
  if (depth < maxDepth && "children" in node) {
    var kids = [];
    for (var i = 0; i < node.children.length && kids.length < 60; i++) {
      kids.push(serializeNode(node.children[i], depth + 1, maxDepth));
    }
    out.children = kids;
    if (node.children.length > kids.length) out.truncated = node.children.length - kids.length;
  }
  return out;
}

function snapshotWholeFile() {
  var pages = [];
  for (var p = 0; p < figma.root.children.length; p++) {
    pages.push(serializeNode(figma.root.children[p], 0, 3));
  }
  var sel = [];
  try {
    sel = figma.currentPage.selection.map(function (n) { return { id: n.id, name: n.name, type: n.type }; });
  } catch (e) {}
  return {
    file: figma.root.name,
    exportedAt: new Date().toISOString(),
    currentPage: { id: figma.currentPage.id, name: figma.currentPage.name },
    selection: sel,
    pageCount: pages.length,
    pages: pages
  };
}

// ---------- create: helpers ----------

function outputPage() {
  var name = "Agent Output — " + new Date().toISOString().slice(0, 10);
  var found = figma.root.children.filter(function (p) { return p.name === name; });
  if (found.length > 0) return found[0];
  var page = figma.createPage();
  page.name = name;
  return page;
}

function hexToRgb(hex) {
  var h = String(hex || "#E5E7EB").replace("#", "");
  if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
  var n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

async function makeText(characters, fontSize, colorHex, bold) {
  await figma.loadFontAsync({ family: "Inter", style: bold ? "Semi Bold" : "Regular" });
  var t = figma.createText();
  t.characters = String(characters).slice(0, 500);
  t.fontSize = fontSize;
  if (colorHex) t.fills = [{ type: "SOLID", color: hexToRgb(colorHex) }];
  return t;
}

function makeFrame(name, w, h, fillHex, radius) {
  var f = figma.createFrame();
  f.name = name;
  f.resize(w, h);
  if (fillHex) f.fills = [{ type: "SOLID", color: hexToRgb(fillHex) }];
  if (radius) f.cornerRadius = radius;
  return f;
}

// Spec v1: { frames: [ { name, w, h, fill,
//   texts: [ { text, size, color, bold, x, y } ],
//   rects: [ { w, h, fill, x, y } ] } ] }
async function createFromSpec(spec) {
  var page = outputPage();
  var frames = (spec && spec.frames) || [];
  if (!Array.isArray(frames) || frames.length === 0) throw new Error("Spec needs a non-empty 'frames' array.");
  if (frames.length > 20) throw new Error("Spec capped at 20 frames per run (got " + frames.length + ").");
  var created = [];
  var cursorY = 0;
  for (var i = 0; i < frames.length; i++) {
    var s = frames[i] || {};
    var f = makeFrame(
      String(s.name || "Agent Frame " + (i + 1)),
      Math.min(Math.max(parseInt(s.w) || 320, 16), 1600),
      Math.min(Math.max(parseInt(s.h) || 200, 16), 1600),
      s.fill || "#FFFFFF", 12
    );
    f.x = 0; f.y = cursorY; cursorY += f.height + 48;
    var texts = Array.isArray(s.texts) ? s.texts.slice(0, 20) : [];
    for (var t = 0; t < texts.length; t++) {
      var ts = texts[t] || {};
      var node = await makeText(ts.text || "", parseInt(ts.size) || 14, ts.color || "#111111", !!ts.bold);
      node.x = parseInt(ts.x) || 16; node.y = parseInt(ts.y) || 16;
      f.appendChild(node);
    }
    var rects = Array.isArray(s.rects) ? s.rects.slice(0, 20) : [];
    for (var r = 0; r < rects.length; r++) {
      var rs = rects[r] || {};
      var rect = figma.createRectangle();
      rect.resize(
        Math.min(Math.max(parseInt(rs.w) || 100, 8), 1600),
        Math.min(Math.max(parseInt(rs.h) || 60, 8), 1600)
      );
      rect.fills = [{ type: "SOLID", color: hexToRgb(rs.fill || "#E5E7EB") }];
      rect.cornerRadius = 8;
      rect.x = parseInt(rs.x) || 16; rect.y = parseInt(rs.y) || 48;
      f.appendChild(rect);
    }
    page.appendChild(f);
    created.push({ id: f.id, name: f.name });
  }
  figma.currentPage = page;
  figma.viewport.scrollAndZoomIntoView(created.map(function (c) { return figma.getNodeById(c.id); }).filter(Boolean));
  return created;
}

async function templateListingCard() {
  var page = outputPage();
  var card = makeFrame("Listing Card — Agent", 320, 400, "#FFFFFF", 12);
  card.layoutMode = "VERTICAL"; card.itemSpacing = 0;
  var photo = figma.createRectangle();
  photo.resize(320, 200);
  photo.fills = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  photo.name = "Photo placeholder (320x200)";
  card.appendChild(photo);
  var body = makeFrame("Body", 320, 200, "#FFFFFF", 0);
  body.layoutMode = "VERTICAL"; body.itemSpacing = 8;
  body.paddingLeft = 16; body.paddingRight = 16; body.paddingTop = 16; body.paddingBottom = 16;
  card.appendChild(body);
  body.appendChild(await makeText("2-bed in Osu — verified", 16, "#111111", true));
  body.appendChild(await makeText("Osu, Accra  •  2 bed  •  1 bath", 13, "#6B7280", false));
  body.appendChild(await makeText("GHS 2,500/mo  •  1 year advance", 14, "#111111", true));
  body.appendChild(await makeText("Staff-verified badge + Unlock CTA go here", 12, "#6B7280", false));
  page.appendChild(card);
  figma.currentPage = page;
  figma.viewport.scrollAndZoomIntoView([card]);
  return [{ id: card.id, name: card.name }];
}

async function templateTextInput() {
  var page = outputPage();
  var wrap = makeFrame("Text Input — Agent", 320, 76, "#FFFFFF", 0);
  wrap.layoutMode = "VERTICAL"; wrap.itemSpacing = 6;
  wrap.appendChild(await makeText("Label", 13, "#374151", true));
  var box = makeFrame("Input box", 320, 44, "#F9FAFB", 8);
  box.strokes = [{ type: "SOLID", color: hexToRgb("#D1D5DB") }]; box.strokeWeight = 1;
  var inner = await makeText("Placeholder text", 14, "#9CA3AF", false);
  inner.x = 12; inner.y = 12; box.appendChild(inner);
  wrap.appendChild(box);
  page.appendChild(wrap);
  figma.currentPage = page;
  figma.viewport.scrollAndZoomIntoView([wrap]);
  return [{ id: wrap.id, name: wrap.name }];
}

async function templateAuthForm() {
  var page = outputPage();
  var form = makeFrame("Auth Form — Agent", 360, 420, "#FFFFFF", 12);
  form.layoutMode = "VERTICAL"; form.itemSpacing = 12;
  form.paddingLeft = 24; form.paddingRight = 24; form.paddingTop = 24; form.paddingBottom = 24;
  form.appendChild(await makeText("Welcome back", 20, "#111111", true));
  form.appendChild(await makeText("Sign in to paddy", 13, "#6B7280", false));
  var email = makeFrame("Email field", 312, 44, "#F9FAFB", 8);
  email.strokes = [{ type: "SOLID", color: hexToRgb("#D1D5DB") }]; email.strokeWeight = 1;
  form.appendChild(email);
  var pass = makeFrame("Password field", 312, 44, "#F9FAFB", 8);
  pass.strokes = [{ type: "SOLID", color: hexToRgb("#D1D5DB") }]; pass.strokeWeight = 1;
  form.appendChild(pass);
  var btn = makeFrame("Sign in button", 312, 48, "#16A34A", 8);
  btn.appendChild(await makeText("Sign in", 15, "#FFFFFF", true));
  form.appendChild(btn);
  page.appendChild(form);
  figma.currentPage = page;
  figma.viewport.scrollAndZoomIntoView([form]);
  return [{ id: form.id, name: form.name }];
}

function routePrompt(prompt) {
  var p = String(prompt || "").toLowerCase();
  if (p.indexOf("input") !== -1 || p.indexOf("text field") !== -1) return "text-input";
  if (p.indexOf("auth") !== -1 || p.indexOf("login") !== -1 || p.indexOf("sign in") !== -1) return "auth-form";
  return "listing-card";
}

// Agent-issued command executor. Single entry point for relay commands:
//   create: 'create-spec' | 'create-template'
//   read:   'snapshot' | 'get-subtree'
//   edit:   'update-text' | 'set-fill' | 'resize' | 'move' | 'rename'
//   delete: 'delete-node'
// All node-targeting commands take explicit node IDs the agent read from a
// snapshot — nothing is name-matched. Every mutation returns a
// before/after receipt so the agent session stays auditable.
function findNode(id) {
  var n = figma.getNodeById(id);
  if (!n) throw new Error("Node not found: " + id);
  return n;
}

function describeNode(n) {
  var d = { id: n.id, name: n.name, type: n.type };
  if ("width" in n && "height" in n) d.size = { w: Math.round(n.width), h: Math.round(n.height) };
  if (n.type === "TEXT") {
    try { d.characters = String(n.characters).slice(0, 200); } catch (e) {}
  }
  return d;
}

async function execCommand(cmd) {
  cmd = cmd || {};
  if (cmd.kind === "create-spec") {
    var spec = typeof cmd.spec === "string" ? JSON.parse(cmd.spec) : cmd.spec;
    var created = await createFromSpec(spec);
    figma.notify("Agent created " + created.length + " frame(s).");
    return { created: created };
  }
  if (cmd.kind === "create-template") {
    var kind = cmd.template === "prompt" ? routePrompt(cmd.prompt) : (cmd.template || "listing-card");
    var out;
    if (kind === "text-input") out = await templateTextInput();
    else if (kind === "auth-form") out = await templateAuthForm();
    else out = await templateListingCard();
    figma.notify("Agent template drawn: " + kind);
    return { created: out, kind: kind };
  }
  if (cmd.kind === "snapshot") {
    return { snapshot: snapshotWholeFile() };
  }
  if (cmd.kind === "get-subtree") {
    if (!cmd.nodeId) throw new Error("get-subtree needs 'nodeId'.");
    var target = findNode(cmd.nodeId);
    var depth = Math.min(Math.max(parseInt(cmd.depth) || 3, 0), 6);
    return { subtree: serializeNode(target, 0, depth) };
  }
  if (cmd.kind === "update-text") {
    if (!cmd.nodeId) throw new Error("update-text needs 'nodeId'.");
    var t = findNode(cmd.nodeId);
    if (t.type !== "TEXT") throw new Error("update-text target is " + t.type + ", not TEXT.");
    var beforeChars = null;
    try { beforeChars = String(t.characters).slice(0, 200); } catch (e) {}
    try {
      if (t.fontName !== figma.mixed) await figma.loadFontAsync(t.fontName);
      else throw new Error("mixed");
    } catch (e) {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      try { await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" }); } catch (e2) {}
    }
    t.characters = String(cmd.characters == null ? "" : cmd.characters).slice(0, 2000);
    figma.notify("Agent updated text: " + t.name);
    return { before: { id: t.id, characters: beforeChars }, after: describeNode(t) };
  }
  if (cmd.kind === "set-fill") {
    if (!cmd.nodeId) throw new Error("set-fill needs 'nodeId'.");
    var s = findNode(cmd.nodeId);
    var beforeFill = serializeFills(s);
    s.fills = [{ type: "SOLID", color: hexToRgb(cmd.fill || "#FFFFFF") }];
    figma.notify("Agent set fill: " + s.name);
    return { before: { id: s.id, fills: beforeFill }, after: describeNode(s) };
  }
  if (cmd.kind === "resize") {
    if (!cmd.nodeId) throw new Error("resize needs 'nodeId'.");
    var r = findNode(cmd.nodeId);
    var beforeSize = describeNode(r);
    r.resize(
      Math.min(Math.max(parseInt(cmd.w) || 100, 1), 4000),
      Math.min(Math.max(parseInt(cmd.h) || 100, 1), 4000)
    );
    figma.notify("Agent resized: " + r.name);
    return { before: beforeSize, after: describeNode(r) };
  }
  if (cmd.kind === "move") {
    if (!cmd.nodeId) throw new Error("move needs 'nodeId'.");
    var m = findNode(cmd.nodeId);
    var beforePos = describeNode(m);
    if (cmd.x != null) m.x = parseInt(cmd.x);
    if (cmd.y != null) m.y = parseInt(cmd.y);
    figma.notify("Agent moved: " + m.name);
    return { before: beforePos, after: describeNode(m) };
  }
  if (cmd.kind === "rename") {
    if (!cmd.nodeId) throw new Error("rename needs 'nodeId'.");
    var rn = findNode(cmd.nodeId);
    var beforeName = rn.name;
    rn.name = String(cmd.name || beforeName).slice(0, 200);
    return { before: { id: rn.id, name: beforeName }, after: describeNode(rn) };
  }
  if (cmd.kind === "delete-node") {
    var ids = Array.isArray(cmd.nodeIds) ? cmd.nodeIds : (cmd.nodeId ? [cmd.nodeId] : []);
    if (ids.length === 0) throw new Error("delete-node needs 'nodeId' or 'nodeIds'.");
    if (ids.length > 50) throw new Error("delete-node capped at 50 nodes per call.");
    var receipts = [];
    for (var i = 0; i < ids.length; i++) {
      var d = findNode(ids[i]);
      if (d.id === "0:0") throw new Error("Refusing to delete the document root.");
      receipts.push({ id: d.id, name: d.name, type: d.type, removed: true });
      d.remove();
    }
    figma.notify("Agent deleted " + receipts.length + " node(s). Undo: Cmd/Ctrl+Z or version history.");
    return { deleted: receipts };
  }
  throw new Error("Unknown command kind: " + cmd.kind);
}

// ---------- portal wiring ----------

figma.showUI(__html__, { width: 420, height: 600 });

// Live read: any selection change is pushed to the UI, which forwards it
// to the relay when connected. Debounced so drag-selects don't spam.
var selTimer = null;
figma.on("selectionchange", function () {
  if (selTimer) clearTimeout(selTimer);
  selTimer = setTimeout(function () {
    try {
      figma.ui.postMessage({ type: "auto-snapshot", snapshot: snapshotWholeFile() });
    } catch (e) {}
  }, 800);
});

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === "snapshot" || msg.type === "pull-snapshot") {
      figma.ui.postMessage({ type: "snapshot-result", snapshot: snapshotWholeFile() });
    } else if (msg.type === "exec") {
      // Relay-issued command: always answer with exec-result carrying the id.
      try {
        var data = await execCommand(msg.command);
        figma.ui.postMessage({ type: "exec-result", id: msg.id, ok: true, data: data });
      } catch (err) {
        figma.ui.postMessage({ type: "exec-result", id: msg.id, ok: false, error: String((err && err.message) || err) });
      }
    } else if (msg.type === "create-spec") {
      // Offline fallback (relay down): same executor, local answer.
      var created = await createFromSpec(JSON.parse(msg.spec));
      figma.ui.postMessage({ type: "create-result", created: created });
      figma.notify("Created " + created.length + " frame(s) on Agent Output page.");
    } else if (msg.type === "create-template") {
      var kind = msg.kind === "prompt" ? routePrompt(msg.prompt) : msg.kind;
      var out;
      if (kind === "text-input") out = await templateTextInput();
      else if (kind === "auth-form") out = await templateAuthForm();
      else out = await templateListingCard();
      figma.ui.postMessage({ type: "create-result", created: out, kind: kind });
      figma.notify("Template drawn: " + kind);
    }
  } catch (err) {
    if (msg && msg.type === "exec") {
      figma.ui.postMessage({ type: "exec-result", id: msg.id, ok: false, error: String((err && err.message) || err) });
    } else {
      figma.ui.postMessage({ type: "error", message: String((err && err.message) || err) });
    }
  }
};
