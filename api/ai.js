export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "GEMINI_API_KEY is not configured" });
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: String(request.body?.prompt || "") }] }],
        }),
      },
    );
    const data = await upstream.json();
    if (!upstream.ok) return response.status(upstream.status).json(data);
    return response.status(200).json({
      text: data.candidates?.[0]?.content?.parts?.[0]?.text || "ИИ не дал ответ.",
    });
  } catch (error) {
    return response.status(500).json({ error: "AI request failed" });
  }
}