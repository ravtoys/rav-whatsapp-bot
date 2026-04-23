const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "rav_toys_webhook_2026";
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "999846293222612";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || "ravtoys.com";
// ─────────────────────────────────────────────────────────────────────────────

if (!WA_TOKEN) { console.error("❌ WA_TOKEN missing"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("❌ ANTHROPIC_API_KEY missing"); process.exit(1); }

const conversations = new Map();

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres "Rav", el asistente virtual de RAV Toys — tienda premium de juguetes en Medellín, Colombia.

SOBRE RAV TOYS:
- Tiendas físicas: Planet Selva (El Tesoro) y Planet Luna (Santafé)
- Online: ravtoys.com
- Horario: Lun–Sáb 10am–8pm | Dom 11am–7pm
- Juguetes premium 0–12 años | Precios $15.000–$500.000 COP

TU FORMA DE SER:
- Cálido, cercano, como un amigo experto en juguetes
- Llama a los niños "peques"
- Respuestas cortas (máximo 4-5 líneas)
- Emojis con moderación
- Orienta hacia la compra o visita a tienda

HERRAMIENTA CLAVE — search_products:
Úsala SIEMPRE que el cliente pregunte por productos, categorías, edades, o intereses. No inventes productos, precios o disponibilidad. Si busca "algo para una niña de 5 años que le gustan las princesas", busca con términos como "princesa", "muñeca", etc.

CUANDO RECOMIENDES PRODUCTOS REALES:
- Menciona el NOMBRE exacto del producto que retornó la búsqueda
- Da el PRECIO exacto en pesos colombianos
- Si la API devuelve un link (url), compártelo para que compren
- Si no hay resultados, sugiere alternativas o preguntarle más sobre intereses

CUANDO QUIERAN HABLAR CON EL EQUIPO:
- Di que en un momento los contacta alguien
- No des emails ni teléfonos

IMPORTANTE:
- Jamás inventes un producto que no venga de search_products
- Si no sabes stock exacto, di "consultemos disponibilidad" o sugiere que revisen en ravtoys.com
- Si la pregunta no es sobre juguetes, redirige amablemente`;

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "search_products",
    description: "Busca productos reales en el catálogo de RAV Toys (ravtoys.com). Úsala cuando el cliente pregunte por productos, categorías, edades, o intereses específicos (ej: 'muñecas', 'carros', 'bebé', 'juegos educativos'). Retorna título, precio, link al producto, imagen, y tags.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Término de búsqueda en español. Usa términos simples y amplios como 'muñeca', 'carro', 'bebé', 'lego'. Evita frases largas."
        },
        limit: {
          type: "integer",
          description: "Cuántos productos retornar (máximo 5, default 3)",
          default: 3
        }
      },
      required: ["query"]
    }
  }
];

// ─── SHOPIFY SEARCH ──────────────────────────────────────────────────────────
async function searchProducts(query, limit = 3) {
  try {
    const url = `https://${SHOPIFY_STORE}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=${limit}`;
    const r = await axios.get(url, { timeout: 10000 });
    const products = r.data?.resources?.results?.products || [];

    if (products.length === 0) {
      return { found: 0, message: `No se encontraron productos para "${query}". Sugiere al cliente probar con otros términos o visitar ravtoys.com.` };
    }

    const simplified = products.map(p => ({
      title: p.title,
      price: p.price ? `$${Number(p.price).toLocaleString('es-CO')} COP` : 'Consultar',
      url: `https://${SHOPIFY_STORE}${p.url}`,
      type: p.product_type,
      vendor: p.vendor,
      image: p.image
    }));

    return { found: simplified.length, products: simplified };
  } catch (err) {
    console.error(`❌ Shopify search error:`, err.message);
    return { found: 0, error: "Error consultando catálogo. Sugiere al cliente visitar ravtoys.com directamente." };
  }
}

// ─── WHATSAPP SEND ───────────────────────────────────────────────────────────
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

// ─── CLAUDE WITH TOOL USE ────────────────────────────────────────────────────
async function askClaude(userId, userMessage) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  const history = conversations.get(userId);
  history.push({ role: "user", content: userMessage });

  let messages = history.slice(-10);

  const MAX_ITERATIONS = 5;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    try {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: messages
        },
        {
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          timeout: 30000
        }
      );

      const { content, stop_reason } = response.data;
      messages.push({ role: "assistant", content });

      if (stop_reason === "tool_use") {
        const toolResults = [];
        for (const block of content) {
          if (block.type === "tool_use") {
            console.log(`🔧 Claude calling tool: ${block.name}(${JSON.stringify(block.input)})`);
            let result;
            if (block.name === "search_products") {
              result = await searchProducts(block.input.query, block.input.limit || 3);
            } else {
              result = { error: `Unknown tool: ${block.name}` };
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result)
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      const textBlock = content.find(b => b.type === "text");
      const reply = textBlock?.text || "Disculpa, no te entendí bien. ¿Puedes repetir?";

      history.push({ role: "assistant", content: reply });
      conversations.set(userId, history.slice(-10));

      return reply;
    } catch (err) {
      console.error(`❌ Claude error:`, err.response?.data || err.message);
      return "Ups, tuve un problemita técnico 😅 ¿Puedes repetir tu mensaje?";
    }
  }

  return "Disculpa, estoy tardando en procesar tu solicitud. ¿Puedes intentar de nuevo?";
}

// ─── WEBHOOK ─────────────────────────────────────────────────────────────────
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
  res.send("RAV Toys WhatsApp Bot 🚀 (Claude + Shopify)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 RAV Toys Bot (Claude + Shopify) running on port ${PORT}`);
  console.log(`📱 Phone ID: ${PHONE_NUMBER_ID}`);
  console.log(`🔑 WA Token: ${WA_TOKEN ? "✅" : "❌"}`);
  console.log(`🧠 Anthropic: ${ANTHROPIC_API_KEY ? "✅" : "❌"}`);
  console.log(`🛒 Shopify Store: ${SHOPIFY_STORE}`);
});
