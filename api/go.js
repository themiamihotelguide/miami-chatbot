const MAP = {
  arlo:   "https://www.hotels.com/affiliates/arlo-wynwood-miami-united-states-of-america.uPxnph9",
  sentral:"https://www.hotels.com/affiliates/sentral-wynwood-miami-united-states-of-america.ZuIyBzv",
  moxy:   "https://www.hotels.com/affiliates/moxy-miami-wynwood-miami-united-states-of-america.qQ45ZN9",
  hyde:   "https://www.hotels.com/affiliates/hyde-suites-midtown-miami-miami-united-states-of-america.Asog0p9"
};

export default function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const key = (url.searchParams.get("to") || "").toLowerCase();
    const dest = MAP[key];
    if (!dest) return res.status(400).send("Missing or invalid ?to= parameter");
    // 302 redirect to your affiliate URL
    res.setHeader("Cache-Control", "no-store");
    res.writeHead(302, { Location: dest });
    return res.end();
  } catch (e) {
    return res.status(500).send("Error");
  }
}

