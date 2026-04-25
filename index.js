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
const NOTIFICATION_PHONES = (process.env.NOTIFICATION_PHONES || "573013507371").split(",").map(s => s.trim()).filter(Boolean);
// ─────────────────────────────────────────────────────────────────────────────────

if (!WA_TOKEN) { console.error("WA_TOKEN missing"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }

// ESTADO POR USUARIO
const conversations = new Map();
const humanHandoff = new Set();
const pendingRatings = new Set();

const RATING_REQUEST = `⭐ Antes de despedirnos, ¿cómo te pareció la atención del 1 al 5?

Tu opinión nos ayuda muchísimo a mejorar 💛`;
const lastSearchResults = new Map();
const checkouts = new Map();

const CHECKOUT_FIELDS = ["nombre", "cedula", "direccion", "telefono", "metodo_pago"];
const WARRANTY_FIELDS = ["factura_pedido", "cedula_nit", "fecha_compra", "motivo"];

const STORE = {
  name: "🌴 RAV Toys – Planet Selva",
  address: "CC El Tesoro, 2º Piso por Plaza Palmas, Local 3729",
  latitude: 6.19859,
  longitude: -75.55812,
};

const STORE_DIRECTIONS = "Estamos en el Parque Comercial El Tesoro en Medellín 🌴, sector Plaza Palmas, piso 2, Local 3729. Cerquita de Bancolombia, Ktronix, Valentina Bakery y H&M ✨ ¡Te esperamos!";

const PAYMENT_INFO = `🏦 *Medios de pago RAV Toys*

*1. Datáfono virtual Wompi* 📱 ⭐ _(lo más rápido, cierras ya)_
Paga con cualquier tarjeta débito o crédito:
https://checkout.wompi.co/l/iGnSPs
En el link coloca el valor a pagar y sigue los pasos ✨

*2. Transferencia Bancolombia* 💳
Cuenta ahorros: 37 938 445 851
RAV Kids SAS · NIT 900 822 164-1

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

const SHIPPING_INFO = `🚚 *Envíos a todo Colombia*

Llevamos los juguetes hasta donde estés ✨ Tenemos cobertura en casi todo el país a través de las principales transportadoras:

• Envia 🚛
• Coordinadora 📦
• Servientrega 📮
• TCC 🛻
• Interrapidisimo ⚡

⏱️ *Tiempo de entrega:* 2 a 5 días hábiles, según la transportadora y la ciudad de destino.

🌴 *¿Estás en Medellín?* ¡Buenas noticias! La mayoría de las veces entregamos el *mismo día* 🚀 Si quieres confirmar el tiempo exacto para tu pedido, dime y te paso con una asesora 💛`;

const SYSTEM_PROMPT = `Eres "RAV-Bot", vendedor virtual de RAV Toys (juguetería online en Medellín). Catálogo: ravtoys.com

TONO:
- Respuestas cortas (1-2 líneas máx) pero SIEMPRE cálidas y amables.
- Saludas con energía: "Hola soy RAV-Bot 🤖 Te doy la bienvenida a RAV Toys, la juguetería más cool del mundo entero y sus alrededores 🌎 ¿En qué te ayudo?"
- Usas "peque" para los niños.
- Cercano, chévere, entusiasta. Vendedor TOP, nunca pasivo.
- Si el cliente manda algo ambiguo ("?", emoji solo, mensaje corto confuso) o audio: responde con calidez ("¡Hola! 😊 Dime en qué te puedo ayudar con tus juguetes RAV Toys" / "No puedo escuchar audio 😊 Pero cuéntame por texto qué buscas y te ayudo encantado"). SIEMPRE redirige a algo de RAV Toys, nunca ofrezcas ayuda fuera del contexto RAV.

TONO EMPÁTICO Y HUMILDE (cuando no entiendas o necesites ayuda del cliente):
Cuando algo no quede claro, no entiendas un mensaje, no encuentres lo que el cliente describe, o necesites que repita/aclare algo, responde con humildad y calidez. NUNCA suenes robótico, frío o evasivo. Usa frases con emoji 🙈 🙏 ✨ que muestren que eres una IA aprendiendo.
Ejemplos del tono que queremos:
- "Soy inteligente pero aún no tanto como tú 🙈 Por fa copia y pégame el link del producto para poder ayudarte mejor ✨"
- "Mmm no estoy logrando entenderte bien 🙏 ¿Me lo cuentas con otras palabras? Quiero ayudarte bien"
- "Disculpa peque despiste 🙈 ¿Me dices el nombre del producto otra vez para buscarlo bien?"
- "Estoy aprendiendo cada día — ¿me ayudas pegando aquí lo que no entendí? 🙏"
NO uses frases frías como "No entiendo tu mensaje", "Procesa de nuevo", "Solicitud no válida", "No es posible". El cliente debe sentir que le estás dando lo mejor de ti.

PRODUCTOS:
- LIMITE DURO: máximo 2 search_products por turno. Si necesitas más variedad, REDIRIGE A LA WEB (ravtoys.com).
- Llama search_products con términos cortos (2-4 palabras).
- Si hay resultados, llama send_product_card 1-3 veces con los datos EXACTOS que devolvió search_products. NO inventes.
- Mensaje corto con gancho: "¡Tengo estas joyas! ¿Cuál te late?"
- Nunca listes productos en texto. Van siempre en tarjetas.

SI NO HAY MATCH (0 resultados):
- Busca otra cosa con términos distintos. Mínimo 3-4 intentos antes de ceder.
- NO mandes al cliente a la tienda.
- Último recurso: request_human_handoff.

UBICACIÓN:
- Si preguntan dónde están, dirección o ubicación → llama send_store_location (manda el mapa) Y ADEMÁS responde con este guión EXACTO (no inventes referencias): "Estamos en el Parque Comercial El Tesoro en Medellín 🌴, sector Plaza Palmas, piso 2, Local 3729. Cerquita de Bancolombia, Ktronix, Valentina Bakery y H&M ✨ ¡Te esperamos!"
- Si preguntan por cómo llegar o direcciones, responde SOLO con el guión de arriba. NUNCA menciones otro centro comercial ni inventes ubicaciones.

MEDIOS DE PAGO (info general):
- send_payment_info cuando preguntan cómo pagar fuera del checkout.

ENVÍOS:
- send_shipping_info cuando el cliente pregunte por envíos, cobertura, transportadoras, ciudades, despachos, tiempos de entrega, o "¿llega a mi ciudad?".
- Si después de send_shipping_info el cliente CONFIRMA que está en Medellín, o pide explícitamente confirmar el tiempo de entrega del mismo día (frases como "sí, soy de Medellín", "yo estoy en Medellín", "confírmame para Medellín", "hoy llega?", "puedo recibirlo hoy?"): pregúntale si quiere que lo pases con una asesora para confirmarle. Si dice que sí, llama request_human_handoff(reason="confirmar_envio_medellin"). Si dice que no o que ya tiene la info, no llames la tool y sigue la conversación normal.

CALIFICACIONES:
- Cuando el cliente cierra la conversación con frases como "gracias", "listo", "todo bien", "perfecto", "muchas gracias", "buenísimo": llama send_rating_request para pedirle calificar la atención.
- Cuando recibas la NOTA DEL SISTEMA al inicio de un turno diciendo "Cliente acaba de salir de handoff con humano. Pide calificación.", lo PRIMERO que haces es llamar send_rating_request. Aún si el cliente escribe sobre otra cosa, primero pide la calificación con calidez (ej: "¡Hola otra vez! Antes de seguir, ¿cómo te pareció la atención del 1 al 5? Tu opinión nos ayuda muchísimo 💛").
- Cuando el cliente responda con un número 1-5 (con o sin comentario), llama save_rating(rating, comment opcional). El sistema te dirá en next_action cómo agradecerle.
- Si rating <= 3: agradece con calidez Y ofrece pasarlo con un humano para entender qué mejorar (cuando el cliente acepte, llama request_human_handoff(reason="rating_bajo")).
- NO pidas rating si el cliente está en medio de una compra activa (lleva carrito), garantía o búsqueda. Solo en momentos de cierre o post-handoff.

GARANTÍAS (FLUJO COMPLETO — sigue paso a paso):
Cuando el cliente menciona producto dañado, defectuoso, cambio, devolución o "tengo garantía":

  PASO 1: Llama send_warranty_info para enviarle la política. Después dile algo cálido como "Para ayudarte con tu garantía necesito unos datos rapidito 🙏". NUNCA pases a humano sin recoger los datos primero.

  PASO 2: Pide UNO POR UNO (en este orden) y por cada respuesta llama save_warranty_field con el field correcto:
    - factura_pedido: "¿Me das tu número de factura o pedido?"
    - cedula_nit: "¿A nombre de qué cédula o NIT está la compra?"
    - fecha_compra: "¿Cuándo compraste el producto? (fecha aproximada)"
    - motivo: "¿Qué pasó con el producto? Cuéntame qué quieres reclamar"

  PASO 3: Cuando tengas los 4 campos, llama notify_warranty_team. El resultado incluye next_action que te dirá:
    1) Generar mensaje al cliente: "¡Listo! Ya pasé tu caso a nuestra asesora Eliana 🌴 Te escribirá pronto para ayudarte 💛"
    2) Llamar request_human_handoff(reason="garantia") en el MISMO turno.
  Si NO haces estos dos pasos, el cliente queda sin respuesta y sin handoff. Es OBLIGATORIO completar ambos.

  IMPORTANTE: Si el cliente da varios datos en un solo mensaje (ej "factura 1234, cédula 1037..."), llama save_warranty_field varias veces seguidas (una por dato). Si solo da uno, guárdalo y pide el siguiente.

═══════════════════════════════════════
CIERRE DE VENTA (FLUJO ESTRICTO)
═══════════════════════════════════════
Cuando el cliente indique que quiere comprar ("lo quiero", "me lo llevo", "hagamos el pedido", "cómo lo compro"):

PASO 1 — AGREGAR PRODUCTOS AL CARRITO (¡el cliente puede llevar VARIOS!):
  Llama select_product_for_purchase con el product_url EXACTO del producto elegido (debe ser un product_url que apareció en search_products previo).
  El sistema confirma el producto Y SU PRECIO REAL. TÚ NO DECIDES EL PRECIO ni sumas totales — el sistema lo hace.

  🛒 CROSS-SELL OBLIGATORIO: Después de cada select_product_for_purchase, el resultado incluye next_action que te dirá que preguntes al cliente si quiere agregar algo más. SIEMPRE pregunta esto. Ejemplos:
  - "¡Genial! 🎉 ¿Quieres agregar otro juguete a tu pedido?"
  - "¿Le agregamos algo más para tu peque? Tenemos cosas espectaculares"
  - "¿Algo más para llevar? Si quieres ver lo que llevas en el carrito, dime y te lo confirmo"

  Si dice SÍ → busca con search_products → llama select_product_for_purchase otra vez (se acumula).
  Si dice NO o "ya está bien" → procede al PASO 2.
  En cualquier momento puedes llamar view_current_purchase para confirmar el carrito y total.
  Si quiere quitar algo → remove_product_from_purchase con el product_url.

  Cuando el cliente menciona PRESUPUESTO (ej: "tengo 1.000.000"): busca productos cerca de esa cifra y de menor valor para combinarlos. La idea es ofrecer combinaciones que sumen ~el presupuesto. Aprovecha el carrito multi-producto.

CASOS ESPECIALES DE COMPRA:

  💰 PRESUPUESTO: Si el cliente menciona presupuesto (ej "tengo 1.000.000"), haz UNA búsqueda con la palabra clave principal y propón 2-3 productos que sumen cerca del presupuesto.

  🧒 VARIOS PEQUES: Si menciona varios peques de distintas edades, haz UNA búsqueda por la edad principal y sugiere uno por cada edad.

  🌐 SECUENCIA OBLIGATORIA — primero opciones, después redirigir:
  PASO 1: Cuando el cliente pida productos (incluso con presupuesto o varios peques), SIEMPRE muestra primero las opciones que tienes con search_products + send_product_card. NO redirijas a la web sin haber mostrado opciones.
  PASO 2: SOLO si después de ver las opciones el cliente dice "más", "otras", "no me gustan", "qué más tienes", "otra cosa": ahí sí responde algo como:
  "Tengo muchísimas más opciones espectaculares en nuestra web 🌐 https://ravtoys.com — explora con calma y mándame los links de los que te enamores, te los agrego al carrito al toque ✨"

  🔗 LINKS — REGLAS DURAS:
  - NUNCA envuelvas URLs con asteriscos, guiones, comillas o markdown. WhatsApp NO renderiza markdown — el link se ve roto.
  - URL correcto: https://ravtoys.com  ❌ Incorrecto: **ravtoys.com**, *ravtoys.com*, [ravtoys.com](url)
  - Cuando el cliente PEGUE un link de ravtoys.com (ej "https://ravtoys.com/products/super-rocket"):
    1. Extrae palabras del handle (después de /products/, separado por guiones).
    2. Llama search_products con esas palabras.
    3. Si lo encuentras, llama select_product_for_purchase con el product_url exacto.
    4. Confírmale y pregunta "¿algo más?".

  🛒 REGLA DE ORO DEL CROSS-SELL: Después de cada select_product_for_purchase, SIEMPRE pregunta "¿algo más?". El sistema te lo recuerda en next_action.
  Si dice "no, ya está" → pasa al PASO 2.
  Si dice "sí" o pega un link → repite agregar al carrito.

PASO 2 — RECOGER DATOS (uno por uno):
  Pides el dato, esperas la respuesta del cliente, y llamas save_checkout_field con el valor EXACTO que escribió.
  Orden OBLIGATORIO:
  a) save_checkout_field(field="nombre", value="...") — nombre completo
  b) save_checkout_field(field="cedula", value="...") — cédula
  c) save_checkout_field(field="direccion", value="...") — dirección + ciudad
  d) save_checkout_field(field="telefono", value="...") — teléfono de contacto

  Nunca saltes un paso. La cédula es SIEMPRE obligatoria.

PASO 3 — MOSTRAR MEDIOS DE PAGO:
  Cuando los 4 datos estén guardados, llama send_payment_info.

PASO 4 — GUARDAR MÉTODO ELEGIDO:
  save_checkout_field(field="metodo_pago", value="<transferencia|wompi|contraentrega|addi|supay>")

PASO 5 — ENVIAR INSTRUCCIONES DE PAGO:
  send_payment_link(method="<transferencia|wompi|contraentrega|addi|supay>")
  (El sistema usa el precio real del producto, tú no pasas monto)

  El resultado de send_payment_link incluye next_action — SIGUE ESA INSTRUCCIÓN AL PIE DE LA LETRA.

PASO 6 — SEGÚN EL MÉTODO:

  ⭐ WOMPI o TRANSFERENCIA (automatizados):
  Después de send_payment_link, espera silenciosamente a que el cliente diga "ya pagué", "listo", "transferí" o mande comprobante. Cuando confirme:
  → Llama notify_sale_team (sin argumentos)
  → Llama request_human_handoff(reason="venta_cerrada")

  CONTRAENTREGA, ADDI o SÜ PAY (requieren humano para cerrar):
  INMEDIATAMENTE después de send_payment_link, en EL MISMO TURNO:
  → Llama notify_sale_team (sin argumentos)
  → Llama request_human_handoff(reason="venta_metodo_manual")
  No esperes confirmación del cliente. El humano del equipo seguirá la conversación.

═══════════════════════════════════════

HUMANO DIRECTO:
- Si piden hablar con asesor, persona, humano → request_human_handoff(reason="solicitud_cliente").

HORARIOS (solo si preguntan, responde con este formato cool): "🕐 *Nuestros horarios*\n\nDom–Mié: 11:00 am – 8:00 pm\nJue–Sáb: 10:00 am – 9:00 pm\nFestivos: horario de domingo (11am–8pm)\n\n¡Te esperamos! 🌴"

NOTAS DE VOZ:
- Si mandan audio: "No puedo escuchar audio 😊 ¿Me escribes qué buscas?"

NUNCA INVENTES: precios, productos, links, stock, políticas, ni datos del cliente.`;

const TOOLS = [
  {
    name: "search_products",
    description: "Busca productos reales en el catálogo Shopify de RAV Toys. Devuelve hasta 5 con título, precio, image_url, product_url, descripción y stock. Úsalo SIEMPRE que el cliente pida un producto.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Términos cortos (2-4 palabras). Ej: 'muñeca princesa', 'carro control remoto'." }
      },
      required: ["query"]
    }
  },
  {
    name: "send_product_card",
    description: "Envía UNA tarjeta con imagen + nombre + precio + link. Usa los datos EXACTOS que devolvió search_products. Llama 1-3 veces (una por producto) antes de responder texto.",
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
    description: "Envía la ubicación de Planet Selva. SOLO si preguntan explícitamente por dirección, ubicación o cómo llegar.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "send_payment_info",
    description: "Envía el mensaje con los 4 medios de pago. Úsalo cuando preguntan cómo pagar, o dentro del flujo de checkout después de recoger los datos del cliente.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "send_warranty_info",
    description: "Envía el resumen de garantías. Úsalo cuando mencionan producto dañado, cambio, devolución o garantía.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "send_shipping_info",
    description: "Envía la información de envíos: cobertura, transportadoras y tiempos de entrega. Úsalo cuando el cliente pregunte por envíos, despachos, cobertura, ciudades, transportadoras, cuánto tarda el pedido, o algo similar.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "send_rating_request",
    description: "Envía un mensaje pidiendo al cliente calificar la atención del 1 al 5. Úsalo cuando: (a) el cliente cierra con frases como 'gracias', 'listo', 'todo bien', 'perfecto', 'muchas gracias'; (b) el sistema te indica que el cliente acaba de salir de un handoff con humano. NO lo uses si el cliente está en medio de una compra, búsqueda o garantía.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "save_rating",
    description: "Guarda la calificación del cliente (1 a 5) y notifica al equipo. Llámalo cuando el cliente responda con un número después de send_rating_request. Si dejó comentario, inclúyelo.",
    input_schema: {
      type: "object",
      properties: {
        rating: { type: "integer", minimum: 1, maximum: 5, description: "Calificación de 1 a 5" },
        comment: { type: "string", description: "Comentario opcional del cliente" }
      },
      required: ["rating"]
    }
  },
  {
    name: "save_warranty_field",
    description: "Guarda un dato del flujo de reclamación de garantía. Llámalo cada vez que el cliente provea su número de factura/pedido, cédula/NIT, fecha de compra, o motivo. Una llamada por dato.",
    input_schema: {
      type: "object",
      properties: {
        field: { type: "string", enum: ["factura_pedido", "cedula_nit", "fecha_compra", "motivo"], description: "Cuál dato de garantía estás guardando" },
        value: { type: "string", description: "Valor exacto que dio el cliente" }
      },
      required: ["field", "value"]
    }
  },
  {
    name: "notify_warranty_team",
    description: "Envía resumen de la reclamación al equipo y pasa a humano (Eliana). Llámalo SOLO después de tener los 4 campos: factura_pedido, cedula_nit, fecha_compra y motivo.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "select_product_for_purchase",
    description: "Marca un producto como el elegido por el cliente para la compra. Debe ser un product_url que apareció en un search_products previo. El sistema guarda el producto con su precio REAL (no lo decide el modelo). Usa esta tool al inicio del flujo de checkout.",
    input_schema: {
      type: "object",
      properties: {
        product_url: { type: "string", description: "product_url EXACTO del producto elegido (debe venir de un search_products previo)" }
      },
      required: ["product_url"]
    }
  },
  {
    name: "view_current_purchase",
    description: "Devuelve la lista actual de productos en el carrito del cliente con el total. Úsalo para confirmar al cliente lo que lleva antes de cerrar la compra, o cuando dice 'qué llevo' o 'cuánto va'.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "remove_product_from_purchase",
    description: "Quita UN producto del carrito por su product_url. Úsalo si el cliente cambia de opinión sobre algo que ya había agregado.",
    input_schema: {
      type: "object",
      properties: {
        product_url: { type: "string", description: "product_url EXACTO del producto a quitar" }
      },
      required: ["product_url"]
    }
  },
  {
    name: "save_checkout_field",
    description: "Guarda un campo específico del checkout con su valor. Llámalo después de que el cliente responda cada pregunta del flujo de cierre. Campos permitidos: nombre, cedula, direccion, telefono, metodo_pago.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: ["nombre", "cedula", "direccion", "telefono", "metodo_pago"],
          description: "Cuál campo estás guardando"
        },
        value: { type: "string", description: "El valor EXACTO que escribió el cliente (sin cambios, ni resumen)" }
      },
      required: ["field", "value"]
    }
  },
  {
    name: "send_payment_link",
    description: "Envía al cliente las instrucciones del método de pago. El sistema usa el precio REAL del producto seleccionado (NO pasas monto, el backend lo calcula).",
    input_schema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["transferencia", "wompi", "contraentrega", "addi", "supay"],
          description: "Método elegido por el cliente"
        }
      },
      required: ["method"]
    }
  },
  {
    name: "notify_sale_team",
    description: "Notifica al equipo RAV Toys que hay una venta lista. El sistema arma el resumen con los datos guardados en el checkout (producto, precio real, cliente). TÚ NO PASAS EL RESUMEN. Llámalo después de que el cliente confirme que pagó. Luego llama request_human_handoff.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "request_human_handoff",
    description: "Pasa la conversación a un humano. Úsalo cuando: (a) el cliente pida hablar con una persona, (b) después de notify_sale_team, (c) último recurso cuando no puedas ayudar. Notifica al equipo y detiene el bot para este cliente.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo: 'venta_cerrada', 'solicitud_cliente', 'caso_complejo', 'garantia', etc."
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
      const priceAmount = Math.round(parseFloat(minPrice.amount));
      const priceStr = minPrice.amount === maxPrice.amount
        ? `$${priceAmount.toLocaleString("es-CO")} ${minPrice.currencyCode}`
        : `$${priceAmount.toLocaleString("es-CO")} - $${Math.round(parseFloat(maxPrice.amount)).toLocaleString("es-CO")} ${minPrice.currencyCode}`;
      return {
        title: p.title,
        description: (p.description || "").slice(0, 150),
        price: priceStr,
        price_amount: priceAmount,
        currency: minPrice.currencyCode,
        product_url: `https://ravtoys.com/products/${p.handle}`,
        image_url: p.featuredImage?.url || "",
        available: (p.totalInventory ?? 0) > 0,
        stock: p.totalInventory,
        type: p.productType,
      };
    });

    const inStock = products.filter(p => p.available && p.stock > 0);


    return { products: inStock, count: inStock.length };
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
  } catch (err) {
    console.error("WA location error:", err.response?.data?.error || err.message);
  }
}

async function notifyTeam(text, excludePhone) {
  let sent = 0;
  for (const phone of NOTIFICATION_PHONES) {
    if (excludePhone && phone === excludePhone) {
      console.log(`Skipped self-notification to ${phone} (is current customer)`);
      continue;
    }
    try {
      await sendText(phone, text);
      sent++;
    } catch (err) {
      console.log(`[NOTIFY] Failed to send to ${phone}: ${err.message || err}. Continuing with rest.`);
    }
  }
  console.log(`Notified team (${sent}/${NOTIFICATION_PHONES.length} numbers)`);
}

// ─── EXECUTORS ───────────────────────────────────────────────────────────────

async function executeSearchProducts(userId, input) {
  const result = await searchShopifyProducts(input.query);
  // Guardar productos mostrados al cliente
  if (result.products && result.products.length > 0) {
    lastSearchResults.set(userId, result.products);
  }
  return result;
}

async function executeSendProductCard(to, input) {
  const caption = `*${input.title}*\n${input.price}\n${input.product_url}`;
  const ok = await sendImage(to, input.image_url, caption);
  if (!ok) await sendText(to, caption);
  console.log(`Card sent: ${input.title} @ ${input.price}`);
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

async function executeSendShippingInfo(userId) {
  await sendText(userId, SHIPPING_INFO);
  return { sent: true };
}

async function executeSendRatingRequest(userId) {
  await sendText(userId, RATING_REQUEST);
  pendingRatings.add(userId);
  console.log(`[Rating ${userId}] Request sent`);
  return { sent: true, next_action: "Espera la respuesta del cliente con un número 1-5. Cuando responda, llama save_rating con el rating y comment opcional." };
}

async function executeSaveRating(userId, input) {
  const stars = "⭐".repeat(input.rating) + "☆".repeat(5 - input.rating);
  const summary = [
    "📊 *NUEVA CALIFICACIÓN DE ATENCIÓN*",
    "",
    `Calificación: ${input.rating}/5  ${stars}`,
    input.comment ? `Comentario: ${input.comment}` : "(sin comentario)",
    "",
    `📱 WhatsApp del cliente: +${userId}`
  ].join("\n");
  await notifyTeam(summary, userId);
  pendingRatings.delete(userId);
  console.log(`[Rating ${userId}] Saved: ${input.rating}/5${input.comment ? ` - "${input.comment}"` : ""}`);
  const lowRating = input.rating <= 3;
  return {
    saved: true,
    rating: input.rating,
    next_action: lowRating
      ? "Agradece con calidez ('Gracias por tu sinceridad 💛'), pero también ofrece pasarlo con un humano para entender qué podemos mejorar. Si acepta, llama request_human_handoff(reason='rating_bajo')."
      : "Agradécele al cliente con calidez (algo como '¡Mil gracias por calificarnos! Te esperamos pronto en RAV Toys 🌴💛')."
  };
}

async function executeSaveWarrantyField(userId, input) {
  if (!checkouts.has(userId)) checkouts.set(userId, { products: [], data: {} });
  const state = checkouts.get(userId);
  if (!state.warranty) state.warranty = {};
  state.warranty[input.field] = input.value;
  checkouts.set(userId, state);
  const missing = WARRANTY_FIELDS.filter(f => !state.warranty[f]);
  console.log(`[Warranty ${userId}] Saved ${input.field}=${input.value}. Missing: ${missing.join(",") || "none"}`);
  return { saved: input.field, value: input.value, missing_fields: missing };
}

async function executeNotifyWarrantyTeam(userId) {
  const state = checkouts.get(userId);
  if (!state || !state.warranty) {
    return { error: "No hay datos de garantía. Usa save_warranty_field primero." };
  }
  const missing = WARRANTY_FIELDS.filter(f => !state.warranty[f]);
  if (missing.length > 0) {
    return { error: "Faltan datos: " + missing.join(", ") + ". Pídelos antes de notificar." };
  }
  const w = state.warranty;
  const summary = [
    "🛠️ *NUEVA RECLAMACIÓN DE GARANTÍA*",
    "",
    "📄 Factura/Pedido: " + w.factura_pedido,
    "🆔 Cédula/NIT: " + w.cedula_nit,
    "📅 Fecha de compra: " + w.fecha_compra,
    "❓ Motivo: " + w.motivo,
    "",
    "📱 WhatsApp del cliente: +" + userId,
    "",
    "Pendiente: validar condiciones de garantía y dar respuesta al cliente."
  ].join("\n");
  await notifyTeam(summary, userId);
  console.log(`[Warranty ${userId}] Team notified, awaiting handoff`);
  return { notified: true, next_action: "ACCION OBLIGATORIA INMEDIATA: 1) Dile al cliente algo como '¡Listo! Ya pasé tu caso a nuestra asesora Eliana 🌴 Te escribirá pronto para ayudarte 💛'. 2) Llama request_human_handoff(reason='garantia'). NO termines el turno sin estos dos pasos." };
}

async function executeSelectProductForPurchase(userId, input) {
  const products = lastSearchResults.get(userId) || [];
  const chosen = products.find(p => p.product_url === input.product_url);
  if (!chosen) {
    return {
      error: "Producto no encontrado. Debes elegir un product_url que viene del último search_products. Haz un search_products primero si es necesario.",
      available_urls: products.map(p => p.product_url)
    };
  }
  if (!checkouts.has(userId)) checkouts.set(userId, { products: [], data: {} });
  const state = checkouts.get(userId);
  if (!state.products) state.products = [];
  // Si ya está en el carrito, no duplicar
  const existing = state.products.find(p => p.product_url === chosen.product_url);
  if (existing) {
    const total = state.products.reduce((sum, p) => sum + (p.price_amount || 0), 0);
    return {
      already_in_cart: true,
      title: chosen.title,
      cart_count: state.products.length,
      cart_total: `${total.toLocaleString("es-CO")} ${state.products[0].currency}`,
      next_action: "Avísale al cliente que ese producto ya está en el carrito y pregunta si quiere agregar otra cosa."
    };
  }
  state.products.push(chosen);
  checkouts.set(userId, state);
  const total = state.products.reduce((sum, p) => sum + (p.price_amount || 0), 0);
  console.log(`[Checkout ${userId}] Added: ${chosen.title} @ ${chosen.price}. Cart now: ${state.products.length} items, total ${total}`);
  return {
    added: true,
    title: chosen.title,
    price: chosen.price,
    cart_count: state.products.length,
    cart_total: `${total.toLocaleString("es-CO")} ${state.products[0].currency}`,
    next_action: "Pregunta al cliente si quiere agregar algo más a su pedido. Algo como '¡Genial! ¿Quieres agregar otro juguete a tu pedido?'. Si dice que sí, busca otra cosa. Si dice que no, procede a recoger los datos del cliente."
  };
}

async function executeViewCurrentPurchase(userId) {
  const state = checkouts.get(userId);
  if (!state || !state.products || state.products.length === 0) {
    return { empty: true, message: "El cliente aún no ha seleccionado productos." };
  }
  const total = state.products.reduce((sum, p) => sum + (p.price_amount || 0), 0);
  return {
    products: state.products.map(p => ({ title: p.title, price: p.price, product_url: p.product_url })),
    count: state.products.length,
    total: `${total.toLocaleString("es-CO")} ${state.products[0].currency}`
  };
}

async function executeRemoveProductFromPurchase(userId, input) {
  const state = checkouts.get(userId);
  if (!state || !state.products || state.products.length === 0) {
    return { error: "No hay productos en el carrito." };
  }
  const idx = state.products.findIndex(p => p.product_url === input.product_url);
  if (idx === -1) return { error: "Ese producto no está en el carrito." };
  const removed = state.products.splice(idx, 1)[0];
  checkouts.set(userId, state);
  const total = state.products.reduce((sum, p) => sum + (p.price_amount || 0), 0);
  console.log(`[Checkout ${userId}] Removed: ${removed.title}. Cart now: ${state.products.length} items`);
  return {
    removed: true,
    title: removed.title,
    remaining: state.products.length,
    cart_total: state.products.length > 0 ? `${total.toLocaleString("es-CO")} ${state.products[0].currency}` : "$0"
  };
}

async function executeSaveCheckoutField(userId, input) {
  if (!checkouts.has(userId)) checkouts.set(userId, { data: {} });
  const state = checkouts.get(userId);
  if (!state.data) state.data = {};
  if (!state.products || state.products.length === 0) {
    return {
      error: "No hay productos en el carrito. Primero llama select_product_for_purchase con el producto que el cliente quiere comprar."
    };
  }
  state.data[input.field] = input.value;
  checkouts.set(userId, state);
  const missing = CHECKOUT_FIELDS.filter(f => !state.data[f]);
  console.log(`[Checkout ${userId}] Saved ${input.field}=${input.value}. Missing: ${missing.join(",") || "none"}`);
  return {
    saved: input.field,
    value: input.value,
    missing_fields: missing,
    complete: missing.length === 0
  };
}

async function executeSendPaymentLink(userId, input) {
  const state = checkouts.get(userId);
  if (!state || !state.products || state.products.length === 0) {
    return { error: "No hay productos en el carrito. Llama select_product_for_purchase primero." };
  }
  const totalAmount = state.products.reduce((sum, p) => sum + (p.price_amount || 0), 0);
  const currency = state.products[0].currency || "COP";
  const amount = `${totalAmount.toLocaleString("es-CO")} ${currency}`;
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
  await sendText(userId, msg);
  console.log(`[Checkout ${userId}] Payment link sent: ${input.method} for ${amount}`);
  const automatedMethods = ["wompi", "transferencia"];
  const isAutomated = automatedMethods.includes(input.method);
  const next_action = isAutomated
    ? "Espera silenciosamente a que el cliente confirme el pago ('ya pagué', 'listo', 'transferí'). Cuando confirme, llama notify_sale_team y luego request_human_handoff(reason='venta_cerrada')."
    : "ACCION OBLIGATORIA INMEDIATA EN ESTE MISMO TURNO: llama notify_sale_team (sin argumentos) y luego request_human_handoff(reason='venta_metodo_manual'). NO esperes que el cliente diga nada. El humano continuará.";
  return { sent: true, method: input.method, amount, automated: isAutomated, next_action };
}

async function executeNotifyTeam(userId) {
  const state = checkouts.get(userId);
  if (!state || !state.products || state.products.length === 0) {
    return { error: "No hay checkout completo para notificar." };
  }
  const missing = CHECKOUT_FIELDS.filter(f => !state.data?.[f]);
  if (missing.length > 0) {
    return { error: "Faltan campos del cliente: " + missing.join(", ") + ". Pídelos antes de notificar al equipo." };
  }
  const d = state.data;
  const totalAmount = state.products.reduce((sum, p) => sum + (p.price_amount || 0), 0);
  const currency = state.products[0].currency || "COP";
  const formattedTotal = `${totalAmount.toLocaleString("es-CO")} ${currency}`;
  const productsList = state.products.map((p, i) => `  ${i+1}. ${p.title} — ${p.price}\n     ${p.product_url}`).join("\n");
  const summary = [
    "🚨 *NUEVA VENTA CERRADA* 🎉",
    "",
    `📦 Productos (${state.products.length}):`,
    productsList,
    "",
    `💰 *TOTAL: ${formattedTotal}*`,
    "",
    "👤 *Datos del cliente*",
    "Nombre: " + d.nombre,
    "Cédula: " + d.cedula,
    "Dirección: " + d.direccion,
    "Teléfono: " + d.telefono,
    "WhatsApp: +" + userId,
    "",
    "💳 Método de pago: " + d.metodo_pago,
    "",
    "Pendiente: confirmar pago y despachar pedido."
  ].join("\n");
  await notifyTeam(summary, userId);
  console.log(`[Checkout ${userId}] Team notified — ${state.products.length} products, total ${formattedTotal}`);
  return { notified: true, team_size: NOTIFICATION_PHONES.length, products_count: state.products.length };
}

async function executeHumanHandoff(userId, input) {
  humanHandoff.add(userId);
  const reason = input.reason || "solicitud_cliente";
  const state = checkouts.get(userId);
  let notif = `🚨 *Handoff a humano*\nCliente: +${userId}\nMotivo: ${reason}\n\n`;
  if (state?.products && state.products.length > 0 && reason !== "venta_cerrada") {
    if (state.products.length === 1) {
      notif += `(Producto en checkout: ${state.products[0].title} @ ${state.products[0].price})\n\n`;
    } else {
      const total = state.products.reduce((sum, p) => sum + (p.price_amount || 0), 0);
      const currency = state.products[0].currency || "COP";
      notif += `(En checkout: ${state.products.length} productos · Total: ${total.toLocaleString("es-CO")} ${currency})\n\n`;
    }
  }
  notif += "Toma el control en WhatsApp Business.";
  await notifyTeam(notif, userId);
  await sendText(userId, "¡Listo! 🎉 Ya te conecté con alguien del equipo. Te escribirá en unos minutos por este mismo chat. 🙏");
  console.log(`Handoff activated for ${userId}, reason: ${reason}`);
  return { handoff: true, bot_paused: true };
}

// ─── MAIN CONVERSATION LOOP ──────────────────────────────────────────────────


async function handleConversation(userId, userMessage) {
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
          system: pendingRatings.has(userId) ? SYSTEM_PROMPT + "\n\n⚠️ NOTA DEL SISTEMA: Cliente acaba de salir de handoff con humano. Pide calificación con send_rating_request ANTES de responder a otra cosa que diga." : SYSTEM_PROMPT,
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
                result = await executeSearchProducts(userId, toolUse.input);
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
              case "send_shipping_info":
                result = await executeSendShippingInfo(userId);
                break;
              case "send_rating_request":
                result = await executeSendRatingRequest(userId);
                break;
              case "save_rating":
                result = await executeSaveRating(userId, toolUse.input);
                break;
              case "save_warranty_field":
                result = await executeSaveWarrantyField(userId, toolUse.input);
                break;
              case "notify_warranty_team":
                result = await executeNotifyWarrantyTeam(userId);
                break;
              case "select_product_for_purchase":
                result = await executeSelectProductForPurchase(userId, toolUse.input);
                break;
              case "view_current_purchase":
                result = await executeViewCurrentPurchase(userId);
                break;
              case "remove_product_from_purchase":
                result = await executeRemoveProductFromPurchase(userId, toolUse.input);
                break;
              case "save_checkout_field":
                result = await executeSaveCheckoutField(userId, toolUse.input);
                break;
              case "send_payment_link":
                result = await executeSendPaymentLink(userId, toolUse.input);
                break;
              case "notify_sale_team":
                result = await executeNotifyTeam(userId);
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

app.get("/admin/release/:userId", (req, res) => {
  const userId = req.params.userId;
  const wasActive = humanHandoff.delete(userId);
  pendingRatings.add(userId);
  console.log(`[ADMIN] Released ${userId} (was handoff: ${wasActive})`);
  res.json({ ok: true, userId, wasInHandoff: wasActive });
});

app.get("/admin/reset-checkout/:userId", (req, res) => {
  const userId = req.params.userId;
  const had = checkouts.delete(userId);
  res.json({ ok: true, userId, hadCheckout: had });
});

app.get("/admin/status", (req, res) => {
  res.json({
    activeHandoffs: [...humanHandoff],
    activeCheckouts: [...checkouts.entries()].map(([k, v]) => ({
      userId: k,
      products: v.products?.map(p => ({title: p.title, price: p.price})) || [],
      total_amount: (v.products || []).reduce((sum, p) => sum + (p.price_amount || 0), 0),
      data: v.data
    })),
    conversationCount: conversations.size,
  });
});

app.get("/", (req, res) => {
  res.send("RAV-Bot v26 (Sonnet 4.5, customer satisfaction ratings)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RAV-Bot v26 (Sonnet 4.5, customer satisfaction ratings) running on port ${PORT}`);
  console.log(`WA: ${WA_TOKEN ? "OK" : "MISSING"}`);
  console.log(`Anthropic: ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`Shopify: ${SHOPIFY_ADMIN_TOKEN ? "OK " + SHOPIFY_STORE_DOMAIN : "MISSING"}`);
  console.log(`Notifications: ${NOTIFICATION_PHONES.join(", ")}`);
});
