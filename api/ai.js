export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OMNIROUTE_API_KEY;
  const endpoint = process.env.OMNIROUTE_ENDPOINT;
  if (!apiKey) {
    return response.status(503).json({ error: "OMNIROUTE_API_KEY is not configured" });
  }
  if (!endpoint) {
    return response.status(503).json({ error: "OMNIROUTE_ENDPOINT is not configured" });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OMNIROUTE_MODEL || "auto",
        messages: [{ role: "user", content: String(request.body?.prompt || "") }],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) return response.status(upstream.status).json(data);
    return response.status(200).json({
      text: data.choices?.[0]?.message?.content || data.output_text || "ИИ не дал ответ.",
    });
  } catch (error) {
    return response.status(500).json({ error: "AI request failed" });
  }
}