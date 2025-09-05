// File: api/places.js
// POST body: { "query": "tacos", "type": "restaurant", "limit": 5 }
// Requires Vercel env var: GOOGLE_MAPS_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    let body = {};
    try { body = await req.json?.(); } catch {}
    if (!body || Object.keys(body).length === 0) body = req.body || {};

    const { query = "", type = "", limit = 5 } = body;
    const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!API_KEY) return res.status(500).json({ results: [], status: "NO_API_KEY" });

    // Wynwood center point
    const lat = 25.8009, lng = -80.1997;
    const radius = 1500; // meters

    const params = new URLSearchParams({
      key: API_KEY,
      location: `${lat},${lng}`,
      radius: String(radius),
      opennow: "true"
    });
    if (type) params.set("type", type);
    const keyword = (query || "").trim();
    if (keyword) params.set("keyword", keyword);

    const nearbyURL = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    const r = await fetch(nearbyURL);
    const j = await r.json();

    if (j.status !== "OK" && j.status !== "ZERO_RESULTS") {
      return res.status(200).json({
        results: [],
        status: j.status || "ERROR",
        error_message: j.error_message || null
      });
    }

    const base = (j.results || []).slice(0, limit);

    // Fetch Place Details for accurate formatted_address (+ website/phone if you want)
    const detailPromises = base.map(async (p) => {
      try {
        const fields = [
          "name",
          "formatted_address",
          "vicinity",
          "place_id",
          "rating",
          "user_ratings_total",
          "website" // optional: comment out if you don't want website
        ].join("%2C");
        const detailsURL =
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(p.place_id)}&fields=${fields}&key=${API_KEY}`;
        const dr = await fetch(detailsURL);
        const dj = await dr.json();

        const d = (dj && dj.result) ? dj.result : {};
        return {
          name: d.name || p.name || "",
          address: d.formatted_address || p.vicinity || "",
          rating: d.rating ?? p.rating ?? null,
          user_ratings_total: d.user_ratings_total ?? p.user_ratings_total ?? null,
          place_id: d.place_id || p.place_id,
          maps_url: `https://www.google.com/maps/place/?q=place_id:${d.place_id || p.place_id}`,
          website: d.website || null
        };
      } catch {
        return {
          name: p.name || "",
          address: p.vicinity || "",
          rating: p.rating ?? null,
          user_ratings_total: p.user_ratings_total ?? null,
          place_id: p.place_id,
          maps_url: `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
          website: null
        };
      }
    });

    const results = await Promise.all(detailPromises);

    return res.status(200).json({ results, status: "OK" });
  } catch (e) {
    return res.status(200).json({ results: [], status: "ERROR", error: String(e) });
  }
}
