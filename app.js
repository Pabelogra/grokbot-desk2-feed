/* Plan B desk app: poll encrypted feed files, decrypt in WebCrypto, no framework. */
(function () {
  const POLL_MS = 30000;
  const BOT_COLORS = {
    scanner: "#64d2ff",
    analyst: "#ffd60a",
    brain: "#bf5af2",
    executor: "#00d35a",
    risk: "#ff6b9a",
  };
  const SETTING_GROUPS = [
    ["scanner", ["min_liquidity_usd","scanner.max_top10_pct","max_h1_change_pct","scanner.poll_s","min_pool_age_min","max_wait_min","runner_h24_pct","min_holders_growth_pct"]],
    ["analyst", ["max_dev_pct","analyst.max_top10_pct","min_lp_locked_pct","max_bundled","max_delegated_accounts","retries","min_score","alive_volume_h1","fast_curve_min","max_fresh_pct","organic_unique_h1","organic_buys_h1","bundled_penalty","flush_sell_ratio","chase_h1_pct"]],
    ["social", ["social_weight","social_max_per_h","social_timeout_s","shill_cut"]],
    ["brain", ["risk_per_trade_pct","full_size_score","below_full_pct","max_pool_pct","min_ticket_usd","max_ticket_usd","max_trades_night"]],
    ["executor", ["dip_pct","dip_window_min","dip_wait_min","crash_pct","tp_x","tp_sell_pct","trail_pct","recheck_liq_drop_pct","recheck_price_up_pct","quote_timeout_s","verify_timeout_s"]],
    ["risk", ["risk.poll_s","stop_pct","timeout_h","timeout_min_gain_pct","night_loss_stop_pct"]],
    ["desk", ["mode","paper_start_cash","night_start","lock_time","report_time","notifier","fomo_handle","fomo_wallet","rpc_url","push_rejects","fee_pct"]],
  ];

  const store = { path: null, key: null, tab: "home", screen: "home", mint: null, range: "LIVE", data: {}, loading: true, liveBlob: [null, null], liveI: 0 };

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
        try {
          localStorage.setItem("desk.path", path);
          localStorage.setItem("desk.key", key);
        } catch (e) {}
        store.path = path;
        store.key = b64urlToBytes(key);
        return true;
      }
    }
    try {
      const path = localStorage.getItem("desk.path");
      const key = localStorage.getItem("desk.key");
      if (path && key) {
        store.path = path;
        store.key = b64urlToBytes(key);
        return true;
      }
    } catch (e) {}
    return false;
  }

  async function importKey() {
    return crypto.subtle.importKey("raw", store.key, { name: "AES-GCM" }, false, ["decrypt"]);
  }

  async function decryptBytes(buf) {
    const env = JSON.parse(new TextDecoder().decode(buf));
    if (env.alg !== "AES-256-GCM" || !env.n || !env.c) throw new Error("bad envelope");
    const iv = b64urlToBytes(env.n.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    // envelope uses standard base64, not necessarily urlsafe
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

  async function getScreen() {
    const r = await fetch(feedUrl("screen.jpg"), { cache: "no-store" });
    if (r.status !== 200) return null;
    try {
      const pt = await decryptBytes(await r.arrayBuffer());
      return new Blob([pt], { type: "image/jpeg" });
    } catch (e) {
      return null;
    }
  }

  async function poll() {
    if (!store.path || !store.key) return;
    const next = { ...store.data };
    try {
      next.state = await getJson("state.json");
      next.chart = await getJson("chart.json");
      next.activity = await getJson("activity.json");
      next.account = await getJson("account.json");
      next.settings = await getJson("settings.json");
      try { next.orders = await getJson("orders.json"); } catch (e) {}
      store.loading = false;
      store.data = next;
      try {
        const blob = await getScreen();
        if (blob) {
          const prev = store.liveBlob[store.liveI];
          store.liveI = 1 - store.liveI;
          store.liveBlob[store.liveI] = URL.createObjectURL(blob);
          store.screenAt = Date.now();
          if (prev) URL.revokeObjectURL(prev);
        }
      } catch (e) {}
    } catch (e) {
      store.err = String(e && e.message || e);
    }
    render();
  }

  function $(id) { return document.getElementById(id); }
  function el(html) {
    const d = document.createElement("div");
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function money(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    return (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
  }
  function pct(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    const sign = v > 0 ? "+" : "";
    return sign + v.toFixed(2) + "%";
  }
  function toast(msg) {
    const t = el('<div class="toast"></div>');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  function openLink(url) {
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  function shareOrCopy(url, label) {
    if (!url) return;
    if (navigator.share) {
      navigator.share({ title: label || "FOMO", url: url }).catch(function () { copy(url); });
    } else copy(url);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Link copied"); });
    } else toast("Link copied");
  }

  function render() {
    if (!store.path || !store.key) {
      $("lock").classList.remove("hidden");
      $("shell").classList.add("hidden");
      return;
    }
    $("lock").classList.add("hidden");
    $("shell").classList.remove("hidden");
    document.querySelectorAll("#tabs button").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-tab") === store.tab && (store.screen === "home" || store.screen === "activity" || store.screen === "account"));
    });
    if (store.loading) return renderLoading();
    if (store.screen === "coin") return renderCoin();
    if (store.screen === "audit") return renderAudit();
    if (store.tab === "activity") return renderActivity();
    if (store.tab === "account") return renderAccount();
    renderHome();
  }

  function renderLoading() {
    $("header").innerHTML = "<h1>Desk</h1>";
    $("main").innerHTML =
      '<div class="skel skel-balance"></div><div class="skel skel-card"></div><div class="skel skel-card"></div>';
  }

  function renderHome() {
    const st = store.data.state || {};
    const mode = st.mode || "PAPER";
    const paper = mode === "PAPER";
    $("header").innerHTML = "<h1>Desk</h1>";
    const today = Number(st.todayPct);
    const todayCls = today > 0 ? "up" : today < 0 ? "down" : "flat";
    const todayTxt = Number.isFinite(today) ? pct(today) + " today" : "— today";
    const mult = st.multiplier != null ? Number(st.multiplier).toFixed(2) + "×" : "—";
    const bots = st.bots || [];
    const pos = st.positions || [];

    let live = '<div class="card live-card"><div class="live-stage">';
    if (store.liveBlob[store.liveI]) {
      const age = store.screenAt ? (Date.now() - store.screenAt) / 1000 : 999;
      const hot = age < 5;
      const tag = hot ? 'Live · Bot’s computer' : ("Last frame " + (store.screenAt ? new Date(store.screenAt).toLocaleTimeString() : "—"));
      live += '<div class="live-tag"><span class="dot ' + (hot ? "hot" : "") + '"></span>' + esc(tag) + "</div>";
      live += '<div class="live-bot"></div>';
      live += '<img class="live-frame" alt="Live screen" src="' + store.liveBlob[store.liveI] + '">';
    } else {
      live += '<div class="live-empty">No frame yet</div>';
    }
    live += "</div></div>";

    let positions = "";
    if (!pos.length) {
      positions = '<div class="card"><div class="empty">Waiting for the night</div></div>';
    } else {
      positions = '<div class="card"><h2>Positions</h2>' + pos.map(function (p) {
        return '<div class="pos-row" data-open-coin="' + esc(p.mint) + '"><div class="grow"><div class="name">' +
          esc(p.mint ? p.mint.slice(0, 6) + "…" : "—") + '</div><div class="sub">entry ' + money(p.entry_price) +
          '</div></div><div class="right">' + money(p.size_usd) + "</div></div>";
      }).join("") + "</div>";
    }

    const botHtml = '<div class="card"><h2>Bots</h2>' + bots.map(function (b) {
      const color = BOT_COLORS[b.name] || "#fff";
      const stt = b.status || (b.paused ? "paused" : "silent");
      return '<div class="bot-row" data-bot="' + esc(b.name) + '"><span class="swatch" style="background:' + color +
        '"></span><div class="grow"><div class="name">' + esc(b.name) + '</div><div class="sub">' +
        esc(b.lastHeartbeat || "no heartbeat") + '</div></div><div class="right status-' + esc(stt) + '">' +
        esc(stt) + "</div></div>";
    }).join("") + '<div class="sub" style="padding:8px 0 2px">Pause and settings go through Telegram (STEP 11). Shown read-only here. Risk is locked while a position is open.</div></div>';

    $("main").innerHTML =
      '<div class="balance-row"><div class="odometer">' + esc(money(st.balance)) + "</div>" +
      (paper ? '<span class="pill paper">PAPER</span>' : "") + "</div>" +
      '<div class="today ' + todayCls + '">' + esc(todayTxt) +
      ' <span class="pill mult">' + esc(mult) + "</span></div>" +
      '<div class="card"><canvas id="equity" width="358" height="200" style="width:100%;height:200px;display:block"></canvas>' +
      '<div class="ranges" id="ranges">' +
      ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(function (r) {
        return '<button data-range="' + r + '"' + (store.range === r ? ' class="on"' : "") + ">" + r + "</button>";
      }).join("") + "</div></div>" + live + positions + botHtml;

    const canvas = $("equity");
    if (window.DeskChart) window.DeskChart.draw(canvas, store.data.chart, store.range);
    $("ranges").addEventListener("click", function (ev) {
      const b = ev.target.closest("button[data-range]");
      if (!b) return;
      store.range = b.getAttribute("data-range");
      render();
    });
    $("main").querySelectorAll("[data-open-coin]").forEach(function (row) {
      row.addEventListener("click", function () { openCoin(row.getAttribute("data-open-coin")); });
    });
    $("main").querySelectorAll("[data-bot]").forEach(function (row) {
      row.addEventListener("click", function () { openBot(row.getAttribute("data-bot")); });
    });
  }

  function renderActivity() {
    $("header").innerHTML = "<h1>Activity</h1>";
    const rows = (store.data.activity && store.data.activity.rows) || [];
    if (!rows.length) {
      $("main").innerHTML = '<div class="card"><div class="empty">No activity yet</div></div>';
      return;
    }
    $("main").innerHTML = '<div class="card">' + rows.map(function (r) {
      const title = r.title || "";
      const sub = [r.bot || "", r.subtitle || r.ts || ""].filter(Boolean).join(" · ");
      const kind = (r.kind || "").toLowerCase();
      const go = kind.indexOf("reject") >= 0 || kind.indexOf("audit") >= 0 ? "audit" : "coin";
      return '<div class="act-row" data-go="' + go + '" data-mint="' + esc(r.mint || "") + '"><div class="grow"><div class="name">' +
        esc(title) + '</div><div class="sub">' + esc(sub) + '</div></div><div class="right">' +
        esc(r.value && r.value.indexOf("http") === 0 ? "" : (r.value || "")) +
        (r.coinUrl ? '<div><button class="btn grey" data-url="' + esc(r.coinUrl) + '" style="width:auto;padding:6px 10px;font-size:13px;margin:4px 0 0">Open on FOMO</button></div>' : "") +
        "</div></div>";
    }).join("") + "</div>";
    $("main").querySelectorAll("[data-go]").forEach(function (row) {
      row.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-url]")) return;
        const mint = row.getAttribute("data-mint");
        if (!mint) return;
        if (row.getAttribute("data-go") === "audit") openAudit(mint);
        else openCoin(mint);
      });
    });
    $("main").querySelectorAll("[data-url]").forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); openLink(b.getAttribute("data-url")); });
    });
  }

  function renderAccount() {
    const ac = store.data.account || {};
    const st = (store.data.settings && store.data.settings.settings) || {};
    const mode = ac.mode || "PAPER";
    $("header").innerHTML = "<h1>Account</h1>";
    let html = '<div class="note">Settings, pause, mode, and test pushes go through Telegram (STEP 11). Everything here is read-only.</div>';
    html += '<div class="group">';
    html += '<div class="link-row"><div class="grow"><div class="name">Mode</div></div><div class="right">' +
      (mode === "PAPER" ? '<span class="pill paper">PAPER</span>' : esc(mode)) + "</div></div>";
    html += '<div class="link-row"><div class="grow"><div class="name">Cash</div></div><div class="right">' + esc(money(ac.balance)) + "</div></div>";
    if (ac.profileUrl) {
      html += '<div class="link-row"><div class="grow"><div class="name">Your FOMO profile</div><div class="sub">' +
        esc(ac.fomoHandle || "") + '</div></div><button class="btn grey" data-url="' + esc(ac.profileUrl) +
        '" style="width:auto;padding:8px 12px">Open</button></div>';
    }
    if (ac.signupUrl) {
      html += '<div class="link-row"><div class="grow"><div class="name">Invite a friend</div></div>' +
        '<button class="btn grey" data-invite="' + esc(ac.signupUrl) + '" style="width:auto;padding:8px 12px">Invite</button></div>';
    }
    html += "</div>";
    html += '<div class="group-title">Pushes</div><div class="group">';
    html += '<div class="link-row"><div class="grow"><div class="name">Plan B: Telegram only</div><div class="sub">Web push is off on this hosting plan. The row says so.</div></div></div>';
    html += '<div class="link-row"><div class="grow"><div class="name">Send test push</div></div><button class="btn grey" disabled style="width:auto;padding:8px 12px">Telegram</button></div>';
    html += '<div class="link-row"><div class="grow"><div class="name">Watch in Grok Bot</div><div class="sub">Opens the bot’s own computer preview.</div></div></div>';
    html += "</div>";
    html += '<div class="group-title">Copy picks</div><div class="group"><div class="link-row"><div class="grow"><div class="name">Copy picks</div><div class="sub">Chapter 3 prompt</div></div><div class="right">off</div></div></div>';

    SETTING_GROUPS.forEach(function (pair) {
      const group = pair[0], keys = pair[1];
      html += '<div class="group-title">' + esc(group) + '</div><div class="group">';
      keys.forEach(function (k) {
        if (!(k in st) && k !== "fomo_handle" && k !== "fomo_wallet") return;
        const val = st[k] != null ? st[k] : "";
        html += '<div class="set-row"><div class="grow"><div class="name">' + esc(k) +
          '</div><input disabled value="' + esc(val) + '"' + (isFiniteNumber(val) ? ' type="text"' : "") +
          "></div></div>";
      });
      html += "</div>";
    });
    $("main").innerHTML = html;
    $("main").querySelectorAll("[data-url]").forEach(function (b) {
      b.addEventListener("click", function () { openLink(b.getAttribute("data-url")); });
    });
    $("main").querySelectorAll("[data-invite]").forEach(function (b) {
      b.addEventListener("click", function () { shareOrCopy(b.getAttribute("data-invite"), "Invite a friend"); });
    });
  }

  function isFiniteNumber(v) { return v !== "" && Number.isFinite(Number(v)); }

  async function openCoin(mint) {
    store.screen = "coin";
    store.mint = mint;
    store.tab = "home";
    try { store.data.coin = await getJson("coin/" + mint + ".json"); }
    catch (e) { store.data.coin = { mint: mint, coinUrl: null, error: "no coin file" }; }
    render();
  }

  async function openAudit(mint) {
    store.screen = "audit";
    store.mint = mint;
    try { store.data.audit = await getJson("audit/" + mint + ".json"); }
    catch (e) { store.data.audit = { mint: mint, layers: [], coinUrl: null }; }
    render();
  }

  async function openBot(name) {
    store.screen = "bot";
    store.bot = name;
    try { store.data.bot = await getJson("bots/" + name + ".json"); }
    catch (e) { store.data.bot = { name: name, decisions: [] }; }
    renderBot();
  }

  function renderBot() {
    const b = store.data.bot || {};
    $("header").innerHTML = '<button class="back" id="back">‹ Home</button><h1 style="font-size:22px">' + esc(b.name || "Bot") + "</h1><span></span>";
    $("back").addEventListener("click", function () { store.screen = "home"; render(); });
    const dec = b.decisions || [];
    let html = '<div class="note">Pause is read-only here. Risk is locked while a position is open. Use Telegram (STEP 11) to pause or change settings.</div>';
    if (!dec.length) html += '<div class="card"><div class="empty">No decisions yet</div></div>';
    else {
      html += '<div class="card"><h2>Last 20</h2>' + dec.map(function (d) {
        return '<div class="act-row"><div class="grow"><div class="name">' +
          esc(d.verdict || d.reason || d.status || (d.score != null ? ("score " + d.score) : "decision")) +
          '</div><div class="sub">' + esc((d.mint || "").slice(0, 8) + (d.ts ? " · " + d.ts : "")) +
          "</div></div>" + (d.coinUrl ? '<button class="btn grey" data-url="' + esc(d.coinUrl) +
          '" style="width:auto;padding:6px 10px;font-size:13px">Open on FOMO</button>' : "") + "</div>";
      }).join("") + "</div>";
    }
    $("main").innerHTML = html;
    $("main").querySelectorAll("[data-url]").forEach(function (btn) {
      btn.addEventListener("click", function () { openLink(btn.getAttribute("data-url")); });
    });
  }

  function renderCoin() {
    const c = store.data.coin || {};
    const coin = c.coin || {};
    const name = coin.symbol || coin.name || (c.mint || store.mint || "").slice(0, 8);
    const st = store.data.state || {};
    const paper = (st.mode || "PAPER") === "PAPER";
    $("header").innerHTML = '<button class="back" id="back">‹ Home</button><h1 style="font-size:22px">' +
      esc(name) + (paper ? ' <span class="pill paper">PAPER</span>' : "") + "</h1><span></span>";
    $("back").addEventListener("click", function () { store.screen = "home"; render(); });
    const price = c.price && c.price.price != null ? money(c.price.price) : "—";
    const pos = c.position;
    let html = '<div class="tiles">';
    [["Price", price], ["Holders", (c.price && c.price.holders) != null ? c.price.holders : (coin.holders != null ? coin.holders : "—")],
     ["Liquidity", "—"], ["Volume m5", c.price && c.price.volumeM5 != null ? money(c.price.volumeM5) : "—"]].forEach(function (t) {
      html += '<div class="tile"><div class="k">' + esc(t[0]) + '</div><div class="v">' + esc(t[1]) + "</div></div>";
    });
    html += "</div>";
    if (pos) {
      html += '<div class="card"><h2>Your position</h2><div class="name">Your position · ' +
        money(pos.size_usd) + ' in · Executor</div><div class="sub">entry ' + money(pos.entry_price) +
        " · " + (pos.tokens != null ? Number(pos.tokens).toPrecision(6) : "—") + " tokens</div></div>";
    } else {
      html += '<div class="card"><div class="empty">No open position</div></div>';
    }
    html += '<div class="row-btns">';
    if (c.coinUrl) html += '<button class="btn blue" id="open-fomo">Open on FOMO</button>';
    html += '<button class="btn red" id="sell-now">Sell now</button></div>';
    $("main").innerHTML = html;
    const of = $("open-fomo");
    if (of) of.addEventListener("click", function () { openLink(c.coinUrl); });
    $("sell-now").addEventListener("click", function () { showSellSheet(c); });
  }

  function showSellSheet(c) {
    const bg = el('<div class="sheet-bg"><div class="sheet"><h3>Sell now</h3>' +
      '<button class="btn grey" data-pct="25">25%</button>' +
      '<button class="btn grey" data-pct="50">50%</button>' +
      '<button class="btn red" data-pct="100">100%</button>' +
      '<button class="btn grey" data-cancel="1">Cancel</button>' +
      '<div class="sub" style="margin-top:10px;text-align:center">Confirm sell would tell Executor to click it. On plan B this goes through Telegram (STEP 11) — there is no public POST from the app.</div>' +
      "</div></div>");
    document.body.appendChild(bg);
    bg.addEventListener("click", function (ev) {
      if (ev.target === bg || ev.target.getAttribute("data-cancel")) bg.remove();
      const pctBtn = ev.target.closest("[data-pct]");
      if (!pctBtn) return;
      const pctV = pctBtn.getAttribute("data-pct");
      bg.innerHTML = '<div class="sheet"><h3>Sell ' + esc(pctV) + "% now?</h3>" +
        '<button class="btn red" data-confirm="1">Confirm sell</button>' +
        '<button class="btn grey" data-cancel="1">Cancel</button>' +
        '<div class="sub" style="margin-top:10px;text-align:center">Plan B: Confirm is not sent from this page. Use Telegram (STEP 11).</div></div>';
    });
  }

  function renderAudit() {
    const a = store.data.audit || {};
    $("header").innerHTML = '<button class="back" id="back">‹ Back</button><h1 style="font-size:22px">Audit</h1><span></span>';
    $("back").addEventListener("click", function () { store.screen = "home"; render(); });
    const layers = a.layers || [];
    let html = '<div class="card"><div class="disc-row">';
    for (let i = 1; i <= 8; i++) {
      const L = layers.find(function (x) { return String(x.layer) === String(i); });
      const cls = !L ? "" : (Number(L.pass) === 1 ? "pass" : "fail");
      html += '<div class="disc ' + cls + '"></div>';
    }
    html += '</div></div><div class="card">';
    if (!layers.length) html += '<div class="empty">No audit layers</div>';
    layers.forEach(function (L) {
      html += '<div class="layer"><div class="name">' + esc(L.layer + " · " + (L.name || "")) +
        ' <span class="' + (Number(L.pass) === 1 ? "ok" : "bad") + '">' +
        (Number(L.pass) === 1 ? "✓" : "✕") + '</span></div><div class="sub">' +
        esc(L.value_text || "") + (L.source ? " · " + L.source : "") + "</div></div>";
    });
    html += "</div>";
    if (a.coinUrl) html += '<button class="btn blue" id="open-fomo">Open on FOMO</button>';
    $("main").innerHTML = html;
    const of = $("open-fomo");
    if (of) of.addEventListener("click", function () { openLink(a.coinUrl); });
  }

  document.getElementById("tabs").addEventListener("click", function (ev) {
    const b = ev.target.closest("button[data-tab]");
    if (!b) return;
    store.tab = b.getAttribute("data-tab");
    store.screen = store.tab;
    render();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }


  window.addEventListener("desk-open", function (ev) {
    const d = ev.detail || {};
    if (d.kind === "coin" && d.mint) openCoin(d.mint);
    if (d.kind === "audit" && d.mint) openAudit(d.mint);
  });

  if (!parseSecret()) {
    render();
    return;
  }
  render();
  poll();
  setInterval(poll, POLL_MS);
})();
