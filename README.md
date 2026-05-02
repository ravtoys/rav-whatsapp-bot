# RAV Toys WhatsApp Bot

Bot de WhatsApp para RAV Toys (Medellín, Colombia). Atiende clientes 24/7 con búsqueda de productos en Shopify, manejo de garantías, envíos, cierre de ventas con derivación a humanos cuando se necesita, y captura de calificaciones.

---

## 🎯 Qué hace

- 🔍 **Búsqueda de productos** en Shopify storefront — devuelve los mismos resultados que ve el cliente en la web
- 🛒 **Carrito y cierre de venta** — el cliente pega links de productos y el bot toma el pedido
- ✨ **Recomendaciones inteligentes** — 3 opciones + link al catálogo filtrado por la búsqueda del cliente
- 🛡️ **Garantías** — flujo guiado con factura, cédula, fecha, motivo + handoff a humano
- 🚚 **Envíos** — info de transportadoras + same-day para Medellín con handoff opcional
- ⭐ **Calificaciones** — pide rating 1-5 al cierre o post-handoff; rating bajo escala a humano
- 🤝 **Handoff a humano** — Eliana (asesora comercial) recibe alertas en su WhatsApp
- 🙈 **Manejo cálido de multimedia** — explica que aún no ve imágenes y guía al cliente a mandar links

---

## 🏗️ Stack

- **Runtime:** Node.js en [Render](https://render.com) (free tier — duerme tras 15 min sin tráfico, ~50s spin-up)
- **Webhook:** Meta WhatsApp Business Cloud API
- **IA:** Anthropic Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- **Catálogo:** Shopify storefront search JSON endpoint (`ravtoys.com/search?q=X&view=json`)
- **Memoria:** in-memory (Maps) — se reinicia cuando Render duerme

---

## ⚙️ Variables de entorno (Render)

| Variable | Descripción |
|---|---|
| `WA_TOKEN` | Token permanente de Meta WhatsApp |
| `PHONE_NUMBER_ID` | ID del número WhatsApp registrado en Meta |
| `VERIFY_TOKEN` | Token de verificación del webhook (default: `rav_toys_webhook_2026`) |
| `ANTHROPIC_API_KEY` | API key de Anthropic (Claude) |
| `SHOPIFY_STORE_DOMAIN` | Dominio Shopify (default: `ravtoys.myshopify.com`) |
| `SHOPIFY_ADMIN_TOKEN` | Token Admin de Shopify (`shpat_...`) |
| `NOTIFICATION_PHONES` | Números a notificar (CSV sin +): `573013507371,573046653449` |

---

## 📡 Endpoints admin

| Endpoint | Para qué |
|---|---|
| `GET /admin/health` | Estado del bot: versión, uptime, conexión a Shopify y Meta, presencia de keys |
| `GET /admin/stats` | Snapshot del estado: handoffs activos, ratings pendientes, carritos en curso |
| `GET /admin/test-search?q=XXXX` | Prueba la búsqueda de productos sin afectar a clientes reales |
| `GET /admin/release/:userId` | Libera un handoff manual de Eliana (vuelve el bot a atender) y marca para pedir rating |

**Uso típico antes de un cambio:** abrir `/admin/health` para ver que todo está OK, después `/admin/test-search?q=carros+montables` para verificar búsquedas.

---

## 🌊 Flujo de conversación

```
Cliente → Webhook Meta → Bot (Claude)
                         ├── search_products       → Shopify storefront
                         ├── send_product_card     → Meta WhatsApp API
                         ├── select_product        → Estado interno (carrito)
                         ├── save_warranty_field   → Estado interno (garantías)
                         ├── send_shipping_info    → Texto plano
                         ├── send_rating_request   → Texto plano
                         ├── save_rating           → Notificación a Boss
                         └── request_human_handoff → Notificación a Eliana
```

**Reglas clave del prompt:**
- LIMITE DURO: máximo 1 `search_products` por turno (anti rate-limit)
- 3 productos máximo por recomendación + link al catálogo de búsqueda
- Tono: empático, "peque" como gender-neutral
- IMÁGENES: bot no las ve; pide al cliente mandar el link del producto

---

## 🚀 Deploy

El servicio en Render auto-deploya cuando hay un push a la rama `main` de este repo.

1. `git push origin main` (o editar via web GitHub)
2. Render detecta el cambio y despliega automáticamente (~60-90s)
3. Verificar con `GET /admin/health` que el bot esté arriba

---

## 🐛 Troubleshooting

### El bot no responde
1. Abrir `/admin/health` — si muestra error, ver qué dependencia falla
2. Si `anthropic_key_present: true` pero el bot no responde, probable saldo agotado → recargar en https://platform.claude.com/settings/billing
3. Si `shopify_storefront` da error, ver si `ravtoys.com` responde

### El bot dice "no encontré" pero la web sí muestra productos
- Probar `/admin/test-search?q=lo+mismo` — si devuelve 0 resultados, hay bug
- Si devuelve resultados, posiblemente el modelo no los está pasando al cliente — revisar logs de Render

### Costos disparados
- Verificar token usage en https://platform.claude.com/settings/usage
- Ratio sano: input/output ~10:1 después del prompt caching (v30+)
- Si ratio >30:1, prompt caching no está funcionando — revisar que `cache_control` esté en system+tools

### Logs en Render
- Dashboard → `rav-whatsapp-bot` → `Logs` (free tier solo guarda 1h)
- Logs estructurados (v32+) en formato JSON: `{ts, level, event, ...data}`

---

## 📋 Histórico de versiones (resumido)

| Versión | Cambio principal |
|---|---|
| v9-v22 | Construcción base: tools, garantías, envíos, handoffs |
| v23 | Try/catch en notifyTeam (#131030 no crashea flujo) |
| v24-v25 | Sonnet 4.5 + envíos Medellín same-day |
| v26 | Sistema de calificación 1-5 con triggers natural y post-handoff |
| v27 | 3 opciones + link de búsqueda específico al catálogo |
| v27.1 | Hard cap 1 `search_products` por turno (anti rate-limit) |
| v28 | CTA "mándame el link y te tomo el pedido" + multimedia handling cálido |
| v29 | Búsqueda migrada a Shopify storefront JSON (cero falsos negativos) |
| v30 | Prompt caching + historial 12→8 (-85% input cost) |
| v31 | Endpoints admin: health, stats, test-search |
| v32 | Alerta de saldo bajo + cache de búsqueda 5min + logger estructurado |
| v32.1 | `BOT_VERSION` constante centralizada |

---

## 👥 Contacto

- **Owner:** Santiago Velásquez (CEO RAV Toys)
- **Asesora comercial:** Eliana (responde handoffs)
- **Tienda física:** Planet Selva, CC El Tesoro, Local 3729 (Medellín)
- **E-commerce:** [ravtoys.com](https://ravtoys.com)
