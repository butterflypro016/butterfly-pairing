<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Butterfly Pairing</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .container {
            background: white;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            padding: 30px;
            max-width: 500px;
            width: 100%;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }
        h1 span {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        input {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            border: 2px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
            box-sizing: border-box;
        }
        button {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            transition: transform 0.2s;
        }
        button:hover {
            transform: scale(1.02);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .result {
            margin-top: 20px;
            padding: 15px;
            border-radius: 5px;
            display: none;
        }
        .result.show {
            display: block;
        }
        .code {
            font-size: 28px;
            font-weight: bold;
            text-align: center;
            padding: 15px;
            background: #f0f0f0;
            border-radius: 5px;
            margin: 15px 0;
            letter-spacing: 5px;
        }
        .session {
            background: #d4edda;
            color: #155724;
            padding: 15px;
            border-radius: 5px;
            word-break: break-all;
            margin: 15px 0;
        }
        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .info {
            background: #e7f3ff;
            color: #004085;
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
            font-size: 14px;
        }
        .loading {
            text-align: center;
            margin: 15px 0;
        }
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🦋 <span>Butterfly Pairing</span></h1>
        <form id="pairForm">
            <input type="text" id="phone" placeholder="Numéro (ex: 221XXXXXXXX)" required>
            <button type="submit" id="submitBtn">Obtenir le code</button>
        </form>
        <div id="result" class="result"></div>
    </div>

    <script>
        const form = document.getElementById('pairForm');
        const phoneInput = document.getElementById('phone');
        const submitBtn = document.getElementById('submitBtn');
        const resultDiv = document.getElementById('result');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const phone = phoneInput.value.trim();
            if (!phone) return;

            // Désactiver le formulaire
            phoneInput.disabled = true;
            submitBtn.disabled = true;
            resultDiv.classList.remove('show');
            resultDiv.innerHTML = '<div class="loading"><div class="spinner"></div><p>Demande en cours...</p></div>';
            resultDiv.classList.add('show');

            try {
                const response = await fetch('/pair', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });
                const data = await response.json();

                if (data.error) {
                    resultDiv.innerHTML = `<div class="error">Erreur : ${data.error}</div>`;
                    phoneInput.disabled = false;
                    submitBtn.disabled = false;
                    return;
                }

                if (data.success) {
                    // Afficher le code
                    resultDiv.innerHTML = `
                        <div class="info">${data.message}</div>
                        <div class="code">${data.code}</div>
                        <p>En attente de la connexion WhatsApp...</p>
                        <div class="loading"><div class="spinner"></div></div>
                        <div id="pollingResult"></div>
                    `;

                    // Commencer le polling
                    const token = data.token;
                    const pollInterval = setInterval(async () => {
                        try {
                            const checkRes = await fetch('/check/' + token);
                            const checkData = await checkRes.json();
                            
                            if (checkData.success) {
                                clearInterval(pollInterval);
                                document.getElementById('pollingResult').innerHTML = `
                                    <div class="session">
                                        <strong>SESSION_ID générée :</strong><br>
                                        <code>${checkData.sessionId}</code>
                                    </div>
                                    <p>Copie cette chaîne et mets-la dans ton fichier .env.</p>
                                `;
                                // Réactiver le formulaire
                                phoneInput.disabled = false;
                                submitBtn.disabled = false;
                            } else if (checkData.error) {
                                clearInterval(pollInterval);
                                document.getElementById('pollingResult').innerHTML = `<div class="error">Erreur : ${checkData.error}</div>`;
                                phoneInput.disabled = false;
                                submitBtn.disabled = false;
                            }
                            // Si pending, on continue
                        } catch (err) {
                            clearInterval(pollInterval);
                            document.getElementById('pollingResult').innerHTML = `<div class="error">Erreur de communication</div>`;
                            phoneInput.disabled = false;
                            submitBtn.disabled = false;
                        }
                    }, 3000);
                } else {
                    resultDiv.innerHTML = `<div class="error">Erreur inconnue</div>`;
                    phoneInput.disabled = false;
                    submitBtn.disabled = false;
                }
            } catch (err) {
                resultDiv.innerHTML = `<div class="error">Erreur réseau</div>`;
                phoneInput.disabled = false;
                submitBtn.disabled = false;
            }
        });
    </script>
</body>
</html>
