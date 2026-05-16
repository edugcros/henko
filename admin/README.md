# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

# 🚀 Proyecto Frontend – Guía de Scripts y Entorno

Este proyecto utiliza Webpack, ESLint, Prettier y Jest para crear un entorno de desarrollo moderno, limpio y profesional. A continuación se describen los scripts disponibles, las herramientas utilizadas y cómo configurar tu entorno de forma correcta.

---

## 📦 Scripts disponibles (`package.json`)

| Script         | Comando                                               | Descripción                                                                 |
|----------------|--------------------------------------------------------|-----------------------------------------------------------------------------|
| `dev`          | `npm run dev`                                          | Inicia el servidor de desarrollo con Webpack en modo `development`.        |
| `build`        | `npm run build`                                        | Compila el proyecto en modo producción dentro de la carpeta `dist`.        |
| `preview`      | `npm run preview`                                      | Lanza un servidor local para previsualizar el `build`.                     |
| `clean`        | `npm run clean`                                        | Elimina las carpetas `dist` y `build`.                                     |
| `lint`         | `npm run lint`                                         | Analiza y corrige errores de ESLint en todos los archivos `.js` y `.jsx`.  |
| `format`       | `npm run format`                                       | Formatea archivos con Prettier (`js`, `jsx`, `css`, `json`, etc.).         |
| `start`        | Alias de `npm run dev`.                                |                                                                            |
| `test`         | Ejecuta todos los tests con Jest en modo `watch`.     |
| `test:watch`   | Igual a `test`.                                        |                                                                            |
| `test:ci`      | Ejecuta los tests en modo CI (`--ci`, sin watch).      |
| `deploy`       | Ejecuta `build` y luego `preview`.                     |

---

## 🧰 Herramientas usadas

| Herramienta      | Descripción                                                                 |
|------------------|-----------------------------------------------------------------------------|
| **Webpack**      | Empaquetador de módulos para el desarrollo y producción                    |
| **ESLint**       | Linter para mantener el código limpio y sin errores                         |
| **Prettier**     | Formateador de código consistente                                           |
| **Jest**         | Framework de testing                                                        |
| **cross-env**    | Para establecer variables de entorno multiplataforma                       |
| **rimraf**       | Utilidad para eliminar carpetas de forma segura                             |
| **http-server**  | Servidor local simple para previsualizar el `build`                         |

---

## 🗂️ Estructura recomendada

