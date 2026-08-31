# Material para la ficha de Chrome Web Store

Copiá y pegá estos textos en el Developer Dashboard al completar la ficha.
Ajustá lo que quieras (nombre del autor, correo de contacto, URL de la politica
de privacidad una vez publicada).

---

## Nombre

Personal Analytics Debugger

## Descripcion breve (menos de 132 caracteres)

Audita en tiempo real los eventos que tu sitio envia a Google Analytics 4, mostrandolos estructurados en la consola del navegador.

## Descripcion detallada

Personal Analytics Debugger es una herramienta para desarrolladores y
analistas que necesitan verificar que sus implementaciones de Google
Analytics 4 (GA4) esten enviando los datos correctos.

La extension intercepta las peticiones "collect" que gtag y Google Tag
Manager envian a GA4 y las imprime en la consola del navegador (DevTools),
organizadas de forma clara por evento:

- event_name: el nombre del evento.
- event_params: los parametros del evento.
- user_params: las propiedades de usuario, con estado persistente entre
  eventos (se muestran siempre, aunque el hit puntual no las reenvie).
- items: los productos de ecommerce, con todos sus parametros.
- analytics info: datos de contexto como measurement_id, client_id,
  session_id, session_count, consent_state y mas.

Caracteristicas:

- Detecta automaticamente cuando se define o cambia una propiedad de usuario
  y lo muestra como un evento "set_user_properties".
- Filtra el ruido: descarta hits que no son de GA4 (Google Ads, Floodlight),
  pings de red y eventos internos.
- Interruptor on/off desde el popup para activar o desactivar la depuracion
  cuando quieras.
- No modifica ni bloquea el trafico: solo lee y muestra. Nada se envia a
  servidores externos.

Como usarla:

1. Activa la extension desde su icono (viene activada por defecto).
2. Abre las DevTools del navegador y ve a la pestana Console.
3. Navega por tu sitio: cada evento de GA4 aparecera estructurado en la
   consola. Filtra por "GA4" para ver solo estos eventos.

## Categoria sugerida

Developer Tools (Herramientas para desarrolladores)

---

## Justificacion de permisos (para el formulario de privacidad)

### Permiso: storage

Se utiliza unicamente para guardar la preferencia del usuario sobre si la
extension esta activada o desactivada (un unico valor booleano). No almacena
datos de navegacion ni informacion personal.

### Permiso de host: acceso a todos los sitios (<all_urls>)

La extension necesita ejecutarse en cualquier sitio web porque su funcion es
auditar los eventos de Google Analytics 4 que ese sitio envia. Para poder
observar las peticiones "collect", la extension debe inyectarse en la pagina
e interceptar las llamadas de red (fetch, XMLHttpRequest y sendBeacon) que
realiza el codigo de medicion del propio sitio. Como el usuario puede querer
depurar cualquier sitio, se requiere acceso amplio. La extension solo lee esas
peticiones para mostrarlas en la consola local; no las modifica, no las
bloquea y no transmite ningun dato a terceros.

### Declaracion de uso de datos

- La extension NO recopila datos personales.
- La extension NO transmite datos a servidores externos.
- Toda la informacion se muestra unicamente en la consola local del navegador
  del propio usuario y no sale de su equipo.
- El unico dato que persiste es la preferencia on/off, guardada localmente.

---

## Screenshots recomendados (1280x800 px, minimo 1)

1. La consola de DevTools mostrando un evento GA4 expandido (event_name,
   event_params, items, analytics info).
2. El popup con el interruptor on/off.
3. Un evento de ecommerce (purchase o view_item) con sus items desplegados.
