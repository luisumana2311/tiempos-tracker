# Nuevos Tiempos Tracker

Sistema web real (no vive dentro de Claude) que:

1. **Cada noche** trae los sorteos de "Nuevos Tiempos" JPS y recalcula
   pruebas estadisticas de aleatoriedad (chi-cuadrado, par/impar, por
   horario, numeros calientes/frios).
2. **Cada manana** guarda las "predicciones" del dia de yelu.cr (numeros
   que dicen estar calientes / con suerte).
3. **Cada noche** compara esas predicciones contra lo que realmente salio
   y lleva el historial de aciertos de cada fuente, contra lo que el azar
   explicaria por si solo.

Todo corre solo, en la nube de Firebase, sin depender de tu computadora.

## Arquitectura

- **Cloud Functions** (`functions/`): 3 funciones programadas (`onSchedule`)
  - `updateDraws` — 9:12pm hora CR
  - `capturePredictions` — 8:41am hora CR
  - `scorePredictions` — 8:35pm hora CR
- **Firestore**: base de datos (`draws`, `predictions`, `stats/latest`,
  `predictions_summary/latest`)
- **Firebase Hosting** (`public/`): las 2 paginas del dashboard, que leen
  Firestore en vivo (no hay que "republicar" nada, se actualizan solas).

## Pasos que tienes que hacer tu (una sola vez)

Yo no puedo crear el proyecto de Firebase, activar la facturacion ni hacer
login con tu cuenta de Google — eso solo lo puedes hacer tu.

### 1. Crear el proyecto en Firebase

1. Entra a https://console.firebase.google.com
2. "Agregar proyecto" → nombralo como quieras (ej. `nuevos-tiempos-tracker`)
3. Dentro del proyecto, activa el plan **Blaze** (pago por uso). Es
   obligatorio para usar Cloud Functions programadas — pero con este
   volumen de uso (3 funciones que corren una vez al dia) el costo mensual
   deberia ser $0 o centavos, muy por debajo de la capa gratuita.
4. Anota el **Project ID** que te asigna Firebase.

### 2. Editar `.firebaserc`

Reemplaza `REEMPLAZA-CON-TU-PROJECT-ID` en el archivo `.firebaserc` por el
Project ID real.

### 3. Instalar Firebase CLI y hacer login

Desde una terminal, dentro de esta carpeta (`nuevos-tiempos-tracker`):

```
npm install -g firebase-tools
firebase login
```

Esto abre tu navegador para que inicies sesion con la cuenta de Google
dueña del proyecto.

### 4. Instalar dependencias

```
cd functions
npm install
cd ..
```

### 5. Cargar el historico que ya recolectamos (opcional, recomendado)

Ya tenemos ~3293 sorteos historicos (2023-08-17 a hoy) y el primer registro
de predicciones, guardados en `seed/data.csv` y `seed/predictions_log.csv`.
Para no esperar meses a que las funciones programadas vuelvan a acumular
ese historial desde cero:

```
gcloud auth application-default login
cd scripts
npm install
node seed.js
cd ..
```

(Si no tienes `gcloud` instalado, tambien puedes generar una service
account key desde Firebase Console → Configuracion del proyecto → Cuentas
de servicio → "Generar nueva clave privada", guardarla como
`scripts/serviceAccountKey.json`, y correr en su lugar:
`set GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json && node seed.js`
en Windows, o `GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node seed.js`
en Mac/Linux.)

### 6. Desplegar

```
firebase deploy
```

Esto sube las 3 Cloud Functions, las reglas de Firestore, y las paginas de
Hosting. Al final te da una URL publica (algo como
`https://TU-PROYECTO.web.app`) — esa es tu pagina, ya funcionando, ya
actualizandose sola cada dia.

## Como verificar que quedo funcionando

- `firebase functions:log` — ver los logs de las 3 funciones.
- En Firebase Console → Firestore, deberias ver las colecciones `draws`,
  `predictions`, `stats`, `predictions_summary` con datos.
- Entra a la URL de Hosting y deberias ver el dashboard con los datos
  cargados.

## Notas

- Se dejo fuera de la automatizacion la fuente `datalotohn.com` porque su
  `robots.txt` bloquea el acceso automatizado; incluirla requeriria un
  metodo distinto (o permiso explicito del sitio) que no se implemento aqui.
- Las formulas de "baseline esperado por azar" usan
  `1 - (1 - k/100)^3` (probabilidad de que al menos 1 de los 3 sorteos del
  dia caiga dentro de una lista de k numeros elegidos al azar entre 00-99).
- El chi-cuadrado se calcula a mano en `functions/chisquare.js` (funcion
  gamma incompleta regularizada, aproximacion de Lanczos) porque Node no
  trae una libreria equivalente a `scipy.stats` incluida.
