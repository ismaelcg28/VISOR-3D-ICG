import { initViewer, loadModel, probarNavegador } from './viewer.js?v=13';

initViewer(document.getElementById('preview')).then(viewer => {
    // Referencia estable para diagnósticos y pruebas automatizadas del visor.
    window.viewerActual = viewer;
    const urn = window.location.hash?.substring(1);
    setupModelSelection(viewer, urn);
    setupModelManager(viewer);
    setupModelUpload(viewer);
    setupOffline(viewer);
    setupOfflineExport();
});

let deferredInstallPrompt;
window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.getElementById('install').hidden = false;
});

async function setupOffline(viewer) {
    if (!('serviceWorker' in navigator)) return;
    await navigator.serviceWorker.register('/service-worker.js');

    document.getElementById('install').onclick = async () => {
        await deferredInstallPrompt?.prompt();
        deferredInstallPrompt = null;
        document.getElementById('install').hidden = true;
    };

    document.getElementById('offline').onclick = async () => {
        const urn = document.getElementById('models').value;
        if (!urn) return;
        const button = document.getElementById('offline');
        button.disabled = true;
        showNotification('Preparando el modelo para uso offline… No cierres esta página.');
        try {
            const preparation = await fetch(`/api/models/${urn}/offline`, { method: 'POST' });
            if (!preparation.ok) throw new Error(await preparation.text());
            await waitForTranslation(urn);
            await loadModel(viewer, urn);
            await cacheModel(urn);
            await probarNavegador(viewer);
            button.textContent = 'Disponible offline ✓';
            clearNotification();
        } catch (error) {
            console.error(error);
            showNotification(`No se pudo preparar el modelo offline: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    };
}

function setupOfflineExport() {
    document.getElementById('export-offline').onclick = () => {
        const models = document.getElementById('models');
        const option = models.selectedOptions[0];
        if (!option?.value) return;
        const url = `/api/models/${encodeURIComponent(option.value)}/package?name=${encodeURIComponent(option.textContent)}`;
        window.location.assign(url);
    };
}

async function waitForTranslation(urn) {
    while (true) {
        const response = await fetch(`/api/models/${urn}/status`, { cache: 'no-store' });
        if (!response.ok) throw new Error(await response.text());
        const status = await response.json();
        if (status.status === 'success') return;
        if (status.status === 'failed') throw new Error('La traducción offline falló.');
        showNotification(`Preparando el modelo offline (${status.progress || 'en proceso'})…`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
}

async function cacheModel(urn) {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) throw new Error('El modo offline todavía no está activo. Recarga la página e inténtalo de nuevo.');
    const tokenResponse = await fetch('/api/auth/token');
    const { access_token } = await tokenResponse.json();
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = ({ data }) => data?.error ? reject(new Error(data.error)) : resolve(data);
        worker.postMessage({ operation: 'CACHE_URN', urn, access_token }, [channel.port2]);
    });
}

async function setupModelSelection(viewer, selectedUrn) {
    const dropdown = document.getElementById('models');
    dropdown.innerHTML = '';
    try {
        const resp = await fetch('/api/models');
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const models = await resp.json();
        renderManagedModels(models);
        for (const model of models) {
            const option = document.createElement('option');
            option.value = model.urn;
            option.textContent = model.name;
            option.selected = model.urn === selectedUrn;
            dropdown.append(option);
        }
        dropdown.onchange = () => onModelSelected(viewer, dropdown.value);
        if (dropdown.value) {
            onModelSelected(viewer, dropdown.value);
        }
    } catch (err) {
        alert('Could not list models. See the console for more details.');
        console.error(err);
    }
}

function setupModelManager(viewer) {
    const dialog = document.getElementById('models-dialog');
    const list = document.getElementById('managed-model-list');
    const deleteButton = document.getElementById('delete-models');
    const updateDeleteButton = () => {
        deleteButton.disabled = list.querySelectorAll('input[type="checkbox"]:checked').length === 0;
    };

    document.getElementById('manage-models').onclick = () => dialog.showModal();
    document.getElementById('close-models').onclick = () => dialog.close();
    list.onchange = updateDeleteButton;
    deleteButton.onclick = async () => {
        const selected = [...list.querySelectorAll('input[type="checkbox"]:checked')];
        const names = selected.map((checkbox) => checkbox.value);
        if (!names.length) return;
        const summary = names.length <= 4 ? names.join('\n') : `${names.slice(0, 4).join('\n')}\ny ${names.length - 4} más`;
        if (!window.confirm(`Se eliminarán permanentemente estos ${names.length} proyecto(s) del almacenamiento:\n\n${summary}\n\nEsta acción no se puede deshacer. ¿Continuar?`)) return;

        deleteButton.disabled = true;
        try {
            const response = await fetch('/api/models/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ names })
            });
            const responseBody = await response.text();
            let result;
            try {
                result = JSON.parse(responseBody);
            } catch (_error) {
                result = null;
            }
            if (!response.ok) throw new Error(responseBody || 'No se pudieron eliminar los proyectos.');

            const dropdown = document.getElementById('models');
            const selectedUrn = dropdown.value;
            const selectedModel = [...dropdown.options].find((option) => option.value === selectedUrn);
            const deletedCurrentModel = selectedModel && result.deleted.includes(selectedModel.textContent);
            if (deletedCurrentModel && viewer.model) viewer.impl.unloadModel(viewer.model);
            if (deletedCurrentModel) window.location.hash = '';

            if (result.failed.length) {
                alert(`Se eliminaron ${result.deleted.length} proyecto(s). No se pudieron eliminar: ${result.failed.map((item) => `${item.name}: ${item.message}`).join('; ')}`);
            } else {
                alert(`Se eliminaron ${result.deleted.length} proyecto(s).`);
            }
            await setupModelSelection(viewer, deletedCurrentModel ? '' : selectedUrn);
        } catch (error) {
            console.error(error);
            alert(`No se pudieron eliminar los proyectos: ${error.message}`);
        } finally {
            updateDeleteButton();
        }
    };
}

function renderManagedModels(models) {
    const list = document.getElementById('managed-model-list');
    list.replaceChildren();
    if (!models.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No hay proyectos cargados.';
        list.append(empty);
        document.getElementById('delete-models').disabled = true;
        return;
    }
    for (const model of models) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = model.name;
        const name = document.createElement('span');
        name.textContent = model.name;
        label.append(checkbox, name);
        list.append(label);
    }
    document.getElementById('delete-models').disabled = true;
}

async function setupModelUpload(viewer) {
    const upload = document.getElementById('upload');
    const input = document.getElementById('input');
    const models = document.getElementById('models');
    upload.onclick = () => input.click();
    input.onchange = async () => {
        const file = input.files[0];
        let data = new FormData();
        data.append('model-file', file);
        if (file.name.endsWith('.zip')) { // When uploading a zip file, ask for the main design file in the archive
            const entrypoint = window.prompt('Please enter the filename of the main design inside the archive.');
            data.append('model-zip-entrypoint', entrypoint);
        }
        upload.setAttribute('disabled', 'true');
        models.setAttribute('disabled', 'true');
        showNotification(`Uploading model <em>${file.name}</em>. Do not reload the page.`);
        try {
            const resp = await fetch('/api/models', { method: 'POST', body: data });
            if (!resp.ok) {
                throw new Error(await resp.text());
            }
            const model = await resp.json();
            setupModelSelection(viewer, model.urn);
        } catch (err) {
            alert(`Could not upload model ${file.name}. See the console for more details.`);
            console.error(err);
        } finally {
            clearNotification();
            upload.removeAttribute('disabled');
            models.removeAttribute('disabled');
            input.value = '';
        }
    };
}

async function onModelSelected(viewer, urn) {
    if (window.onModelSelectedTimeout) {
        clearTimeout(window.onModelSelectedTimeout);
        delete window.onModelSelectedTimeout;
    }
    window.location.hash = urn;
    try {
        const resp = await fetch(`/api/models/${urn}/status`);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const status = await resp.json();
        switch (status.status) {
            case 'n/a':
                showNotification(`Model has not been translated.`);
                break;
            case 'inprogress':
                showNotification(`Model is being translated (${status.progress})...`);
                window.onModelSelectedTimeout = setTimeout(onModelSelected, 5000, viewer, urn);
                break;
            case 'failed':
                showNotification(`Translation failed. <ul>${status.messages.map(msg => `<li>${JSON.stringify(msg)}</li>`).join('')}</ul>`);
                break;
            default:
                clearNotification();
                await loadModel(viewer, urn);
                await probarNavegador(viewer);
                console.log('MODELO 3D CARGADO CORRECTAMENTE');
                break;
        }
    } catch (err) {
        alert('Could not load model. See the console for more details.');
        console.error(err);
    }
}

function showNotification(message) {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = `<div class="notification">${message}</div>`;
    overlay.style.display = 'flex';
}

function clearNotification() {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'none';
}
