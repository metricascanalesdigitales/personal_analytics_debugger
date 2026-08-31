# Personal Analytics Debugger

Extensión de Chrome (Manifest V3) para **auditar las métricas que se envían a Google Analytics 4**.

Intercepta todas las peticiones `collect` que hace GA4 (gtag / Google Tag Manager) y las imprime en la **consola de la página** de forma estructurada por evento:

- `event_name`
- `event_params`
- `user_params` (propiedades de usuario)
- `items` (array de productos, cada uno con sus parámetros de ecommerce)

## Cómo funciona

Un content script se inyecta en el contexto de la página (`world: MAIN`) en `document_start` y hookea los tres transportes que usa GA4:

- `navigator.sendBeacon` (transporte por defecto)
- `fetch`
- `XMLHttpRequest`

Cuando detecta una URL de collect (`/g/collect`, `/mp/collect` o cualquier endpoint que termine en `/collect`, útil para server-side GTM), parsea el payload del Measurement Protocol de gtag:

| Prefijo en el hit | Se mapea a |
|-------------------|------------|
| `en`              | `event_name` |
| `ep.<clave>`      | `event_params` (texto) |
| `epn.<clave>`     | `event_params` (número) |
| `up.<clave>`      | `user_params` (texto) |
| `upn.<clave>`     | `user_params` (número) |
| `pr1`, `pr2`, ... | `items` (productos de ecommerce) |
| `tid`, `cid`, `sid`, `dl`, ... | `analytics info` (contexto del hit) |

Soporta hits por **GET** (evento en la query string), por **POST/beacon** (evento en el body) y **batch** (varios eventos en un mismo body, uno por línea).

Cada producto en `pr#` se decodifica usando las abreviaturas de gtag (`id`→`item_id`, `nm`→`item_name`, `pr`→`price`, `qt`→`quantity`, `ca`→`item_category`, etc.).

### Salida limpia

- Cada sección (`event_params`, `user_params`, `items`) se muestra solo si tiene contenido. Si un evento no lleva `user_params`, esa sección no aparece.
- Cada bloque va en su propio grupo colapsable para reducir ruido visual.

### Propiedades de usuario persistentes

GA4 solo incluye los user params en algunos hits (el primero o cuando cambian), no en todos. La extensión mantiene un estado acumulado por measurement id y **muestra siempre las propiedades de usuario conocidas en cada evento**, aunque el hit puntual no las traiga.

Además, cuando se **setea una propiedad por primera vez** o **cambia de valor**, se emite un evento sintético **`set_user_properties`** (marcado en azul) que contiene solo las propiedades nuevas o modificadas. Sirve para ver con claridad en qué momento se define cada propiedad de usuario.

### Información de Analytics

Cada evento incluye un apartado **`analytics info`** (en verde) con los datos de contexto que Google Analytics agrega al hit, ordenados por relevancia: `measurement_id`, `client_id`, `user_id`, `session_id`, `session_count`, `session_engaged`, `page_load_id`, `consent_state`, `document_location`, etc. Los identificadores (como `client_id`) se conservan como texto para no perder su formato.

Los parámetros del hit que la extensión no reconoce se muestran aparte en **`raw params`**, por si aportan información adicional.

### Filtrado de hits no auditables

Solo se muestran hits de GA4 (measurement id `G-...`). Se descartan:
- Hits de Google Ads (`AW-`) y Floodlight (`DC-`) que comparten el endpoint `/g/collect`.
- Collects sin evento (pings, keep-alive, verificaciones de consentimiento).
- Eventos internos como `user_id_update`.

### Activar / desactivar (on/off)

Al hacer clic en el ícono de la extensión se abre un popup con un interruptor. Cuando está **desactivado**, la extensión deja de imprimir hits en la consola; cuando está **activado**, vuelve a hacerlo. El estado se guarda en `chrome.storage.local` y se aplica en todas las pestañas.

El cambio se propaga en tiempo real a las pestañas ya abiertas. Si en alguna no se refleja, recargala.

> Nota técnica: el interceptor corre en el `MAIN world` (sin acceso a las APIs de la extensión), así que un segundo content script (`bridge.js`, en el mundo `ISOLATED`) lee el estado de `chrome.storage` y se lo comunica al interceptor mediante `window.postMessage`.

## Instalación (modo desarrollador)

1. Abre `chrome://extensions` en Chrome (o Edge: `edge://extensions`).
2. Activa el **Modo de desarrollador** (arriba a la derecha).
3. Clic en **Cargar descomprimida** / *Load unpacked*.
4. Selecciona esta carpeta (`Analytics debugger`).

## Cómo probar

1. Abre cualquier sitio que use GA4 (por ejemplo una tienda con gtag).
2. Abre las **DevTools** → pestaña **Console**.
3. Verás el mensaje `Personal Analytics Debugger activo`.
4. Navega / interactúa con la página. Por cada hit verás un grupo colapsable:

```
GA4  purchase  [beacon]
  event_name: purchase
  event_params    (tabla)
  user_params     (tabla)
  items           (por item, expandible)
  analytics info  (tabla)
```

> Tip: en el filtro de la consola escribe `GA4` para ver solo los eventos de la extensión.

## Estructura del proyecto

```
Analytics debugger/
├─ manifest.json    # Manifest V3: content scripts (MAIN + ISOLATED), popup, storage
├─ interceptor.js   # (MAIN) Hooks de red + parser GA4 + salida en consola
├─ bridge.js        # (ISOLATED) Puente chrome.storage <-> interceptor (estado on/off)
├─ popup.html       # UI del interruptor on/off
├─ popup.js         # Lógica del popup (lee/escribe chrome.storage.local)
├─ icons/           # icon16/48/128.png
└─ README.md
```

## Notas

- La extensión solo **lee y muestra** los datos; no modifica ni bloquea las peticiones que llegan a Google Analytics.
