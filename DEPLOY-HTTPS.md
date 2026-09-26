# Publicar VISOR 3D ICG con HTTPS

El proyecto incluye `render.yaml` para crear un servicio web en Render. Una vez publicado,
la dirección HTTPS funciona en Safari para iPhone, Chrome para Android y navegadores de
escritorio. La computadora local no necesita permanecer encendida.

## Variables privadas

Configura estas variables en el servicio. No copies el archivo `.env` al repositorio.

- `APS_CLIENT_ID`: identificador de la aplicación Autodesk APS.
- `APS_CLIENT_SECRET`: secreto de Autodesk APS.
- `APS_BUCKET`: bucket persistente que ya utiliza el visor.
- `APP_USERNAME`: usuario que solicitará el navegador.
- `APP_PASSWORD`: contraseña larga y exclusiva para el visor.

`PORT` lo proporciona automáticamente el hosting.

## Despliegue

1. Guarda el proyecto en un repositorio privado de GitHub.
2. En Render, crea un **Blueprint** desde ese repositorio.
3. Render detectará `render.yaml`.
4. Introduce las cinco variables privadas cuando se soliciten.
5. Espera a que `/api/health` indique que el servicio está disponible.
6. Abre la URL `https://...onrender.com` desde el teléfono e introduce el usuario y la contraseña.

## iPhone y Android

En iPhone se puede usar **Compartir > Añadir a pantalla de inicio** para abrir el visor como
una aplicación. En Android puede instalarse desde el aviso del navegador. Ambos dispositivos
seguirán usando la misma versión alojada y los mismos modelos almacenados en Autodesk OSS.

## Seguridad

La autenticación se activa solamente cuando existen `APP_USERNAME` y `APP_PASSWORD`. En un
despliegue público ambas deben estar configuradas. El navegador recibe únicamente un token APS
limitado a visualizar; `APS_CLIENT_SECRET` permanece en el servidor.
