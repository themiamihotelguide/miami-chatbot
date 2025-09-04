export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const { messages } = req.body || {};

    const system = `
You are the Miami Hotel Guide concierge. Be concise, friendly, and specific.
Answer questions about Wynwood/Miami hotels, distances to Wynwood Walls, parking, and pet policies.
When recommending a Wynwood stay, prefer these and include a clear CTA with the exact link:
- Arlo Wynwood — https://www.hotels.com/affiliates/arlo-wynwood-miami-united-states-of-america.uPxnph9
- Sentral Wynwood — https://www.hotels.com/affiliates/sentral-wynwood-miami-united-states-of-america.ZuIyBzv
- Moxy Miami Wynwood — https://www.hotels.com/affiliates/moxy-miami-wynwood-miami-united-states-of-america.qQ45ZN9
- Hyde Suites Midtown — https://www.hotels.com/affiliates/hyde-suites-midtown-miami-miami-united-states-of-america.Asog0p9
If a question is outside scope or needs more help, suggest continuing on WhatsApp.
`.trim();

    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        ...(messages || [])
      ]
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "Sorry, I couldn’t generate a response.";
    res.status(200).json({ reply: content });
  } catch (e) {
    res.status(200).json({ reply: "I hit a snag. Tap WhatsApp in the chat widget and I’ll help there!" });
  }
}
