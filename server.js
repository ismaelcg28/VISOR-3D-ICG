const express = require('express');
const crypto = require('crypto');
const { PORT } = require('./config.js');

let app = express();
app.set('trust proxy', 1);

app.get('/api/health', function (_req, res) {
    res.json({ status: 'ok' });
});

function safeEqual(left, right) {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function protectPublicDeployment(req, res, next) {
    const expectedUser = process.env.APP_USERNAME;
    const expectedPassword = process.env.APP_PASSWORD;
    if (!expectedUser || !expectedPassword) return next();

    const authorization = req.get('authorization') || '';
    const encoded = authorization.startsWith('Basic ') ? authorization.slice(6) : '';
    let suppliedUser = '';
    let suppliedPassword = '';
    try {
        [suppliedUser, suppliedPassword] = Buffer.from(encoded, 'base64').toString('utf8').split(/:(.*)/s, 2);
    } catch (_error) {
        // La respuesta 401 de abajo solicitará nuevamente las credenciales.
    }

    if (safeEqual(suppliedUser, expectedUser) && safeEqual(suppliedPassword, expectedPassword)) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Visor 3D ICG", charset="UTF-8"');
    res.status(401).send('Acceso protegido.');
}

app.use(protectPublicDeployment);
app.use(express.json({ limit: '100kb' }));
app.use(express.static('wwwroot'));
app.use(require('./routes/auth.js'));
app.use(require('./routes/models.js'));
app.listen(PORT, '0.0.0.0', function () { console.log(`Server listening on port ${PORT}...`); });
