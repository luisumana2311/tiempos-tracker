// Inicializa firebase-admin usando una clave de cuenta de servicio que
// llega como texto plano en la variable de entorno GOOGLE_APPLICATION_CREDENTIALS_JSON
// (asi es como se pasa un "secret" de GitHub Actions: no es un archivo, es texto).
//
// Localmente (en tu maquina) tambien podes usar la variable de entorno
// estandar GOOGLE_APPLICATION_CREDENTIALS apuntando a un archivo .json.

const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return admin.app();

  const rawJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (rawJson) {
    const serviceAccount = JSON.parse(rawJson);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  // Si no hay JSON en texto, usa las credenciales por defecto del entorno
  // (GOOGLE_APPLICATION_CREDENTIALS apuntando a un archivo, o gcloud login).
  return admin.initializeApp();
}

module.exports = { admin, init, db: () => init().firestore() };
