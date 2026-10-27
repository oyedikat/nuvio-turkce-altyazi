// Türkçe Altyazı - Nuvio / Stremio eklentisi
// Kaynaklar: turkcealtyazi.org (subTR kütüphanesi ile) + OpenSubtitles v3 (yedek)
// Gereksinim: Node.js 18+  |  Kurulum: npm install  |  Çalıştır: npm start

import http from "node:http";
import { search, download } from "subtr";

const PORT = process.env.PORT || 7000;
const PUBLIC_URL = process.env.PUBLIC_URL; // örn. https://benim-eklenti.onrender.com
const OS_SOURCE = "https://opensubtitles-v3.strem.io";
const MAX_TCA = 10;

const manifest = {
  id: "community.turkce.altyazi",
  version: "2.0.0",
  name: "Türkçe Altyazı",
  description: "turkcealtyazi.org ve OpenSubtitles'tan Türkçe altyazılar.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};
const json = { ...cors, "Content-Type": "application/json; charset=utf-8" };

// Basit önbellek
const cache = new Map();
function remember(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { t: Date.now(), p });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return p;
}

async function fromTurkceAltyazi(type, rawId, base) {
  const [imdbId, season, episode] = decodeURIComponent(rawId).split(":");
  let list = await remember(`tca:${imdbId}`, 10 * 60e3, () => search({ imdbId }));
  if (type === "series") {
    list = list.filter(
      (s) => Number(s.season) === Number(season) && Number(s.episode) === Number(episode)
    );
  }
  return list.slice(0, MAX_TCA).map((s) => ({
    id: `TCA-${s.release || "altyazi"}-${s.fps || ""}fps-${s.id}`,
    url: `${base}/srt/${s.id}.srt?u=${encodeURIComponent(s.url || "")}`,
    lang: "tur",
  }));
}

async function fromOpenSubtitles(type, rawId, rawExtra) {
  const url = `${OS_SOURCE}/subtitles/${type}/${rawId}${rawExtra ? "/" + rawExtra : ""}.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OpenSubtitles: ${res.status}`);
  const data = await res.json();
  return (data.subtitles || [])
    .filter((s) => /^(tur|tr)/i.test(s.lang || ""))
    .map((s, i) => ({ id: `OS-${s.id ?? i}`, url: s.url, lang: "tur" }));
}

const server = http.createServer(async (req, res) => {
  const [path, query = ""] = req.url.split("?");
  const base =
    PUBLIC_URL || `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }

  if (path === "/manifest.json") {
    res.writeHead(200, json);
    return res.end(JSON.stringify(manifest));
  }

  const sub = path.match(/^\/subtitles\/(movie|series)\/([^/]+?)(?:\/([^/]+?))?\.json$/);
  if (sub) {
    const [, type, rawId, rawExtra] = sub;
    const results = await Promise.allSettled([
      fromTurkceAltyazi(type, rawId, base),
      fromOpenSubtitles(type, rawId, rawExtra),
    ]);
    results.forEach((r) => r.status === "rejected" && console.error(r.reason?.message));
    const subtitles = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    res.writeHead(200, json);
    return res.end(JSON.stringify({ subtitles }));
  }

  // Altyazıyı indirip UTF-8 SRT olarak sun
  const srt = path.match(/^\/srt\/(\d+)\.srt$/);
  if (srt) {
    try {
      const u = new URLSearchParams(query).get("u") || undefined;
      const { srt: text } = await remember(`srt:${srt[1]}`, 30 * 60e3, () =>
        download(srt[1], u)
      );
      res.writeHead(200, { ...cors, "Content-Type": "application/x-subrip; charset=utf-8" });
      return res.end(text);
    } catch (err) {
      console.error("İndirme hatası:", err.message);
      res.writeHead(502, cors);
      return res.end("Altyazı indirilemedi");
    }
  }

  if (path === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(
      `<h2>Türkçe Altyazı</h2><p>Nuvio'da eklenti URL'si:</p><code>${base}/manifest.json</code>`
    );
  }

  res.writeHead(404, json);
  res.end(JSON.stringify({ error: "Bulunamadı" }));
});

server.listen(PORT, () => console.log(`Çalışıyor: http://localhost:${PORT}/manifest.json`));
