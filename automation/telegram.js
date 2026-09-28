// Notificaciones por Telegram. No-op silencioso si no hay credenciales
// configuradas (asi el resto del sistema sigue funcionando igual aunque
// no se haya activado el bot todavia).

const fetch = require('node-fetch');

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('Telegram: sin credenciales configuradas, se omite el aviso.');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Telegram: fallo al enviar (${res.status}): ${body}`);
    }
  } catch (err) {
    console.error('Telegram: error de red al enviar:', err.message);
  }
}

module.exports = { sendTelegram };
