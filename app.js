/* Plan B desk app: poll encrypted feed files, decrypt in WebCrypto, no framework. */
(function () {
  const POLL_MS = 30000;
  const SCREEN_MS = 15000;
  const BOT_COLORS = {
    scanner: "#64d2ff",
    analyst: "#ffd60a",
    brain: "#bf5af2",
    executor: "#00d35a",
    risk: "#ff6b9a",
  };
  const SETTING_GROUPS = [
    ["Scanner", ["min_liquidity_usd","scanner.max_top10_pct","max_h1_change_pct","scanner.poll_s","min_pool_age_min","max_wait_min","runner_h24_pct","min_holders_growth_pct"]],
    ["Analyst", ["max_dev_pct","analyst.max_top10_pct","min_lp_locked_pct","max_bundled","max_delegated_accounts","retries","min_score","alive_volume_h1","fast_curve_min","max_fresh_pct","organic_unique_h1","organic_buys_h1","bundled_penalty","flush_sell_ratio","chase_h1_pct"]],
    ["Social", ["social_weight","social_max_per_h","social_timeout_s","shill_cut"]],
    ["Brain", ["risk_per_trade_pct","full_size_score","below_full_pct","max_pool_pct","min_ticket_usd","max_ticket_usd","max_trades_night"]],
    ["Executor", ["dip_pct","dip_window_min","dip_wait_min","crash_pct","tp_x","tp_sell_pct","trail_pct","recheck_liq_drop_pct","recheck_price_up_pct","quote_timeout_s","verify_timeout_s"]],
    ["Risk", ["risk.poll_s","stop_pct","timeout_h","timeout_min_gain_pct","night_loss_stop_pct"]],
    ["Desk", ["mode","paper_start_cash","night_start","lock_time","report_time","notifier","fomo_handle","fomo_wallet","withdraw_address","rpc_url","push_rejects","fee_pct"]],
  ];
  const AVATAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.5-3.2 4-4.8 7-4.8S17.5 15.8 19 19"/></svg>';
  const SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5" stroke-linecap="round"/></svg>';
  const BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16h12l-1.2-2.2a6.2 6.2 0 0 1-.6-3.3V9.4A4.2 4.2 0 0 0 12 5.2 4.2 4.2 0 0 0 7.8 9.4v1.1c0 1.1-.2 2.3-.6 3.3L6 16z"/><path d="M10 18.2a2 2 0 0 0 4 0"/></svg>';

  const store = {
    path: null, key: null, tab: "home", screen: "home", mint: null, range: "LIVE",
    data: {}, loading: true, liveBlob: [null, null], liveI: 0, liveHash: null,
    err: null, lastUpdate: null, retryAt: null, frameTs: null, screenMeta: null,
    odoText: null, searchQ: "", seenActivity: 0, scrollToGroup: null, liveZoom: 1,
  };

  function b64urlToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function parseSecret() {
    const hash = location.hash || "";
    let raw = "";
    if (hash.startsWith("#d=")) raw = hash.slice(3);
    if (raw) {
      const dot = raw.indexOf(".");
      if (dot > 0) {
        const path = raw.slice(0, dot);
        const key = raw.slice(dot + 1);
        try { localStorage.setItem("desk.path", path); localStorage.setItem("desk.key", key); } catch (e) {}
        store.path = path; store.key = b64urlToBytes(key); return true;
      }
    }
    try {
      const path = localStorage.getItem("desk.path");
      const key = localStorage.getItem("desk.key");
      if (path && key) { store.path = path; store.key = b64urlToBytes(key); return true; }
    } catch (e) {}
    return false;
  }
  async function importKey() {
    return crypto.subtle.importKey("raw", store.key, { name: "AES-GCM" }, false, ["decrypt"]);
  }
  async function decryptBytes(buf) {
    const env = JSON.parse(new TextDecoder().decode(buf));
    if (env.alg !== "AES-256-GCM" || !env.n || !env.c) throw new Error("bad envelope");
    const iv2 = Uint8Array.from(atob(env.n), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(env.c), (c) => c.charCodeAt(0));
    const key = await importKey();
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv2 }, key, ct);
  }
  function feedUrl(name) {
    const base = location.pathname.endsWith("/") ? location.pathname : location.pathname.replace(/[^/]+$/, "");
    return base + "d/" + store.path + "/" + name;
  }
  async function getJson(name) {
    const r = await fetch(feedUrl(name), { cache: "no-store" });
    if (r.status !== 200) throw new Error(name + " HTTP " + r.status);
    const pt = await decryptBytes(await r.arrayBuffer());
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function hashBuf(buf) {
    const u = new Uint8Array(buf);
    let h = u.length;
    for (let i = 0; i < u.length; i += 97) h = (h * 33 + u[i]) >>> 0;
    if (u.length) h = (h * 33 + u[u.length - 1]) >>> 0;
    return String(h) + ":" + u.length;
  }
  async function pollScreen() {
    if (!store.path || !store.key) return;
    try {
      try { store.screenMeta = await getJson("screen.json"); } catch (e) {}
      const r = await fetch(feedUrl("screen.jpg"), { cache: "no-store" });
      if (r.status !== 200) return;
      const pt = await decryptBytes(await r.arrayBuffer());
      const h = hashBuf(pt);
      if (h === store.liveHash) {
        if (store.screenMeta && store.screenMeta.ts && !store.frameTs) store.frameTs = Date.parse(store.screenMeta.ts);
        return;
      }
      store.liveHash = h;
      const prev = store.liveBlob[store.liveI];
      store.liveI = 1 - store.liveI;
      store.liveBlob[store.liveI] = URL.createObjectURL(new Blob([pt], { type: "image/jpeg" }));
      if (store.screenMeta && store.screenMeta.ts) store.frameTs = Date.parse(store.screenMeta.ts);
      else store.frameTs = Date.now();
      if (prev) URL.revokeObjectURL(prev);
    } catch (e) {}
  }
  async function poll() {
    if (!store.path || !store.key) return;
    store.retryAt = Date.now() + POLL_MS;
    const next = Object.assign({}, store.data);
    try {
      next.state = await getJson("state.json");
      next.chart = await getJson("chart.json");
      next.activity = await getJson("activity.json");
      next.account = await getJson("account.json");
      next.settings = await getJson("settings.json");
      try { next.orders = await getJson("orders.json"); } catch (e) {}
      store.loading = false;
      store.err = null;
      store.data = next;
      store.lastUpdate = new Date();
      await pollScreen();
    } catch (e) {
      store.err = String(e && e.message || e);
      store.retryAt = Date.now() + POLL_MS;
    }
    render();
  }

  function $(id) { return document.getElementById(id); }
  function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function money(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    return (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
  }
  function priceFmt(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    const v = Number(n); const abs = Math.abs(v);
    if (abs === 0) return "$0.00";
    if (abs >= 1) return money(v);
    let s = abs.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    return (v < 0 ? "-$" : "$") + s;
  }
  function pct(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  }
  function reduceMotion() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function toast(msg) {
    const t = el('<div class="toast"></div>'); t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }
  function openLink(url) { if (!url) return; window.open(url, "_blank", "noopener"); }
  function shareOrCopy(url, label) {
    if (!url) return;
    if (navigator.share) navigator.share({ title: label || "FOMO", url: url }).catch(function () { copy(url); });
    else copy(url);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast("Link copied"); });
    else toast("Link copied");
  }
  function isFiniteNumber(v) { return v !== "" && Number.isFinite(Number(v)); }
  function latestActivityId() {
    const rows = (store.data.activity && store.data.activity.rows) || [];
    return rows.length ? Number(rows[0].id || 0) : 0;
  }
  function hasBellDot() { const latest = latestActivityId(); return latest > 0 && latest > (store.seenActivity || 0); }
  function formatLastUpdate() {
    if (!store.lastUpdate) return "—";
    try { return store.lastUpdate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }); }
    catch (e) { return store.lastUpdate.toISOString(); }
  }
  function bannerText() {
    const left = store.retryAt ? Math.max(0, Math.ceil((store.retryAt - Date.now()) / 1000)) : Math.ceil(POLL_MS / 1000);
    return "Desk offline · retrying in " + left + "s · last update " + formatLastUpdate();
  }
  function paintBanner() {
    const b = $("banner"); if (!b) return;
    if (store.err) { b.hidden = false; b.textContent = bannerText(); }
    else { b.hidden = true; b.textContent = ""; }
  }
  function mountOdometer(root, value) {
    const text = money(value);
    const first = store.odoText == null;
    const prev = store.odoText == null ? text : store.odoText;
    store.odoText = text;
    if (reduceMotion() || first || prev === text) { root.textContent = text; return; }
    root.textContent = "";
    const len = Math.max(prev.length, text.length);
    const a = prev.padStart(len, " "); const b = text.padStart(len, " ");
    let delay = 0;
    for (let i = 0; i < len; i++) {
      const ch = b[i], was = a[i];
      if (!/[0-9]/.test(ch)) {
        const s = document.createElement("span"); s.className = "odo-ch"; s.textContent = ch === " " ? "" : ch; root.appendChild(s); continue;
      }
      const col = document.createElement("span"); col.className = "odo-col";
      const strip = document.createElement("span"); strip.className = "odo-strip";
      for (let d = 0; d <= 9; d++) { const n = document.createElement("span"); n.textContent = String(d); strip.appendChild(n); }
      const from = /[0-9]/.test(was) ? Number(was) : 0, to = Number(ch);
      strip.style.transition = "none"; strip.style.transform = "translateY(-" + from * 10 + "%)";
      col.appendChild(strip); root.appendChild(col);
      if (from !== to) { strip.style.transitionDelay = delay + "ms"; delay += 30; }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          strip.style.transition = "transform 600ms ease-out";
          strip.style.transform = "translateY(-" + to * 10 + "%)";
        });
      });
    }
  }
  function tabOn(name) {
    const stack = { coin: store.tab, audit: store.tab, bot: "bots", search: "home", live: store.tab };
    if (store.screen === name) return true;
    if (store.screen === "home" || store.screen === "bots" || store.screen === "activity" || store.screen === "account") return store.screen === name;
    return (stack[store.screen] || store.tab) === name;
  }
  function goTab(name) {
    store.tab = name; store.screen = name;
    if (name === "activity") store.seenActivity = Math.max(store.seenActivity, latestActivityId());
    render();
  }
  function homeNavbar() {
    const handle = (store.data.account && store.data.account.fomoHandle) || "";
    const initial = handle.replace(/^@/, "").slice(0, 1).toUpperCase();
    const avatarInner = initial ? esc(initial) : AVATAR_SVG;
    const dot = hasBellDot() ? '<span class="bell-dot"></span>' : "";
    $("header").innerHTML =
      '<div class="home-nav"><button type="button" class="avatar" id="nav-avatar" aria-label="Account">' + avatarInner + "</button>" +
      '<button type="button" class="brand" id="nav-brand">Grok Bot ›</button>' +
      '<div class="nav-actions"><button type="button" class="nav-btn" id="nav-search" aria-label="Search">' + SEARCH_SVG + "</button>" +
      '<button type="button" class="nav-btn" id="nav-bell" aria-label="Activity">' + BELL_SVG + dot + "</button></div></div>";
    $("nav-avatar").addEventListener("click", function () { goTab("account"); });
    $("nav-brand").addEventListener("click", function () { goTab("home"); });
    $("nav-search").addEventListener("click", function () { store.screen = "search"; store.searchQ = ""; render(); });
    $("nav-bell").addEventListener("click", function () { goTab("activity"); });
  }

  function frameAgeMs() {
    if (!store.frameTs) return Infinity;
    return Date.now() - store.frameTs;
  }
  function liveTagHtml() {
    const age = frameAgeMs();
    if (!store.liveBlob[store.liveI]) return "";
    if (age < 5000) return '<div class="live-tag"><span class="dot hot"></span>Live · Bot\'s computer</div>';
    const t = store.frameTs ? new Date(store.frameTs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";
    return '<div class="live-tag"><span class="dot"></span>Last frame ' + esc(t) + "</div>";
  }
  function laneHtml() {
    const lane = store.data.state && store.data.state.lane;
    if (!lane) return '<div class="live-bot">Idle</div>';
    const color = lane.color || BOT_COLORS[(lane.bot || "").toLowerCase()] || "#fff";
    return '<div class="live-bot" style="color:' + esc(color) + '">' + esc(lane.label || "Idle") + "</div>";
  }
  function checkHtml(checks) {
    if (!checks) return "";
    function one(k, letter) {
      const v = checks[k];
      const cls = v === true ? "ok" : v === false ? "bad" : "na";
      const label = k === "api" && checks.apiLabel ? checks.apiLabel : k;
      return '<span class="ck ' + cls + '" title="' + esc(label) + '">' + letter + "</span>";
    }
    return '<div class="checks">' + one("screen", "S") + one("api", "A") + one("chain", "C") + "</div>";
  }
  function liveCard() {
    let html = '<div class="card live-card" id="live-card"><div class="live-stage">';
    if (store.liveBlob[store.liveI]) {
      html += liveTagHtml() + laneHtml();
      html += '<img class="live-frame" alt="Live screen" src="' + store.liveBlob[store.liveI] + '">';
    } else {
      html += '<div class="live-empty">No frame yet</div>' + laneHtml();
    }
    html += "</div>";
    const last = store.data.state && store.data.state.lastOrder;
    if (last && last.line) {
      html += '<div class="order-line"><div class="name">' + esc(last.line) + "</div>" + checkHtml(last.checks) + "</div>";
    }
    html += "</div>";
    return html;
  }
  function openLiveViewer() {
    const existing = document.querySelector(".fs-live");
    if (existing) existing.remove();
    const meta = store.screenMeta || (store.data.state && store.data.state.screenCoin) || {};
    const last = store.data.state && store.data.state.lastOrder;
    const url = meta.coinUrl || (last && last.coinUrl);
    const src = store.liveBlob[store.liveI];
    const box = el('<div class="fs-live"><div class="fs-bar">' +
      '<button type="button" class="back" id="fs-close">‹ Close</button>' +
      (url ? '<button type="button" class="btn blue" id="fs-fomo">Open on FOMO</button>' : "") +
      '</div><div class="fs-stage" id="fs-stage">' +
      (src ? '<img id="fs-img" alt="Live screen" src="' + src + '">' : '<div class="fs-empty">No frame yet</div>') +
      "</div></div>");
    document.body.appendChild(box);
    store.liveZoom = 1;
    $("fs-close").addEventListener("click", function () { box.remove(); });
    const fomo = $("fs-fomo");
    if (fomo) fomo.addEventListener("click", function () { openLink(url); });
    const img = $("fs-img");
    if (img) {
      img.style.transform = "scale(1)";
      const stage = $("fs-stage");
      stage.addEventListener("wheel", function (ev) {
        ev.preventDefault();
        store.liveZoom = Math.min(6, Math.max(1, store.liveZoom * (ev.deltaY < 0 ? 1.08 : 0.92)));
        img.style.transform = "scale(" + store.liveZoom + ")";
      }, { passive: false });
      let startDist = 0, startZoom = 1;
      stage.addEventListener("touchstart", function (ev) {
        if (ev.touches.length === 2) {
          const dx = ev.touches[0].clientX - ev.touches[1].clientX;
          const dy = ev.touches[0].clientY - ev.touches[1].clientY;
          startDist = Math.hypot(dx, dy); startZoom = store.liveZoom;
        }
      }, { passive: true });
      stage.addEventListener("touchmove", function (ev) {
        if (ev.touches.length === 2 && startDist) {
          const dx = ev.touches[0].clientX - ev.touches[1].clientX;
          const dy = ev.touches[0].clientY - ev.touches[1].clientY;
          store.liveZoom = Math.min(6, Math.max(1, startZoom * (Math.hypot(dx, dy) / startDist)));
          img.style.transform = "scale(" + store.liveZoom + ")";
        }
      }, { passive: true });
    }
  }

  function botCompact(b, skipHead) {
    const color = b.color || BOT_COLORS[b.name] || "#fff";
    let inner = "";
    if (!skipHead) {
      inner += '<div class="bot-name"><span class="swatch" style="background:' + color + '"></span>' + esc(b.name) + "</div>";
      inner += '<div class="count">' + esc(b.countLabel || "") + "</div>";
    }
    if (b.name === "scanner") {
      const feed = b.feed || [];
      if (!feed.length && (b.count || 0) === 0) { /* honest empty feed */ }
      feed.forEach(function (it) {
        if (it.verdict === "kill") inner += '<div class="feed-item killed"><span class="xname">' + esc(it.x || "") + "</span> · " + esc(it.reason || "") + "</div>";
        else if (it.verdict === "pass") inner += '<div class="feed-item passed">' + esc(it.x || "") + " → Analyst</div>";
      });
    } else if (b.name === "analyst") {
      inner += '<div class="strips">' + (b.layers || []).map(function (L) {
        const cls = !L || L.pass == null ? "" : (Number(L.pass) === 1 ? "pass" : "fail");
        return '<div class="strip ' + cls + '"></div>';
      }).join("") + "</div>";
      const score = b.score;
      if (score != null && Number.isFinite(Number(score))) {
        const v = Number(score);
        const col = v >= 70 ? "#00d35a" : "rgba(235,235,245,0.3)";
        inner += '<div class="score-row"><div class="score-ring" style="--p:' + v + ";--ring:" + col + '"><span>' + Math.round(v) + "</span></div>";
        inner += '<div class="sub">' + (b.socialOff ? "Social: off" : ("Social +" + (b.socialPts != null ? b.socialPts : "—"))) + "</div></div>";
      } else {
        inner += '<div class="score-row"><div class="score-ring empty"><span>—</span></div><div class="sub">Social: off</div></div>';
      }
    } else if (b.name === "brain") {
      if (b.sizeText) inner += '<div class="name" style="margin-top:8px">' + esc(b.sizeText) + "</div>";
      inner += '<div class="rules">' + esc(b.ruleFull || "") + "<br>" + esc(b.ruleHalf || "") + "</div>";
    } else if (b.name === "executor") {
      if (b.bar) inner += '<div class="exec-bar">' + esc(b.bar) + "</div>";
    } else if (b.name === "risk") {
      inner += '<div class="pills-row">';
      if (b.stopPct != null) inner += '<span class="pill stop">stop -' + esc(String(b.stopPct).replace(/\.0$/, "")) + "%</span>";
      if (b.trailPct != null) inner += '<span class="pill trail">trail ' + esc(String(b.trailPct).replace(/\.0$/, "")) + "%</span>";
      inner += "</div>";
    }
    return inner;
  }
  function decisionRows(dec) {
    if (!dec || !dec.length) return '<div class="empty" style="padding:12px 0">No decisions yet</div>';
    return dec.map(function (d) {
      const label = d.verdict || d.reason || d.status || (d.score != null ? ("score " + d.score) : "decision");
      const sub = [(d.mint || "").slice(0, 8), d.ts].filter(Boolean).join(" · ");
      return '<div class="act-row"><div class="grow"><div class="name">' + esc(label) + '</div><div class="sub">' + esc(sub) + "</div></div>" +
        (d.coinUrl ? '<button type="button" class="btn grey tiny" data-url="' + esc(d.coinUrl) + '">Open on FOMO</button>' : "") + "</div>";
    }).join("");
  }
  function botFull(b) {
    const color = b.color || BOT_COLORS[b.name] || "#fff";
    const locked = b.riskLocked;
    let html = '<div class="bot-full" data-bot-card="' + esc(b.name) + '">';
    html += '<div class="bot-full-head"><span class="swatch" style="background:' + color + '"></span>';
    html += '<div class="grow"><div class="name">' + esc(b.name) + '</div><div class="sub">' + esc((b.countLabel || "") + (b.status ? " · " + b.status : "")) + "</div></div></div>";
    html += '<div class="pause-row"><div class="grow"><div class="name">Pause</div><div class="sub">' +
      (locked ? "Risk is locked while a position is open. " : "") +
      "Pause goes through Telegram (STEP 11). Shown read-only here.</div></div>";
    html += '<input type="checkbox" disabled' + (b.paused ? " checked" : "") + (locked ? " disabled" : "") + "></div>";
    html += botCompact(b, true);
    html += '<div class="sub" style="margin:12px 0 4px">Last 20</div>' + decisionRows(b.decisions);
    html += '<button type="button" class="settings-link" data-settings="' + esc(b.name) + '">Settings</button>';
    html += "</div>";
    return html;
  }

  function activityRow(r) {
    const title = r.title || "";
    const sub = r.subtitle || [r.bot || "", r.ts || ""].filter(Boolean).join(" · ");
    const kind = (r.kind || "").toLowerCase();
    const go = kind.indexOf("reject") >= 0 || kind.indexOf("audit") >= 0 ? "audit" : "coin";
    return '<div class="act-row" data-go="' + go + '" data-mint="' + esc(r.mint || "") + '"><div class="grow"><div class="name">' +
      esc(title) + '</div><div class="sub">' + esc(sub) + '</div></div><div class="right">' + esc(r.value || "") +
      (r.coinUrl ? '<div><button type="button" class="btn grey tiny" data-url="' + esc(r.coinUrl) + '">Open on FOMO</button></div>' : "") +
      "</div></div>";
  }
  function bindActivity(root) {
    (root || $("main")).querySelectorAll("[data-go]").forEach(function (row) {
      row.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-url]")) return;
        const mint = row.getAttribute("data-mint"); if (!mint) return;
        if (row.getAttribute("data-go") === "audit") openAudit(mint); else openCoin(mint);
      });
    });
    (root || $("main")).querySelectorAll("[data-url]").forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); openLink(b.getAttribute("data-url")); });
    });
  }

  function render() {
    if (!store.path || !store.key) { $("lock").classList.remove("hidden"); $("shell").classList.add("hidden"); return; }
    $("lock").classList.add("hidden"); $("shell").classList.remove("hidden");
    document.querySelectorAll("#tabs button").forEach((b) => { b.classList.toggle("on", tabOn(b.getAttribute("data-tab"))); });
    paintBanner();
    if (store.loading && !store.data.state) return renderLoading();
    if (store.screen === "search") return renderSearch();
    if (store.screen === "coin") return renderCoin();
    if (store.screen === "audit") return renderAudit();
    if (store.tab === "activity" || store.screen === "activity") return renderActivity();
    if (store.tab === "account" || store.screen === "account") return renderAccount();
    if (store.tab === "bots" || store.screen === "bots") return renderBots();
    renderHome();
  }
  function renderLoading() {
    homeNavbar();
    $("main").innerHTML = '<div class="skel skel-balance"></div><div class="skel skel-card"></div><div class="skel skel-card"></div><div class="skel skel-card"></div><div class="skel skel-card"></div>';
  }
  function positionCard(pos) {
    if (!pos.length) return '<div class="card"><div class="empty">Waiting for the first trade</div></div>';
    return '<div class="card"><h2>Positions</h2>' + pos.map(function (p) {
      const name = p.symbol || p.name || (p.mint ? p.mint.slice(0, 6) + "…" : "—");
      return '<div class="pos-row" data-open-coin="' + esc(p.mint) + '"><div class="grow"><div class="name">' +
        esc(name) + '</div><div class="sub">entry ' + money(p.entry_price) + '</div></div><div class="right">' + money(p.size_usd) + "</div></div>";
    }).join("") + "</div>";
  }
  function renderHome() {
    const st = store.data.state || {};
    const mode = st.mode || "PAPER";
    const paper = mode === "PAPER";
    homeNavbar();
    const today = Number(st.todayPct);
    const todayCls = today > 0 ? "up" : today < 0 ? "down" : "flat";
    const todayTxt = Number.isFinite(today) ? pct(today) + " today" : "— today";
    const mult = st.multiplier != null ? Number(st.multiplier).toFixed(2) + "×" : "—";
    const pos = st.positions || [];
    const bots = st.bots || [];
    const running = st.runningBots != null ? st.runningBots : bots.filter(function (b) { return b.status === "running"; }).length;
    const rows = ((store.data.activity && store.data.activity.rows) || []).slice(0, 5);

    let botsHtml = '<div class="sec-head"><div class="sec-title">Bots · ' + running + ' running</div></div>';
    botsHtml += '<div class="bot-carousel" id="bot-carousel">' + bots.map(function (b) {
      return '<div class="bot-slide" data-bot="' + esc(b.name) + '">' + botCompact(b) + "</div>";
    }).join("") + "</div>";

    let actHtml = '<div class="sec-head"><div class="sec-title">Activity</div><button type="button" class="see-all" id="see-all">See all</button></div>';
    if (rows.length) actHtml += '<div class="card" id="home-act">' + rows.map(activityRow).join("") + "</div>";

    $("main").innerHTML =
      '<div class="balance-row"><div class="odometer" id="odo"></div>' +
      (paper ? '<span class="pill paper">PAPER</span>' : "") + "</div>" +
      '<div class="today ' + todayCls + '">' + esc(todayTxt) +
      ' <span class="pill mult">' + esc(mult) + "</span></div>" +
      '<div class="card"><canvas id="equity" width="358" height="200" style="width:100%;height:200px;display:block"></canvas>' +
      '<div class="ranges" id="ranges">' +
      ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(function (r) {
        return '<button type="button" data-range="' + r + '"' + (store.range === r ? ' class="on"' : "") + ">" + r + "</button>";
      }).join("") + "</div></div>" + liveCard() + positionCard(pos) + botsHtml + actHtml;

    mountOdometer($("odo"), st.balance);
    if (window.DeskChart) window.DeskChart.draw($("equity"), store.data.chart, store.range);
    $("ranges").addEventListener("click", function (ev) {
      const b = ev.target.closest("button[data-range]"); if (!b) return; store.range = b.getAttribute("data-range"); render();
    });
    $("main").querySelectorAll("[data-open-coin]").forEach(function (row) {
      row.addEventListener("click", function () { openCoin(row.getAttribute("data-open-coin")); });
    });
    $("main").querySelectorAll("[data-bot]").forEach(function (row) {
      row.addEventListener("click", function () { goTab("bots"); });
    });
    const live = $("live-card");
    if (live) live.addEventListener("click", function () { if (store.liveBlob[store.liveI]) openLiveViewer(); });
    const see = $("see-all"); if (see) see.addEventListener("click", function () { goTab("activity"); });
    bindActivity($("home-act") || $("main"));
  }
  function renderBots() {
    $("header").innerHTML = "<h1>Bots</h1>";
    const bots = (store.data.state && store.data.state.bots) || [];
    $("main").innerHTML = '<div class="note">Pause and settings go through Telegram (STEP 11). Shown read-only here.</div>' +
      bots.map(botFull).join("");
    $("main").querySelectorAll("[data-url]").forEach(function (b) {
      b.addEventListener("click", function () { openLink(b.getAttribute("data-url")); });
    });
    $("main").querySelectorAll("[data-settings]").forEach(function (b) {
      b.addEventListener("click", function () {
        store.scrollToGroup = b.getAttribute("data-settings");
        goTab("account");
      });
    });
  }
  function renderActivity() {
    $("header").innerHTML = "<h1>Activity</h1>";
    store.seenActivity = Math.max(store.seenActivity, latestActivityId());
    const rows = (store.data.activity && store.data.activity.rows) || [];
    if (!rows.length) { $("main").innerHTML = '<div class="card"><div class="empty">Nothing yet tonight</div></div>'; return; }
    $("main").innerHTML = '<div class="card">' + rows.map(activityRow).join("") + "</div>";
    bindActivity();
  }
  function renderAccount() {
    const ac = store.data.account || {};
    const st = (store.data.settings && store.data.settings.settings) || {};
    const mode = ac.mode || "PAPER";
    $("header").innerHTML = "<h1>Account</h1>";
    let html = '<div class="note">Settings, pause, mode, and test pushes go through Telegram (STEP 11). Everything here is read-only. Plan B cannot POST from this page.</div>';
    html += '<div class="group">';
    html += '<div class="link-row"><div class="grow"><div class="name">Mode</div></div><div class="seg" id="mode-seg">';
    html += '<button type="button" data-mode="PAPER"' + (mode === "PAPER" ? ' class="on"' : "") + ">PAPER</button>";
    html += '<button type="button" data-mode="LIVE"' + (mode === "LIVE" ? ' class="on"' : "") + ">LIVE</button></div></div>";
    html += '<div class="link-row"><div class="grow"><div class="name">Cash</div></div><div class="right" style="flex:0 0 46%"><input disabled value="' + esc(money(ac.balance)) + '"></div></div>';
    if (ac.profileUrl) {
      html += '<div class="link-row"><div class="grow"><div class="name">Your FOMO profile</div><div class="sub">' +
        esc(ac.fomoHandle || "") + '</div></div><button type="button" class="btn grey tiny" data-url="' + esc(ac.profileUrl) + '">Open</button></div>';
    }
    if (ac.signupUrl) {
      html += '<div class="link-row"><div class="grow"><div class="name">Invite a friend</div></div>' +
        '<button type="button" class="btn grey tiny" data-invite="' + esc(ac.signupUrl) + '">Invite</button></div>';
    }
    html += "</div>";
    html += '<div class="group-title">Pushes</div><div class="group">';
    html += '<div class="link-row"><div class="grow"><div class="name">Enable notifications</div><div class="sub">Telegram only</div></div><div class="right">not connected</div></div>';
    html += '<div class="link-row"><div class="grow"><div class="name">Send test push</div></div><button type="button" class="btn grey tiny" disabled>Telegram</button></div>';
    html += '<div class="link-row" id="watch-row"><div class="grow"><div class="name">Watch in Grok Bot</div><div class="sub">Opens the bot\'s own computer preview.</div></div></div>';
    html += "</div>";
    const picks = ac.copyPicks || "off";
    html += '<div class="group-title">Copy picks</div><div class="group"><div class="link-row"><div class="grow"><div class="name">Copy picks</div><div class="sub">Chapter 3 prompt</div>';
    html += '<div class="copy-opts">';
    ["off", "every 24h", "12h", "6h"].forEach(function (opt) {
      const on = (picks === "off" && opt === "off") || picks === opt;
      html += '<button type="button" disabled' + (on ? ' class="on"' : "") + ">" + opt + "</button>";
    });
    html += "</div>";
    if (ac.copyPicksTime) html += '<div class="sub" style="margin-top:6px">Time · ' + esc(ac.copyPicksTime) + "</div>";
    html += "</div></div></div>";

    const ranges = (store.data.settings && store.data.settings.ranges) || {};
    const rangesStatus = (store.data.settings && store.data.settings.rangesStatus) || "proposed";
    if (rangesStatus !== "approved") {
      html += '<div class="note proposed">Setting ranges are proposed, not yet approved. Changes go through Telegram.</div>';
    }
    SETTING_GROUPS.forEach(function (pair) {
      const group = pair[0], keys = pair[1];
      html += '<div class="group-title" id="set-' + esc(group) + '">' + esc(group) + '</div><div class="group">';
      keys.forEach(function (k) {
        if (!(k in st) && k !== "fomo_handle" && k !== "fomo_wallet" && k !== "withdraw_address") return;
        const val = st[k] != null ? st[k] : "";
        const rng = ranges[k];
        const hasRange = rng && isFiniteNumber(rng.min) && isFiniteNumber(rng.max);
        html += '<div class="set-row"><div class="grow"><div class="name">' + esc(k) + "</div>";
        html += '<input disabled value="' + esc(val) + '">';
        if (hasRange && isFiniteNumber(val)) {
          html += '<input type="range" min="' + rng.min + '" max="' + rng.max + '" step="' + rng.step + '" value="' + Number(val) + '" disabled>';
          html += '<div class="sub">' + rng.min + "–" + rng.max + " · step " + rng.step;
          if (rangesStatus !== "approved") html += " · proposed";
          html += "</div>";
        }
        html += "</div></div>";
      });
      html += "</div>";
    });
    $("main").innerHTML = html;
    $("main").querySelectorAll("[data-url]").forEach(function (b) { b.addEventListener("click", function () { openLink(b.getAttribute("data-url")); }); });
    $("main").querySelectorAll("[data-invite]").forEach(function (b) { b.addEventListener("click", function () { shareOrCopy(b.getAttribute("data-invite"), "Invite a friend"); }); });
    $("watch-row").addEventListener("click", function () { openLiveViewer(); });
    $("mode-seg").addEventListener("click", function (ev) {
      const b = ev.target.closest("button[data-mode]"); if (!b) return;
      if (b.getAttribute("data-mode") === "LIVE" && mode !== "LIVE") openLiveSheet();
    });
    if (store.scrollToGroup) {
      const g = store.scrollToGroup;
      store.scrollToGroup = null;
      const id = "set-" + (g.charAt(0).toUpperCase() + g.slice(1));
      const node = $(id);
      if (node) node.scrollIntoView({ block: "start" });
    }
  }
  function openLiveSheet() {
    const bg = el('<div class="sheet-bg"><div class="sheet"><h3>Type LIVE</h3>' +
      '<input disabled placeholder="LIVE" value="">' +
      '<button type="button" class="btn red" disabled>Confirm LIVE</button>' +
      '<button type="button" class="btn grey" data-cancel="1">Cancel</button>' +
      '<div class="sub" style="margin-top:10px;text-align:center">On plan B, mode changes go through Telegram (STEP 11). This page does not POST.</div></div></div>');
    document.body.appendChild(bg);
    bg.addEventListener("click", function (ev) { if (ev.target === bg || ev.target.getAttribute("data-cancel")) bg.remove(); });
  }
  function renderSearch() {
    $("header").innerHTML = '<button type="button" class="back" id="back">‹ Home</button>' +
      '<input class="search-field" id="q" type="search" placeholder="Name, symbol or mint" value="' + esc(store.searchQ) + '" autocapitalize="off" autocomplete="off">';
    $("back").addEventListener("click", function () { store.screen = "home"; store.tab = "home"; render(); });
    const qEl = $("q");
    const q = (store.searchQ || "").trim().toLowerCase();
    const hits = q ? searchCorpus().filter(function (h) { return [h.name, h.mint, h.extra].join(" ").toLowerCase().indexOf(q) >= 0; }) : [];
    if (!q) $("main").innerHTML = '<div class="card"><div class="empty">Search name, symbol or mint</div></div>';
    else if (!hits.length) $("main").innerHTML = '<div class="card"><div class="empty">No matches</div></div>';
    else {
      $("main").innerHTML = '<div class="card">' + hits.map(function (h) {
        return '<div class="hit-row" data-mint="' + esc(h.mint || "") + '"><div class="grow"><div class="name">' + esc(h.name) + '</div><div class="sub">' + esc(h.extra || "") + "</div></div></div>";
      }).join("") + "</div>";
      $("main").querySelectorAll("[data-mint]").forEach(function (row) {
        row.addEventListener("click", function () { const mint = row.getAttribute("data-mint"); if (mint) openCoin(mint); });
      });
    }
    qEl.focus();
    qEl.addEventListener("input", function () {
      store.searchQ = qEl.value; renderSearch();
      const again = $("q"); if (again) { again.focus(); try { again.setSelectionRange(store.searchQ.length, store.searchQ.length); } catch (e) {} }
    });
  }
  function searchCorpus() {
    const hits = [], seen = {};
    function add(kind, mint, name, extra) {
      const key = (kind || "") + ":" + (mint || name); if (seen[key]) return; seen[key] = 1;
      hits.push({ kind: kind, mint: mint, name: name, extra: extra });
    }
    const st = store.data.state || {};
    (st.positions || []).forEach(function (p) { add("coin", p.mint, p.symbol || p.name || (p.mint || "").slice(0, 8), "Position"); });
    ((store.data.activity && store.data.activity.rows) || []).forEach(function (r) { if (r.mint) add("coin", r.mint, r.title || r.mint.slice(0, 8), r.kind || "Activity"); });
    const c = store.data.coin;
    if (c && (c.mint || (c.coin && c.coin.mint))) {
      const mint = c.mint || c.coin.mint;
      add("coin", mint, (c.coin && (c.coin.symbol || c.coin.name)) || mint.slice(0, 8), "Coin");
    }
    ((st.bots || [])).forEach(function (b) {
      if (b.latestMint) add("audit", b.latestMint, b.latestMint.slice(0, 8), "Analyst");
      (b.feed || []).forEach(function (it) { if (it.mint) add("coin", it.mint, it.x || it.mint.slice(0, 8), "Scan"); });
    });
    return hits;
  }
  async function openCoin(mint) {
    store.screen = "coin"; store.mint = mint;
    try { store.data.coin = await getJson("coin/" + mint + ".json"); }
    catch (e) { store.data.coin = { mint: mint, coinUrl: null, error: "no coin file" }; }
    render();
  }
  async function openAudit(mint) {
    store.screen = "audit"; store.mint = mint;
    try { store.data.audit = await getJson("audit/" + mint + ".json"); }
    catch (e) { store.data.audit = { mint: mint, layers: [], coinUrl: null, social: { off: true, line: "Social: off" } }; }
    render();
  }
  function ageText(hours) {
    if (hours == null || !Number.isFinite(Number(hours))) return null;
    const h = Number(hours);
    if (h >= 1) return Math.round(h) + "h old";
    return Math.max(1, Math.round(h * 60)) + "m old";
  }
  function renderCoin() {
    const c = store.data.coin || {};
    const coin = c.coin || {};
    const name = coin.symbol || coin.name || (c.mint || store.mint || "").slice(0, 8);
    const st = store.data.state || {};
    const paper = (st.mode || "PAPER") === "PAPER";
    $("header").innerHTML = '<button type="button" class="back" id="back">‹ Home</button><div class="title-slot">' +
      esc(name) + (paper ? ' <span class="pill paper">PAPER</span>' : "") + '</div><span style="width:44px"></span>';
    $("back").addEventListener("click", function () { store.screen = store.tab || "home"; render(); });
    const price = c.price && c.price.price != null ? priceFmt(c.price.price) : "—";
    const pos = c.position;
    const age = ageText(c.ageHours);
    const metaParts = [name, c.chain || "Solana"];
    if (age) metaParts.push(age);
    let html = '<div class="coin-meta">' + esc(metaParts.join(" · ")) +
      ' <span class="shield">' + esc(c.shield || "0/8") + "</span></div>";
    html += '<div class="big-price">' + esc(price) + "</div>";
    if (c.sinceEntryPct != null && Number.isFinite(Number(c.sinceEntryPct))) {
      const v = Number(c.sinceEntryPct);
      const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
      const arrow = v >= 0 ? "▲ " : "▼ ";
      html += '<div class="since ' + cls + '">' + arrow + esc(Math.abs(v).toFixed(2)) + "% since entry</div>";
    }
    html += '<div class="card"><canvas id="candles" width="358" height="180" style="width:100%;height:180px;display:block"></canvas></div>';
    html += '<div class="tiles">';
    html += '<div class="tile"><div class="k">Market cap</div><div class="v">' + esc(c.marketCap == null ? "—" : money(c.marketCap)) + "</div></div>";
    html += '<div class="tile"><div class="k">Liquidity</div><div class="v">' + esc(c.liquidity == null ? "—" : money(c.liquidity)) + "</div></div>";
    html += '<div class="tile"><div class="k">Holders</div><div class="v">' + esc(c.holders == null ? "—" : String(c.holders)) + "</div></div>";
    html += "</div>";
    if (pos) {
      html += '<div class="card"><div class="name">Your position · ' + money(pos.size_usd) + " in · " + esc(pos.bot || "Executor") + "</div></div>";
    } else {
      html += '<div class="card"><div class="empty">No open position</div></div>';
    }
    html += '<div class="row-btns">';
    if (c.coinUrl) html += '<button type="button" class="btn blue" id="open-fomo">Open on FOMO</button>';
    html += '<button type="button" class="btn red" id="sell-now">Sell now</button></div>';
    $("main").innerHTML = html;
    if (window.DeskChart) window.DeskChart.drawCandles($("candles"), c.candles || [], { exitPrice: c.exitPrice });
    const of = $("open-fomo"); if (of) of.addEventListener("click", function () { openLink(c.coinUrl); });
    const sn = $("sell-now"); if (sn) sn.addEventListener("click", function () { openSellSheet(c); });
  }
  function openSellSheet(c) {
    const bg = el('<div class="sheet-bg"><div class="sheet"><h3>Sell now</h3>' +
      '<button type="button" class="btn grey" data-pct="25">25%</button>' +
      '<button type="button" class="btn grey" data-pct="50">50%</button>' +
      '<button type="button" class="btn red" data-pct="100">100%</button>' +
      '<button type="button" class="btn grey" data-cancel="1">Cancel</button>' +
      '<div class="sub" style="margin-top:10px;text-align:center">Confirm sell would POST /api/sell and tell Executor to click it. On plan B this goes through Telegram (STEP 11) — there is no public POST from the app.</div></div></div>');
    document.body.appendChild(bg);
    bg.addEventListener("click", function (ev) {
      if (ev.target === bg || ev.target.getAttribute("data-cancel")) bg.remove();
      const pctBtn = ev.target.closest("[data-pct]"); if (!pctBtn) return;
      const pctV = pctBtn.getAttribute("data-pct");
      bg.innerHTML = '<div class="sheet"><h3>Sell ' + esc(pctV) + "% now?</h3>" +
        '<button type="button" class="btn red" data-confirm="1">Confirm sell</button>' +
        '<button type="button" class="btn grey" data-cancel="1">Cancel</button>' +
        '<div class="sub" style="margin-top:10px;text-align:center">Plan B: Confirm is not sent from this page. Use Telegram (STEP 11).</div></div>';
    });
  }
  function renderAudit() {
    const a = store.data.audit || {};
    $("header").innerHTML = '<button type="button" class="back" id="back">‹ Back</button><div class="title-slot">Audit</div><span style="width:44px"></span>';
    $("back").addEventListener("click", function () { store.screen = store.tab || "home"; render(); });
    const layers = a.layers || [];
    let html = '<div class="card"><div class="disc-row"><div class="beam"></div>';
    for (let i = 1; i <= 8; i++) {
      const L = layers.find(function (x) { return String(x.layer) === String(i); });
      const cls = !L ? "" : (Number(L.pass) === 1 ? "pass" : "fail");
      html += '<div class="disc ' + cls + '"></div>';
    }
    html += "</div></div><div class=" + '"card">';
    if (!layers.length) html += '<div class="empty">No audit layers</div>';
    layers.forEach(function (L) {
      html += '<div class="layer"><div class="name">' + esc(L.layer + " · " + (L.name || "")) +
        ' <span class="' + (Number(L.pass) === 1 ? "ok" : "bad") + '">' +
        (Number(L.pass) === 1 ? "✓" : "✕") + '</span></div><div class="sub">' +
        esc(L.value_text || "") + (L.source ? " · " + L.source : "") + "</div></div>";
    });
    const social = a.social && a.social.line ? a.social.line : "Social: off";
    html += '<div class="social-row">' + esc(social) + "</div></div>";
    if (a.coinUrl) html += '<button type="button" class="btn blue" id="open-fomo">Open on FOMO</button>';
    $("main").innerHTML = html;
    const of = $("open-fomo"); if (of) of.addEventListener("click", function () { openLink(a.coinUrl); });
  }

  document.getElementById("tabs").addEventListener("click", function (ev) {
    const b = ev.target.closest("button[data-tab]"); if (!b) return; goTab(b.getAttribute("data-tab"));
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  window.addEventListener("desk-open", function (ev) {
    const d = ev.detail || {};
    if (d.kind === "coin" && d.mint) openCoin(d.mint);
    if (d.kind === "audit" && d.mint) openAudit(d.mint);
    if (d.kind === "bots") goTab("bots");
    if (d.kind === "search") { store.screen = "search"; render(); }
    if (d.kind === "live") openLiveViewer();
  });
  setInterval(function () { if (store.err) paintBanner(); }, 1000);
  if (!parseSecret()) { render(); return; }
  render();
  poll();
  setInterval(poll, POLL_MS);
  setInterval(pollScreen, SCREEN_MS);
})();
