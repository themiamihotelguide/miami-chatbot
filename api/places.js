// File: api/places.js
// Accurate Wynwood results with HARD place_id override for Dante’s HiFi
// POST body: { "query": "tacos", "type": "restaurant", "limit": 5 }
// Requires: GOOGLE_MAPS_API_KEY (Billing ON)

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

    // ---- HARD OVERRIDES (place_id-based) ----
    // Canonical Dante’s data (your address + website)
    const DANTES_CANON = {
      displayName: "Dante’s HiFi",
      canonicalAddress: "519 NW 26th St, Miami, FL 33127",
      website: "https://danteshifi.com",
      // text to resolve place_id reliably:
      findText: "Dante’s HiFi, 519 NW 26th St, Miami, FL 33127"
    };

    // Utils
    const toRad = d => d * Math.PI / 180;
    function distMeters(a, b) {
      const R = 6371000;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const la1 = toRad(a.lat);
      const la2 = toRad(b.lat);
      const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
      return 2 * R * Math.asin(Math.sqrt(x));
    }
    const norm = s => (s||"").toLowerCase()
      .normalize("NFKD")
      .replace(/[’'`]/g,"")
      .replace(/[^a-z0-9]+/g," ")
      .trim();

    function buildStreetAddress(components) {
      if (!components) return "";
      const get = (t) => (components.find(c => c.types.includes(t)) || {}).long_name || "";
      const streetNum = get("street_number");
      const route     = get("route");
      const city      = get("locality") || get("sublocality") || get("postal_town") || "Miami";
      const state     = get("administrative_area_level_1") || "FL";
      const zip       = get("postal_code") || "";
      const street    = [streetNum, route].filter(Boolean).join(" ");
      const line2     = [city, state].filter(Boolean).join(", ") + (zip ? ` ${zip}` : "");
      return street && line2 ? `${street}, ${line2}` : (route ? `${route}, ${line2}` : line2);
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
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}&result_type=street_address`;
      const r = await fetch(url);
      const j = await r.json();
      return (j.results?.[0]?.formatted_address) || "";
    }
    async function geocodeAddress(address) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      const hit = j.results?.[0];
      return hit ? { place_id: hit.place_id, location: hit.geometry?.location || null } : null;
    }
    async function findPlaceIdByText(input) {
      // Find Place From Text for a rock-solid place_id
      const fields = "place_id,geometry";
      const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=${fields}&key=${API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      const cand = j.candidates?.[0];
      return cand ? { place_id: cand.place_id, location: cand.geometry?.location || null } : null;
    }

    // Resolve Dante’s place_id once per request; create a canonical object we can inject/replace with
    async function getCanonicalDantes() {
      // Resolve by exact text → place_id
      const found = await findPlaceIdByText(DANTES_CANON.findText);
      let pid = found?.place_id;
      let geo = found?.location;
      if (!pid) {
        // fallback: geocode address to at least build maps_url
        const g = await geocodeAddress(DANTES_CANON.canonicalAddress);
        pid = g?.place_id || null;
        geo = g?.location || null;
      }
      // If still no pid, we’ll craft a minimal object (maps link will still work via address search)
      const maps_url = pid
        ? `https://www.google.com/maps/place/?q=place_id:${pid}`
        : `https://www.google.com/maps/search/${encodeURIComponent(DANTES_CANON.canonicalAddress)}`;

      return {
        name: DANTES_CANON.displayName,
        address: DANTES_CANON.canonicalAddress,
        rating: null,
        user_ratings_total: null,
        place_id: pid || "override_dantes",
        maps_url,
        website: DANTES_CANON.website,
        geometry: geo
      };
    }

    // 1) Topical Text Search constrained to Wynwood
    const search = (query && query.trim())
      ? `${query.trim()} in Wynwood Miami`
      : (type ? `${type} in Wynwood Miami` : "Wynwood Miami");

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

    const candidates = (tsj.results || []).slice(0, Math.max(limit * 3, 12));
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

        const meters = distMeters(center, { lat: geo.lat, lng: geo.lng });
        if (meters > maxMeters) continue;

        // Build street address from components; fallback to reverse geocode
        let addr = buildStreetAddress(det.address_components);
        if (!addr || !/\d/.test(addr)) {
          const fallback = await reverseStreet(geo.lat, geo.lng);
          if (fallback) addr = fallback;
        }
        if (!addr) addr = det.formatted_address || "";

        enriched.push({
          name: det.name || p.name || "",
          address: addr,
          rating: det.rating ?? p.rating ?? null,
          user_ratings_total: det.user_ratings_total ?? p.user_ratings_total ?? null,
          place_id: det.place_id || pid,
          maps_url: `https://www.google.com/maps/place/?q=place_id:${det.place_id || pid}`,
          website: det.website || null,
          distance_m: Math.round(meters),
          distance_mi: +(meters / 1609.344).toFixed(2)
        });

        if (enriched.length >= limit) break;
      } catch { /* skip */ }
    }

    // 2) Inject/replace with canonical Dante’s (if user asked nightlife/bars or query mentions dante)
    const qn = norm(query);
    const wantsDantes = /dante/.test(qn) || /bar|night|vinyl|listening|dj/.test(qn);
    if (wantsDantes) {
      const dcanon = await getCanonicalDantes();
      // Remove any Dante variants and push the canonical one on top
      const filtered = enriched.filter(e => norm(e.name) !== norm(DANTES_CANON.displayName));
      enriched.length = 0;
      enriched.push({
        name: dcanon.name,
        address: dcanon.address,
        rating: null,
        user_ratings_total: null,
        place_id: dcanon.place_id,
        maps_url: dcanon.maps_url,
        website: dcanon.website,
        distance_m: dcanon.geometry ? Math.round(distMeters(center, dcanon.geometry)) : null,
        distance_mi: dcanon.geometry ? +(distMeters(center, dcanon.geometry) / 1609.344).toFixed(2) : null
      });
      for (const e of filtered) {
        if (enriched.length >= limit) break;
        enriched.push(e);
      }
    } else {
      // Even if the query didn't say "dante", replace any Dante hits with canonical
      const dcanon = await getCanonicalDantes();
      for (let i = 0; i < enriched.length; i++) {
        if (norm(enriched[i].name) === norm(DANTES_CANON.displayName)) {
          enriched[i] = {
            name: dcanon.name,
            address: dcanon.address,
            rating: enriched[i].rating,
            user_ratings_total: enriched[i].user_ratings_total,
            place_id: dcanon.place_id,
            maps_url: dcanon.maps_url,
            website: dcanon.website,
            distance_m: dcanon.geometry ? Math.round(distMeters(center, dcanon.geometry)) : enriched[i].distance_m,
            distance_mi: dcanon.geometry ? +(distMeters(center, dcanon.geometry) / 1609.344).toFixed(2) : enriched[i].distance_mi
          };
        }
      }
    }

    return res.status(200).json({ results: enriched.slice(0, limit), status: "OK" });
  } catch (e) {
    return res.status(200).json({ results: [], status: "ERROR", error: String(e) });
  }
}

