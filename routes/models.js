const express = require('express');
const formidable = require('express-formidable');
const archiver = require('archiver');
const path = require('path');
const zlib = require('zlib');
const { listObjects, uploadObject, deleteObject, translateObject, prepareObjectForOffline, getManifest, getInternalToken, urnify } = require('../services/aps.js');

let router = express.Router();

router.get('/api/models', async function (req, res, next) {
    try {
        const objects = await listObjects();
        res.json(objects.map(o => ({
            name: o.objectKey,
            urn: urnify(o.objectId)
        })));
    } catch (err) {
        next(err);
    }
});

router.get('/api/models/:urn/status', async function (req, res, next) {
    try {
        const manifest = await getManifest(req.params.urn);
        if (manifest) {
            let messages = [];
            if (manifest.derivatives) {
                for (const derivative of manifest.derivatives) {
                    messages = messages.concat(derivative.messages || []);
                    if (derivative.children) {
                        for (const child of derivative.children) {
                            messages.concat(child.messages || []);
                        }
                    }
                }
            }
            res.json({ status: manifest.status, progress: manifest.progress, messages });
        } else {
            res.json({ status: 'n/a' });
        }
    } catch (err) {
        next(err);
    }
});

router.post('/api/models/delete', async function (req, res, next) {
    const names = req.body?.names;
    if (!Array.isArray(names) || names.length === 0 || names.length > 50 || names.some((name) => typeof name !== 'string')) {
        res.status(400).send('Selecciona entre 1 y 50 proyectos para eliminar.');
        return;
    }

    const deleted = [];
    const failed = [];
    for (const name of [...new Set(names)]) {
        try {
            await deleteObject(name);
            deleted.push(name);
        } catch (error) {
            failed.push({ name, message: error.message });
        }
    }
    res.status(failed.length ? 207 : 200).json({ deleted, failed });
});

router.post('/api/models/:urn/offline', async function (req, res, next) {
    try {
        res.json({ result: await prepareObjectForOffline(req.params.urn) });
    } catch (err) {
        next(err);
    }
});

router.get('/api/models/:urn/files', async function (req, res, next) {
    try {
        const token = await getInternalToken();
        const manifest = await getManifest(req.params.urn);
        const derivatives = collectOfflineDerivatives(manifest);

        for (const derivative of derivatives) {
            if (derivative.mime === 'application/autodesk-svf') {
                const response = await fetchDerivative(derivative.urn, token);
                const svfManifest = JSON.parse(extractZipEntry(response, 'manifest.json').toString('utf8'));
                derivative.files = (svfManifest.assets || [])
                    .map((asset) => asset.URI)
                    .filter((uri) => !uri.startsWith('embed:/'));
            } else if (derivative.mime === 'application/autodesk-db') {
                derivative.files = ['objects_attrs.json.gz', 'objects_vals.json.gz', 'objects_offs.json.gz', 'objects_ids.json.gz', 'objects_avs.json.gz', derivative.rootFileName];
            } else {
                derivative.files = [derivative.rootFileName];
            }
        }

        res.json(derivatives);
    } catch (err) {
        next(err);
    }
});

router.get('/api/models/:urn/package', async function (req, res, next) {
    try {
        const token = await getInternalToken();
        const manifest = await getManifest(req.params.urn);
        if (!manifest || manifest.status !== 'success') {
            res.status(409).send('El modelo debe terminar de traducirse antes de exportarlo.');
            return;
        }

        const derivatives = collectOfflineDerivatives(manifest);
        for (const derivative of derivatives) {
            if (derivative.mime === 'application/autodesk-svf') {
                const response = await fetchDerivative(derivative.urn, token);
                const svfManifest = JSON.parse(extractZipEntry(response, 'manifest.json').toString('utf8'));
                derivative.files = (svfManifest.assets || [])
                    .map((asset) => asset.URI)
                    .filter((uri) => !uri.startsWith('embed:/'));
            } else if (derivative.mime === 'application/autodesk-db') {
                derivative.files = [
                    'objects_attrs.json.gz', 'objects_vals.json.gz', 'objects_offs.json.gz',
                    'objects_ids.json.gz', 'objects_avs.json.gz', derivative.rootFileName
                ];
            } else {
                derivative.files = [derivative.rootFileName];
            }
        }

        const svf = derivatives.find((derivative) => derivative.mime === 'application/autodesk-svf');
        if (!svf) {
            res.status(422).send('No se encontró una vista SVF compatible con el modo offline.');
            return;
        }

        const requestedName = String(req.query.name || 'Proyecto offline').trim();
        const safeName = requestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'Proyecto offline';
        res.attachment(`${safeName}.visor3d`);
        res.type('application/zip');

        const archive = archiver('zip', { zlib: { level: 0 } });
        archive.on('error', next);
        archive.pipe(res);
        archive.append(JSON.stringify({
            format: 'visor3d-project',
            version: 1,
            name: requestedName,
            entrypoint: localDerivativePath(svf.urn)
        }, null, 2), { name: 'project.json' });

        const added = new Set();
        for (const derivative of derivatives) {
            const resources = [derivative.urn, ...(derivative.files || []).map((file) => derivative.basePath + file)];
            for (const resource of resources) {
                const localPath = localDerivativePath(resource);
                if (!localPath || added.has(localPath)) continue;
                added.add(localPath);
                const buffer = await fetchDerivative(resource, token);
                archive.append(buffer, { name: localPath });
            }
        }
        await archive.finalize();
    } catch (err) {
        if (!res.headersSent) next(err);
        else res.destroy(err);
    }
});

function collectOfflineDerivatives(manifest) {
    const result = [];
    const roles = new Set([
        'Autodesk.CloudPlatform.DesignDescription',
        'Autodesk.CloudPlatform.PropertyDatabase',
        'graphics', 'preview', 'thumbnail'
    ]);
    const visit = (node) => {
        if (node?.urn && roles.has(node.role)) {
            const decoded = decodeURIComponent(node.urn);
            const slash = decoded.lastIndexOf('/');
            result.push({
                urn: decoded,
                mime: node.mime,
                rootFileName: decoded.slice(slash + 1),
                basePath: decoded.slice(0, slash + 1)
            });
        }
        node?.children?.forEach(visit);
    };
    manifest?.derivatives?.forEach(visit);
    return result;
}

function localDerivativePath(derivativeUrn) {
    const decoded = decodeURIComponent(derivativeUrn).replace(/\\/g, '/');
    const outputMarker = '/output/';
    const markerIndex = decoded.indexOf(outputMarker);
    const relative = markerIndex >= 0
        ? decoded.slice(markerIndex + outputMarker.length)
        : decoded.slice(decoded.lastIndexOf('/') + 1);
    const clean = path.posix.normalize(relative).replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
    return clean || null;
}

async function fetchDerivative(derivativeUrn, token) {
    const url = `https://developer.api.autodesk.com/derivativeservice/v2/derivatives/${encodeURIComponent(derivativeUrn)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        throw new Error(`No se pudo descargar un derivado APS (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
}

function extractZipEntry(buffer, wantedName) {
    const eocdSignature = 0x06054b50;
    let eocd = buffer.length - 22;
    while (eocd >= 0 && buffer.readUInt32LE(eocd) !== eocdSignature) eocd--;
    if (eocd < 0) throw new Error('El archivo SVF descargado no es un ZIP válido.');

    const entries = buffer.readUInt16LE(eocd + 10);
    let cursor = buffer.readUInt32LE(eocd + 16);
    for (let index = 0; index < entries; index++) {
        if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
        const method = buffer.readUInt16LE(cursor + 10);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const nameLength = buffer.readUInt16LE(cursor + 28);
        const extraLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const localOffset = buffer.readUInt32LE(cursor + 42);
        const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
        if (name === wantedName) {
            const localNameLength = buffer.readUInt16LE(localOffset + 26);
            const localExtraLength = buffer.readUInt16LE(localOffset + 28);
            const start = localOffset + 30 + localNameLength + localExtraLength;
            const compressed = buffer.subarray(start, start + compressedSize);
            if (method === 0) return compressed;
            if (method === 8) return zlib.inflateRawSync(compressed);
            throw new Error(`Método ZIP no compatible: ${method}.`);
        }
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error(`No se encontró ${wantedName} dentro del SVF.`);
}

router.post('/api/models', formidable({ maxFileSize: Infinity }), async function (req, res, next) {
    const file = req.files['model-file'];
    if (!file) {
        res.status(400).send('The required field ("model-file") is missing.');
        return;
    }
    try {
        const obj = await uploadObject(file.name, file.path);
        await translateObject(urnify(obj.objectId), req.fields['model-zip-entrypoint']);
        res.json({
            name: obj.objectKey,
            urn: urnify(obj.objectId)
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
