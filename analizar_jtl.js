// Resume resultados JMeter (.jtl CSV). Uso: node analizar_jtl.js nf01.jtl [nf02.jtl ...]
const fs = require("fs");

function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}

function load(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => { const v = parseCsvLine(l); const o = {}; h.forEach((k, i) => (o[k] = v[i])); return o; })
    .map((r) => ({ ts: +r.timeStamp, el: +r.elapsed, lat: +r.Latency, label: r.label, code: r.responseCode,
      ok: r.success === "true", threads: +r.allThreads, msg: r.responseMessage }));
}

function stats(rows) {
  const start = Math.min(...rows.map((r) => r.ts)), end = Math.max(...rows.map((r) => r.ts + r.el));
  const els = rows.map((r) => r.el).sort((a, b) => a - b);
  const pct = (p) => els[Math.min(els.length - 1, Math.ceil((p / 100) * els.length) - 1)];
  const err = rows.filter((r) => !r.ok).length;
  return { n: rows.length, thr: rows.length / ((end - start) / 1000), avg: els.reduce((a, b) => a + b, 0) / els.length,
    max: els[els.length - 1], p90: pct(90), p95: pct(95), latAvg: rows.reduce((a, r) => a + r.lat, 0) / rows.length,
    errPct: (100 * err) / rows.length, err, start };
}

function buckets(rows, sec, start) {
  const m = new Map();
  for (const r of rows) { const k = Math.floor((r.ts - start) / (sec * 1000)); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, rs]) => ({
    t: k * sec, n: rs.length, threads: Math.max(...rs.map((r) => r.threads)),
    avg: rs.reduce((a, r) => a + r.el, 0) / rs.length, max: Math.max(...rs.map((r) => r.el)),
    errPct: (100 * rs.filter((r) => !r.ok).length) / rs.length }));
}

for (const file of process.argv.slice(2)) {
  const all = load(file);
  const rows = all.filter((r) => r.label === "GET /tipo-examen");
  const login = all.find((r) => r.label.startsWith("POST /autenticacion"));
  const s = stats(rows);
  console.log(`\n=== ${file} (GET /tipo-examen) ===  login setUp: ${login ? login.code : "no encontrado"}`);
  console.log(`muestras=${s.n} throughput=${s.thr.toFixed(1)} req/s  t.resp prom=${s.avg.toFixed(0)} ms  max=${s.max} ms  p90=${s.p90} p95=${s.p95}  latencia(TTFB) prom=${s.latAvg.toFixed(0)} ms  error=${s.errPct.toFixed(2)}% (${s.err})`);
  const codes = {}; rows.filter((r) => !r.ok).forEach((r) => (codes[r.code + " " + r.msg.slice(0, 60)] = (codes[r.code + " " + r.msg.slice(0, 60)] || 0) + 1));
  if (Object.keys(codes).length) console.log("errores por tipo:", codes);
  const b = buckets(rows, file.includes("03") ? 5 : 10, s.start);
  console.log("t(s)  hilos  n     prom(ms) max(ms) err%");
  b.forEach((x) => console.log(`${String(x.t).padStart(4)}  ${String(x.threads).padStart(5)}  ${String(x.n).padStart(5)} ${x.avg.toFixed(0).padStart(8)} ${String(x.max).padStart(7)} ${x.errPct.toFixed(1).padStart(5)}`));
  const first = b.find((x) => x.errPct > 5);
  console.log(first ? `>> primer intervalo con error > 5%: t=${first.t}s con ${first.threads} hilos activos` : ">> ningún intervalo supera 5% de error");
}
