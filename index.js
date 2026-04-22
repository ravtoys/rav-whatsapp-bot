const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "rav_toys_webhook_2026";
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "999846293222612";

const greeted = new Set();

async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${WA_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Error sending message:", err.response?.data || err.message);
  }
}

async function handleMessage(from, text) {
  const msg = text.toLowerCase().trim();

  if (!greeted.has(from)) {
    greeted.add(from);
    await sendMessage(
      from,
      "¡Hola! 👋 Bienvenido a RAV Toys.\n\n¿En qué te puedo ayudar?\n\nEscribe una de estas palabras:\n\n🏷️ *precio* — ver productos y precios\n🏪 *tienda* — ubicación de nuestras tiendas\n📦 *pedido* — hacer un pedido\n👤 *equipo* — hablar con alguien del equipo"
    );
    return;
  }

  if (msg.includes("precio") || msg.includes("product") || msg.includes("catalogo") || msg.includes("catálogo")) {
    await sendMessage(
      from,
      "Tenemos juguetes desde $15.000 hasta $500.000 🎁\n\nVe nuestro catálogo completo aquí 👇\nhttps://ravtoys.com\n\n¿Buscas algo para una edad específica? Cuéntame y te recomiendo algo perfecto."
    );
  } else if (msg.includes("tienda") || msg.includes("local") || msg.includes("donde") || msg.includes("dónde")) {
    await sendMessage(
      from,
      "Estamos en dos tiendas 🏪\n\n📍 *Planet Selva* — Centro Comercial El Tesoro, Medellín\n📍 *Planet Luna* — Centro Comercial Santafé, Medellín\n\n⏰ Lunes–Sábado 10am–8pm | Domingos 11am–7pm\n\n¿Te gustaría apartar algo antes de venir?"
    );
  } else if (msg.includes("pedido") || msg.includes("comprar") || msg.includes("compra") || msg.includes("orden")) {
    await sendMessage(
      from,
      "¡Perfecto! Puedes comprar en nuestra tienda online 🛒\n\nhttps://ravtoys.com\n\nO cuéntame qué producto buscas y te ayudo directamente con tu pedido."
    );
  } else if (msg.includes("equipo") || msg.includes("humano") || msg.includes("asesor") || msg.includes("persona") || msg.includes("ayuda")) {
    await sendMessage(
      from,
      "Dame un segundo, te conecto con alguien del equipo 🚀\n\nEn un momento te atendemos."
    );
  } else {
    await sendMessage(
      from,
      "No entendí bien 😅\n\nEscribe una de estas palabras:\n\n🏷️ *precio* — ver productos y precios\n🏪 *tienda* — ubicación de nuestras tiendas\n📦 *pedido* — hacer un pedido\n👤 *equipo* — hablar con alguien del equipo"
    );
  }
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified ✅");
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
      await handleMessage(from, text);
    }
  } catch (err) {
    console.error("Error processing message:", err);
  }
});

app.get("/", (req, res) => {
  res.send("RAV Toys WhatsApp Bot is running 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 RAV Toys Bot running on port ${PORT}`);
});
