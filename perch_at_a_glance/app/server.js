"use strict";
/* Perch at a Glance — add-on server.
 *
 * Phase 1: FEED-ONLY. Skipper + Amanda push structured items to POST /api/feed
 * (per-assistant bearer tokens, idempotency keys). The server also polls
 * Open-Meteo for weather (free, no key) every 30 minutes and caches it.
 *
 * Authority rules (locked):
 *  - Polled layer is authority for facts (weather; calendar/tasks once HA
 *    Google polling lands in a later phase).
 *  - Fed layer is authority for lunch, school notes, pickup notes, shopping,
 *    teacher requests, and annotations on polled data.
 *  - Fed items never rewrite/delete polled events. Fed calendar items render
 *    with a Provisional badge.
 *  - Shopping / lunch / school schedule are fed-only: the app never invents them.
 *  - Same-source conflicts: last-write-wins (by id). Cross-source disagreements
 *    on the same natural key are flagged as conflicts and surfaced in /api/state.
 *
 * No framework, no build step. Node 20 LTS, better-sqlite3, plain http.
 * Data lives in $PERCH_DATA_DIR (the add-on's /data, persisted by Supervisor).
 * No HA calls are made in Phase 1; PERCH_HA_TOKEN is accepted and held for
 * Phase 2 (read-only HA states).
 */

var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var Database = require("better-sqlite3");

/* ------------------------------------------------------------------ config */

var PORT = parseInt(process.env.PERCH_PORT || "8099", 10);
var TIMEZONE = process.env.PERCH_TIMEZONE || "America/St_Johns";
var DEFAULT_VIEWER = process.env.PERCH_DEFAULT_VIEWER || "trevor";
/* Theme follows the viewer and is CONFIGURABLE per viewer (add-on options
   theme_trevor / theme_leslie) — never hard-coded. Trevor -> dark,
   northdatum-dark, direction A ("Field Instrument, Dark") applied
   2026-11-10 from locked Northdatum tokens (ND-BRAND-001 v1.4 /
   ND-VIS-004 v1.3); pine is one candidate among others. Leslie -> blush
   (light). Blush is Leslie's only; Trevor's view is never blush. */
var VIEWER_THEME = {
  trevor: process.env.PERCH_THEME_TREVOR || "northdatum-dark",
  leslie: process.env.PERCH_THEME_LESLIE || "blush"
};
var OPEN_METEO = process.env.PERCH_OPEN_METEO_ENABLED !== "0";
var HA_TOKEN = process.env.PERCH_HA_TOKEN || ""; // Phase 2+; unused in Phase 1.
var FEED_TOKENS = {
  skipper: process.env.PERCH_FEED_TOKEN_SKIPPER || "",
  amanda: process.env.PERCH_FEED_TOKEN_AMANDA || ""
};
var PUBLIC_DIR = path.join(__dirname, "public");
var SCHEMA_VERSION = "perch-state/0.1";
var LOOKOUT_REOPEN_DATE = "2027-05-01"; // May 1 benchmark (Trevor, 2026-11-09)
var WEATHER_POLL_MS = 30 * 60 * 1000;

var PLACES = [
  { key: "cbs", label: "Conception Bay South", lat: 47.5114, lon: -52.9857 },
  { key: "holyrood", label: "Holyrood", lat: 47.3833, lon: -53.1333 },
  { key: "mount_pearl", label: "Mount Pearl", lat: 47.5189, lon: -52.8058 },
  // Lookout farmhouse point (Trevor-confirmed 2026-10-24).
  { key: "lethbridge", label: "Lethbridge (Lookout)", lat: 48.333868, lon: -53.887623 }
];

/* Fed item types. calendar-event is a Phase 1 bridge: with no polled layer
   yet, the assistants push the calendar events they read themselves; those
   items always render Provisional and are superseded by polled events when
   HA Google polling lands (matched on source_event_id, else date+title). */
var FEED_TYPES = [
  "lunch", "school-note", "pickup-note", "task", "shopping",
  "calendar-annotation", "calendar-event", "flag"
];

/* --------------------------------------------------------------- data dir */

function resolveDataDir() {
  var candidates = [];
  if (process.env.PERCH_DATA_DIR) candidates.push(process.env.PERCH_DATA_DIR);
  candidates.push("/data");
  candidates.push(path.join(__dirname, "data"));
  for (var i = 0; i < candidates.length; i++) {
    try {
      fs.mkdirSync(candidates[i], { recursive: true });
      fs.accessSync(candidates[i], fs.constants.W_OK);
      return candidates[i];
    } catch (e) { /* try next */ }
  }
  throw new Error("No writable data directory found");
}
var DATA_DIR = resolveDataDir();
var db = new Database(path.join(DATA_DIR, "perch.db"));
db.pragma("journal_mode = WAL");
db.exec(
  "CREATE TABLE IF NOT EXISTS feed_items (" +
  "  id TEXT PRIMARY KEY," +
  "  source TEXT NOT NULL," +              // skipper | amanda | board
  "  type TEXT NOT NULL," +
  "  subject TEXT," +                      // natural-key part (usually a date or person)
  "  title TEXT," +
  "  payload TEXT NOT NULL," +             // JSON
  "  provisional INTEGER NOT NULL DEFAULT 0," +
  "  conflict INTEGER NOT NULL DEFAULT 0," +
  "  retracted INTEGER NOT NULL DEFAULT 0," +
  "  created_at TEXT NOT NULL," +
  "  updated_at TEXT NOT NULL" +
  ");" +
  "CREATE TABLE IF NOT EXISTS task_states (" +
  "  item_id TEXT PRIMARY KEY," +
  "  reported_done INTEGER NOT NULL," +
  "  updated_at TEXT NOT NULL" +
  ");" +
  "CREATE TABLE IF NOT EXISTS weather_cache (" +
  "  place TEXT PRIMARY KEY," +
  "  payload TEXT NOT NULL," +
  "  fetched_at TEXT NOT NULL" +
  ");" +
  "CREATE TABLE IF NOT EXISTS meta (" +
  "  key TEXT PRIMARY KEY," +
  "  value TEXT" +
  ");"
);

/* ------------------------------------------------------------------ utils */

function nowIso() { return new Date().toISOString(); }

function log() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("[" + nowIso() + "]");
  console.log.apply(console, args);
}

/* YYYY-MM-DD in America/St_Johns for a Date (defaults to now). */
function stJohnsDate(d) {
  d = d || new Date();
  var parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  var y = "", m = "", day = "";
  parts.forEach(function (p) {
    if (p.type === "year") y = p.value;
    if (p.type === "month") m = p.value;
    if (p.type === "day") day = p.value;
  });
  return y + "-" + m + "-" + day;
}

function addDaysIso(isoDate, n) {
  var d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isWeekendMode() {
  var fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, weekday: "short", hour: "numeric", hour12: false
  });
  var parts = fmt.formatToParts(new Date());
  var wd = "", hour = 0;
  parts.forEach(function (p) {
    if (p.type === "weekday") wd = p.value;
    if (p.type === "hour") hour = parseInt(p.value, 10);
  });
  // Weekend view: Friday evening -> Monday morning.
  if (wd === "Fri" && hour >= 17) return true;
  if (wd === "Sat" || wd === "Sun") return true;
  if (wd === "Mon" && hour < 8) return true;
  return false;
}

function readBody(req, maxBytes) {
  maxBytes = maxBytes || 256 * 1024;
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > maxBytes) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authenticateFeed(req) {
  var h = req.headers.authorization || "";
  var m = /^Bearer\s+(.+)$/.exec(h);
  if (!m) return null;
  var token = m[1];
  if (FEED_TOKENS.skipper && timingSafeEqual(token, FEED_TOKENS.skipper)) return "skipper";
  if (FEED_TOKENS.amanda && timingSafeEqual(token, FEED_TOKENS.amanda)) return "amanda";
  return null;
}

/* ------------------------------------------------------------------ weather */

function fetchPlaceWeather(place) {
  return new Promise(function (resolve) {
    var q = "latitude=" + place.lat + "&longitude=" + place.lon +
      "&current=temperature_2m,weather_code,wind_speed_10m" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code" +
      "&timezone=" + encodeURIComponent(TIMEZONE) + "&forecast_days=7";
    var req = https.get("https://api.open-meteo.com/v1/forecast?" + q, { timeout: 10000 }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        try {
          var parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve({ place: place.key, label: place.label, data: parsed, fetched_at: nowIso() });
        } catch (e) { resolve(null); }
      });
    });
    req.on("timeout", function () { req.destroy(); resolve(null); });
    req.on("error", function () { resolve(null); });
  });
}

function pollWeather() {
  if (!OPEN_METEO) return;
  var pending = PLACES.length;
  PLACES.forEach(function (place) {
    fetchPlaceWeather(place).then(function (result) {
      if (result) {
        db.prepare("INSERT INTO weather_cache (place, payload, fetched_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(place) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at")
          .run(place.key, JSON.stringify(result), result.fetched_at);
      } else {
        log("Weather fetch failed for " + place.key + " (keeping last cached)");
      }
      if (--pending === 0) log("Weather poll done");
    });
  });
}

/* -------------------------------------------------------------- feed store */

var upsertFeed = db.prepare(
  "INSERT INTO feed_items (id, source, type, subject, title, payload, provisional, conflict, retracted, created_at, updated_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET source=excluded.source, type=excluded.type, " +
  "subject=excluded.subject, title=excluded.title, payload=excluded.payload, " +
  "provisional=excluded.provisional, retracted=excluded.retracted, updated_at=excluded.updated_at"
);

/* Flag cross-source conflicts on the same natural key (type + subject). */
function refreshConflicts(type, subject) {
  if (!subject) return;
  var rows = db.prepare(
    "SELECT id, source, payload FROM feed_items WHERE type=? AND subject=? AND retracted=0"
  ).all(type, subject);
  /* A conflict is a DISAGREEMENT: the same natural key fed by two or more
     different sources with different payloads. Multiple distinct items of
     the same type on the same date from ONE source (e.g. five tasks due
     Nov 10, all from Skipper) are normal, not a conflict. The pre-fix
     version flagged those — false positives on every multi-item day. */
  var byPayload = {};
  var sources = {};
  rows.forEach(function (r) { byPayload[r.payload] = 1; sources[r.source] = 1; });
  var conflicted = Object.keys(byPayload).length > 1 && Object.keys(sources).length > 1;
  rows.forEach(function (r) {
    db.prepare("UPDATE feed_items SET conflict=? WHERE id=?").run(conflicted ? 1 : 0, r.id);
  });
}

function listFeed(type) {
  var rows = type
    ? db.prepare("SELECT * FROM feed_items WHERE type=? AND retracted=0 ORDER BY updated_at DESC").all(type)
    : db.prepare("SELECT * FROM feed_items WHERE retracted=0 ORDER BY updated_at DESC").all();
  return rows.map(function (r) {
    var item = {
      id: r.id, source: r.source, type: r.type, subject: r.subject,
      title: r.title, provisional: !!r.provisional, conflict: !!r.conflict,
      created_at: r.created_at, updated_at: r.updated_at
    };
    try { item.payload = JSON.parse(r.payload); } catch (e) { item.payload = {}; }
    return item;
  });
}

function lastFeedAt(source) {
  var row = db.prepare(
    "SELECT MAX(updated_at) AS t FROM feed_items WHERE retracted=0 AND source=?"
  ).get(source);
  return row ? row.t : null;
}

/* ------------------------------------------------------------ state build */

/* Lunch header rule (Trevor, 2026-11-09): "Pack Lunch" / "Hot Lunch" /
   "Pack & Hot" when one boy has hot lunch and the other packs. */
function lunchHeaderForDate(dateIso) {
  var items = listFeed("lunch").filter(function (it) { return it.subject === dateIso; });
  var robbie = "pack", keagan = "pack";
  items.forEach(function (it) {
    var p = it.payload || {};
    if (p.robbie && p.robbie.meal) robbie = p.robbie.meal;
    if (p.keagan && p.keagan.meal) keagan = p.keagan.meal;
  });
  var header = (robbie === "hot" && keagan === "hot") ? "Hot Lunch"
    : (robbie !== keagan) ? "Pack & Hot" : "Pack Lunch";
  return { header: header, robbie: robbie, keagan: keagan, items: items };
}

/* Next-week pack count: Mon–Fri, days with no lunch item default to pack for
   both boys; a day is excluded when a school-note marks lunch as provided
   (e.g. PL day at Stay & Play). Returns { pack_days, lunches, days: [...] }. */
function nextWeekPackCount() {
  var today = stJohnsDate();
  var dow = new Date(today + "T12:00:00Z").getUTCDay(); // 0 Sun .. 6 Sat
  var daysToMonday = ((8 - dow) % 7) || 7;
  var monday = addDaysIso(today, daysToMonday);
  var provided = {};
  listFeed("school-note").forEach(function (it) {
    if (it.payload && it.payload.lunch_provided) provided[it.subject] = true;
  });
  var packDays = 0, lunches = 0, days = [];
  for (var i = 0; i < 5; i++) {
    var date = addDaysIso(monday, i);
    if (provided[date]) { days.push({ date: date, pack: false, reason: "lunch provided" }); continue; }
    var lh = lunchHeaderForDate(date);
    var packs = (lh.robbie === "pack" ? 1 : 0) + (lh.keagan === "pack" ? 1 : 0);
    if (packs > 0) { packDays++; lunches += packs; }
    days.push({ date: date, pack: packs > 0, lunches: packs });
  }
  return { week_of: monday, pack_days: packDays, lunches: lunches, days: days };
}

function buildState() {
  var today = stJohnsDate();
  var lunchToday = lunchHeaderForDate(today);

  var weather = {};
  db.prepare("SELECT place, payload, fetched_at FROM weather_cache").all().forEach(function (r) {
    try {
      var p = JSON.parse(r.payload);
      p.fetched_at = r.fetched_at;
      weather[r.place] = p;
    } catch (e) { /* skip bad cache row */ }
  });

  /* Who's where (Phase 1): fed calendar events + notes, over settled defaults.
     Emily is always "Emily — Alberta", subtext "nothing flagged for today"
     unless a fed item notes otherwise. Never "with Ethan" / "lives with her mom". */
  var eventsToday = listFeed("calendar-event").filter(function (it) { return it.subject === today; });
  var notesToday = listFeed("school-note").filter(function (it) { return it.subject === today; });
  var pickupToday = listFeed("pickup-note").filter(function (it) { return it.subject === today; });
  function eventsFor(person) {
    return eventsToday.filter(function (ev) {
      var p = ev.payload || {};
      return (p.people || []).indexOf(person) !== -1;
    });
  }
  var leslieWfh = listFeed("flag").some(function (f) {
    return f.payload && f.payload.leslie_wfh === true && f.subject === today;
  });
  var whosWhere = [
    { id: "trevor", label: "Trevor", detail: "Holyrood — HFD", events: eventsFor("trevor") },
    { id: "leslie", label: "Leslie",
      detail: leslieWfh ? "Home (CBS) — working from home" : "Mount Pearl — K&D Pratt office, Glencoe Drive",
      events: eventsFor("leslie") },
    { id: "robbie", label: "Robbie Dean", detail: "School + Stay & Play", events: eventsFor("robbie"), notes: notesToday.filter(function (n) { return (n.payload || {}).boy === "robbie" || !(n.payload || {}).boy; }) },
    { id: "keagan", label: "Keagan", detail: "School + Stay & Play", events: eventsFor("keagan"), notes: notesToday.filter(function (n) { return (n.payload || {}).boy === "keagan" || !(n.payload || {}).boy; }) },
    { id: "emily", label: "Emily — Alberta", detail: "nothing flagged for today", events: eventsFor("emily") }
  ];

  /* Tasks: home items above work items. Checkbox state is "reported done"
     (board) — verified status only changes via a fed item. */
  var taskStates = {};
  db.prepare("SELECT item_id, reported_done FROM task_states").all().forEach(function (r) {
    taskStates[r.item_id] = !!r.reported_done;
  });
  var tasks = listFeed("task").map(function (t) {
    t.reported_done = !!taskStates[t.id];
    return t;
  });
  tasks.sort(function (a, b) {
    var la = (a.payload && a.payload.list) || "work";
    var lb = (b.payload && b.payload.list) || "work";
    if (la === "home" && lb !== "home") return -1;
    if (la !== "home" && lb === "home") return 1;
    return 0;
  });

  /* Flags: fed flags + system flags (cross-source conflicts). */
  var flags = listFeed("flag");
  listFeed().forEach(function (it) {
    if (it.conflict) {
      flags.push({
        id: "sys-conflict-" + it.id, source: "system", type: "flag", subject: it.subject,
        title: "Conflicting fed items: " + (it.title || it.type),
        payload: { severity: "high", detail: "Skipper and Amanda fed different values for the same item. Last write did not win — check with the household.", about_id: it.id },
        provisional: false, conflict: true, created_at: it.created_at, updated_at: it.updated_at
      });
    }
  });

  var allItems = listFeed();
  var lastUpdated = null;
  allItems.forEach(function (it) {
    if (!lastUpdated || it.updated_at > lastUpdated) lastUpdated = it.updated_at;
  });

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: nowIso(),
    timezone: TIMEZONE,
    mode: isWeekendMode() ? "weekend" : "weekday",
    viewer_default: DEFAULT_VIEWER,
    viewer_themes: VIEWER_THEME,
    freshness: {
      last_updated: lastUpdated,
      last_feed_skipper: lastFeedAt("skipper"),
      last_feed_amanda: lastFeedAt("amanda"),
      weather_fetched_at: (function () {
        var t = null;
        Object.keys(weather).forEach(function (k) {
          if (!t || weather[k].fetched_at > t) t = weather[k].fetched_at;
        });
        return t;
      })()
    },
    weather: weather,
    whos_where: whosWhere,
    schedule: {
      today: today,
      events: eventsToday,
      annotations: listFeed("calendar-annotation")
    },
    boys_day: {
      date: today,
      lunch: lunchToday,
      school_notes: notesToday,
      pickup_notes: pickupToday,
      next_week_pack: nextWeekPackCount()
    },
    tasks: tasks,
    shopping: listFeed("shopping"),
    lookout: {
      status: "winterized",
      reopen_date: LOOKOUT_REOPEN_DATE,
      note: "Lookout winterized — see seasonal opening checklist when the time comes.",
      overwinter: [
        "Batteries on trickle charge (main positive feed is a BLACK wire — mark with red tape)",
        "Monthly family check-ins on trailer covers / property"
      ]
    },
    flags: flags,
    notices: {
      skipper: lastFeedAt("skipper"),
      amanda: lastFeedAt("amanda")
    }
  };
}

/* ----------------------------------------------------------------- routes */

function serveStatic(req, res, pathname) {
  var rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (rel.indexOf("..") !== -1 || rel.indexOf("\0") !== -1) {
    sendJson(res, 400, { error: "bad path" });
    return;
  }
  var file = path.join(PUBLIC_DIR, rel);
  if (file.indexOf(PUBLIC_DIR) !== 0) { sendJson(res, 400, { error: "bad path" }); return; }
  fs.readFile(file, function (err, data) {
    if (err) { sendJson(res, 404, { error: "not found" }); return; }
    var ext = path.extname(file);
    var type = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Content-Length": data.length });
    res.end(data);
  });
}

function handleFeed(req, res, actor) {
  readBody(req).then(function (raw) {
    var body;
    try { body = JSON.parse(raw); } catch (e) { sendJson(res, 400, { error: "invalid JSON" }); return; }
    if (!body || typeof body !== "object") { sendJson(res, 400, { error: "invalid body" }); return; }
    if (!body.id || typeof body.id !== "string") { sendJson(res, 400, { error: "id (idempotency key) is required" }); return; }
    if (body.source && body.source !== actor) { sendJson(res, 403, { error: "source does not match bearer token" }); return; }
    if (FEED_TYPES.indexOf(body.type) === -1) { sendJson(res, 400, { error: "unknown type", allowed: FEED_TYPES }); return; }
    if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null)) {
      sendJson(res, 400, { error: "payload must be an object" }); return;
    }
    var now = nowIso();
    var existing = db.prepare("SELECT id FROM feed_items WHERE id=?").get(body.id);
    var provisional = (body.type === "calendar-event" || body.type === "calendar-annotation") ? 1 : 0;
    upsertFeed.run(
      body.id, actor, body.type, body.subject || null, body.title || null,
      JSON.stringify(body.payload || {}), provisional,
      body.retract ? 1 : 0, existing ? existing.created_at || now : now, now
    );
    refreshConflicts(body.type, body.subject || null);
    log("feed " + (body.retract ? "retract" : (existing ? "update" : "create")) + " " + body.type + " " + body.id + " (" + actor + ")");
    sendJson(res, 200, { ok: true, id: body.id, action: body.retract ? "retracted" : (existing ? "updated" : "created") });
  }).catch(function (e) { sendJson(res, 400, { error: String(e.message || e) }); });
}

function handleQuickAdd(req, res) {
  readBody(req).then(function (raw) {
    var body;
    try { body = JSON.parse(raw); } catch (e) { sendJson(res, 400, { error: "invalid JSON" }); return; }
    if (!body || (body.kind !== "task" && body.kind !== "shopping") || !body.label || typeof body.label !== "string") {
      sendJson(res, 400, { error: "kind (task|shopping) and label are required" }); return;
    }
    var now = nowIso();
    var id = "board-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
    var type = body.kind;
    var payload = { label: body.label, status: "proposed" };
    if (type === "task") { payload.list = body.list || "home"; payload.title = body.label; }
    if (type === "shopping") { payload.group = body.group || "Quick adds"; payload.quantity = body.quantity || ""; }
    upsertFeed.run(id, "board", type, body.subject || null, body.label,
      JSON.stringify(payload), 0, 0, now, now);
    log("quickadd " + type + " " + id + " (board proposal)");
    sendJson(res, 200, { ok: true, id: id });
  }).catch(function (e) { sendJson(res, 400, { error: String(e.message || e) }); });
}

function handleTaskState(req, res) {
  readBody(req).then(function (raw) {
    var body;
    try { body = JSON.parse(raw); } catch (e) { sendJson(res, 400, { error: "invalid JSON" }); return; }
    if (!body || !body.id || typeof body.reported_done !== "boolean") {
      sendJson(res, 400, { error: "id and reported_done (boolean) are required" }); return;
    }
    var item = db.prepare("SELECT id FROM feed_items WHERE id=? AND type='task'").get(body.id);
    if (!item) { sendJson(res, 404, { error: "unknown task id" }); return; }
    db.prepare("INSERT INTO task_states (item_id, reported_done, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(item_id) DO UPDATE SET reported_done=excluded.reported_done, updated_at=excluded.updated_at")
      .run(body.id, body.reported_done ? 1 : 0, nowIso());
    /* "Reported done" is a board claim, not verification. Verified status only
       changes when an assistant feeds a task update. */
    sendJson(res, 200, { ok: true, id: body.id, reported_done: body.reported_done });
  }).catch(function (e) { sendJson(res, 400, { error: String(e.message || e) }); });
}

function handler(req, res) {
  var parsed = new URL(req.url, "http://localhost");
  var pathname = parsed.pathname || "/";
  if (req.method === "GET" && pathname === "/api/state") { sendJson(res, 200, buildState()); return; }
  if (req.method === "GET" && pathname === "/health") { sendJson(res, 200, { ok: true, version: "0.1.0", phase: 1 }); return; }
  if (req.method === "POST" && pathname === "/api/feed") {
    if (!FEED_TOKENS.skipper && !FEED_TOKENS.amanda) {
      sendJson(res, 503, { error: "feed not configured: no assistant tokens set" }); return;
    }
    var actor = authenticateFeed(req);
    if (!actor) { sendJson(res, 401, { error: "missing or invalid bearer token" }); return; }
    handleFeed(req, res, actor);
    return;
  }
  if (req.method === "POST" && pathname === "/api/quickadd") { handleQuickAdd(req, res); return; }
  if (req.method === "POST" && pathname === "/api/task-state") { handleTaskState(req, res); return; }
  if (req.method === "GET") { serveStatic(req, res, pathname); return; }
  sendJson(res, 405, { error: "method not allowed" });
}

var server = http.createServer(handler);
server.listen(PORT, "0.0.0.0", function () {
  log("Perch at a Glance server listening on 0.0.0.0:" + PORT +
    " (data dir " + DATA_DIR + ", timezone " + TIMEZONE +
    ", default viewer " + DEFAULT_VIEWER + " -> " + VIEWER_THEME[DEFAULT_VIEWER] + ")");
  log("HA token " + (HA_TOKEN ? "configured (Phase 2)" : "not set (expected in Phase 1)") +
    "; feed tokens: skipper " + (FEED_TOKENS.skipper ? "set" : "MISSING") +
    ", amanda " + (FEED_TOKENS.amanda ? "set" : "MISSING"));
  pollWeather();
  setInterval(pollWeather, WEATHER_POLL_MS);
});

process.on("SIGTERM", function () {
  log("SIGTERM received, closing");
  server.close(function () { db.close(); process.exit(0); });
});
