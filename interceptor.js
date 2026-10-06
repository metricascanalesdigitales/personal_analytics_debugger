/**
 * Personal Analytics Debugger
 * ---------------------------
 * Se inyecta en el MAIN world de la pagina (document_start) y hookea
 * fetch, XMLHttpRequest y navigator.sendBeacon para capturar los hits
 * que gtag/GA4 envia al endpoint de "collect".
 *
 * Por cada evento capturado imprime en consola:
 *   - event_name
 *   - event_params
 *   - user_params (propiedades de usuario)
 *   - items (array de productos, cada uno con sus parametros)
 *   - analytics info (measurement_id, client_id, session_id, etc.)
 */
(function () {
  "use strict";

  // Evita doble inyeccion (por ejemplo si corre en varios frames o recargas).
  if (window.__GA4_AUDIT_INSTALLED__) return;
  window.__GA4_AUDIT_INSTALLED__ = true;

  // ---------------------------------------------------------------------------
  // Estado on/off (controlado desde el popup via bridge.js)
  // ---------------------------------------------------------------------------
  // Por defecto habilitado. El bridge (mundo ISOLATED) nos envia el estado real
  // guardado en chrome.storage y los cambios posteriores por postMessage.
  var ENABLED = true;

  // Solo el frame principal anuncia el estado en consola, para no repetir el
  // mensaje una vez por cada iframe de la pagina.
  var IS_TOP_FRAME = (function () {
    try {
      return window.top === window;
    } catch (e) {
      return false; // acceso cross-origin a window.top: no somos el top
    }
  })();

  var STATE_ANNOUNCED = false;
  var STATE_RECEIVED = false;

  // Cola de hits capturados ANTES de conocer el estado real (on/off).
  // ---------------------------------------------------------------------------
  // El estado real llega de forma asincrona desde el bridge (que a su vez lee
  // chrome.storage). Pero GA4 dispara su page_view inicial muy temprano en la
  // carga de la pagina, a veces antes de que ese estado asincrono confirme.
  // Si en ese instante procesaramos o descartaramos el hit segun un estado aun
  // no confirmado, perderiamos el page_view inicial en navegaciones normales
  // (por ejemplo al pasar de un dominio a otro). Para no depender del timing,
  // mientras el estado no este confirmado ENCOLAMOS los hits en vez de
  // procesarlos o descartarlos. Al confirmarse:
  //   - si quedo activado -> procesamos toda la cola (no se pierde nada);
  //   - si quedo desactivado -> descartamos la cola.
  var PENDING_HITS = [];
  var MAX_PENDING = 200; // tope de seguridad para no crecer sin limite

  function flushPending() {
    var queued = PENDING_HITS;
    PENDING_HITS = [];
    if (!ENABLED) return; // desactivado: se descartan
    queued.forEach(function (h) {
      emit(h.url, h.body, h.transport);
    });
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var data = ev.data;
    if (!data || data.source !== "PAD_BRIDGE" || data.type !== "PAD_SET_ENABLED") return;
    var firstConfirmation = !STATE_RECEIVED;
    STATE_RECEIVED = true;
    var prev = ENABLED;
    ENABLED = data.enabled !== false;
    // Anuncia el estado (solo en el frame principal) la primera vez que llega,
    // y luego unicamente cuando el estado cambia.
    if (IS_TOP_FRAME && (!STATE_ANNOUNCED || prev !== ENABLED)) {
      STATE_ANNOUNCED = true;
      console.log(
        "%cPersonal Analytics Debugger%c " +
          (ENABLED ? "activo - escuchando hits de collect" : "desactivado"),
        "background:#1F9BF0;color:#fff;font-weight:bold;padding:2px 8px;border-radius:3px;",
        "color:#888;"
      );
    }
    // Al confirmar el estado por primera vez, procesamos (o descartamos) los
    // hits que se capturaron mientras aun no lo conociamos.
    if (firstConfirmation) flushPending();
  });

  // Pedimos el estado actual al bridge. Reintentamos una vez por si este
  // script arranco antes de que el bridge registrara su listener. En cuanto
  // llega la respuesta (STATE_ANNOUNCED / listener de arriba), dejamos de pedir.
  function requestState() {
    try {
      window.postMessage({ source: "PAD_MAIN", type: "PAD_REQUEST_STATE" }, "*");
    } catch (e) {
      /* noop */
    }
  }
  requestState();
  setTimeout(function () {
    if (!STATE_RECEIVED) {
      requestState();
      // Salvaguarda: si tras el reintento el estado sigue sin llegar (bridge no
      // disponible), asumimos el default (activado) y procesamos la cola para
      // no perder los hits tempranos.
      setTimeout(function () {
        if (!STATE_RECEIVED) {
          STATE_RECEIVED = true;
          flushPending();
        }
      }, 300);
    }
  }, 300);

  // ---------------------------------------------------------------------------
  // Deteccion de endpoints de collect
  // ---------------------------------------------------------------------------
  // GA4 (gtag/GTM):     https://<region>.google-analytics.com/g/collect
  //                     https://www.google-analytics.com/g/collect
  // Server-side / MP:   .../g/collect  o  .../mp/collect
  // Tambien se aceptan endpoints propios (server-side GTM) que terminen en /collect.
  // Eventos que GA4/gtag envia pero que no representan una interaccion a
  // auditar (son internos o de sincronizacion). No se muestran en consola.
  var EXCLUDED_EVENTS = {
    user_id_update: true
  };

  // Un hit es de GA4 solo si su measurement id (tid) empieza con "G-".
  // gtag comparte el endpoint /g/collect con Google Ads (tid "AW-") y
  // Floodlight/Campaign Manager (tid "DC-"), cuyos hits no queremos auditar.
  function isGa4Hit(evt) {
    var tid = evt._meta && evt._meta.measurement_id;
    if (!tid) return false;
    return /^G-/i.test(String(tid));
  }

  // ---------------------------------------------------------------------------
  // Estado acumulado de user params (propiedades de usuario)
  // ---------------------------------------------------------------------------
  // GA4 solo incluye los user params en algunos hits (normalmente el primero o
  // cuando cambian), no en todos. Mantenemos un estado acumulado por
  // measurement id para poder mostrar SIEMPRE las propiedades de usuario
  // conocidas en cada evento, y para detectar cuando aparece una propiedad
  // nueva o cambia su valor (y emitir un "set_user_properties" sintetico).
  var USER_PARAMS_STATE = {}; // { <tid>: { clave: valor, ... } }

  function getUserState(tid) {
    var key = tid || "_default";
    if (!USER_PARAMS_STATE[key]) USER_PARAMS_STATE[key] = {};
    return USER_PARAMS_STATE[key];
  }

  /**
   * Fusiona los user params entrantes de un hit con el estado acumulado.
   * Devuelve:
   *   - merged:  el estado completo de user params tras aplicar los entrantes
   *              (lo que se mostrara en el evento).
   *   - changed: subconjunto con las propiedades nuevas o con valor modificado
   *              (vacio si no hubo cambios). Sirve para el set_user_properties.
   */
  function applyUserParams(tid, incoming) {
    var state = getUserState(tid);
    var changed = {};
    if (incoming) {
      Object.keys(incoming).forEach(function (k) {
        var val = incoming[k];
        // Nueva propiedad o valor distinto al ya conocido.
        if (!(k in state) || state[k] !== val) {
          changed[k] = val;
          state[k] = val;
        }
      });
    }
    // Copia del estado completo para no exponer la referencia interna.
    var merged = {};
    Object.keys(state).forEach(function (k) {
      merged[k] = state[k];
    });
    return { merged: merged, changed: changed };
  }

  function isEmptyObj(obj) {
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) return false;
    return true;
  }

  function isCollectUrl(url) {
    if (!url) return false;
    try {
      var u = String(url);
      return /\/(g|mp)\/collect|[/.]collect(\?|$)/i.test(u);
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Parseo de parametros GA4
  // ---------------------------------------------------------------------------
  // Prefijos que usa el protocolo measurement de gtag:
  //   en            -> event_name
  //   ep.<clave>    -> event param (string)
  //   epn.<clave>   -> event param (numerico)
  //   up.<clave>    -> user property (string)
  //   upn.<clave>   -> user property (numerico)
  //   pr1, pr2...   -> items, formato "k~valor~k~valor" (ver parseItem)

  // Parametros de "control" que Google Analytics agrega al hit (no son ni
  // event params ni user params). Se muestran en el apartado "analytics info".
  var META_KEYS = {
    tid: "measurement_id",
    cid: "client_id",
    sid: "session_id",
    sct: "session_count",
    seg: "session_engaged",
    _p: "page_load_id",
    _s: "hit_sequence",
    _et: "engagement_time_msec",
    v: "protocol_version",
    gtm: "gtm_hash",
    dl: "document_location",
    dr: "document_referrer",
    dt: "document_title",
    ul: "user_language",
    sr: "screen_resolution",
    tfd: "time_since_page_load",
    _z: "transport_marker",
    _dbg: "debug_mode",
    _ee: "external_event",
    _fv: "first_visit",
    _ss: "session_start",
    _nsi: "new_session_id",
    tt: "traffic_type",
    ep: "event_param_flag",
    are: "auto_related_events",
    pscdl: "privacy_sandbox_cookie_deprecation",
    gcs: "consent_state",
    gcd: "consent_default",
    dma: "dma_region",
    dma_cps: "dma_consent",
    _geo: "geo",
    _uip: "user_ip_override",
    us_privacy: "us_privacy",
    frm: "frame_type",
    lp: "link_id",
    _c: "collection_flag"
  };

  // Campos de meta que deben conservarse como texto (identificadores/formatos
  // que no son numeros reales aunque lo parezcan).
  var META_STRING_KEYS = {
    client_id: true,
    session_id: true,
    measurement_id: true,
    gtm_hash: true,
    consent_state: true,
    consent_default: true
  };

  // Orden preferido de los campos mas relevantes en el apartado "analytics
  // info". Los que no esten aqui se muestran despues, en el orden en que llegan.
  var META_PRIORITY = [
    "measurement_id",
    "client_id",
    "user_id",
    "session_id",
    "session_count",
    "session_engaged",
    "session_start",
    "first_visit",
    "page_load_id",
    "hit_sequence",
    "engagement_time_msec",
    "protocol_version",
    "gtm_hash",
    "consent_state",
    "document_location",
    "document_title",
    "document_referrer",
    "user_language",
    "screen_resolution"
  ];

  function coerceNumber(value) {
    if (value === "" || value === null || value === undefined) return value;
    var n = Number(value);
    return isNaN(n) ? value : n;
  }

  /**
   * Parsea un item de ecommerce codificado en un parametro prN.
   * Formato de gtag: pares "clave~valor" unidos por "~".
   * Ejemplo: "idSKU_123~nmCamiseta~pr19.99~qt2~caRopa"
   * Las claves usan abreviaturas de 2 letras -> se mapean a nombres GA4.
   */
  var ITEM_KEY_MAP = {
    id: "item_id",
    nm: "item_name",
    br: "item_brand",
    ca: "item_category",
    c2: "item_category2",
    c3: "item_category3",
    c4: "item_category4",
    c5: "item_category5",
    va: "item_variant",
    li: "item_list_id",
    ln: "item_list_name",
    lp: "index",
    cp: "coupon",
    ds: "discount",
    af: "affiliation",
    pr: "price",
    qt: "quantity",
    lo: "location_id",
    // Parametros de promocion (item-scoped) del ecommerce GA4.
    cn: "creative_name",
    cs: "creative_slot",
    pi: "promotion_id",
    pn: "promotion_name"
  };

  function parseItem(raw) {
    var item = {};
    // Los pares vienen separados por "~".
    // - Parametros estandar: abreviatura de 2 letras + valor. Ej: "idSKU1", "pr9.99".
    // - Parametros custom (item-scoped): gtag los codifica como par clave/valor
    //   con un indice numerico compartido: "k<n><nombre>" seguido de "v<n><valor>".
    //   Ejemplo: "k0item_list_price" + "v0324999" -> item_list_price = 324999.
    //   El indice <n> es el mismo en el par k/v y sirve para saber cuantos
    //   caracteres de prefijo quitar del token de valor (importante cuando el
    //   valor tambien es numerico y quedaria pegado al indice).
    var tokens = raw.split("~");
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (!token) continue;

      // Custom item parameter: "k" + indice + nombre; su valor en el token "v" + mismo indice.
      var kMatch = /^k(\d+)(.*)$/.exec(token);
      if (kMatch) {
        var idx = kMatch[1];        // indice numerico (p. ej. "0", "1", "12")
        var customKey = kMatch[2];  // nombre del parametro (p. ej. "item_list_price")
        var next = tokens[i + 1] || "";
        // Del token de valor quitamos SOLO "v" + ese mismo indice, no todos los
        // digitos: asi un valor numerico como "v0324999" -> "324999" (antes un
        // regex codicioso /^v\d+/ se comia los digitos del valor y quedaba vacio).
        var vPrefix = "v" + idx;
        var customVal = next.indexOf(vPrefix) === 0 ? next.slice(vPrefix.length) : next;
        if (customKey) item[customKey] = coerceNumber(customVal);
        i++; // consume el token de valor
        continue;
      }

      // Parametro estandar: 2 letras de abreviatura + valor.
      var abbr = token.slice(0, 2);
      var val = token.slice(2);
      var name = ITEM_KEY_MAP[abbr] || abbr;
      item[name] = coerceNumber(val);
    }
    return item;
  }

  /**
   * Convierte una lista de pares [clave, valor] (de un URLSearchParams o de
   * una linea del body) en un objeto estructurado del evento.
   */
  function buildEvent(pairs) {
    var evt = {
      event_name: undefined,
      event_params: {},
      user_params: {},
      items: [],
      _meta: {}, // info reconocida que provee Analytics (nombres legibles)
      _raw: {}   // parametros del hit no reconocidos (clave cruda)
    };

    pairs.forEach(function (pair) {
      var key = pair[0];
      var value = pair[1];

      if (key === "en") {
        evt.event_name = value;
        return;
      }
      if (key.indexOf("epn.") === 0) {
        evt.event_params[key.slice(4)] = coerceNumber(value);
        return;
      }
      if (key.indexOf("ep.") === 0) {
        evt.event_params[key.slice(3)] = value;
        return;
      }
      if (key.indexOf("upn.") === 0) {
        evt.user_params[key.slice(4)] = coerceNumber(value);
        return;
      }
      if (key.indexOf("up.") === 0) {
        evt.user_params[key.slice(3)] = value;
        return;
      }
      // user_id (uid) es una propiedad de usuario: va dentro de user_params.
      if (key === "uid") {
        evt.user_params.user_id = value;
        return;
      }
      // Items: pr1, pr2, ...
      if (/^pr\d+$/.test(key)) {
        evt.items.push(parseItem(value));
        return;
      }
      // Informacion reconocida que provee Analytics.
      if (META_KEYS.hasOwnProperty(key)) {
        var metaName = META_KEYS[key];
        // Los identificadores se mantienen como texto para no perder formato
        // ni precision (el client_id "111.222" no es un numero decimal).
        evt._meta[metaName] = META_STRING_KEYS[metaName]
          ? value
          : coerceNumber(value);
        return;
      }
      // Cualquier otra cosa la dejamos aparte con su clave cruda, por si sirve.
      evt._raw[key] = value;
    });

    return evt;
  }

  /**
   * Un hit de collect puede contener parametros comunes en la query string
   * y uno o varios eventos en el body (batch, separados por \n).
   * Devuelve un array de eventos ya estructurados.
   */
  function parseCollect(url, body) {
    var events = [];
    var queryPairs = [];

    try {
      var qIndex = String(url).indexOf("?");
      if (qIndex !== -1) {
        var sp = new URLSearchParams(String(url).slice(qIndex + 1));
        sp.forEach(function (v, k) {
          queryPairs.push([k, v]);
        });
      }
    } catch (e) {
      /* noop */
    }

    var hasEventInQuery = queryPairs.some(function (p) {
      return p[0] === "en";
    });

    // Caso 1: hit por GET, el evento va todo en la query string.
    if ((!body || !String(body).trim()) && hasEventInQuery) {
      events.push(buildEvent(queryPairs));
      return events;
    }

    // Caso 2: hit por POST/beacon. La query lleva params comunes (tid, cid, dl...)
    // y el body lleva una linea por evento (batch).
    if (body && String(body).trim()) {
      var lines = String(body).split(/\r?\n/).filter(function (l) {
        return l.trim() !== "";
      });
      lines.forEach(function (line) {
        var linePairs = [];
        try {
          var sp2 = new URLSearchParams(line);
          sp2.forEach(function (v, k) {
            linePairs.push([k, v]);
          });
        } catch (e) {
          /* noop */
        }
        // Los params comunes de la query se combinan con los de la linea.
        var combined = queryPairs.concat(linePairs);
        events.push(buildEvent(combined));
      });
      return events;
    }

    // Sin "en" ni en query ni en body: es un collect que no transporta un
    // evento (ping de red, verificacion de consentimiento, keep-alive, etc.).
    // No aporta datos que auditar, asi que no generamos ningun evento.
    return events;
  }

  // ---------------------------------------------------------------------------
  // Salida en consola
  // ---------------------------------------------------------------------------
  var STYLE_TITLE =
    "background:#1F9BF0;color:#fff;font-weight:bold;padding:2px 8px;border-radius:3px;";
  var STYLE_SECTION = "color:#1F9BF0;font-weight:bold;";

  function isEmpty(obj) {
    if (!obj) return true;
    for (var k in obj) if (obj.hasOwnProperty(k)) return false;
    return true;
  }

  /**
   * Renderiza un objeto { clave: valor } como tabla en consola.
   *
   * console.table siempre genera una primera columna "(index)". Si le pasamos
   * un OBJETO (no un array), esa columna muestra las CLAVES reales (currency,
   * value, ...) en lugar de indices numericos 0,1,2.
   *
   * Pasamos el objeto TAL CUAL a console.table (valores primitivos directos),
   * en lugar de envolver cada valor en { valor: ... }. Antes ese envoltorio
   * hacia que cada celda se mostrara como un objeto anidado ("Object" con
   * { valor: 90 }) al expandir la vista de arbol en DevTools. Con el objeto
   * plano, la tabla queda en dos columnas limpias: nombre del parametro y su
   * valor, sin niveles intermedios.
   *
   * El segundo argumento (valueLabel) se mantiene por compatibilidad con las
   * llamadas existentes, pero ya no se usa: console.table nombra la columna de
   * valores como "Values" automaticamente.
   *
   *   logTable({ currency: "ARS", value: 10 })
   *   => filas "currency" y "value" con sus valores en la columna "Values"
   */
  function logTable(obj, valueLabel) {
    // Pasamos un CLON superficial, no el objeto original. console.table (como
    // console.log) guarda una REFERENCIA viva al objeto, no un snapshot. En
    // cargas tempranas (document_start / page_view inicial) DevTools a veces
    // evalua esa referencia de forma diferida y la pinta como "Object"
    // colapsado SIN dibujar la grilla de la tabla, hasta que un re-render
    // (p. ej. recargar la pagina) la fuerza. Clonar rompe esa referencia:
    // DevTools serializa el estado actual y renderiza la tabla de inmediato.
    var snapshot = {};
    Object.keys(obj).forEach(function (k) {
      snapshot[k] = obj[k];
    });
    console.table(snapshot);
  }

  function logEvent(evt, transport) {
    var name = evt.event_name || "(sin event_name)";
    // El evento sintetico de propiedades de usuario se distingue en morado y con
    // una etiqueta, para que quede claro que lo genera la extension (no es un
    // hit literal de GA4, sino la deteccion de un cambio de user params).
    // Todo el renglon del titulo se resalta con un mismo color de fondo y con la
    // letra levemente mas grande, para que cada evento sea facil de distinguir.
    var bg = evt._synthetic ? "#7B48F0" : "#1F9BF0";
    // Estilo comun a todo el renglon: mismo fondo y tamano de letra mayor.
    var rowStyle = "background:" + bg + ";font-size:15px;padding:2px 0;";
    // Rellenamos el nombre a un ancho fijo con espacios para que el resaltado
    // tenga la MISMA longitud en todos los eventos (aspecto uniforme). Si algun
    // nombre supera el ancho, no se recorta (solo no se agrega relleno).
    var NAME_WIDTH = 26;
    var paddedName = name.length < NAME_WIDTH
      ? name + Array(NAME_WIDTH - name.length + 1).join(" ")
      : name;
    // El apartado final ("[transport]") cierra el renglon. Para los eventos
    // sinteticos agregamos ademas la etiqueta "(sintetico)" con su propio %c.
    if (evt._synthetic) {
      console.groupCollapsed(
        "%c GA4 %c " + paddedName + " %c[" + transport + "] %c(sintetico)",
        rowStyle + "color:#000;font-weight:bold;border-radius:3px 0 0 3px;padding-left:8px;",
        rowStyle + "color:#fff;font-weight:bold;",
        rowStyle + "color:#000;font-weight:normal;font-style:italic;padding-right:8px;border-radius:0 3px 3px 0;",
        "color:#7B48F0;font-weight:normal;font-style:italic;"
      );
    } else {
      console.groupCollapsed(
        "%c GA4 %c " + paddedName + " %c[" + transport + "]",
        // "GA4": texto negro, negrita.
        rowStyle + "color:#000;font-weight:bold;border-radius:3px 0 0 3px;padding-left:8px;",
        // nombre del evento: texto blanco, negrita.
        rowStyle + "color:#fff;font-weight:bold;",
        // "[transport]": texto negro, cursiva.
        rowStyle + "color:#000;font-weight:normal;font-style:italic;border-radius:0 3px 3px 0;padding-right:8px;"
      );
    }

    // event_name como linea simple.
    console.log("%cevent_name:%c " + name, STYLE_SECTION, "font-weight:normal;");

    // Solo se imprime la seccion si tiene contenido. La tabla ya lleva su
    // propio encabezado visual, asi que no duplicamos un label previo.
    if (!isEmpty(evt.event_params)) {
      console.groupCollapsed("%cevent_params", STYLE_SECTION);
      logTable(evt.event_params, "valor");
      console.groupEnd();
    }

    if (!isEmpty(evt.user_params)) {
      console.groupCollapsed("%cuser_params", STYLE_SECTION);
      logTable(evt.user_params, "valor");
      console.groupEnd();
    }

    if (evt.items && evt.items.length) {
      console.groupCollapsed(
        "%citems%c (" + evt.items.length + ")",
        STYLE_SECTION,
        "color:#888;font-weight:normal;"
      );
      // Cada item es un grupo colapsable (expandir/contraer). Dentro, una tabla
      // con los parametros del item: primera columna "(index)" = nombre del
      // parametro, segunda columna "valor" = su valor.
      evt.items.forEach(function (item, idx) {
        console.groupCollapsed(
          "%c[" + idx + "]%c " + (item.item_name || item.item_id || ""),
          "color:#1F9BF0;font-weight:bold;",
          "color:#666;font-weight:normal;"
        );
        logTable(item, "valor");
        console.groupEnd();
      });
      console.groupEnd();
    }

    // Apartado con la informacion que provee Analytics (measurement_id,
    // client_id, session_id, etc.), ordenada por relevancia.
    var info = buildAnalyticsInfo(evt);
    if (!isEmpty(info)) {
      console.groupCollapsed(
        "%canalytics info",
        "color:#0F9D58;font-weight:bold;"
      );
      logTable(info, "valor");
      console.groupEnd();
    }

    // Parametros crudos del hit que no reconocemos (por si aportan algo).
    if (evt._raw && !isEmpty(evt._raw)) {
      console.groupCollapsed("%craw params", "color:#888;font-weight:bold;");
      logTable(evt._raw, "valor");
      console.groupEnd();
    }

    console.groupEnd();
  }

  // Construye el objeto "analytics info" ordenando los campos por relevancia.
  // Incluye el user_id (que vive en user_params) por ser un identificador clave.
  function buildAnalyticsInfo(evt) {
    var meta = evt._meta || {};
    var info = {};

    // user_id primero si existe.
    if (evt.user_params && evt.user_params.user_id != null) {
      info.user_id = evt.user_params.user_id;
    }

    // Campos prioritarios en orden.
    META_PRIORITY.forEach(function (name) {
      if (name === "user_id") return; // ya agregado
      if (meta[name] != null) info[name] = meta[name];
    });

    // Resto de campos reconocidos que no estaban en la lista de prioridad.
    Object.keys(meta).forEach(function (name) {
      if (info[name] == null && meta[name] != null) info[name] = meta[name];
    });

    return info;
  }

  function emit(url, body, transport) {
    try {
      if (!isCollectUrl(url)) return;
      var events = parseCollect(url, body);
      events.forEach(function (evt) {
        // Descarta hits que no transportan un evento real de GA4.
        if (!evt.event_name) return;
        // Solo auditamos hits de GA4 (tid tipo "G-..."). El mismo endpoint
        // /g/collect recibe hits de Google Ads (AW-) y Floodlight (DC-) que
        // gtag envia para redaccion de datos publicitarios y conversiones;
        // esos aparecen como page_view con solo "ads_data_redaction" y no
        // corresponden a la medicion de GA4.
        if (!isGa4Hit(evt)) return;
        // Eventos internos/no auditables que no aportan datos utiles.
        if (EXCLUDED_EVENTS[evt.event_name]) return;

        var tid = evt._meta && evt._meta.measurement_id;
        // Fusiona los user params del hit con el estado acumulado.
        var up = applyUserParams(tid, evt.user_params);

        // Si aparecieron propiedades nuevas o cambiaron, emitimos primero un
        // evento sintetico "set_user_properties" con solo esas propiedades.
        if (!isEmptyObj(up.changed)) {
          logEvent(
            {
              event_name: "set_user_properties",
              event_params: {},
              user_params: up.changed,
              items: [],
              _meta: evt._meta,
              _synthetic: true
            },
            transport
          );
        }

        // El evento real muestra SIEMPRE el estado completo de user params.
        evt.user_params = up.merged;
        logEvent(evt, transport);
      });
    } catch (e) {
      console.warn("[GA4 Audit] Error parseando collect:", e, url);
    }
  }

  // Recibe el body en cualquier forma. Si es un Blob (caso comun de sendBeacon)
  // lo lee de forma asincrona y luego emite. En el resto de casos, sincrono.
  function handleCollect(url, body, transport) {
    if (!isCollectUrl(url)) return;

    // Los Blob (sendBeacon) se leen de forma asincrona; convertimos a texto
    // antes de decidir, para poder encolar el contenido ya legible.
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      body.text().then(function (text) {
        dispatchHit(url, text, transport);
      }).catch(function () {
        dispatchHit(url, null, transport);
      });
      return;
    }
    dispatchHit(url, typeof body === "string" ? body : bodyToString(body), transport);
  }

  // Decide que hacer con un hit ya con su body en texto:
  //   - si aun no confirmamos el estado -> lo encolamos (se resolvera al llegar);
  //   - si esta desactivado -> se descarta;
  //   - si esta activado -> se procesa en el momento.
  function dispatchHit(url, body, transport) {
    if (!STATE_RECEIVED) {
      if (PENDING_HITS.length < MAX_PENDING) {
        PENDING_HITS.push({ url: url, body: body, transport: transport });
      }
      return;
    }
    if (!ENABLED) return; // extension desactivada desde el popup
    emit(url, body, transport);
  }

  // ---------------------------------------------------------------------------
  // Hooks de red
  // ---------------------------------------------------------------------------

  // fetch
  if (typeof window.fetch === "function") {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === "string" ? input : (input && input.url);
        var body = init && init.body ? init.body : null;
        // Request object puede llevar el body dentro (no siempre legible sync).
        if (!body && input && typeof input === "object" && input.body) {
          body = null; // los streams no se leen de forma sincronica; suele ir en init.
        }
        handleCollect(url, body, "fetch");
      } catch (e) {
        /* noop */
      }
      return origFetch.apply(this, arguments);
    };
  }

  // XMLHttpRequest
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ga4_url = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      handleCollect(this.__ga4_url, body, "xhr");
    } catch (e) {
      /* noop */
    }
    return origSend.apply(this, arguments);
  };

  // navigator.sendBeacon (transporte por defecto de GA4)
  if (navigator && typeof navigator.sendBeacon === "function") {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try {
        handleCollect(url, data, "beacon");
      } catch (e) {
        /* noop */
      }
      return origBeacon(url, data);
    };
  }

  // Convierte distintos tipos de body a string cuando es posible (sincrono).
  function bodyToString(body) {
    if (body == null) return null;
    if (typeof body === "string") return body;
    try {
      if (body instanceof URLSearchParams) return body.toString();
      if (typeof Blob !== "undefined" && body instanceof Blob) {
        // Los Blob no se leen de forma sincronica; GA4 suele mandar texto plano.
        return null;
      }
      if (typeof body === "object") {
        // ArrayBuffer / TypedArray
        if (body.buffer || body instanceof ArrayBuffer) {
          return new TextDecoder("utf-8").decode(body);
        }
      }
    } catch (e) {
      /* noop */
    }
    return null;
  }

  // El estado inicial (y su anuncio en consola) llega desde el bridge via
  // postMessage, en cuanto lee chrome.storage.
})();
