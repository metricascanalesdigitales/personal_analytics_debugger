/**
 * Personal Analytics Debugger - popup
 * Lee y escribe el estado on/off en chrome.storage.local. El bridge que corre
 * en cada pestaña escucha los cambios de storage y actualiza el interceptor.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "pad_enabled";
  var toggle = document.getElementById("toggle");
  var stateEl = document.getElementById("state");

  function render(enabled) {
    toggle.checked = !!enabled;
    stateEl.textContent = enabled ? "Activado" : "Desactivado";
    stateEl.classList.toggle("on", !!enabled);
  }

  // Estado inicial (por defecto habilitado si nunca se configuro).
  chrome.storage.local.get(STORAGE_KEY, function (res) {
    var enabled = res && typeof res[STORAGE_KEY] === "boolean" ? res[STORAGE_KEY] : true;
    render(enabled);
  });

  // Al cambiar el toggle, guardamos el nuevo estado.
  toggle.addEventListener("change", function () {
    var enabled = toggle.checked;
    render(enabled);
    var obj = {};
    obj[STORAGE_KEY] = enabled;
    chrome.storage.local.set(obj);
  });

  // Refleja cambios hechos desde otra ventana del popup.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes[STORAGE_KEY]) {
      render(changes[STORAGE_KEY].newValue !== false);
    }
  });
})();
