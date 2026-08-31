# Politica de Privacidad - Personal Analytics Debugger

_Ultima actualizacion: 28 de agosto de 2026_

Personal Analytics Debugger ("la extension") es una herramienta de depuracion
para desarrolladores que muestra, en la consola del navegador, los eventos que
un sitio web envia a Google Analytics 4.

## Datos que recopilamos

**La extension no recopila, almacena ni transmite datos personales ni de
navegacion.**

- La extension lee las peticiones "collect" que el propio sitio web envia a
  Google Analytics y las muestra unicamente en la consola local (DevTools) del
  navegador del usuario.
- Esa informacion nunca sale del equipo del usuario. No se envia a los
  desarrolladores de la extension ni a ningun tercero.
- No se utilizan servidores, bases de datos ni servicios de analitica propios.

## Almacenamiento local

La extension guarda, mediante `chrome.storage.local`, una unica preferencia:
si la depuracion esta activada o desactivada. Este valor se guarda solo en el
navegador del usuario y no se comparte con nadie.

## Permisos

- **storage**: para recordar la preferencia on/off.
- **Acceso a los sitios web visitados**: necesario para poder observar y mostrar
  los eventos de Google Analytics del sitio. La extension solo los lee para
  mostrarlos; no los modifica ni los bloquea.

## Cambios en esta politica

Si esta politica cambia, se actualizara la fecha indicada arriba.

## Contacto

Para consultas sobre privacidad, escribi a: [TU_CORREO_DE_CONTACTO]
