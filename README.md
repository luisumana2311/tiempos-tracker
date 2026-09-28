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

Todo corre solo, sin depender de tu computadora, y sin costo.

## Arquitectura

- **GitHub Actions** (`.github/workflows/nuevos-tiempos.yml`): corre los 3
  scripts de `automation/` en un cron programado (gratis, sin tarjeta —
  ver nota de "por que no Cloud Functions" abajo).
- **Firestore**: base de datos (`draws`, `predictions`, `stats/latest`,
  `predictions_summary/latest`) — plan Spark (gratis).
- **Firebase Hosting** (`public/`): las 2 paginas del dashboard, que leen
  Firestore en vivo (no hay que "republicar" nada, se actualizan solas) —
  plan Spark (gratis).
- `functions/` queda como referencia/alternativa futura, pero **no se usa
  ahora mismo** (ver nota abajo).

### Por que GitHub Actions y no Cloud Functions

Cloud Functions (incluso el uso minimo) exige que el proyecto de Firebase
este en el plan **Blaze**, que pide asociar una tarjeta. Para evitar eso,
la automatizacion diaria corre en GitHub Actions en su lugar, que es
gratis y no pide tarjeta. El codigo de logica (parsear las paginas,
calcular estadisticas) es el mismo en ambos casos — esta compartido en
`functions/parseHistorico.js`, `functions/parseYelu.js`, `functions/stats.js`
y `functions/chisquare.js`, y `automation/` solo lo reutiliza. Si en algun
momento queres pasarte a Blaze, `functions/index.js` ya esta listo para
desplegarse tal cual.

## Pasos que tienes que hacer tu (una sola vez)

### 1. El proyecto de Firebase ya existe

Ya creaste `nuevos-tiempos-tracker` en Firebase Console y esta en plan
**Spark** (gratis) — no hace falta Blaze para nada de esto.

### 2. Generar una clave de cuenta de servicio

Esto es lo que le da permiso a GitHub Actions (y a tu maquina, si queres
correr los scripts localmente) para escribir en tu Firestore:

1. Firebase Console → ⚙️ Configuracion del proyecto → pestaña
   **Cuentas de servicio**.
2. Boton **"Generar nueva clave privada"** → se descarga un archivo
   `.json`. Guardalo, por ejemplo, en `scripts/serviceAccountKey.json`
   (esta carpeta ya esta en `.gitignore`, no se sube a git jamas).

### 3. Crear el repo en GitHub y subir el proyecto

```
git remote add origin https://github.com/TU-USUARIO/nuevos-tiempos-tracker.git
git branch -M main
git push -u origin main
```

(Si preferis, tambien podes crear el repo primero en github.com y despues
conectar el remoto — el orden no importa.)

### 4. Agregar el secret en GitHub

En el repo de GitHub → **Settings → Secrets and variables → Actions →
New repository secret**:

- **Name**: `FIREBASE_SERVICE_ACCOUNT`
- **Value**: pega el contenido completo del archivo `.json` que descargaste
  en el paso 2 (abrilo con un editor de texto y copia todo, tal cual, con
  las llaves `{ }` incluidas).

Con eso, el workflow `.github/workflows/nuevos-tiempos.yml` ya puede
escribir en tu Firestore cuando corra.

### 5. Activar el workflow

Con el push del paso 3, GitHub ya deberia detectar el archivo
`.github/workflows/nuevos-tiempos.yml` solo. Anda a la pestaña **Actions**
de tu repo — si te pide habilitarlo, aceptalo. Los 3 horarios programados
(cron) van a correr solos desde ese momento.

Para probarlo ya, sin esperar al horario: pestaña **Actions** → selecciona
el workflow "Nuevos Tiempos Tracker" → **Run workflow** → elegi que tarea
correr (`update-draws`, `capture-predictions` o `score-predictions`) →
**Run workflow**. En un minuto deberias ver el resultado en los logs.

### 6. Cargar el historico que ya recolectamos (recomendado)

Ya tenemos ~3293 sorteos historicos (2023-08-17 a hoy) y el primer registro
de predicciones, guardados en `seed/data.csv` y `seed/predictions_log.csv`.
Para no esperar meses a que el workflow vuelva a acumular ese historial
desde cero, corre esto una vez, desde tu maquina:

```
cd scripts
npm install
set GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json
node seed.js
```

(En Windows con PowerShell: `$env:GOOGLE_APPLICATION_CREDENTIALS="serviceAccountKey.json"`
antes del `node seed.js`. En Mac/Linux:
`GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node seed.js`.)

### 7. Publicar las paginas (Hosting)

Esto si necesita el Firebase CLI, pero **no necesita Blaze**, es parte del
plan gratis:

```
npm install -g firebase-tools
firebase login
```

Editar `.firebaserc` y poner tu Project ID real en vez de
`REEMPLAZA-CON-TU-PROJECT-ID`, y despues:

```
firebase deploy --only hosting,firestore:rules
```

Al final te da una URL publica (algo como
`https://TU-PROYECTO.web.app`) — esa es tu pagina.

## Como verificar que quedo funcionando

- Pestaña **Actions** del repo de GitHub — logs de cada corrida.
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
