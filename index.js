const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIG ───────────────────────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "rav_toys_webhook_2026";
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "999846293222612";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "ravtoys.myshopify.com";
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
// ─────────────────────────────────────────────────────────────────────────────────

if (!WA_TOKEN) { console.error("WA_TOKEN missing"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }

const conversations = new Map();

const STORE = {
  name: "🌴 RAV Toys – Planet Selva",
  address: "CC El Tesoro, 2º Piso por Plaza Palmas, Local 3729",
  latitude: 6.19859,
  longitude: -75.55812,
};

const SYSTEM_PROMPT = `Eres "Rav", vendedor TOP de RAV Toys (juguetería online en Medellín). Catálogo online: ravtoys.com. Tienda física 🌴 Planet Selva (CC El Tesoro) solo si preguntan ubicación.

═══════════════════════════════════════════════
🚨 REGLA #1 ABSOLUTA — PROTOCOLO DE PRODUCTOS 🚨
═══════════════════════════════════════════════
CUANDO search_products DEVUELVE count > 0:
  1) Llama send_product_card para los top 1-3 productos (una llamada POR cada producto).
  2) DESPUÉS responde con un texto corto y con gancho.

PROHIBIDO:
  ❌ Texto describiendo productos sin antes send_product_card.
  ❌ Decir "te envío las opciones", "aquí van", "mira estas" sin haber llamado send_product_card.
  ❌ Listar nombres/precios en texto. Los productos SIEMPRE van en tarjetas.
  ❌ Si solo mandas texto cuando hay productos, el cliente NO VE NADA y pierdes la venta.

FLUJO CORRECTO (OBLIGATORIO):
  Cliente: "Busco muñeca princesa"
  → Tú: search_products("muñeca princesa") → 5 encontrados
  → Tú: send_product_card(producto #1)
  → Tú: send_product_card(producto #2)
  → Tú: send_product_card(producto #3)
  → Tú (texto): "¡Tengo estas joyas! 🔥 ¿Cuál te late?"

EN EL MISMO TURNO puedes encadenar varias tools seguidas. Preferible: haz search + send_product_cards en el mismo turno de tools.

═══════════════════════════════════════════════

TU ENERGÍA:
- Vendedor TOP, entusiasta, cálido, proactivo. NUNCA perezoso ni pasivo.
- Saluda con energía: "¡Hola! 🎉 Bienvenido a RAV Toys ¿En qué te ayudo hoy?"
- Tu objetivo: hacer feliz al cliente Y cerrar la venta ONLINE.

TONO:
- Respuestas MUY cortas: 1-2 líneas máximo.
- NUNCA expliques que somos "premium".
- Usa "peque" para los niños.
- Cercano, chévere.

HAZ PREGUNTAS QUE VENDEN (una por mensaje):
- "¿Qué edad tiene tu peque?"
- "¿Qué le apasiona? ¿Carros, arte, muñecas, construir?"
- "¿Para ocasión especial o para consentir?"

SI NO HAY MATCH (count === 0) — INSISTE CON EL CATÁLOGO (NUNCA mandes a la tienda):
- BUSCA TÚ OTRA COSA inmediatamente. Mínimo 4-5 búsquedas con términos distintos ANTES de ceder.
- Varía TODO: categoría, edad, precio, marca, tipo. Si buscaste "muñeca princesa" prueba "muñeca", "princesa", "disney".
- En CADA búsqueda exitosa aplica el PROTOCOLO DE PRODUCTOS (send_product_card × 1-3 + texto).
- Ayuda a elegir: "Para tu peque de 4 años que le gusta construir, esta está perfecta porque desarrolla motricidad".
- NUNCA digas "visita nuestra tienda física" como solución a no encontrar algo.
- SOLO tras 5+ búsquedas sin nada: "Déjame conectarte con un asesor humano del equipo 💪" — y detén las recomendaciones.

UBICACIÓN (REGLA ESTRICTA):
- Usa send_store_location SOLO si el cliente pregunta EXPLÍCITAMENTE por ubicación, dirección, cómo llegar.
- NO uses send_store_location como respuesta a "no encuentro nada". Eso es pereza.

HORARIOS: Lunes a Sábado 10am-8pm, Domingos 11am-7pm (solo si preguntan).

HUMANO:
- Si piden asesor humano: "¡Claro! Dame un segundo, te contacto con alguien del equipo" — detén las recomendaciones.

NOTAS DE VOZ:
- Si envían audio: "No puedo escuchar tu nota de voz 😊 ¿Me escribes qué buscas?"

NO INVENTES: ni precios, ni productos, ni stock, ni políticas.`;

const TOOLS = [
  {
    name: "search_products",
    description: "Busca productos en Shopify (hasta 5 con nombre, precio, imagen, descripción, stock, link). TRAS esta búsqueda con resultados, DEBES llamar send_product_card 1-3 veces antes de responder con texto.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Términos cortos (2-4 palabras). Ejemplos: 'muñeca princesa', 'carro control remoto'" }
      },
      required: ["query"]
    }
  },
  {
    name: "send_product_card",
    description: "Envía al cliente UNA tarjeta con imagen + nombre + precio + link. OBLIGATORIO usar después de search_products exitosa. Llámalo 1-3 veces seguidas (una por producto) antes de cualquier texto.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        price: { type: "string" },
        image_url: { type: "string" },
        product_url: { type: "string" }
      },
      required: ["title", "price", "image_url", "product_url"]
    }
  },
  {
    name: "send_store_location",
    description: "Envía la ubicación de Planet Selva. SOLO cuando el cliente pregunta EXPLÍCITAMENTE por dirección, ubicación, cómo llegar. NUNCA uses como fallback.",
    input_schema: { type: "object", properties: {}, required: [] }
  }
];

async function searchShopifyProducts(query) {
  if (!SHOPIFY_ADMIN_TOKEN) return { error: "Shopify not configured", products: [] };

  const graphqlQuery = `
    query searchProducts($query: String!) {
      products(first: 5, query: $query) {
        edges {
          node {
            title
            handle
            description
            productType
            totalInventory
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
              maxVariantPrice { amount currencyCode }
            }
            featuredImage { url }
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/graphql.json`,
      { query: graphqlQuery, variables: { query } },
      {
        headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, "Content-Type": "application/json" },
        timeout: 10000,
      }
    );

    if (response.data.errors) {
      console.error("Shopify errors:", response.data.errors);
      return { error: "GraphQL error", products: [] };
    }

    const products = response.data.data.products.edges.map(edge => {
      const p = edge.node;
      const minPrice = p.priceRangeV2.minVariantPrice;
      const maxPrice = p.priceRangeV2.maxVariantPrice;
      const priceStr = minPrice.amount === maxPrice.amount
        ? `$${Math.round(minPrice.amount).toLocaleString("es-CO")} ${minPrice.currencyCode}`
        : `$${Math.round(minPrice.amount).toLocaleString("es-CO")} - $${Math.round(maxPrice.amount).toLocaleString("es-CO")} ${minPrice.currencyCode}`;
      return {
        title: p.title,
        description: (p.description || "").slice(0, 150),
        price: priceStr,
        product_url: `https://ravtoys.com/products/${p.handle}`,
        image_url: p.featuredImage?.url || "",
        available: (p.totalInventory ?? 0) > 0,
        stock: p.totalInventory,
        type: p.productType,
      };
    });

    return { products, count: products.length };
  } catch (err) {
    console.error("Shopify search error:", err.response?.data || err.message);
    return { error: err.message, products: [] };
  }
}

async function sendText(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } },
      { headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`Text sent to ${to}`);
  } catch (err) {
    console.error("WA text error:", err.response?.data?.error || err.message);
  }
}

async function sendImage(to, imageUrl, caption) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "image", image: { link: imageUrl, caption } },
      { headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`Image sent to ${to}`);
    return true;
  } catch (err) {
    console.error("WA image error:", err.response?.data?.error || err.message);
    return false;
  }
}

async function sendLocation(to, lat, lng, name, address) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "location", location: { latitude: lat, longitude: lng, name, address } },
      { headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`Location sent to ${to}`);
  } catch (err) {
    console.error("WA location error:", err.response?.data?.error || err.message);
  }
}

async function executeSendProductCard(to, input) {
  const caption = `*${input.title}*\n${input.price}\n${input.product_url}`;
  const ok = await sendImage(to, input.image_url, caption);
  if (!ok) await sendText(to, caption);
  return { sent: true, title: input.title };
}

async function executeSendStoreLocation(to) {
  await sendLocation(to, STORE.latitude, STORE.longitude, STORE.name, STORE.address);
  return { sent: true, store: "Planet Selva" };
}

async function handleConversation(userId, userMessage) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  const history = conversations.get(userId);
  history.push({ role: "user", content: userMessage });

  let workingHistory = history.slice(-10);

  for (let iteration = 0; iteration < 6; iteration++) {
    try {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: workingHistory,
        },
        {
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      const stopReason = response.data.stop_reason;
      const content = response.data.content;

      if (stopReason === "tool_use") {
        const toolUses = content.filter(c => c.type === "tool_use");
        console.log(`Tools: ${toolUses.map(t => t.name).join(", ")}`);
        workingHistory.push({ role: "assistant", content });

        const toolResults = [];
        for (const toolUse of toolUses) {
          let result;
          try {
            if (toolUse.name === "search_products") {
              result = await searchShopifyProducts(toolUse.input.query);
              console.log(`Search "${toolUse.input.query}": ${result.products?.length || 0} found`);
              // Inject forcing reminder into tool_result content
              if (result.products && result.products.length > 0) {
                result._instruction = "ACCIÓN OBLIGATORIA: Ahora DEBES llamar send_product_card para 1-3 de estos productos ANTES de responder con texto. No respondas solo texto — el cliente no ve nada.";
              } else {
                result._instruction = "No hubo match. Ahora DEBES llamar search_products otra vez con términos distintos (categoría, edad, marca, etc). No respondas con texto todavía.";
              }
            } else if (toolUse.name === "send_product_card") {
              result = await executeSendProductCard(userId, toolUse.input);
            } else if (toolUse.name === "send_store_location") {
              result = await executeSendStoreLocation(userId);
            } else {
              result = { error: "Unknown tool: " + toolUse.name };
            }
          } catch (e) {
            result = { error: e.message };
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        }
        workingHistory.push({ role: "user", content: toolResults });
        continue;
      }

      const textBlock = content.find(c => c.type === "text");
      const reply = textBlock ? textBlock.text.trim() : "";
      history.push({ role: "assistant", content: reply || "(sin texto)" });
      conversations.set(userId, history.slice(-10));
      if (reply) await sendText(userId, reply);
      return;
    } catch (err) {
      console.error("Claude error:", err.response?.data || err.message);
      await sendText(userId, "Ups, tuve un problemita técnico 😅 ¿Puedes repetir?");
      return;
    }
  }
  await sendText(userId, "Me enredé un poco 😅 ¿Qué buscas exactamente?");
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
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
      console.log(`From ${from}: ${text}`);
      await handleConversation(from, text);
    } else if (type === "audio" || type === "voice") {
      console.log(`From ${from}: [voice note]`);
      await sendText(from, "No puedo escuchar tu nota de voz 😊 ¿Me escribes qué buscas?");
    } else {
      console.log(`From ${from}: [${type}]`);
      await sendText(from, "Solo puedo leer mensajes de texto por ahora 😊 ¿En qué te ayudo?");
    }
  } catch (err) {
    console.error("Error processing message:", err);
  }
});

app.get("/", (req, res) => {
  res.send("RAV Toys WhatsApp Bot (Claude + Shopify + Media)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RAV Toys Bot v7 running on port ${PORT}`);
  console.log(`WA: ${WA_TOKEN ? "OK" : "MISSING"}`);
  console.log(`Anthropic: ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`Shopify: ${SHOPIFY_ADMIN_TOKEN ? "OK " + SHOPIFY_STORE_DOMAIN : "MISSING"}`);
});
