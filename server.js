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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/pair', async (req, res) => {
  const { phoneNumber } = req.body;
  console.log('📥 Requête reçue pour le numéro:', phoneNumber);

  if (!phoneNumber) {
    console.log('❌ Numéro manquant');
    return res.status(400).json({ error: 'Numéro requis.' });
  }

  const cleanNumber = phoneNumber.replace(/\D/g, '');
  console.log('🔢 Numéro nettoyé:', cleanNumber);
  if (cleanNumber.length < 10) {
    console.log('❌ Numéro trop court');
    return res.status(400).json({ error: 'Numéro invalide. Utilise le format international (ex: 221XXXXXXXX).' });
  }

  const sessionDir = path.join(TEMP_DIR, `session_${Date.now()}`);
  fs.mkdirSync(sessionDir);
  console.log('📁 Dossier de session créé:', sessionDir);

  try {
    console.log('🔄 Chargement de l\'état Baileys...');
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    console.log('✅ Version Baileys:', version);

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['Butterfly Pairing', 'Chrome', ''],
    });

    let pairingCode = null;
    let connectionError = null;

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      console.log('📡 Mise à jour de connexion:', update);
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log('🔌 Connexion fermée, code:', statusCode);
        if (statusCode === 401) {
          connectionError = 'Déconnecté. La session a expiré.';
        } else {
          connectionError = 'Erreur de connexion.';
        }
        // Ne pas supprimer le dossier tout de suite, on veut garder les infos pour debug
        // fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    });

    try {
      console.log('🔄 Demande du code de jumelage pour:', cleanNumber);
      pairingCode = await sock.requestPairingCode(cleanNumber);
      pairingCode = pairingCode.replace(/-/g, '');
      console.log('✅ Code obtenu:', pairingCode);
    } catch (error) {
      console.error('❌ Erreur lors de requestPairingCode:', error);
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
    console.error('💥 Erreur générale dans /pair:', error);
    fs.rmSync(sessionDir, { recursive: true, force: true });
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.get('/check/:token', async (req, res) => {
  const { token } = req.params;
  console.log('🔍 Vérification du token:', token);
  const sessionDir = path.join(TEMP_DIR, token);

  if (!fs.existsSync(sessionDir)) {
    console.log('❌ Dossier session introuvable');
    return res.status(404).json({ error: 'Session introuvable ou expirée.' });
  }

  const credsPath = path.join(sessionDir, 'creds.json');
  if (fs.existsSync(credsPath)) {
    try {
      console.log('📄 Fichier creds.json trouvé, lecture...');
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      const credsBase64 = Buffer.from(JSON.stringify(creds)).toString('base64');
      const sessionId = `butterfly~${credsBase64}`;
      console.log('✅ Session ID générée');
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.json({ success: true, sessionId });
    } catch (e) {
      console.error('❌ Erreur lecture creds.json:', e);
      return res.status(500).json({ error: 'Erreur de lecture des credentials.' });
    }
  } else {
    console.log('⏳ En attente de creds.json...');
    return res.json({ success: false, status: 'pending' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
