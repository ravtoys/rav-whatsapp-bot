const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "rav_toys_webhook_2026";
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "999846293222612";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// ─────────────────────────────────────────────────────────────────────────────

if (!WA_TOKEN) { console.error("❌ WA_TOKEN missing"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("❌ ANTHROPIC_API_KEY missing"); process.exit(1); }

const conversations = new Map();

const SYSTEM_PROMPT = `Eres el asistente virtual de RAV Toys, una tienda premium de juguetes en Medellín, Colombia. Tu nombre es "Rav".

SOBRE RAV TOYS:
- Tiendas físicas: Planet Selva (Centro Comercial El Tesoro) y Planet Luna (Centro Comercial Santafé)
- Tienda online: ravtoys.com
- Horario: Lunes–Sábado 10am–8pm | Domingos 11am–7pm
- Especialidad: juguetes premium para niños de 0 a 12 años
- Rango de precios: $15.000 a $500.000 COP
- Concepto: cada tienda es un planeta temático (inspirado en FAO Schwarz y Disney)

TU FORMA DE SER:
- Cálido, cercano, como un amigo experto en juguetes
- Llamas a los niños "peques"
- Usas emojis pero con moderación
- Respuestas cortas (máximo 3-4 líneas por mensaje)
- Siempre orientas hacia una compra o visita a la tienda

CUANDO TE PREGUNTEN POR PRODUCTOS:
- Pregunta la edad del peque y el presupuesto si no lo dicen
- Recomienda categorías (no productos específicos que no conoces)
- Siempre menciona que pueden ver el catálogo completo en ravtoys.com

CUANDO QUIERAN HABLAR CON ALGUIEN:
- Di que en un momento los contacta alguien del equipo
- No des números de teléfono ni emails

IMPORTANTE:
- Si no sabes algo específico (precio exacto, disponibilidad), di que pueden consultar en ravtoys.com o visitando la tienda
- Nunca inventes información de productos o precios específicos
- Si la pregunta no es sobre juguetes, redirige amablemente al tema`;

async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
      { headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`✅ Sent to ${to}`);
  } catch (err) {
    console.error(`❌ WA error:`, err.response?.data?.error || err.message);
  }
}

async function askClaude(userId, userMessage) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  const history = conversations.get(userId);
  history.push({ role: "user", content: userMessage });
  const trimmedHistory = history.slice(-10);

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: trimmedHistory,
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      }
    );
    const reply = response.data.content[0].text;
    history.push({ role: "assistant", content: reply });
    conversations.set(userId, history.slice(-10));
    return reply;
  } catch (err) {
    console.error(`❌ Claude error:`, err.response?.data || err.message);
    return "Ups, tuve un problemita técnico 😅 ¿Puedes repetir tu mensaje?";
  }
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    if (!messages || messages.length === 0) return;
    const message = messages[0];
    const from = message.from;
    const type = message.type;
    if (type === "text") {
      const text = message.text.body;
      console.log(`📩 From ${from}: ${text}`);
      const reply = await askClaude(from, text);
      await sendMessage(from, reply);
    } else {
      console.log(`📎 From ${from}: [${type}]`);
      await sendMessage(from, "Solo puedo leer mensajes de texto por ahora 😊 ¿En qué te puedo ayudar?");
    }
  } catch (err) {
    console.error("Error processing message:", err);
  }
});

app.get("/", (req, res) => {
  res.send("RAV Toys WhatsApp Bot 🚀 (Claude-powered)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 RAV Toys Bot (Claude-powered) running on port ${PORT}`);
  console.log(`📱 Phone Number ID: ${PHONE_NUMBER_ID}`);
  console.log(`🔑 WA Token: ${WA_TOKEN ? "✅" : "❌ MISSING"}`);
  console.log(`🧠 Anthropic Key: ${ANTHROPIC_API_KEY ? "✅" : "❌ MISSING"}`);
});
