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

  // Reenvia los cambios de estado en tiempo real.
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[STORAGE_KEY]) {
        sendEnabled(changes[STORAGE_KEY].newValue !== false);
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
