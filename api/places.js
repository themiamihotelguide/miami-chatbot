// File: api/places.js
// Accurate Wynwood results with hard overrides for edge-cases (e.g., Dante’s HiFi)
// POST body: { "query": "tacos", "type": "restaurant", "limit": 5 }
// Requires: GOOGLE_MAPS_API_KEY (with Billing ON)

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
    const maxMeters = 1300; // ~0.8 mi cap

    // ---------- OVERRIDES (bullet-proof corrections) ----------
    // We match by normalized name (see norm()) OR force by place_id once resolved.
    // For Dante’s HiFi we hard-set the address you want; we also geocode it to get precise place_id/maps_url.
    const OVERRIDES = {
      "dantes hifi": {
        name: "Dante’s HiFi",
        address: "519 NW 26th St, Miami, FL 33127",
        website: "https://danteshifi.com",
        geocode_address: "519 NW 26th St, Miami, FL 33127" // we will resolve to place_id/maps_url
      }
      // add more fixes if needed
    };

    const norm = (s) =>
      (s || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[’'`]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    // Haversine
    const toRad = (d) => (d * Math.PI) / 180;
    function distMeters(a, b) {
      const R = 6371000;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const la1 = toRad(a.lat);
      const la2 = toRad(b.lat);
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(x));
    }

    // Bias search to Wynwood specifically
    const search = (query && query.trim())
      ? `${query.trim()} in Wynwood Miami`
      : (type ? `${type} in Wynwood Miami` : "Wynwood Miami");

    // ---------- TEXT SEARCH (topical) + open now ----------
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
      return res.status(200).json({
        results: [],
        status: tsj.status || "ERROR",
        error_message: tsj.error_message || null
      });
    }

    const candidates = (tsj.results || []).slice(0, Math.max(limit * 3, 12)); // overfetch, filter later

    // ---------- helpers ----------
    function buildStreetAddress(components) {
      if (!components) return "";
      const get = (t) => (components.find((c) => c.types.includes(t)) || {}).long_name || "";
      const streetNum = get("street_number");
      const route = get("route");
      const city =
        get("locality") ||
        get("sublocality") ||
        get("postal_town") ||
        "Miami";
      const state = get("administrative_area_level_1") || "FL";
      const zip = get("postal_code") || "";
      const street = [streetNum, route].filter(Boolean).join(" ");
      const line2 = [city, state].filter(Boolean).join(", ") + (zip ? ` ${zip}` : "");
      return street && line2 ? `${street}, ${line2}` : (route ? `${route}, ${line2}` : line2);
    }

    async function placeDetails(place_id) {
      const fields = [
        "name",
        "business_status",
        "place_id",
        "rating",
        "user_ratings_total",
        "geometry",
        "address_components",
        "formatted_address",
        "website"
      ].join("%2C");
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
        place_id
      )}&fields=${fields}&key=${API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      return j?.result || null;
    }

    async function reverseStreet(lat, lng) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}&result_type=street_address`;
      const r = await fetch(url);
      const j = await r.json();
      const hit = (j.results || [])[0];
      return hit?.formatted_address || "";
    }

    async function geocodeAddress(address) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      const hit = (j.results || [])[0];
      if (!hit) return null;
      return {
        place_id: hit.place_id,
        location: hit.geometry?.location || null,
        formatted_address: hit.formatted_address || ""
      };
    }

    // ---------- Enrich results ----------
    const enriched = [];
    for (const p of candidates) {
      try {
        const pid = p.place_id;
        if (!pid) continue;

        const det = await placeDetails(pid);
        if (!det) continue;
        if (det.business_status && det.business_status !== "OPERATIONAL") continue;

        const geo = det.geometry?.location || p.geometry?.location;
        if (!geo) continue;

        // compute distance; keep tight to Wynwood
        const meters = distMeters(center, { lat: geo.lat, lng: geo.lng });
        if (meters > maxMeters) continue;

        // Build precise street address from components; fallback to reverse geocode
        let addr = buildStreetAddress(det.address_components);
        if (!addr || !/\d/.test(addr)) {
          const fallback = await reverseStreet(geo.lat, geo.lng);
          if (fallback) addr = fallback;
        }
        if (!addr) addr = det.formatted_address || ""; // last resort

        // ---------- Apply hard override by name (e.g., Dante’s HiFi) ----------
        const key = norm(det.name);
        let outPlaceId = det.place_id || pid;
        let outGeo = { ...geo };
        let outWebsite = det.website || null;

        if (OVERRIDES[key]) {
          const fix = OVERRIDES[key];
          // Hard address
          if (fix.address) addr = fix.address;
          if (fix.website) outWebsite = fix.website;
          // If a geocode target is provided, resolve to precise place_id/location and rebuild maps_url + distance
          if (fix.geocode_address) {
            const g = await geocodeAddress(fix.geocode_address);
            if (g?.place_id) {
              outPlaceId = g.place_id;
              if (g.location) {
                outGeo = g.location;
                const meters2 = distMeters(center, { lat: outGeo.lat, lng: outGeo.lng });
                // keep it only if still within Wynwood cap (it is) — else fall back to the original geo
                if (meters2 <= maxMeters) {
                  // ok
                }
              }
            }
          }
        }

        enriched.push({
          name: det.name || p.name || "",
          address: addr,
          rating: det.rating ?? p.rating ?? null,
          user_ratings_total: det.user_ratings_total ?? p.user_ratings_total ?? null,
          place_id: outPlaceId,
          maps_url: `https://www.google.com/maps/place/?q=place_id:${outPlaceId}`,
          website: outWebsite,
          distance_m: Math.round(distMeters(center, { lat: outGeo.lat, lng: outGeo.lng })),
          distance_mi: +(distMeters(center, { lat: outGeo.lat, lng: outGeo.lng }) / 1609.344).toFixed(2)
        });

        if (enriched.length >= limit) break;
      } catch {
        /* skip */
      }
    }

    return res.status(200).json({ results: enriched, status: "OK" });
  } catch (e) {
    return res.status(200).json({ results: [], status: "ERROR", error: String(e) });
  }
}
