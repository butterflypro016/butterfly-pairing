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

// Route pour la page d'accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour démarrer le jumelage
app.post('/pair', async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'Numéro requis.' });

  const cleanNumber = phoneNumber.replace(/\D/g, '');
  if (cleanNumber.length < 10) {
    return res.status(400).json({ error: 'Numéro invalide. Utilise le format international (ex: 221XXXXXXXX).' });
  }

  const sessionDir = path.join(TEMP_DIR, `session_${Date.now()}`);
  fs.mkdirSync(sessionDir);

  try {
    const { state } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['Butterfly Pairing', 'Chrome', ''],
    });

    let pairingCode = null;
    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'close') {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    });

    pairingCode = await sock.requestPairingCode(cleanNumber);
    pairingCode = pairingCode.replace(/-/g, '');

    return res.json({
      success: true,
      message: 'Code de jumelage généré. Entre ce code dans WhatsApp pour connecter le bot.',
      code: pairingCode,
      token: path.basename(sessionDir)
    });
  } catch (error) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    return res.status(500).json({ error: 'Erreur lors de la demande de code.' });
  }
});

// Route pour vérifier l'état et récupérer la session
app.get('/check/:token', async (req, res) => {
  const { token } = req.params;
  const sessionDir = path.join(TEMP_DIR, token);
  if (!fs.existsSync(sessionDir)) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }

  const credsPath = path.join(sessionDir, 'creds.json');
  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      const credsBase64 = Buffer.from(JSON.stringify(creds)).toString('base64');
      const sessionId = `butterfly~${credsBase64}`;
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.json({ success: true, sessionId });
    } catch (e) {
      return res.status(500).json({ error: 'Erreur de lecture.' });
    }
  } else {
    return res.json({ success: false, status: 'pending' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));
