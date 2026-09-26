/// import * as Autodesk from "@types/forge-viewer";

async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        alert('Could not obtain access token. See the console for more details.');
        console.error(err);
    }
}

function configurarRenderizadoMovil(viewer) {
    if (!/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return;
    viewer.setProgressiveRendering(false);
    viewer.prefs?.set?.('progressiveRendering', false);
    viewer.impl?.invalidate?.(true, true, true);
}

async function configurarMedicionNativa(viewer, model) {
    // La traducción DWG entrega las coordenadas 3D ya normalizadas en metros,
    // aunque conserva "mm" como unidad declarada. Corregimos solo la unidad;
    // no volvemos a escalar la geometría.
    model.getData().overriddenUnits = 'm';
    const measure = await viewer.loadExtension('Autodesk.Measure');
    measure.setUnits('cm');
    measure.setPrecision(2);
    const bounds = model.getBoundingBox();
    console.log('MEDICION_CONFIGURADA', JSON.stringify({
        unidadModelo: model.getUnitString?.(),
        unidadVisible: measure.getUnits(),
        dimensionesMetros: {
            x: bounds.max.x - bounds.min.x,
            y: bounds.max.y - bounds.min.y,
            z: bounds.max.z - bounds.min.z
        }
    }));
}

function encuadrarModeloConMargen(viewer, model) {
    const bounds = model.getBoundingBox().clone();
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(1.25);
    bounds.setFromCenterAndSize(center, size);
    viewer.navigation.fitBounds(true, bounds, false, true);
}

export function initViewer(container) {
    return new Promise(function (resolve, reject) {
        Autodesk.Viewing.Initializer({
            env: 'AutodeskProduction',
            getAccessToken
        }, function () {
            const config = {
                extensions: ['Autodesk.DocumentBrowser']
            };
            const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
            viewer.start();
            viewer.setTheme('light-theme');

            configurarRenderizadoMovil(viewer);
            resolve(viewer);
        });
    });
}

export function loadModel(viewer, urn) {
    return new Promise(function (resolve, reject) {

        function onDocumentLoadSuccess(doc) {
            const viewables3D = doc.getRoot().search({
                type: 'geometry',
                role: '3d'
            }, true);

            console.log('Vistas 3D encontradas:', viewables3D);

            if (viewables3D.length > 0) {
                viewer.loadDocumentNode(doc, viewables3D[0]).then(async (model) => {
                    configurarRenderizadoMovil(viewer);
                    await configurarMedicionNativa(viewer, model);
                    encuadrarModeloConMargen(viewer, model);
                    resolve(model);
                }, reject);
            } else {
                reject(
                    new Error('El archivo no contiene una vista 3D traducida por APS.')
                );
            }
        }

        function onDocumentLoadFailure(code, message, errors) {
            reject({ code, message, errors });
        }

        viewer.setLightPreset(0);

        Autodesk.Viewing.Document.load(
            'urn:' + urn,
            onDocumentLoadSuccess,
            onDocumentLoadFailure
        );
    });
}

export function contarFormaletas(viewer) {
    const model = viewer.model;

    if (!model) {
        console.log('No hay modelo cargado.');
        return;
    }

    const tree = model.getInstanceTree();

    if (!tree) {
        console.log('No se encontró el árbol del modelo.');
        return;
    }

    const conteo = {};

    tree.enumNodeChildren(tree.getRootId(), function (dbId) {
        const nombre = tree.getNodeName(dbId);

        if (nombre) {
            console.log('Nodo:', dbId, nombre);

            const match = nombre.match(/WP\d+X\d+/i);

            if (match) {
                const tipo = match[0].toUpperCase();
                conteo[tipo] = (conteo[tipo] || 0) + 1;
            }
        }
    }, true);

    console.log('CONTEO DE FORMALETAS:', conteo);

    return conteo;
}

function normalizarNombreBloque(nombre) {
    return nombre.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
}

function obtenerHandle(nombre) {
    return nombre.match(/\[([^\]]+)\]\s*$/)?.[1];
}

function obtenerInstanciasDeBloques(instanceTree) {
    const instancias = [];
    const rootId = instanceTree.getRootId();
    let blocksId = null;

    // En los DWG, las referencias de bloque cuelgan del nodo "Blocks (n)".
    // Agrupar solamente sus hijos evita incluir categorías como Blocks o Polylines.
    instanceTree.enumNodeChildren(rootId, (dbId) => {
        const nombre = instanceTree.getNodeName(dbId) ?? '';
        if (/^Blocks\s*\(\d+\)\s*$/i.test(nombre)) {
            blocksId = dbId;
        }
    }, false);

    const agregarInstancia = (dbId) => {
        const nombreOriginal = instanceTree.getNodeName(dbId);

        if (nombreOriginal) {
            const nombreBase = normalizarNombreBloque(nombreOriginal);

            if (nombreBase) {
                instancias.push({ dbId, nombreOriginal, nombreBase });
            }
        }
    };

    if (blocksId !== null) {
        instanceTree.enumNodeChildren(blocksId, agregarInstancia, false);
    }

    return instancias;
}

function obtenerPropiedades(model, dbIds) {
    return new Promise((resolve, reject) => {
        model.getBulkProperties(dbIds, {}, resolve, reject);
    });
}

async function agruparBloquesPorCapa(model, instancias) {
    const grupos = {};

    if (!instancias.length) {
        return grupos;
    }

    const resultados = await obtenerPropiedades(model, instancias.map(({ dbId }) => dbId));
    const capaPorDbId = new Map();

    for (const resultado of resultados) {
        const propiedadCapa = resultado.properties?.find((propiedad) => {
            const nombres = [propiedad.displayName, propiedad.attributeName]
                .filter(Boolean)
                .map((nombre) => String(nombre).trim().toLowerCase());
            return nombres.includes('layer') || nombres.includes('capa');
        });
        const nombreCapa = String(propiedadCapa?.displayValue ?? 'Sin capa').trim() || 'Sin capa';
        capaPorDbId.set(resultado.dbId, nombreCapa);
    }

    for (const instancia of instancias) {
        const nombreCapa = capaPorDbId.get(instancia.dbId) ?? 'Sin capa';
        const gruposCapa = (grupos[nombreCapa] ??= {});
        (gruposCapa[instancia.nombreBase] ??= []).push(instancia);
    }

    return grupos;
}

function crearArbolAgrupado(grupos, totalInstancias) {
    const children = Object.entries(grupos)
        .sort(([capaA], [capaB]) => capaA.localeCompare(capaB, undefined, { sensitivity: 'base' }))
        .map(([nombreCapa, bloques], indiceCapa) => {
            const totalCapa = Object.values(bloques)
                .reduce((total, instancias) => total + instancias.length, 0);

            return {
                id: `capa-${indiceCapa}`,
                type: 'layer',
                label: `${nombreCapa} (${totalCapa})`,
                children: Object.entries(bloques)
                    .sort(([nombreA], [nombreB]) => nombreA.localeCompare(nombreB, undefined, { sensitivity: 'base' }))
                    .map(([nombreBloque, instancias], indiceBloque) => ({
                        id: `capa-${indiceCapa}-bloque-${indiceBloque}`,
                        type: 'group',
                        label: `${nombreBloque} (${instancias.length})`,
                        children: instancias.map((instancia, indiceInstancia) => {
                            const handle = obtenerHandle(instancia.nombreOriginal);
                            return {
                                id: `instancia-${instancia.dbId}`,
                                type: 'instance',
                                label: `Instancia ${indiceInstancia + 1}${handle ? ` [${handle}]` : ''}`,
                                dbId: instancia.dbId
                            };
                        })
                    }))
            };
        });

    return {
        id: 'bloques-agrupados',
        type: 'root',
        label: `Blocks (${totalInstancias})`,
        children
    };
}

function recorrerNodos(nodo, callback) {
    callback(nodo);
    nodo.children?.forEach((child) => recorrerNodos(child, callback));
}

class GroupedTreeDelegate extends Autodesk.Viewing.UI.TreeDelegate {
    constructor(panel) {
        super();
        this.panel = panel;
    }

    isTreeNodeGroup(node) {
        return Boolean(node.children?.length);
    }

    getTreeNodeId(node) {
        return node.id;
    }

    getTreeNodeLabel(node) {
        return node.label;
    }

    getTreeNodeClass(node) {
        return node.type === 'instance' ? 'grouped-model-instance' : 'grouped-model-group';
    }

    forEachChild(node, callback) {
        node.children?.forEach(callback);
    }

    onTreeNodeClick(tree, node, event) {
        if (node.type !== 'instance') {
            tree.setCollapsed(node, !tree.isCollapsed(node));
            return;
        }

        this.panel.selectInstance(node, event);
    }

    onTreeNodeDoubleClick(_tree, node) {
        if (node.type === 'instance') {
            this.panel.viewer.fitToView([node.dbId]);
        }
    }
}

class GroupedModelStructurePanel extends Autodesk.Viewing.Extensions.ViewerModelStructurePanel {
    constructor(viewer, model, grupos, totalInstancias) {
        super(viewer, 'Modelo', { hideSearch: true });
        this.viewer = viewer;
        this.model = model;
        this.root = crearArbolAgrupado(grupos, totalInstancias);
        this.instancesByDbId = new Map();
        this.container.classList.add('grouped-model-structure-panel');

        recorrerNodos(this.root, (instancia) => {
            if (instancia.type === 'instance') {
                this.instancesByDbId.set(instancia.dbId, instancia);
            }
        });

        this.buildGroupedTree();
    }

    buildGroupedTree() {
        if (!this.scrollContainer) {
            this.createScrollContainer({ left: false, heightAdjustment: 70, marginTop: 0 });
        }

        this.tree?.clear?.();
        this.scrollContainer.replaceChildren();
        this.delegate = new GroupedTreeDelegate(this);
        this.tree = new Autodesk.Viewing.UI.Tree(this.delegate, this.root, this.scrollContainer);
        this.tree.setAllCollapsed(true);
        this.tree.setCollapsed(this.root, false);
    }

    selectInstance(node, event) {
        this.viewer.fitToView([node.dbId], this.model, true);

        if (event.ctrlKey || event.metaKey || event.shiftKey) {
            this.viewer.toggleSelect(node.dbId);
        } else {
            this.viewer.select(node.dbId);
        }
    }

    onViewerSelect(event) {
        const selectedDbIds = new Set(event.dbIdArray ?? []);

        for (const selection of event.selections ?? []) {
            if (!selection.model || selection.model === this.model) {
                (selection.dbIdArray ?? []).forEach((dbId) => selectedDbIds.add(dbId));
            }
        }

        const selectedNodes = [...selectedDbIds]
            .map((dbId) => this.instancesByDbId.get(dbId))
            .filter(Boolean);

        this.selectedNodes = selectedNodes;
    }

    // El panel se construye con datos agrupados; la extensión puede invocar
    // setModel/addModel al instalarlo, pero no debe sustituir este árbol.
    setModel() {}

    addModel() {}
}

export async function probarNavegador(viewer) {
    const model = viewer.model;
    if (!model) {
        throw new Error('No hay un modelo cargado para construir el navegador.');
    }

    const instanceTree = await new Promise((resolve, reject) => {
        model.getObjectTree(resolve, reject);
    });
    const instancias = obtenerInstanciasDeBloques(instanceTree);
    const grupos = await agruparBloquesPorCapa(model, instancias);
    const extension = await viewer.loadExtension('Autodesk.ModelStructure');
    const panel = new GroupedModelStructurePanel(viewer, model, grupos, instancias.length);

    extension.setModelStructurePanel(panel);

    // Se conservan para inspección y depuración desde DevTools.
    window.gruposNavegador = grupos;
    window.viewerActual = viewer;

    console.log('Panel Modelo agrupado instalado:', grupos);
    return panel;
}

export function seleccionarBloque(viewer, dbId) {
    viewer.select(dbId);
    viewer.fitToView([dbId]);
}
