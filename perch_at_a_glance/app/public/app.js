"use strict";
/* The Perch at a Glance — front-end (Phase 1).
 * Plain ES5-style JS (var, function declarations, XMLHttpRequest) so it runs
 * on the iPad Air 2 (iOS 15.8.2) wall tablet. No framework, no CDN.
 *
 * Two full-screen panels, one active at a time: Perch + Smart Home (Phase 2
 * stub). Switch via the prominent bottom switcher bar or a horizontal swipe.
 * Viewer toggle (Trevor / Leslie) lives in the header chrome; the theme
 * follows the viewer from the server-provided mapping (viewer_themes) and is
 * configurable per viewer — Trevor -> dark (leading: northdatum-dark),
 * Leslie -> blush (light). A per-viewer theme picker offers the other
 * candidates; the choice is remembered on that tablet (localStorage).
 * Polls GET /api/state every 30s (60s on wall tablets: ?wall=1).
 */

var TIMEZONE = "America/St_Johns";
var THEME_CANDIDATES = {
  trevor: ["northdatum-dark", "pine", "dusk", "midnight"],
  leslie: ["blush", "daylight"]
};
var THEME_LABELS = {
  "northdatum-dark": "Northdatum dark",
  "pine": "Pine",
  "dusk": "Dusk",
  "midnight": "Midnight",
  "blush": "Blush",
  "daylight": "Daylight"
};
var WEATHER_LABELS = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 95: "Thunderstorm"
};

var state = null;
var weekOffset = 0;
var viewer = "trevor";
var panel = "perch";
var viewerThemes = { trevor: "northdatum-dark", leslie: "blush" };

function store(key, value) {
  try { if (window.localStorage) window.localStorage.setItem(key, value); } catch (e) {}
}
function readStore(key) {
  try { if (window.localStorage) return window.localStorage.getItem(key); } catch (e) {}
  return null;
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function $(id) { return document.getElementById(id); }

function isWall() {
  return /[?&]wall=1/.test(window.location.search) || readStore("perch.wall") === "1";
}
function pollMs() { return isWall() ? 60000 : 30000; }

function themeForViewer(v) {
  var override = readStore("perch.theme." + v);
  if (override && THEME_CANDIDATES[v].indexOf(override) !== -1) return override;
  return viewerThemes[v] || (v === "leslie" ? "blush" : "northdatum-dark");
}

function applyViewer() {
  document.body.setAttribute("data-theme", themeForViewer(viewer));
  $("viewerTrevor").className = viewer === "trevor" ? "active" : "";
  $("viewerLeslie").className = viewer === "leslie" ? "active" : "";
  var sel = $("themeSelect");
  var cands = THEME_CANDIDATES[viewer];
  var html = "";
  for (var i = 0; i < cands.length; i++) {
    html += '<option value="' + cands[i] + '"' + (themeForViewer(viewer) === cands[i] ? " selected" : "") + ">" +
      esc(THEME_LABELS[cands[i]] || cands[i]) + "</option>";
  }
  sel.innerHTML = html;
  /* Leslie's "Barbie Dream House" — playful subtitle under the board title,
     her view only, on both panels. Never on Trevor's view. */
  var subText = viewer === "leslie" ? "Bonnie's Barbie Dream House" : "";
  ["viewerSub", "viewerSubHome"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.textContent = subText;
    el.hidden = viewer !== "leslie";
  });
  store("perch.viewer", viewer);
}

function setViewer(v) {
  viewer = v;
  applyViewer();
  renderAll();
}

function showPanel(name) {
  panel = name;
  document.body.setAttribute("data-panel", name);
  $("panel-perch").hidden = name !== "perch";
  $("panel-home").hidden = name !== "home";
  $("switchPerch").className = name === "perch" ? "active" : "";
  $("switchHome").className = name === "home" ? "active" : "";
  store("perch.panel", name);
  window.scrollTo(0, 0);
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
function fmtDayShort(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso + "T12:00:00"));
}
function stJohnsToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");
}
function addDays(iso, n) {
  var d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function wxLabel(code) { return WEATHER_LABELS[code] || "—"; }

function renderClock() {
  var now = new Date();
  $("clockLine").textContent = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" }).format(now);
  var hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "numeric", hour12: false }).format(now), 10);
  var greet = hour < 12 ? "Good morning" : (hour < 18 ? "Good afternoon" : "Good evening");
  $("dateLine").textContent = greet + " · " + new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now);
}

function renderWeather() {
  var order = viewer === "leslie"
    ? ["cbs", "mount_pearl", "holyrood", "lethbridge"]
    : ["cbs", "holyrood", "mount_pearl", "lethbridge"];
  var html = "";
  for (var i = 0; i < order.length; i++) {
    var w = state.weather[order[i]];
    if (!w || !w.data || !w.data.current) {
      html += '<div class="wx"><b>' + esc(order[i]) + '</b><div class="temp">—</div><small>No data yet</small></div>';
      continue;
    }
    var cur = w.data.current;
    var daily = w.data.daily || {};
    var hi = daily.temperature_2m_max ? daily.temperature_2m_max[0] : "—";
    var lo = daily.temperature_2m_min ? daily.temperature_2m_min[0] : "—";
    html += '<div class="wx"><b>' + esc(w.label) + '</b><div class="temp">' + Math.round(cur.temperature_2m) + '°C</div>' +
      "<small>" + esc(wxLabel(cur.weather_code)) + " · H " + hi + "° / L " + lo + "°" +
      (cur.wind_speed_10m != null ? " · wind " + Math.round(cur.wind_speed_10m) + " km/h" : "") + "</small></div>";
  }
  $("weatherGrid").innerHTML = html;
  $("weatherNote").textContent = state.freshness.weather_fetched_at
    ? "Weather updated " + fmtTime(state.freshness.weather_fetched_at) + " · Open-Meteo"
    : "Weather not fetched yet — showing placeholders until the first Open-Meteo poll.";
}

function renderWhosWhere() {
  var html = "";
  for (var i = 0; i < state.whos_where.length; i++) {
    var p = state.whos_where[i];
    html += '<div class="row"><div class="t"><strong>' + esc(p.label) + '</strong> — ' + esc(p.detail);
    if (p.events && p.events.length) {
      html += "<small>" + p.events.map(function (ev) {
        return esc((ev.payload && ev.payload.time ? ev.payload.time + " · " : "") + (ev.title || ""));
      }).join("<br>") + "</small>";
    }
    if (p.notes && p.notes.length) {
      html += "<small>" + p.notes.map(function (n) {
        return esc((n.payload && (n.payload.note || n.payload.text)) || n.title || "");
      }).join("<br>") + "</small>";
    }
    html += "</div></div>";
  }
  $("whosWhere").innerHTML = html;
}

function renderWeek() {
  var today = state.schedule.today;
  var start = new Date(today + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() + weekOffset * 7);
  var html = "";
  for (var i = 0; i < 7; i++) {
    var d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    var iso = d.toISOString().slice(0, 10);
    var isToday = iso === today;
    html += '<div class="day' + (isToday ? " today" : "") + '"><b>' + esc(fmtDayShort(iso)) + (isToday ? " (today)" : "") + "</b>";
    var any = false;
    for (var j = 0; j < state.schedule.events.length; j++) {
      var ev = state.schedule.events[j];
      if (ev.subject !== iso) continue;
      any = true;
      var p = ev.payload || {};
      html += '<div class="ev">' + esc(ev.title || "") +
        "<small>" + esc(p.time || "") + (ev.provisional ? ' <span class="chip provisional">Provisional</span>' : "") + "</small></div>";
    }
    if (!any) html += '<span style="color:var(--muted);font-size:13px">Nothing fed</span>';
    html += "</div>";
  }
  $("calGrid").innerHTML = html;
}

function renderBoysDay() {
  var bd = state.boys_day;
  var lunch = bd.lunch;
  $("lunchHead").textContent = lunch.header;
  var sub = [];
  if (lunch.robbie === "hot" || lunch.keagan === "hot") {
    lunch.items.forEach(function (it) {
      var p = it.payload || {};
      if (p.robbie && p.robbie.meal === "hot") sub.push("Robbie Dean: hot lunch" + (p.robbie.menu ? " — " + p.robbie.menu : ""));
      if (p.keagan && p.keagan.meal === "hot") sub.push("Keagan: hot lunch" + (p.keagan.menu ? " — " + p.keagan.menu : ""));
    });
  }
  if (!sub.length) sub.push("Both boys packing a regular lunch.");
  $("lunchSub").textContent = sub.join(" · ");

  var boys = [
    { id: "robbie", label: "Robbie Dean" },
    { id: "keagan", label: "Keagan" }
  ];
  var html = "";
  for (var b = 0; b < boys.length; b++) {
    var boy = boys[b];
    var meal = lunch[boy.id];
    html += '<div class="boy"><b>' + boy.label + " — " + (meal === "hot" ? "Hot Lunch" : "Pack Lunch") + "</b>";
    var bring = ["Water bottle"];
    if (meal === "hot") bring.push("Lunch kit / snacks");
    var notes = [];
    bd.school_notes.forEach(function (n) {
      var p = n.payload || {};
      if (p.boy && p.boy !== boy.id) return;
      if (p.note) notes.push(p.note);
      if (p.bring) bring = bring.concat(p.bring);
    });
    html += "<ul>" + bring.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    if (notes.length) html += "<small>" + notes.map(esc).join("<br>") + "</small>";
    html += "</div>";
  }
  $("boysGrid").innerHTML = html;

  var nw = bd.next_week_pack;
  var hotNoted = false;
  $("packFlag").innerHTML = "Next week (" + esc(nw.week_of) + "): <strong>" + nw.pack_days + " pack days / " + nw.lunches + " lunches</strong> — check lunchmates / noodles / staples on the weekend shop." +
    (hotNoted ? "" : "<br><span style='color:var(--muted)'>No hot lunch orders noted for next week yet.</span>");
}

function renderTasks() {
  var html = "";
  for (var i = 0; i < state.tasks.length; i++) {
    var t = state.tasks[i];
    var p = t.payload || {};
    var status = p.status || "proposed";
    html += '<div class="row' + (t.reported_done ? " done" : "") + '">' +
      '<input type="checkbox" data-task="' + esc(t.id) + '"' + (t.reported_done ? " checked" : "") + ' aria-label="' + esc(t.title || "") + '">' +
      '<div class="t">' + esc(t.title || "") + ' <span class="chip">' + esc(status) + "</span>" +
      "<small>" + esc((p.list || "work") + (p.owner ? " · " + p.owner : "") + (p.due ? " · due " + p.due : "")) +
      (t.provisional ? ' · <span class="chip provisional">Provisional</span>' : "") + "</small></div></div>";
  }
  $("taskList").innerHTML = html || '<p style="color:var(--muted)">No tasks fed yet.</p>';
  var boxes = $("taskList").querySelectorAll("[data-task]");
  for (var k = 0; k < boxes.length; k++) boxes[k].addEventListener("change", function (e) {
    postJson("api/task-state", { id: e.target.getAttribute("data-task"), reported_done: e.target.checked }, function () { fetchState(); });
  });
}

function renderShopping() {
  var groups = {};
  for (var i = 0; i < state.shopping.length; i++) {
    var it = state.shopping[i];
    var p = it.payload || {};
    var g = p.group || "Quick adds";
    if (!groups[g]) groups[g] = [];
    groups[g].push(it);
  }
  var html = "";
  var names = Object.keys(groups);
  for (var gi = 0; gi < names.length; gi++) {
    html += "<h3>" + esc(names[gi]) + "</h3>";
    for (var j = 0; j < groups[names[gi]].length; j++) {
      var s = groups[names[gi]][j];
      var sp = s.payload || {};
      html += '<div class="row"><div class="t">' + esc(sp.label || s.title || "") +
        (sp.quantity ? " " + esc(sp.quantity) : "") +
        "<small>Status: " + esc(sp.status || "needed") + "</small></div></div>";
    }
  }
  $("shopList").innerHTML = html || '<p style="color:var(--muted)">Nothing on the list — add below or ask Skipper / Amanda.</p>';
}

function renderLookout() {
  var lk = state.lookout;
  var today = new Date(state.schedule.today + "T12:00:00Z");
  var reopen = new Date(lk.reopen_date + "T12:00:00Z");
  var days = Math.round((reopen - today) / 86400000);
  var html = "<p><strong>" + esc(lk.status === "winterized" ? "Winterized" : lk.status) + "</strong> — " + esc(lk.note) + "</p>" +
    "<p>Countdown to reopening (" + esc(lk.reopen_date) + " benchmark): <strong>" + days + " days</strong></p>" +
    "<ul>" + lk.overwinter.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
  $("lookoutBody").innerHTML = html;
  var w = state.weather.lethbridge;
  var fc = "";
  if (w && w.data && w.data.daily) {
    var d = w.data.daily;
    for (var i = 0; i < 7 && i < d.time.length; i++) {
      fc += '<div class="fc"><b>' + esc(d.time[i].slice(5)) + "</b>" +
        Math.round(d.temperature_2m_max[i]) + "° / " + Math.round(d.temperature_2m_min[i]) + "°<br>" +
        "<small>" + esc(wxLabel(d.weather_code[i])) + "</small></div>";
    }
  }
  $("lookoutForecast").innerHTML = fc;
}

function renderFlags() {
  var html = "";
  for (var i = 0; i < state.flags.length; i++) {
    var f = state.flags[i];
    var p = f.payload || {};
    var sev = p.severity || "medium";
    html += '<div class="flag ' + esc(sev) + '"><strong>' + esc(f.title || f.type) + "</strong>" +
      "<p>" + esc(p.detail || p.headline || "") + "</p>" +
      "<small>From: " + esc(f.source) + (p.next_action ? " · Next: " + esc(p.next_action) : "") + "</small></div>";
  }
  $("flagList").innerHTML = html || '<p style="color:var(--muted)">No open flags.</p>';
}

function renderFooter() {
  $("modePill").textContent = state.mode === "weekend" ? "Weekend" : "Weekday";
  $("lastUpdated").textContent = "Last updated: " + (state.freshness.last_updated ? fmtTime(state.freshness.last_updated) : "—") +
    " · generated " + fmtTime(state.generated_at);
  $("feedFreshness").textContent =
    "Skipper feed: " + (state.freshness.last_feed_skipper ? fmtTime(state.freshness.last_feed_skipper) : "—") +
    " · Amanda feed: " + (state.freshness.last_feed_amanda ? fmtTime(state.freshness.last_feed_amanda) : "—");
}

function renderAll() {
  if (!state) return;
  if (state.viewer_themes) viewerThemes = state.viewer_themes;
  renderClock();
  renderWeather();
  renderWhosWhere();
  renderWeek();
  renderBoysDay();
  renderTasks();
  renderShopping();
  renderLookout();
  renderFlags();
  renderFooter();
  applyViewer();
  /* Design v2: Perch-card summaries were empty at init (state arrives
     async); refresh them now that state is rendered. */
  if (typeof refreshPerchSummaries === "function") refreshPerchSummaries();
}

function getJson(path, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", path, true);
  xhr.timeout = 10000;
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) {
      try { cb(null, JSON.parse(xhr.responseText)); } catch (e) { cb(e); }
    } else cb(new Error("HTTP " + xhr.status));
  };
  xhr.onerror = function () { cb(new Error("network error")); };
  xhr.send();
}

function postJson(path, body, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open("POST", path, true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.timeout = 10000;
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (cb) cb(xhr.status >= 200 && xhr.status < 300 ? null : new Error("HTTP " + xhr.status));
  };
  xhr.onerror = function () { if (cb) cb(new Error("network error")); };
  xhr.send(JSON.stringify(body));
}

function fetchState() {
  getJson("api/state", function (err, data) {
    if (err) {
      $("lastUpdated").textContent = "Couldn\u2019t refresh — showing last good data.";
      return;
    }
    state = data;
    renderAll();
  });
}

function init() {
  var savedViewer = readStore("perch.viewer");
  if (savedViewer === "trevor" || savedViewer === "leslie") viewer = savedViewer;
  var savedPanel = readStore("perch.panel");
  if (savedPanel === "home" || savedPanel === "perch") panel = savedPanel;
  var savedDensity = readStore("perch.density");
  if (savedDensity === "large") document.body.classList.add("text-large");

  $("viewerTrevor").addEventListener("click", function () { setViewer("trevor"); });
  $("viewerLeslie").addEventListener("click", function () { setViewer("leslie"); });
  $("themeSelect").addEventListener("change", function (e) {
    store("perch.theme." + viewer, e.target.value);
    applyViewer();
  });
  $("densityNormal").addEventListener("click", function () {
    document.body.classList.remove("text-large");
    $("densityNormal").className = "active"; $("densityLarge").className = "";
    store("perch.density", "normal");
  });
  $("densityLarge").addEventListener("click", function () {
    document.body.classList.add("text-large");
    $("densityLarge").className = "active"; $("densityNormal").className = "";
    store("perch.density", "large");
  });
  if (savedDensity === "large") { $("densityLarge").className = "active"; } else { $("densityNormal").className = "active"; }

  $("switchPerch").addEventListener("click", function () { showPanel("perch"); });
  $("switchHome").addEventListener("click", function () { showPanel("home"); });

  /* Swipe between panels: horizontal swipe > 60px. */
  var startX = null, startY = null, startTarget = null;
  document.addEventListener("touchstart", function (e) {
    var t = e.changedTouches[0];
    startX = t.clientX; startY = t.clientY; startTarget = e.target;
  }, false);
  document.addEventListener("touchend", function (e) {
    if (startX === null) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - startX, dy = t.clientY - startY;
    startX = null; startY = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (startTarget && /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(startTarget.tagName)) return;
    if (dx < 0 && panel === "perch") showPanel("home");
    if (dx > 0 && panel === "home") showPanel("perch");
  }, false);

  $("prevWeek").addEventListener("click", function () { weekOffset--; renderWeek(); });
  $("nextWeek").addEventListener("click", function () { weekOffset++; renderWeek(); });
  $("todayBtn").addEventListener("click", function () { weekOffset = 0; renderWeek(); });

  $("quickTaskBtn").addEventListener("click", function () {
    var input = $("quickTaskTitle");
    var title = input.value.replace(/^\s+|\s+$/g, "");
    if (!title) { input.focus(); return; }
    postJson("api/quickadd", { kind: "task", label: title, list: $("quickTaskList").value }, function () { input.value = ""; fetchState(); });
  });
  $("quickTaskTitle").addEventListener("keydown", function (e) { if (e.key === "Enter") $("quickTaskBtn").click(); });
  $("quickShopBtn").addEventListener("click", function () {
    var input = $("quickShopLabel");
    var label = input.value.replace(/^\s+|\s+$/g, "");
    if (!label) { input.focus(); return; }
    postJson("api/quickadd", { kind: "shopping", label: label, group: $("quickShopGroup").value }, function () { input.value = ""; fetchState(); });
  });
  $("quickShopLabel").addEventListener("keydown", function (e) { if (e.key === "Enter") $("quickShopBtn").click(); });

  applyViewer();
  showPanel(panel);
  renderClock();
  fetchState();
  setInterval(fetchState, pollMs());
  setInterval(renderClock, 30000);
  /* Design v2: rooms + drawer nav + expandable Perch cards (rooms.js). */
  if (typeof initRooms === "function") initRooms();
  if (typeof initV2 === "function") initV2();
}

if (typeof document !== "undefined" && document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else if (typeof document !== "undefined") init();
