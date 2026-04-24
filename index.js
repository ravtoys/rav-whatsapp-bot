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
// Notificaciones: teléfonos separados por coma, sin +, con código país. Ej: "573013507371,573001234567"
const NOTIFICATION_PHONES = (process.env.NOTIFICATION_PHONES || "573013507371").split(",").map(s => s.trim()).filter(Boolean);
// ─────────────────────────────────────────────────────────────────────────────────

if (!WA_TOKEN) { console.error("WA_TOKEN missing"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }

// Estado por cliente en memoria
const conversations = new Map();      // userId -> [ { role, content } ]
const humanHandoff = new Set();       // userIds cuyo chat pasó a humano (bot no responde)
const checkouts = new Map();          // userId -> { step, data }

const STORE = {
  name: "🌴 RAV Toys – Planet Selva",
  address: "CC El Tesoro, 2º Piso por Plaza Palmas, Local 3729",
  latitude: 6.19859,
  longitude: -75.55812,
};

const PAYMENT_INFO = `🏦 *Medios de pago RAV Toys*

*1. Transferencia Bancolombia* 💳
Cuenta ahorros: 37 938 445 851
RAV Kids SAS · NIT 900 822 164-1

*2. Datáfono virtual Wompi* 📱
Paga con cualquier tarjeta débito o crédito:
https://checkout.wompi.co/l/iGnSPs

*3. Contraentrega* 🚚
Paga en efectivo al recibir. Disponible para compras < $1.450.000.

*4. Crédito con Addi o Sü Pay* 📅
Compra ahora y paga después, sin intereses. Sujeto a aprobación.

¿Cuál prefieres?`;

const WARRANTY_SHORT = `📋 *Política de garantías RAV Toys*

• 30 días calendario desde la compra (Ley 1480).
• Cambios por defecto de fábrica, idoneidad o calidad.
• Cambio de opinión: hasta 5 días hábiles, producto en empaque original sin uso.
• No hacemos devolución de dinero: entregamos bono por el mismo valor, vigencia 1 año.
• Transporte hacia nosotros corre por cuenta del cliente.

¿Me cuentas qué pasó con tu producto? Así te oriento mejor. 🙏`;

const SYSTEM_PROMPT = `Eres "RAV-Bot", vendedor virtual de RAV Toys (juguetería online en Medellín). Catálogo: ravtoys.com

TONO:
- Respuestas cortas (1-2 líneas máx).
- Saludas con energía: "¡Hola! Soy RAV-Bot 🎉 Bienvenido a RAV Toys ¿En qué te ayudo?"
- Usas "peque" para los niños.
- Cercano, chévere, entusiasta. Vendedor TOP, nunca pasivo.

CÓMO BUSCAR Y MOSTRAR PRODUCTOS:
1. Llama search_products con términos cortos (2-4 palabras).
2. Si hay resultados, llama send_product_card 1-3 veces (una por producto) con los datos EXACTOS que devolvió search_products. NO inventes ni cambies título, precio, image_url o product_url.
3. Después un texto corto con gancho: "¡Tengo estas joyas! ¿Cuál te late?"
4. NUNCA listes productos en texto. Van siempre en tarjetas.

SI NO HAY MATCH (0 resultados):
- Busca otra cosa con términos distintos (varía categoría, edad, marca, estilo). Mínimo 3-4 intentos antes de ceder.
- NO mandes al cliente a la tienda física como solución.
- Solo como último recurso: usa request_human_handoff para conectarlo con el equipo.

UBICACIÓN:
- Usa send_store_location SOLO si preguntan explícitamente dónde están, dirección o cómo llegar.

MEDIOS DE PAGO:
- Si preguntan "cómo pago", "formas de pago", "transferencia", "contraentrega", "con tarjeta", etc. → usa send_payment_info.

GARANTÍAS Y CAMBIOS:
- Si mencionan producto dañado, defectuoso, quieren cambio, devolución, garantía → usa send_warranty_info.
- Luego personaliza según el caso: cambio de opinión (5 días hábiles) vs defecto de fábrica (30 días). Sé breve y amable.
- Si necesitan atención humana para garantía → usa request_human_handoff.

CIERRE DE VENTA (MUY IMPORTANTE):
Cuando el cliente diga "lo quiero", "me lo llevo", "cómo lo compro", "hagamos el pedido" o similar:
1. Confirma producto y precio: "¡Perfecto! [producto] por [precio] 🎉"
2. Llama start_checkout con collect_field="nombre" para pedir nombre completo.
3. Luego con collect_field="cedula" (SIEMPRE pides cédula).
4. Luego collect_field="direccion" (dirección + ciudad).
5. Luego collect_field="telefono" (si el cliente ya te da WhatsApp está bien, pero confirma).
6. Llama send_payment_info para mostrar métodos.
7. Cuando el cliente elija método → llama start_checkout con collect_field="metodo_pago" y guarda la elección.
8. Llama send_payment_link con el método elegido.
9. Cuando el cliente confirme que pagó (dice "ya pagué", "listo", envía comprobante):
   → Llama notify_sale_team con todos los datos.
   → Llama request_human_handoff para que Eliana tome el control.

NUNCA saltes pasos del checkout. La cédula es SIEMPRE obligatoria.

HUMANO DIRECTO:
- Si piden hablar con asesor humano, persona, alguien del equipo → usa request_human_handoff inmediatamente.

HORARIOS (solo si preguntan): L-S 10am-8pm, D 11am-7pm.

NOTAS DE VOZ:
- Si mandan audio: "No puedo escuchar audio 😊 ¿Me escribes qué buscas?"

NO INVENTES precios, productos, links, stock ni políticas.`;

const TOOLS = [
  {
    name: "search_products",
    description: "Busca productos reales en el catálogo Shopify de RAV Toys. Devuelve hasta 5 con título, precio, image_url, product_url, descripción y stock. Úsalo SIEMPRE que el cliente pida un producto.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Términos cortos (2-4 palabras). Ejemplos: 'muñeca princesa', 'carro control remoto', 'lego 5 años'." }
      },
      required: ["query"]
    }
  },
  {
    name: "send_product_card",
    description: "Envía UNA tarjeta con imagen + nombre + precio + link. Usa los datos EXACTOS que devolvió search_products. Llama esta tool 1-3 veces consecutivas (una por producto) antes de responder texto.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título exacto" },
        price: { type: "string", description: "Precio exacto" },
        image_url: { type: "string", description: "URL imagen exacta" },
        product_url: { type: "string", description: "URL producto exacta" }
      },
      required: ["title", "price", "image_url", "product_url"]
    }
  },
  {
    name: "send_store_location",
    description: "Envía la ubicación de Planet Selva por mapa. SOLO cuando el cliente pregunta explícitamente por dirección, ubicación o cómo llegar.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "send_payment_info",
    description: "Envía al cliente el mensaje con los medios de pago de RAV Toys (transferencia Bancolombia, Wompi, contraentrega, Addi/Sü Pay). Úsalo cuando pregunten cómo pagar o al iniciar el checkout.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "send_warranty_info",
    description: "Envía el resumen de la política de garantías RAV Toys. Úsalo cuando mencionen producto dañado, cambio, devolución o pregunten por garantía.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "start_checkout",
    description: "Gestiona el cierre de venta paso a paso. Cada llamada pide UN dato al cliente y lo guarda. Los pasos son: 'producto' (qué producto y precio), 'nombre', 'cedula', 'direccion', 'telefono', 'metodo_pago'. Llámalo secuencialmente a medida que el cliente responde.",
    input_schema: {
      type: "object",
      properties: {
        collect_field: {
          type: "string",
          enum: ["producto", "nombre", "cedula", "direccion", "telefono", "metodo_pago"],
          description: "Qué campo vas a pedir/guardar ahora"
        },
        value: {
          type: "string",
          description: "Valor que el cliente acaba de dar para el campo anterior. En la primera llamada de un campo se omite (se pide el dato). En la siguiente llamada se pasa el valor recibido."
        }
      },
      required: ["collect_field"]
    }
  },
  {
    name: "send_payment_link",
    description: "Envía al cliente las instrucciones/link del método de pago elegido. Úsalo después de que el cliente elija método en el checkout.",
    input_schema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["transferencia", "wompi", "contraentrega", "addi", "supay"],
          description: "Método elegido por el cliente"
        },
        amount: {
          type: "string",
          description: "Monto total de la compra, ej: '$249.900 COP'"
        }
      },
      required: ["method", "amount"]
    }
  },
  {
    name: "notify_sale_team",
    description: "Notifica al equipo RAV Toys (Santiago y Eliana) que hay una venta lista con todos los datos del pedido. Úsalo CUANDO el cliente confirme que pagó. Después llama request_human_handoff.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Resumen del pedido con todos los datos: producto, precio, nombre, cédula, dirección, ciudad, teléfono, método de pago, estado."
        }
      },
      required: ["summary"]
    }
  },
  {
    name: "request_human_handoff",
    description: "Pasa la conversación a un humano del equipo RAV Toys. Úsalo cuando: (a) el cliente pida hablar con una persona, (b) después de notify_sale_team tras confirmar pago, (c) como último recurso cuando no puedas ayudar. Notifica a Santiago y Eliana, y detiene la respuesta del bot en esta conversación.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo del handoff: 'venta_cerrada', 'solicitud_cliente', 'caso_complejo', 'garantia', u otro."
        }
      },
      required: ["reason"]
    }
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

async function notifyTeam(text) {
  for (const phone of NOTIFICATION_PHONES) {
    await sendText(phone, text);
  }
  console.log(`Notified team (${NOTIFICATION_PHONES.length} numbers)`);
}

// ─── EXECUTORS ───────────────────────────────────────────────────────────────

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

async function executeSendPaymentInfo(to) {
  await sendText(to, PAYMENT_INFO);
  return { sent: true };
}

async function executeSendWarrantyInfo(to) {
  await sendText(to, WARRANTY_SHORT);
  return { sent: true };
}

async function executeStartCheckout(to, input) {
  if (!checkouts.has(to)) checkouts.set(to, { step: null, data: {} });
  const state = checkouts.get(to);
  // Guardar valor si vino (corresponde al campo del paso anterior que ya se pidió)
  if (input.value && state.step) {
    state.data[state.step] = input.value;
  }
  state.step = input.collect_field;
  checkouts.set(to, state);
  console.log(`Checkout [${to}]: step=${input.collect_field}, data=${JSON.stringify(state.data)}`);
  return { step: input.collect_field, data: state.data, saved_previous: !!input.value };
}

async function executeSendPaymentLink(to, input) {
  const amount = input.amount || "el total de tu pedido";
  let msg;
  switch (input.method) {
    case "transferencia":
      msg = `💳 *Transferencia Bancolombia*\n\nCuenta de ahorros: *37 938 445 851*\nTitular: RAV Kids SAS\nNIT: 900 822 164-1\n\nMonto a transferir: *${amount}*\n\nCuando tengas el comprobante, me lo envías por aquí y cerramos el pedido. 🙏`;
      break;
    case "wompi":
      msg = `📱 *Pago con tarjeta (Wompi)*\n\nHaz clic aquí para pagar *${amount}*:\nhttps://checkout.wompi.co/l/iGnSPs\n\nEn el checkout coloca el valor exacto y sigue los pasos. Al terminar, avísame por acá. 🙏`;
      break;
    case "contraentrega":
      msg = `🚚 *Pago contraentrega*\n\nPagas *${amount}* en efectivo cuando recibas tu pedido.\n\nSolo disponible para compras menores a $1.450.000. Te confirmamos el envío en un momento. 🎁`;
      break;
    case "addi":
      msg = `📅 *Crédito con Addi*\n\nCompra ahora, paga después, sin intereses. Sujeto a aprobación.\n\nEl equipo te pasará el link de Addi en un momento para que solicites el crédito por *${amount}*.`;
      break;
    case "supay":
      msg = `📅 *Crédito con Sü Pay*\n\nCompra ahora, paga después. Sujeto a aprobación.\n\nEl equipo te pasará el link de Sü Pay en un momento para que solicites el crédito por *${amount}*.`;
      break;
    default:
      msg = `Te paso los detalles de pago por aquí. Monto: ${amount}`;
  }
  await sendText(to, msg);
  return { sent: true, method: input.method };
}

async function executeNotifyTeam(to, input) {
  const header = `🚨 *Nueva venta cerrada*\nCliente WhatsApp: +${to}\n\n`;
  await notifyTeam(header + input.summary);
  return { notified: true, team_size: NOTIFICATION_PHONES.length };
}

async function executeHumanHandoff(to, input) {
  humanHandoff.add(to);
  const reason = input.reason || "solicitud_cliente";
  const notif = `🚨 *Handoff a humano*\nCliente: +${to}\nMotivo: ${reason}\n\nRevisa el chat en WhatsApp Business para continuar la conversación.`;
  await notifyTeam(notif);
  await sendText(to, "¡Listo! 🎉 Ya te conecté con alguien del equipo. Te escribirá en unos minutos por este mismo chat. 🙏");
  console.log(`Handoff activated for ${to}, reason: ${reason}`);
  return { handoff: true, bot_paused: true };
}

// ─── MAIN CONVERSATION LOOP ──────────────────────────────────────────────────

async function handleConversation(userId, userMessage) {
  // Si el cliente ya fue pasado a humano, bot no responde
  if (humanHandoff.has(userId)) {
    console.log(`[HANDOFF ACTIVE] Ignoring message from ${userId}`);
    return;
  }

  if (!conversations.has(userId)) conversations.set(userId, []);
  const history = conversations.get(userId);
  history.push({ role: "user", content: userMessage });

  let workingHistory = history.slice(-12);

  for (let iteration = 0; iteration < 8; iteration++) {
    try {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 1000,
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
          timeout: 40000,
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
            switch (toolUse.name) {
              case "search_products":
                result = await searchShopifyProducts(toolUse.input.query);
                console.log(`Search "${toolUse.input.query}": ${result.products?.length || 0} found`);
                break;
              case "send_product_card":
                result = await executeSendProductCard(userId, toolUse.input);
                break;
              case "send_store_location":
                result = await executeSendStoreLocation(userId);
                break;
              case "send_payment_info":
                result = await executeSendPaymentInfo(userId);
                break;
              case "send_warranty_info":
                result = await executeSendWarrantyInfo(userId);
                break;
              case "start_checkout":
                result = await executeStartCheckout(userId, toolUse.input);
                break;
              case "send_payment_link":
                result = await executeSendPaymentLink(userId, toolUse.input);
                break;
              case "notify_sale_team":
                result = await executeNotifyTeam(userId, toolUse.input);
                break;
              case "request_human_handoff":
                result = await executeHumanHandoff(userId, toolUse.input);
                break;
              default:
                result = { error: "Unknown tool: " + toolUse.name };
            }
          } catch (e) {
            console.error(`Tool ${toolUse.name} error:`, e.message);
            result = { error: e.message };
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        }
        workingHistory.push({ role: "user", content: toolResults });

        // Si el handoff se activó en esta iteración, no seguimos procesando
        if (humanHandoff.has(userId)) {
          conversations.set(userId, history.slice(-12));
          return;
        }
        continue;
      }

      const textBlock = content.find(c => c.type === "text");
      const reply = textBlock ? textBlock.text.trim() : "";
      history.push({ role: "assistant", content: reply || "(sin texto)" });
      conversations.set(userId, history.slice(-12));
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

// ─── WEBHOOK ─────────────────────────────────────────────────────────────────

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
      if (!humanHandoff.has(from)) {
        await sendText(from, "No puedo escuchar audio 😊 ¿Me escribes qué buscas?");
      }
    } else if (type === "image" || type === "document") {
      // Comprobantes de pago: no respondemos, dejamos que el cliente escriba "ya pagué" y el flujo siga
      console.log(`From ${from}: [${type}] (possibly payment proof)`);
    } else {
      console.log(`From ${from}: [${type}]`);
      if (!humanHandoff.has(from)) {
        await sendText(from, "Solo puedo leer texto por ahora 😊 ¿En qué te ayudo?");
      }
    }
  } catch (err) {
    console.error("Error processing message:", err);
  }
});

// ─── ADMIN ENDPOINTS ─────────────────────────────────────────────────────────

// Reactivar bot para un cliente (cuando el humano terminó de atenderlo)
app.get("/admin/release/:userId", (req, res) => {
  const userId = req.params.userId;
  const wasActive = humanHandoff.delete(userId);
  console.log(`[ADMIN] Released ${userId} (was handoff: ${wasActive})`);
  res.json({ ok: true, userId, wasInHandoff: wasActive });
});

app.get("/admin/status", (req, res) => {
  res.json({
    activeHandoffs: [...humanHandoff],
    activeCheckouts: [...checkouts.entries()].map(([k, v]) => ({ userId: k, ...v })),
    conversationCount: conversations.size,
  });
});

app.get("/", (req, res) => {
  res.send("RAV-Bot v9 (Sonnet 4.5)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RAV-Bot v9 (Sonnet 4.5) running on port ${PORT}`);
  console.log(`WA: ${WA_TOKEN ? "OK" : "MISSING"}`);
  console.log(`Anthropic: ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`Shopify: ${SHOPIFY_ADMIN_TOKEN ? "OK " + SHOPIFY_STORE_DOMAIN : "MISSING"}`);
  console.log(`Notifications: ${NOTIFICATION_PHONES.join(", ")}`);
});
