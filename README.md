# Simple Viewer (Node.js)

![platforms](https://img.shields.io/badge/platform-windows%20%7C%20osx%20%7C%20linux-lightgray.svg)
[![node.js](https://img.shields.io/badge/Node.js-20.13-blue.svg)](https://nodejs.org)
[![npm](https://img.shields.io/badge/npm-10.5-blue.svg)](https://www.npmjs.com/)
[![license](https://img.shields.io/:license-mit-green.svg)](https://opensource.org/licenses/MIT)

[Autodesk Platform Services](https://aps.autodesk.com) application built by following
the [Simple Viewer](https://tutorials.autodesk.io/tutorials/simple-viewer/) tutorial
from https://tutorials.autodesk.io.

![thumbnail](thumbnail.png)

## Development

### Prerequisites

- [APS credentials](https://forge.autodesk.com/en/docs/oauth/v2/tutorials/create-app)
- [Node.js](https://nodejs.org) (Long Term Support version is recommended)
- Command-line terminal such as [PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/overview)
or [bash](https://en.wikipedia.org/wiki/Bash_(Unix_shell)) (should already be available on your system)

> We recommend using [Visual Studio Code](https://code.visualstudio.com) which, among other benefits,
> provides an [integrated terminal](https://code.visualstudio.com/docs/terminal/basics) as well.

### Setup & Run

- Clone this repository: `git clone https://github.com/autodesk-platform-services/aps-simple-viewer-nodejs`
- Go to the project folder: `cd aps-simple-viewer-nodejs`
- Install Node.js dependencies: `npm install`
- Open the project folder in a code editor of your choice
- Create a _.env_ file in the project folder, and populate it with the snippet below,
replacing `<client-id>` and `<client-secret>` with your APS Client ID and Client Secret:

```bash
APS_CLIENT_ID="<client-id>"
APS_CLIENT_SECRET="<client-secret>"
```

- Run the application, either from your code editor, or by running `npm start` in terminal
- Open http://localhost:8080

> When using [Visual Studio Code](https://code.visualstudio.com), you can run & debug
> the application by pressing `F5`.

## Uso sin conexión en teléfonos y tabletas

La aplicación funciona como PWA. El dispositivo debe abrir una versión publicada mediante HTTPS
al menos una vez. Selecciona un modelo y pulsa **Preparar offline**; mantén la página abierta hasta
que aparezca **Disponible offline ✓**. Después puedes instalarla desde el botón del navegador o,
en iPhone/iPad, desde **Compartir > Agregar a inicio**.

La traducción inicial de un DWG requiere conexión con APS. Una vez preparado, el modelo y los
recursos del Viewer quedan en la caché privada de ese dispositivo. Borrar los datos del navegador
elimina esa copia. Los modelos grandes pueden superar el almacenamiento disponible del teléfono.

El modo PWA requiere HTTPS, excepto en `localhost`. Abrir `http://<IP-de-la-PC>:8080` desde otro
dispositivo sirve para probar el visor conectado, pero el navegador móvil puede bloquear la
instalación y el modo offline por no usar HTTPS.

## APK independiente sin conexión

La carpeta `android-offline-app` contiene una segunda aplicación con APS Viewer incorporado y almacenamiento privado por instalación. Desde la aplicación conectada, selecciona un modelo traducido y pulsa **Exportar .visor3d**. Copia el archivo resultante al dispositivo y cárgalo desde **VISOR 3D ICG Offline**.

Esta variante no convierte archivos DWG sin internet: importa derivados preparados previamente. Consulta `android-offline-app/README.md` y `docs/08-implementacion-apk-offline.md` para conocer el flujo y las limitaciones.

## Troubleshooting

Please contact us via https://forge.autodesk.com/en/support/get-help.

## License

This sample is licensed under the terms of the [MIT License](http://opensource.org/licenses/MIT).
Please see the [LICENSE](LICENSE) file for more details.
