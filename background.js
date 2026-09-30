/**
 * Personal Analytics Debugger - service worker (background)
 * ---------------------------------------------------------
 * Unico proposito: reflejar en el icono de la extension si la captura esta
 * activada o desactivada, para que el usuario lo detecte de un vistazo sin
 * abrir el popup ni la consola.
 *
 * Muestra una marca "ON" (badge verde) sobre el icono cuando esta activada, y
 * ninguna marca cuando esta desactivada. El estado se lee de chrome.storage,
 * que es global: vale para todas las pestañas y todos los dominios. Asi, una
 * vez activada, la extension queda activada en toda la navegacion.
 */
"use strict";

var STORAGE_KEY = "pad_enabled";

// Devuelve el estado on/off. Por defecto activado si nunca se configuro.
function readEnabled(callback) {
  try {
    chrome.storage.local.get(STORAGE_KEY, function (res) {
      var enabled =
        res && typeof res[STORAGE_KEY] === "boolean" ? res[STORAGE_KEY] : true;
      callback(enabled);
    });
  } catch (e) {
    callback(true);
  }
}

// Pinta el badge del icono segun el estado. El badge es global (aplica a todas
// las pestañas), de modo que la marca "ON" se ve en cualquier sitio.
function paintBadge(enabled) {
  try {
    if (enabled) {
      chrome.action.setBadgeText({ text: "ON" });
      // setBadgeBackgroundColor: color de fondo del badge (verde = activo).
      chrome.action.setBadgeBackgroundColor({ color: "#0F9D58" });
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
      }
      chrome.action.setTitle({
        title: "Personal Analytics Debugger - ACTIVADO"
      });
    } else {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({
        title: "Personal Analytics Debugger - desactivado"
      });
    }
  } catch (e) {
    /* noop */
  }
}

function refreshBadge() {
  readEnabled(paintBadge);
}

// Al instalar/actualizar: fijamos el estado por defecto (activado) de forma
// EXPLICITA en storage si aun no existe, para que el valor persista de forma
// global e inequivoca en todos los dominios, y pintamos el badge.
chrome.runtime.onInstalled.addListener(function () {
  try {
    chrome.storage.local.get(STORAGE_KEY, function (res) {
      if (!res || typeof res[STORAGE_KEY] !== "boolean") {
        var obj = {};
        obj[STORAGE_KEY] = true;
        chrome.storage.local.set(obj, refreshBadge);
      } else {
        refreshBadge();
      }
    });
  } catch (e) {
    refreshBadge();
  }
});

// Al arrancar el navegador (o el service worker), reflejamos el estado actual.
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(refreshBadge);
}

// Cambios del toggle (desde el popup): actualizamos el badge en tiempo real.
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === "local" && changes[STORAGE_KEY]) {
    paintBadge(changes[STORAGE_KEY].newValue !== false);
  }
});

// Primer pintado al cargar el service worker.
refreshBadge();
