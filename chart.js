/* Hand-drawn equity chart on a <canvas>. Not a charting library. */
(function (global) {
  const GREEN = "#00d35a";
  const BLUE = "#0a84ff";
  const RED = "#ff453a";

  function xOf(i, n, w, pad) {
    if (n <= 1) return pad + (w - pad * 2) / 2;
    return pad + (i / (n - 1)) * (w - pad * 2);
  }

  function yOf(v, min, max, h, padT, padB) {
    const span = max - min || 1;
    const usable = h - padT - padB;
    return padT + (1 - (v - min) / span) * usable;
  }

  function drawChart(canvas, chart, range) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 358;
    const h = canvas.clientHeight || 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pack = (chart && (chart[range] || chart.ranges && chart.ranges[range])) || chart;
    const points = (pack && pack.points) || [];
    const marks = (pack && pack.marks) || [];

    if (!points.length) {
      ctx.fillStyle = "#8e8e93";
      ctx.font = "15px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No prices yet", w / 2, h / 2);
      return;
    }

    const vals = points.map((p) => Number(p.price)).filter((n) => Number.isFinite(n));
    if (!vals.length) {
      ctx.fillStyle = "#8e8e93";
      ctx.font = "15px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No prices yet", w / 2, h / 2);
      return;
    }
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const pad = 8, padT = 28, padB = 16;

    // dashed start line (first price)
    const y0 = yOf(vals[0], min, max, h, padT, padB);
    ctx.save();
    ctx.strokeStyle = "rgba(142,142,147,0.7)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y0);
    ctx.lineTo(w - pad, y0);
    ctx.stroke();
    ctx.restore();

    const path = new Path2D();
    points.forEach((p, i) => {
      const x = xOf(i, points.length, w, pad);
      const y = yOf(Number(p.price), min, max, h, padT, padB);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });

    const lastX = xOf(points.length - 1, points.length, w, pad);
    const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
    grad.addColorStop(0, "rgba(0,211,90,0.35)");
    grad.addColorStop(1, "rgba(0,211,90,0)");
    ctx.beginPath();
    ctx.add(path);
    const firstX = xOf(0, points.length, w, pad);
    ctx.lineTo(lastX, h - padB);
    ctx.lineTo(firstX, h - padB);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(path);

    // Marks above the line. A later mark moves up a row, never overlaps.
    const rowH = 14;
    const placed = [];
    marks.forEach((m, idx) => {
      const ts = m.ts;
      let i = points.findIndex((p) => p.ts >= ts);
      if (i < 0) i = points.length - 1;
      const x = xOf(i, points.length, w, pad);
      const y = yOf(Number(points[i].price), min, max, h, padT, padB);
      let label = "";
      let color = BLUE;
      const side = (m.side || "").toLowerCase();
      const status = (m.status || "").toLowerCase();
      if (side === "buy") {
        label = "Bought " + (m.mint ? m.mint.slice(0, 4) : "");
        color = BLUE;
      } else if (status.indexOf("stop") >= 0 || (m.reason && String(m.reason).indexOf("stop") >= 0)) {
        label = "-25% · -$N";
        if (m.usd != null) label = "-25% · -$" + Math.abs(Number(m.usd)).toFixed(0);
        color = RED;
      } else if (side === "sell") {
        if (m.usd != null) label = "+$" + Number(m.usd).toFixed(0);
        else label = "Sold";
        color = GREEN;
      } else {
        label = m.status || side || "·";
      }
      let row = 0;
      const twGuess = label.length * 6;
      for (;;) {
        const top = y - 16 - row * rowH;
        const clash = placed.some((q) => Math.abs(q.x - x) < twGuess && q.row === row);
        if (!clash) break;
        row += 1;
      }
      placed.push({ x, row });
      ctx.fillStyle = color;
      ctx.font = "600 11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x, y - 16 - row * rowH);
    });
  }

  // Path2D.add is not standard; use a fallback stroke/fill from points if needed.
  const _orig = drawChart;
  function drawChartSafe(canvas, chart, range) {
    try {
      _orig(canvas, chart, range);
    } catch (err) {
      // Fallback without Path2D.add
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 358;
      const h = canvas.clientHeight || 200;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  global.DeskChart = { draw: function (canvas, chart, range) {
    if (!canvas) return;
    // Reimplement fill+stroke without Path2D.add for Safari.
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 358;
    const h = canvas.clientHeight || 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pack = (chart && (chart[range] || (chart.ranges && chart.ranges[range]))) || chart || {};
    const points = pack.points || [];
    const marks = pack.marks || [];
    if (!points.length) {
      ctx.fillStyle = "#8e8e93";
      ctx.font = "15px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No prices yet", w / 2, h / 2);
      return;
    }
    const vals = points.map((p) => Number(p.price)).filter((n) => Number.isFinite(n));
    if (!vals.length) {
      ctx.fillStyle = "#8e8e93";
      ctx.font = "15px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No prices yet", w / 2, h / 2);
      return;
    }
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const pad = 8, padT = 28, padB = 16;
    function X(i) { return xOf(i, points.length, w, pad); }
    function Y(v) { return yOf(v, min, max, h, padT, padB); }
    const y0 = Y(vals[0]);
    ctx.save();
    ctx.strokeStyle = "rgba(142,142,147,0.7)";
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
      const ts = m.ts;
      let i = points.findIndex((p) => p.ts >= ts);
      if (i < 0) i = points.length - 1;
      const x = X(i);
      const y = Y(Number(points[i].price));
      let label = "", color = BLUE;
      const side = (m.side || "").toLowerCase();
      const reason = String(m.reason || m.status || "");
      if (side === "buy") { label = "Bought " + (m.mint ? m.mint.slice(0, 4) : ""); color = BLUE; }
      else if (/stop/i.test(reason)) {
        label = m.usd != null ? ("-25% · -$" + Math.abs(Number(m.usd)).toFixed(0)) : "-25% · -$N";
        color = RED;
      } else if (side === "sell") {
        label = m.usd != null ? ("+$" + Number(m.usd).toFixed(0)) : "Sold";
        color = GREEN;
      } else label = reason || "·";
      let row = 0;
      const tw = Math.max(40, label.length * 6);
      while (placed.some((q) => Math.abs(q.x - x) < tw && q.row === row)) row += 1;
      placed.push({ x, row });
      ctx.fillStyle = color;
      ctx.font = "600 11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, Math.min(w - 4, Math.max(4, x)), y - 16 - row * rowH);
    });
  } };
})(window);
