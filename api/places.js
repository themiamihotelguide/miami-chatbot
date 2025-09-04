// File: api/places.js
// POST body: { "query": "tacos", "type": "restaurant", "limit": 5 }
// Requires Vercel env var: GOOGLE_MAPS_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    // Support both edge (req.json) and node (req.body)
    let body = {};
    try { body = await req.json?.(); } catch {}
    if (!body || Object.keys(body).length === 0) body = req.body || {};

    const { query = "", type = "", limit = 5 } = body;
    const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!API_KEY) return res.status(500).json({ results: [], status: "NO_API_KEY" });

    // Wynwood center coordinates
    const lat = 25.8009;
    const lng = -80.1997;
    const radius = 1500; // meters (~0.9 miles)

    const params = new URLSearchParams({
      key: API_KEY,
      location: `${lat},${lng}`,
      radius: String(radius),
      opennow: "true"
    });

    // Prefer a specific type if provided; otherwise use the keyword query.
    // Common types: restaurant, bar, cafe, night_club, meal_takeaway, bakery, etc.
    if (type) params.set("type", type);
    const keyword = (query || "").trim();
    if (keyword) params.set("keyword", keyword);

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    const r = await fetch(url);
    const j = await r.json();

    if (j.status !== "OK" && j.status !== "ZERO_RESULTS") {
      return res.status(200).json({ results: [], status: j.status || "ERROR" });
    }

    const out = (j.results || []).slice(0, limit).map(p => ({
      name: p.name,
      address: p.vicinity || p.formatted_address || "",
      rating: p.rating ?? null,
      user_ratings_total: p.user_ratings_total ?? null,
      types: p.types || [],
      price_level: p.price_level ?? null,
      place_id: p.place_id,
      maps_url: `https://www.google.com/maps/place/?q=place_id:${p.place_id}`
    }));

    return res.status(200).json({ results: out, status: "OK" });
  } catch (e) {
    return res.status(200).json({ results: [], status: "ERROR", error: String(e) });
  }
}
