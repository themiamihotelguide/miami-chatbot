// File: api/places.js
// Accurate Wynwood results (street-level addresses)
// POST: { "query": "tacos", "type": "restaurant", "limit": 5 }
// Requires: GOOGLE_MAPS_API_KEY (billing ON)

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

    // Wynwood center (near Wynwood Walls)
    const center = { lat: 25.8009, lng: -80.1997 };
    const maxMeters = 1300; // ~0.8 mi

    // Haversine distance
    const toRad = d => d * Math.PI / 180;
    function distMeters(a, b) {
      const R = 6371000;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const la1  = toRad(a.lat);
      const la2  = toRad(b.lat);
      const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
      return 2 * R * Math.asin(Math.sqrt(x));
    }

    // Bias search to Wynwood specifically
    const search = (query && query.trim())
      ? `${query.trim()} in Wynwood Miami`
      : (type ? `${type} in Wynwood Miami` : "Wynwood Miami");

    // TEXT SEARCH (topic-biased) + open now
    const tsParams = new URLSearchParams({
      key: API_KEY,
      query: search,
      location: `${center.lat},${center.lng}`,
      radius: "1500",
      opennow: "true",
      region: "us"
    });
    if (type) tsParams.set("type", type);

    const textURL = `https://maps.googleapis.com/maps/api/place/textsearch/json?${tsParams.toString()}`;
    const tsr = await fetch(textURL);
    const tsj = await tsr.json();
    if (tsj.status !== "OK" && tsj.status !== "ZERO_RESULTS") {
      return res.status(200).json({ results: [], status: tsj.status || "ERROR", error_message: tsj.error_message || null });
    }

    // Helpers
    function buildStreet(components) {
      if (!components) return "";
      const get = t => (components.find(c => c.types.includes(t)) || {}).long_name || "";
      const num   = get("street_number");
      const route = get("route");
      const city  = get("locality") || get("sublocality") || get("postal_town") || "Miami";
      const st    = get("administrative_area_level_1") || "FL";
      const zip   = get("postal_code") || "";
      const line1 = [num, route].filter(Boolean).join(" ");
      const line2 = [city, st].filter(Boolean).join(", ") + (zip ? ` ${zip}` : "");
      return line1 && line2 ? `${line1}, ${line2}` : (route ? `${route}, ${line2}` : line2);
    }
    async function placeDetails(place_id) {
      const fields = [
        "name","business_status","place_id","rating","user_ratings_total",
        "geometry","address_components","formatted_address","website"
      ].join("%2C");
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&fields=${fields}&key=${API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      return j?.result || null;
    }
    async function reverseStreet(lat, lng) {
      const gURL = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}&result_type=street_address`;
      const r = await fetch(gURL);
      const j = await r.json();
      return j?.results?.[0]?.formatted_address || "";
    }

    const candidates = (tsj.results || []).slice(0, Math.max(limit * 3, 12));
    const out = [];

    for (const p of candidates) {
      try {
        const pid = p.place_id;
        if (!pid) continue;

        const det = await placeDetails(pid);
        if (!det) continue;
        if (det.business_status && det.business_status !== "OPERATIONAL") continue;

        const geo = det.geometry?.location || p.geometry?.location;
        if (!geo) continue;

        const meters = distMeters(center, { lat: geo.lat, lng: geo.lng });
        if (meters > maxMeters) continue;

        // Build precise street address (components first, then reverse geocode if needed)
        let addr = buildStreet(det.address_components);
        if (!addr || !/\d/.test(addr)) {
          const rev = await reverseStreet(geo.lat, geo.lng);
          if (rev) addr = rev;
        }
        if (!addr) addr = det.formatted_address || ""; // last resort

        out.push({
          name: det.name || p.name || "",
          address: addr, // precise street address only
          rating: det.rating ?? p.rating ?? null,
          user_ratings_total: det.user_ratings_total ?? p.user_ratings_total ?? null,
          place_id: det.place_id || pid,
          maps_url: `https://www.google.com/maps/place/?q=place_id:${det.place_id || pid}`,
          website: det.website || null,
          distance_m: Math.round(meters),
          distance_mi: +(meters / 1609.344).toFixed(2)
        });

        if (out.length >= limit) break;
      } catch {
        // skip bad entries
      }
    }

    return res.status(200).json({ results: out, status: "OK" });
  } catch (e) {
    return res.status(200).json({ results: [], status: "ERROR", error: String(e) });
  }
}


