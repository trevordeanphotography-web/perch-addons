/* ---- Perch at a Glance — Smart Home rooms + exterior, drawer nav,
 * expandable Perch cards (ported from design mockup v2, 2026-11-11).
 * Photos are Trevor's own house, as files in photos/ (family.jpg =
 * Perch background, interior.jpg = front of house at dusk, exterior.jpg
 * = backyard at night), referenced by relative URL — never embedded.
 * Device / yard states are ILLUSTRATIVE and toggles are visual-only:
 * they flip locally in this file and never touch Home Assistant.
 * ES5-style, like the rest of the front-end (iPad Air 2 / iOS 15). */
var PHOTOS = {
  perchBg: "photos/family.jpg",
  interior: "photos/interior.jpg",
  exterior: "photos/exterior.jpg"
};
var INTERIOR_PHOTO = PHOTOS.interior; /* one copy of the data URI, not two */
var ROOM_PHOTOS = {
  mainfloor: INTERIOR_PHOTO,
  secondfloor: INTERIOR_PHOTO,
  den: INTERIOR_PHOTO
};
var ROOMS = {
  mainfloor: { title: "Main Floor", devices: [
    { id: "mf-pots", name: "Kitchen pot lights", detail: "4 lights", on: true },
    { id: "mf-white", name: "White Lamp", detail: "Globe A19", on: true },
    { id: "mf-black", name: "Black Lamp", detail: "Merkury", on: false },
    { id: "mf-reading", name: "Reading Lamp", detail: "Living room", on: true },
    { id: "mf-mudroom", name: "Mudroom", detail: "Entry", on: false }
  ] },
  secondfloor: { title: "Second Floor", devices: [
    { id: "sf-makeup", name: "Makeup Room lamp", detail: "Smart plug", on: false },
    { id: "sf-scentsy", name: "Bathroom Scentsy", detail: "Warmer", on: true }
  ] },
  den: { title: "Den", devices: [
    { id: "den-1", name: "Den Light 1", detail: "", on: true },
    { id: "den-2", name: "Den Light 2", detail: "", on: false }
  ] }
};
/* Battery readings are real but dated: Nov 10 evening, from the HA
 * inventory (fresh iCloud re-add). Live values come with Phase 2. */
var DEVICES_STRIP = [
  { name: "Trevor's iPhone", battery: 50, note: "Not charging" },
  { name: "Leslie's iPhone", battery: 34, note: "Not charging" },
  { name: "Master bedroom iPad", battery: 52, note: "Not charging" }
];
/* Yard states are illustrative summaries only (visual-only). */
var EXTERIOR_CARDS = [
  { id: "ext-lights", name: "String lights", detail: "On at dusk · timer (illustrative)", on: true, state: "On", open: false },
  { id: "ext-driveway", name: "Driveway", detail: "Clear · gate closed (illustrative)", on: false, state: "Clear", open: false },
  { id: "ext-cameras", name: "Cameras", detail: "Driveway · Front Bridge · Backyard — all online (illustrative)", on: true, state: "3 online", open: false }
];
var currentRoom = "mainfloor";
var currentSection = "interior";
var drawerOpen = false;

function roomStats(room) {
  var on = 0;
  for (var i = 0; i < room.devices.length; i++) if (room.devices[i].on) on++;
  return room.devices.length + " lights · " + on + " on";
}

function renderRoomDevices() {
  var room = ROOMS[currentRoom];
  var html = "";
  for (var i = 0; i < room.devices.length; i++) {
    var d = room.devices[i];
    html += '<button type="button" class="room-device' + (d.on ? " on" : "") + '" data-device="' + esc(d.id) + '">' +
      '<span class="dev-dot"></span><span class="dev-name"><b>' + esc(d.name) + "</b>" +
      (d.detail ? "<small>" + esc(d.detail) + "</small>" : "") + "</span>" +
      '<span class="dev-state">' + (d.on ? "On" : "Off") + "</span></button>";
  }
  $("roomDevices").innerHTML = html;
  var tiles = $("roomDevices").querySelectorAll("[data-device]");
  for (var k = 0; k < tiles.length; k++) tiles[k].addEventListener("click", function (e) {
    var el = e.currentTarget || e.target;
    toggleDevice(el.getAttribute("data-device"));
  });
}

function toggleDevice(id) {
  for (var key in ROOMS) {
    var devs = ROOMS[key].devices;
    for (var i = 0; i < devs.length; i++) {
      if (devs[i].id === id) { devs[i].on = !devs[i].on; renderRoomDevices(); renderRoomStats(); return; }
    }
  }
}

function updateRoomExpandBtn() {
  var btn = $("roomExpandBtn");
  if (!btn) return;
  var collapsed = $("roomDevices").className.indexOf("collapsed") !== -1;
  btn.textContent = collapsed ? ("Show lights · " + roomStats(ROOMS[currentRoom])) : "Hide lights";
}

function renderRoomStats() {
  $("roomHeroStats").innerHTML = "<span>" + esc(roomStats(ROOMS[currentRoom])) + "</span><span>Tap a tile to flip it (visual only)</span>";
  updateRoomExpandBtn();
}

function toggleRoomDevices() {
  var d = $("roomDevices");
  var collapsed = d.className.indexOf("collapsed") !== -1;
  d.className = collapsed ? "room-devices" : "room-devices collapsed";
  updateRoomExpandBtn();
}

function setRailActive(key) {
  var btns = { mainfloor: "roomBtnMain", secondfloor: "roomBtnSecond", den: "roomBtnDen", exterior: "roomBtnExterior" };
  for (var k in btns) {
    var b = $(btns[k]);
    if (b) b.className = "room-btn" + (k === key ? " active" : "");
  }
}

function syncTopNav() {
  var map = {
    navTopPerch: panel === "perch",
    navTopHome: panel === "home",
    navTopMain: panel === "home" && currentSection === "interior" && currentRoom === "mainfloor",
    navTopSecond: panel === "home" && currentSection === "interior" && currentRoom === "secondfloor",
    navTopDen: panel === "home" && currentSection === "interior" && currentRoom === "den",
    navTopExt: panel === "home" && currentSection === "exterior"
  };
  for (var id in map) {
    var b = $(id);
    if (b) b.className = map[id] ? "active" : "";
  }
}

function showRoom(name) {
  if (!ROOMS[name]) return;
  currentRoom = name;
  currentSection = "interior";
  var room = ROOMS[name];
  $("roomHero").hidden = false;
  $("exteriorHero").hidden = true;
  $("roomHeroPhoto").style.backgroundImage = "url(" + ROOM_PHOTOS[name] + ")";
  $("roomHeroTitle").textContent = room.title;
  renderRoomStats();
  renderRoomDevices();
  setRailActive(name);
  syncTopNav();
}

function renderExteriorCards() {
  var html = "";
  for (var i = 0; i < EXTERIOR_CARDS.length; i++) {
    var c = EXTERIOR_CARDS[i];
    html += '<button type="button" class="room-device ext-card' + (c.on ? " on" : "") + (c.open ? " open" : "") + '" data-ext="' + esc(c.id) + '">' +
      '<span class="dev-dot"></span><span class="dev-name"><b>' + esc(c.name) + "</b>" +
      '<small class="ext-detail">' + esc(c.detail) + "</small></span>" +
      '<span class="dev-state">' + esc(c.state) + "</span></button>";
  }
  $("exteriorCards").innerHTML = html;
  var tiles = $("exteriorCards").querySelectorAll("[data-ext]");
  for (var k = 0; k < tiles.length; k++) tiles[k].addEventListener("click", function (e) {
    var el = e.currentTarget || e.target;
    toggleExtCard(el.getAttribute("data-ext"));
  });
}

function toggleExtCard(id) {
  for (var i = 0; i < EXTERIOR_CARDS.length; i++) {
    if (EXTERIOR_CARDS[i].id === id) { EXTERIOR_CARDS[i].open = !EXTERIOR_CARDS[i].open; renderExteriorCards(); return; }
  }
}

function updateExtExpandBtn() {
  var btn = $("extExpandBtn");
  if (!btn) return;
  var collapsed = $("exteriorCards").className.indexOf("collapsed") !== -1;
  btn.textContent = collapsed ? "Show yard · String lights on" : "Hide yard";
}

function toggleExteriorCards() {
  var d = $("exteriorCards");
  var collapsed = d.className.indexOf("collapsed") !== -1;
  d.className = collapsed ? "room-devices" : "room-devices collapsed";
  updateExtExpandBtn();
}

function showExterior() {
  currentSection = "exterior";
  $("roomHero").hidden = true;
  $("exteriorHero").hidden = false;
  $("exteriorHeroPhoto").style.backgroundImage = "url(" + PHOTOS.exterior + ")";
  $("exteriorHeroTitle").textContent = "Exterior";
  $("exteriorHeroStats").innerHTML = "<span>String lights on · 3 cameras online</span><span>Tap a card for detail (visual only)</span>";
  renderExteriorCards();
  updateExtExpandBtn();
  setRailActive("exterior");
  syncTopNav();
}

function renderDevicesStrip() {
  var html = "";
  for (var i = 0; i < DEVICES_STRIP.length; i++) {
    var d = DEVICES_STRIP[i];
    html += '<div class="device-tile"><b>' + esc(d.name) + '</b><div class="batt">' + d.battery + '%</div>' +
      '<div class="batt-bar"><span class="batt-fill" style="width:' + d.battery + '%"></span></div>' +
      "<small>" + esc(d.note) + " · Nov 10 evening</small></div>";
  }
  $("deviceStrip").innerHTML = html;
}

function initRooms() {
  var map = { roomBtnMain: "mainfloor", roomBtnSecond: "secondfloor", roomBtnDen: "den" };
  for (var id in map) {
    (function (btnId, room) {
      var b = $(btnId);
      if (b) b.addEventListener("click", function () { showRoom(room); });
    })(id, map[id]);
  }
  var extBtn = $("roomBtnExterior");
  if (extBtn) extBtn.addEventListener("click", function () { showExterior(); });
  var rb = $("roomExpandBtn");
  if (rb) rb.addEventListener("click", function () { toggleRoomDevices(); });
  var eb = $("extExpandBtn");
  if (eb) eb.addEventListener("click", function () { toggleExteriorCards(); });
  renderDevicesStrip();
  showRoom(currentRoom);
}

/* ---- Drawer nav: trigger is tapping "The Perch", never a hamburger ---- */
function renderDrawerActive() {
  var map = {
    navDrPerch: panel === "perch",
    navDrHome: panel === "home",
    navDrMain: panel === "home" && currentSection === "interior" && currentRoom === "mainfloor",
    navDrSecond: panel === "home" && currentSection === "interior" && currentRoom === "secondfloor",
    navDrDen: panel === "home" && currentSection === "interior" && currentRoom === "den",
    navDrExt: panel === "home" && currentSection === "exterior",
    navDrTrevor: viewer === "trevor",
    navDrLeslie: viewer === "leslie"
  };
  for (var id in map) {
    var b = $(id);
    if (b) b.className = "drawer-row" + (map[id] ? " active" : "");
  }
}

function openDrawer() {
  $("navDrawer").className = "open";
  $("drawerScrim").hidden = false;
  drawerOpen = true;
  renderDrawerActive();
}

function closeDrawer() {
  $("navDrawer").className = "";
  $("drawerScrim").hidden = true;
  drawerOpen = false;
}

function toggleDrawer() {
  if (drawerOpen) closeDrawer(); else openDrawer();
}

function navigate(target) {
  if (target === "perch") showPanel("perch");
  else if (target === "home") showPanel("home");
  else if (target === "room-mainfloor") { showPanel("home"); showRoom("mainfloor"); }
  else if (target === "room-secondfloor") { showPanel("home"); showRoom("secondfloor"); }
  else if (target === "room-den") { showPanel("home"); showRoom("den"); }
  else if (target === "exterior") { showPanel("home"); showExterior(); }
  closeDrawer();
}

function initDrawer() {
  var brand = $("brandNav");
  if (brand) brand.addEventListener("click", function () { toggleDrawer(); });
  var title = $("perchTitle");
  if (title) title.addEventListener("click", function () { toggleDrawer(); });
  var x = $("drawerClose");
  if (x) x.addEventListener("click", function () { closeDrawer(); });
  var scrim = $("drawerScrim");
  if (scrim) scrim.addEventListener("click", function () { closeDrawer(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && drawerOpen) closeDrawer();
  });
  var navMap = {
    navTopPerch: "perch", navTopHome: "home",
    navTopMain: "room-mainfloor", navTopSecond: "room-secondfloor",
    navTopDen: "room-den", navTopExt: "exterior",
    navDrPerch: "perch", navDrHome: "home",
    navDrMain: "room-mainfloor", navDrSecond: "room-secondfloor",
    navDrDen: "room-den", navDrExt: "exterior"
  };
  for (var id in navMap) {
    (function (btnId, target) {
      var b = $(btnId);
      if (b) b.addEventListener("click", function () { navigate(target); });
    })(id, navMap[id]);
  }
  var vt = $("navDrTrevor");
  if (vt) vt.addEventListener("click", function () { setViewer("trevor"); closeDrawer(); });
  var vl = $("navDrLeslie");
  if (vl) vl.addEventListener("click", function () { setViewer("leslie"); closeDrawer(); });
}

/* ---- Expandable Perch cards: collapsed-first, 1-tap to dig deeper ----
 * Summaries are computed from state at load (mockup: state is baked in,
 * so they are fresh; in the live app they refresh when a card collapses). */
var PERCH_CARDS = ["secWhosWhere", "secSchedule", "secBoysDay", "secTasks", "secShop", "secLookout", "secFlags"];

function perchSummary(id) {
  if (!state) return "";
  if (id === "secWhosWhere") {
    return state.whos_where.map(function (p) { return p.label; }).join(" · ");
  }
  if (id === "secSchedule") {
    var todays = [];
    for (var i = 0; i < state.schedule.events.length; i++) {
      if (state.schedule.events[i].subject === state.schedule.today) todays.push(state.schedule.events[i]);
    }
    return todays.length + " event" + (todays.length === 1 ? "" : "s") + " today" +
      (todays.length ? " · " + todays[0].title : "");
  }
  if (id === "secBoysDay") {
    var nw = state.boys_day.next_week_pack;
    return state.boys_day.lunch.header + " · " + nw.pack_days + " pack days / " + nw.lunches + " lunches next week";
  }
  if (id === "secTasks") {
    var open = [];
    for (var j = 0; j < state.tasks.length; j++) if (!state.tasks[j].reported_done) open.push(state.tasks[j]);
    return open.length + " open" + (open.length ? " · " + open[0].title : " · all done");
  }
  if (id === "secShop") {
    var groups = {};
    for (var k = 0; k < state.shopping.length; k++) groups[(state.shopping[k].payload || {}).group || "Quick adds"] = true;
    return state.shopping.length + " items · " + Object.keys(groups).join(", ");
  }
  if (id === "secLookout") {
    var today = new Date(state.schedule.today + "T12:00:00Z");
    var reopen = new Date(state.lookout.reopen_date + "T12:00:00Z");
    var days = Math.round((reopen - today) / 86400000);
    return "Winterized · " + days + " days to May 1, 2027";
  }
  if (id === "secFlags") {
    return state.flags.length + " noticed" + (state.flags.length ? " · " + state.flags[0].title : "");
  }
  return "";
}

function togglePerchCard(id) {
  var sec = $(id);
  if (!sec) return;
  var open = sec.className.indexOf("x-open") !== -1;
  sec.className = sec.className.replace(/ x-open|x-collapsed/g, "") + (open ? " x-collapsed" : " x-open");
  if (open) {
    var s = $("x-sum-" + id);
    if (s) s.textContent = perchSummary(id);
  }
}

function initExpandableCards() {
  for (var i = 0; i < PERCH_CARDS.length; i++) {
    (function (secId) {
      var sec = $(secId);
      if (!sec) return;
      sec.className += " x-card x-collapsed";
      var h2 = $("x-h2-" + secId);
      if (h2) h2.addEventListener("click", function () { togglePerchCard(secId); });
      var s = $("x-sum-" + secId);
      if (s) s.textContent = perchSummary(secId);
    })(PERCH_CARDS[i]);
  }
}

/* ---- Live-app summary refresh: initExpandableCards() runs before the
 * first /api/state fetch lands, so summaries start empty; refresh them
 * whenever state renders (app.js renderAll calls this). ---- */
function refreshPerchSummaries() {
  for (var i = 0; i < PERCH_CARDS.length; i++) {
    var s = $("x-sum-" + PERCH_CARDS[i]);
    if (s) s.textContent = perchSummary(PERCH_CARDS[i]);
  }
}

function updateTopNavClock() {
  var t = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" }).format(new Date());
  var c = $("topNavClock");
  if (c) c.textContent = t;
  var d = $("drawerClock");
  if (d) d.textContent = t;
}

function initV2() {
  var bg = $("perchBgPhoto");
  if (bg) bg.style.backgroundImage = "url(" + PHOTOS.perchBg + ")";
  var ext = $("exteriorHeroPhoto");
  if (ext) ext.style.backgroundImage = "url(" + PHOTOS.exterior + ")";
  initDrawer();
  initExpandableCards();
  updateTopNavClock();
  setInterval(updateTopNavClock, 30000);
}
