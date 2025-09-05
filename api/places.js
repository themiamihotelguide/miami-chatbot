// File: api/places.js
// POST body: { "query": "tacos", "type": "restaurant", "limit": 5 }
// Requires env var: GOOGLE_MAPS_API_KEY

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

    // Wynwood center (roughly Wynwood Walls)
    const center = { lat: 25.8009, lng: -80.1997 };
    const maxMeters = 1300; // hard cap ~0.8 miles

    // Build Nearby Search with rankby=distance (requires location + keyword/type, no radius)
    const params = new URLSearchParams({
      key: API_KEY,
      location: `${center.lat},${center.lng}`,
      rankby: "distance",
      opennow: "true"
    });
    if (type) params.set("type", type);
    if (query && !type) params.set("keyword", query.trim());

    const nearbyURL = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    const nr = await fetch(nearbyURL);
    const nj = await nr.json();

    if (nj.status !== "OK" && nj.status !== "ZERO_RESULTS") {
      return res.status(200).json({
        results: [],
        status: nj.status || "ERROR",
        error_message: nj.error_message || null
      });
    }

    // Haversine distance
    function distMeters(a, b) {
      const toRad = d => d * Math.PI / 180;
      const R = 6371000;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const la1 = toRad(a.lat);
      const la2 = toRad(b.lat);
      const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
      return 2 * R * Math.asin(Math.sqrt(x));
    }

    const base = (nj.results || [])
      .slice(0, Math.max(limit * 2, 10)); // over-fetch then filter

    const details = await Promise.all(base.map(async (p) => {
      try {
        // quick distance gate using Nearby geometry (if absent, we’ll compute after Details)
        const pLoc = p.geometry && p.geometry.location
          ? { lat: p.geometry.location.lat, lng: p.geometry.location.lng }
          : null;

        const fields = [
          "name",
          "formatted_address",
          "place_id",
          "business_status",
          "rating",
          "user_ratings_total",
          "website",
          "geometry"
        ].join("%2C");

        const detailsURL =
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(p.place_id)}&fields=${fields}&key=${API_KEY}`;
        const dr = await fetch(detailsURL);
        const dj = await dr.json();
        const d = (dj && dj.result) ? dj.result : {};

        if (d.business_status && d.business_status !== "OPERATIONAL") return null;

        const geo = d.geometry && d.geometry.location
          ? { lat: d.geometry.location.lat, lng: d.geometry.location.lng }
          : pLoc;

        if (!geo) return null;

        const meters = distMeters(center, geo);
        if (meters > maxMeters) return null;

        return {
          name: d.name || p.name || "",
          address: d.formatted_address || "",
          rating: d.rating ?? p.rating ?? null,
          user_ratings_total: d.user_ratings_total ?? p.user_ratings_total ?? null,
          place_id: d.place_id || p.place_id,
          maps_url: `https://www.google.com/maps/place/?q=place_id:${d.place_id || p.place_id}`,
          website: d.website || null,
          distance_m: Math.round(meters),
          distance_mi: +(meters / 1609.344).toFixed(2)
        };
      } catch {
        return null;
      }
    }));

    const cleaned = details
      .filter(Boolean)
      .slice(0, limit);

    return res.status(200).json({ results: cleaned, status: "OK" });
  } catch (e) {
    return res.status(200).json({ results: [], status: "ERROR", error: String(e) });
  }
}
