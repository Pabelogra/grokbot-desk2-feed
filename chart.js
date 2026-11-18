/* Hand-drawn equity chart on a <canvas>. Not a charting library. */
(function (global) {
  const GREEN = "#00d35a";
  const BLUE = "#0a84ff";
  const RED = "#ff453a";
  const prevByRange = {};
  let animTimer = 0;

  function reduceMotion() {
    return global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function xOf(i, n, w, pad) {
    if (n <= 1) return pad + (w - pad * 2) / 2;
    return pad + (i / (n - 1)) * (w - pad * 2);
  }

  function yOf(v, min, max, h, padT, padB) {
    const span = max - min || 1;
    const usable = h - padT - padB;
    return padT + (1 - (v - min) / span) * usable;
  }

  function packOf(chart, range) {
    return (chart && (chart[range] || (chart.ranges && chart.ranges[range]))) || chart || {};
  }

  function markLabel(m) {
    if (m.label) return { label: m.label, color: m.color || BLUE };
    const side = (m.side || "").toLowerCase();
    const reason = String(m.reason || m.status || "");
    const stopPct = m.stopPct != null ? Number(m.stopPct) : null;
    const pnl = m.pnl != null ? Number(m.pnl) : (m.usd != null && side !== "buy" ? Number(m.usd) : null);
    const x = m.symbol || (m.mint ? String(m.mint).slice(0, 6) : "");
    if (side === "buy") return { label: "Bought " + x, color: BLUE };
    if (/stop/i.test(reason) || (m.bot || "").toLowerCase() === "risk") {
      const pct = Number.isFinite(stopPct) ? stopPct : null;
      const head = pct != null ? ("-" + Math.abs(pct).toString().replace(/\.0$/, "") + "%") : null;
      const tail = Number.isFinite(pnl) ? ("-$" + Math.abs(pnl).toFixed(0)) : null;
      let label = [head, tail].filter(Boolean).join(" · ");
      if (!label) label = "Stopped";
      return { label: label, color: RED };
    }
    if (side === "sell") {
      if (Number.isFinite(pnl)) {
        const sign = pnl >= 0 ? "+$" : "-$";
        return { label: sign + Math.abs(pnl).toFixed(0), color: GREEN };
      }
      return { label: "Sold", color: GREEN };
    }
    return { label: reason || side || "", color: BLUE };
  }

  function paint(canvas, points, marks, slideT) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 358;
    const h = canvas.clientHeight || 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!points.length) return;

    const vals = points.map((p) => Number(p.price)).filter((n) => Number.isFinite(n));
    if (!vals.length) return;
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const pad = 8, padT = 28, padB = 16;
    const n = points.length;
    function X(i) {
      if (slideT != null && n >= 2 && i === n - 1) {
        const from = xOf(n - 2, n - 1, w, pad);
        const to = xOf(n - 1, n, w, pad);
        return from + (to - from) * slideT;
      }
      const count = slideT != null && n >= 2 ? n - 1 + slideT : n;
      if (n <= 1) return xOf(i, n, w, pad);
      // During the slide, earlier points sit on the n-point scale already? Keep final x for 0..n-2.
      return xOf(i, n, w, pad);
    }
    function Y(v) { return yOf(v, min, max, h, padT, padB); }

    const y0 = Y(vals[0]);
    ctx.save();
    ctx.strokeStyle = "rgba(235,235,245,0.3)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y0);
    ctx.lineTo(w - pad, y0);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    points.forEach((p, i) => {
      const y = Y(Number(p.price));
      if (i === 0) ctx.moveTo(X(i), y);
      else ctx.lineTo(X(i), y);
    });
    ctx.lineTo(X(points.length - 1), h - padB);
    ctx.lineTo(X(0), h - padB);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
    grad.addColorStop(0, "rgba(0,211,90,0.35)");
    grad.addColorStop(1, "rgba(0,211,90,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) => {
      const y = Y(Number(p.price));
      if (i === 0) ctx.moveTo(X(i), y);
      else ctx.lineTo(X(i), y);
    });
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const rowH = 14;
    const placed = [];
    marks.forEach((m) => {
      const info = markLabel(m);
      if (!info.label) return;
      const ts = m.ts;
      let i = points.findIndex((p) => p.ts >= ts);
      if (i < 0) i = points.length - 1;
      const x = X(i);
      const y = Y(Number(points[i].price));
      let row = 0;
      const tw = Math.max(40, info.label.length * 6);
      while (placed.some((q) => Math.abs(q.x - x) < tw && q.row === row)) row += 1;
      placed.push({ x: x, row: row });
      ctx.fillStyle = info.color;
      ctx.font = "600 11px -apple-system, 'SF Pro Text', sans-serif";
      ctx.textAlign = "center";
      const tx = Math.min(w - 4, Math.max(4, x));
      ctx.fillText(info.label, tx, y - 16 - row * rowH);
    });
  }

  function interpolateLast(prev, next, t) {
    const keep = next.slice(0, -1);
    const a = prev[prev.length - 1];
    const b = next[next.length - 1];
    const price = Number(a.price) + (Number(b.price) - Number(a.price)) * t;
    return keep.concat([{ ts: b.ts, price: price }]);
  }

  global.DeskChart = {
    draw: function (canvas, chart, range) {
      if (!canvas) return;
      const pack = packOf(chart, range);
      const points = pack.points || [];
      const marks = pack.marks || [];
      const key = range || "LIVE";
      const prev = prevByRange[key];
      const canSlide = !reduceMotion() && prev && points.length === prev.length + 1 && points.length >= 2;
      if (animTimer) {
        cancelAnimationFrame(animTimer);
        animTimer = 0;
      }
      if (canSlide) {
        const start = performance.now();
        function frame(now) {
          const t = Math.min(1, (now - start) / 250);
          const eased = 1 - Math.pow(1 - t, 2);
          paint(canvas, interpolateLast(prev, points, eased), marks, eased);
          if (t < 1) animTimer = requestAnimationFrame(frame);
          else prevByRange[key] = points.slice();
        }
        animTimer = requestAnimationFrame(frame);
      } else {
        paint(canvas, points, marks, null);
        prevByRange[key] = points.slice();
      }
    },
    drawCandles: function (canvas, candles, opts) {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 358;
      const h = canvas.clientHeight || 180;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const rows = (candles || []).filter((c) => Number.isFinite(Number(c.close)));
      if (!rows.length) return;
      const exit = opts && opts.exitPrice != null ? Number(opts.exitPrice) : null;
      let lo = Math.min.apply(null, rows.map((c) => Number(c.low != null ? c.low : c.close)));
      let hi = Math.max.apply(null, rows.map((c) => Number(c.high != null ? c.high : c.close)));
      if (Number.isFinite(exit)) {
        lo = Math.min(lo, exit);
        hi = Math.max(hi, exit);
      }
      const pad = 8, padT = 10, padB = 10;
      const span = hi - lo || 1;
      const Y = (v) => padT + (1 - (v - lo) / span) * (h - padT - padB);
      const n = rows.length;
      const slot = (w - pad * 2) / n;
      if (Number.isFinite(exit)) {
        ctx.save();
        ctx.strokeStyle = "#ff9f0a";
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pad, Y(exit));
        ctx.lineTo(w - pad, Y(exit));
        ctx.stroke();
        ctx.restore();
      }
      rows.forEach((c, i) => {
        const o = Number(c.open != null ? c.open : c.close);
        const cl = Number(c.close);
        const high = Number(c.high != null ? c.high : cl);
        const low = Number(c.low != null ? c.low : cl);
        const up = cl >= o;
        const x = pad + slot * i + slot / 2;
        const bw = Math.max(3, slot * 0.55);
        ctx.strokeStyle = up ? "#00d35a" : "#ff453a";
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, Y(high));
        ctx.lineTo(x, Y(low));
        ctx.stroke();
        const top = Y(Math.max(o, cl));
        const bot = Y(Math.min(o, cl));
        ctx.fillRect(x - bw / 2, top, bw, Math.max(1, bot - top));
      });
    }
  };
})(window);
