// Türkçe Altyazı - Nuvio / Stremio eklentisi
// Kaynak: turkcealtyazi.org (subTR kütüphanesi ile)
// Gereksinim: Node.js 18+  |  Kurulum: npm install  |  Çalıştır: npm start

import http from "node:http";
import { search, download } from "subtr";

const PORT = process.env.PORT || 7000;
const PUBLIC_URL = process.env.PUBLIC_URL; // örn. https://benim-eklenti.onrender.com
const MAX_RESULTS = 15;

const manifest = {
  id: "community.turkce.altyazi",
  version: "2.1.0",
  name: "Türkçe Altyazı",
  description: "turkcealtyazi.org'dan Türkçe altyazılar.",
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
  const total = list.length;
  if (type === "series") {
    list = list.filter(
      (s) => Number(s.season) === Number(season) && Number(s.episode) === Number(episode)
    );
  }
  console.log(`[TCA] ${imdbId} s${season ?? "-"}e${episode ?? "-"}: ${total} sonuç, ${list.length} eşleşti`);
  return list.slice(0, MAX_RESULTS).map((s) => {
    const label = `TCA · ${s.release || "altyazı"}${s.fps ? " · " + s.fps + " fps" : ""}`;
    return {
      id: `TCA-${s.id}`,
      url: `${base}/srt/${s.id}.srt?u=${encodeURIComponent(s.url || "")}`,
      lang: "tur",
      // Bazı oynatıcılar başlık için bu alanlardan birini kullanır
      title: label,
      name: label,
      label,
    };
  });
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
    let subtitles = [];
    try {
      subtitles = await fromTurkceAltyazi(sub[1], sub[2], base);
    } catch (err) {
      console.error("[TCA] hata:", err.message);
    }
    res.writeHead(200, json);
    return res.end(JSON.stringify({ subtitles }));
  }

  // Tanı sayfası: /debug/tt2861424  (siteye erişilebiliyor mu?)
  const dbg = path.match(/^\/debug\/(tt\d+)$/);
  if (dbg) {
    const out = { imdbId: dbg[1], node: process.version };
    try {
      const list = await search({ imdbId: dbg[1] });
      out.ok = true;
      out.count = list.length;
      out.ornek = list.slice(0, 3);
    } catch (err) {
      out.ok = false;
      out.hata = err.message;
      out.neden = err.cause?.message || err.cause?.code || null;
    }
    res.writeHead(200, json);
    return res.end(JSON.stringify(out, null, 2));
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
