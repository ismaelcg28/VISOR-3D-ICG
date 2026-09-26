const CACHE_NAME = 'visor-3d-icg-v15';
const DERIVATIVE_BASE = 'https://developer.api.autodesk.com/derivativeservice/v2';
const VIEWER_BASE = 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.99';
const APP_SHELL = [
    '/', '/index.html', '/main.css', '/main.js', '/viewer.js', '/manifest.webmanifest', '/icon.svg',
    `${VIEWER_BASE}/style.css`, `${VIEWER_BASE}/viewer3D.js`, `${VIEWER_BASE}/lmvworker.js`,
    `${VIEWER_BASE}/res/locales/en/allstrings.json`, `${VIEWER_BASE}/res/locales/es/allstrings.json`,
    `${VIEWER_BASE}/res/environments/SharpHighlights_irr.logluv.dds`,
    `${VIEWER_BASE}/res/environments/SharpHighlights_mipdrop.logluv.dds`
];

self.addEventListener('install', (event) => {
    event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(Promise.all([
        self.clients.claim(),
        caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
    ]));
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    event.respondWith(url.origin === self.location.origin && url.pathname.startsWith('/api/')
        ? networkFirst(event.request)
        : cacheFirst(event.request));
});

self.addEventListener('message', (event) => {
    if (event.data?.operation !== 'CACHE_URN') return;
    cacheUrn(event.data.urn, event.data.access_token)
        .then((urls) => event.ports[0].postMessage({ status: 'ok', urls }))
        .catch((error) => event.ports[0].postMessage({ error: error.message }));
});

async function cacheFirst(request) {
    const cached = await caches.match(request.url, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
    }
    return response;
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = await caches.match(request.url, { ignoreSearch: true });
        if (cached) return cached;
        throw error;
    }
}

async function cacheAppShell() {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    const localFailures = results.filter((result, index) =>
        result.status === 'rejected' && APP_SHELL[index].startsWith('/')
    );
    if (localFailures.length) {
        throw new Error('No se pudieron guardar los archivos principales de la aplicación.');
    }
}

async function cacheUrn(urn, token) {
    const listResponse = await fetch(`/api/models/${urn}/files`);
    if (!listResponse.ok) throw new Error(await listResponse.text());
    const derivatives = await listResponse.json();
    const urls = [`${DERIVATIVE_BASE}/manifest/${urn}`];
    for (const derivative of derivatives) {
        urls.push(`${DERIVATIVE_BASE}/derivatives/${encodeURIComponent(derivative.urn)}`);
        for (const file of derivative.files) {
            urls.push(`${DERIVATIVE_BASE}/derivatives/${encodeURIComponent(derivative.basePath + file)}`);
        }
    }

    const cache = await caches.open(CACHE_NAME);
    const options = { headers: { Authorization: `Bearer ${token}` } };
    let completed = 0;
    for (const url of [...new Set(urls)]) {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`No se pudo guardar un archivo del modelo (${response.status}).`);
        await cache.put(url, response);
        completed++;
    }
    return completed;
}
