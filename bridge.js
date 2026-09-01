/**
 * Personal Analytics Debugger - bridge (ISOLATED world)
 * -----------------------------------------------------
 * El interceptor corre en el MAIN world y no tiene acceso a las APIs de la
 * extension (chrome.storage). Este bridge corre en el mundo ISOLATED, lee el
 * estado on/off desde chrome.storage y se lo comunica al MAIN mediante
 * window.postMessage. Tambien escucha los cambios de estado (cuando el usuario
 * usa el toggle del popup) y los reenvia en tiempo real.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "pad_enabled";
  var MSG_TYPE = "PAD_SET_ENABLED";

  function sendEnabled(enabled) {
    try {
      window.postMessage({ source: "PAD_BRIDGE", type: MSG_TYPE, enabled: !!enabled }, "*");
    } catch (e) {
      /* noop */
    }
  }

  // El estado inicial se entrega cuando el MAIN lo solicita (ver el listener de
  // PAD_REQUEST_STATE mas abajo). No lo enviamos tambien de forma proactiva
  // para evitar un doble mensaje al cargar la pagina.

  // Solo el frame principal debe recargar la pagina; si recargara cada iframe
  // por separado romperia la navegacion.
  var IS_TOP_FRAME = (function () {
    try {
      return window.top === window;
    } catch (e) {
      return false; // acceso cross-origin a window.top: no somos el top
    }
  })();

  // Reenvia los cambios de estado en tiempo real.
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[STORAGE_KEY]) {
        var change = changes[STORAGE_KEY];
        var newEnabled = change.newValue !== false;
        var oldEnabled = change.oldValue !== false;
        sendEnabled(newEnabled);

        // Al ENCENDER la extension (apagado -> encendido) recargamos la pagina
        // para capturar los hits desde el inicio de la carga (page_view, etc.),
        // que de otro modo ya habrian ocurrido antes de activar la captura.
        // No recargamos al apagar ni cuando el estado no cambia.
        if (IS_TOP_FRAME && newEnabled && !oldEnabled) {
          window.location.reload();
        }
      }
    });
  } catch (e) {
    /* noop */
  }

  // El MAIN puede pedir el estado actual si arranco antes de recibirlo.
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var data = ev.data;
    if (!data || data.source !== "PAD_MAIN" || data.type !== "PAD_REQUEST_STATE") return;
    try {
      chrome.storage.local.get(STORAGE_KEY, function (res) {
        var enabled = res && typeof res[STORAGE_KEY] === "boolean" ? res[STORAGE_KEY] : true;
        sendEnabled(enabled);
      });
    } catch (e) {
      sendEnabled(true);
    }
  });
})();
