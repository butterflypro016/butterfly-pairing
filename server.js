const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const logger = pino({ level: 'silent' });
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Route pour démarrer le jumelage
app.post('/pair', async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Numéro requis.' });
  }

  const cleanNumber = phoneNumber.replace(/\D/g, '');
  if (cleanNumber.length < 10) {
    return res.status(400).json({ error: 'Numéro invalide. Utilise le format international (ex: 221XXXXXXXX).' });
  }

  const sessionDir = path.join(TEMP_DIR, `session_${Date.now()}`);
  fs.mkdirSync(sessionDir);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['Butterfly Pairing', 'Chrome', ''],
    });

    let pairingCode = null;
    let connectionError = null;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        // Connexion réussie, on laisse le dossier temporaire avec les credentials
        // Le client viendra les chercher via /check
      }
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === 401) {
          connectionError = 'Déconnecté. La session a expiré.';
        } else {
          connectionError = 'Erreur de connexion.';
        }
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    });

    try {
      pairingCode = await sock.requestPairingCode(cleanNumber);
      pairingCode = pairingCode.replace(/-/g, '');
    } catch (error) {
      connectionError = 'Erreur lors de la demande de code. Vérifie le numéro.';
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    if (pairingCode) {
      return res.json({
        success: true,
        message: 'Code de jumelage généré. Entre ce code dans WhatsApp pour connecter le bot.',
        code: pairingCode,
        token: path.basename(sessionDir)
      });
    } else {
      return res.status(500).json({ error: connectionError || 'Erreur inconnue.' });
    }
  } catch (error) {
    console.error(error);
    fs.rmSync(sessionDir, { recursive: true, force: true });
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Route pour vérifier l'état et récupérer la session
app.get('/check/:token', async (req, res) => {
  const { token } = req.params;
  const sessionDir = path.join(TEMP_DIR, token);

  if (!fs.existsSync(sessionDir)) {
    return res.status(404).json({ error: 'Session introuvable ou expirée.' });
  }

  const credsPath = path.join(sessionDir, 'creds.json');
  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      const credsBase64 = Buffer.from(JSON.stringify(creds)).toString('base64');
      const sessionId = `butterfly~${credsBase64}`;

      // Nettoyer
      fs.rmSync(sessionDir, { recursive: true, force: true });

      return res.json({ success: true, sessionId });
    } catch (e) {
      return res.status(500).json({ error: 'Erreur de lecture des credentials.' });
    }
  } else {
    return res.json({ success: false, status: 'pending' });
  }
});

// Page d'accueil simple (interface HTML)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Butterfly Pairing</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial; padding: 20px; max-width: 500px; margin: auto; }
        input, button { padding: 10px; width: 100%; margin: 5px 0; }
        .code { font-size: 24px; font-weight: bold; background: #f0f0f0; padding: 10px; text-align: center; }
        .session { background: #e0ffe0; padding: 10px; word-break: break-all; }
      </style>
    </head>
    <body>
      <h1>🦋 Butterfly Pairing</h1>
      <form id="pairForm">
        <input type="text" id="phone" placeholder="Numéro (ex: 221XXXXXXXX)" required>
        <button type="submit">Obtenir le code</button>
      </form>
      <div id="result"></div>
      <script>
        document.getElementById('pairForm').onsubmit = async (e) => {
          e.preventDefault();
          const phone = document.getElementById('phone').value;
          document.getElementById('result').innerHTML = '<p>Chargement...</p>';
          const res = await fetch('/pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: phone })
          });
          const data = await res.json();
          if (data.error) {
            document.getElementById('result').innerHTML = '<p style="color:red">Erreur : ' + data.error + '</p>';
          } else {
            document.getElementById('result').innerHTML = \`
              <p>Code de jumelage :</p>
              <div class="code">\${data.code}</div>
              <p>Entre ce code dans WhatsApp (Appareils liés → Lier un appareil).</p>
              <p>En attente de la connexion...</p>
              <div id="polling"></div>
            \`;
            const token = data.token;
            const poll = setInterval(async () => {
              const check = await fetch('/check/' + token);
              const checkData = await check.json();
              if (checkData.success) {
                clearInterval(poll);
                document.getElementById('polling').innerHTML = \`
                  <p style="color:green">✅ Session générée !</p>
                  <p>Copie cette SESSION_ID :</p>
                  <div class="session">\${checkData.sessionId}</div>
                  <p>Utilise-la dans le fichier .env de ton bot.</p>
                \`;
              } else if (checkData.error) {
                clearInterval(poll);
                document.getElementById('polling').innerHTML = '<p style="color:red">Erreur : ' + checkData.error + '</p>';
              }
            }, 3000);
          }
        };
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
