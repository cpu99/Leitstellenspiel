
// ==UserScript==
// @name         LSS Statistik-Dashboard
// @license      MIT
// @version      2.2.0
// @author       cpu99 x ChatGPT
// @description  Gebäude, Kleinwachen, Fahrzeuge, Diagramme und Erweiterungen
// @namespace    local.lss.statistics
// @match        https://www.leitstellenspiel.de/
// @match        https://leitstellenspiel.de/
// @grant        GM_xmlhttpRequest
// @connect      api.lss-manager.de
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/cpu99/Leitstellenspiel/main/LSS-Statistik-Dashboard.user.js
// @downloadURL  https://raw.githubusercontent.com/cpu99/Leitstellenspiel/main/LSS-Statistik-Dashboard.user.js
// ==/UserScript==

/*
 * ==========================================
 * HINWEISE & HAFTUNGSAUSSCHLUSS
 * ==========================================
 *
 * Dieses Script wurde mithilfe künstlicher Intelligenz
 * (OpenAI ChatGPT) auf Grundlage meiner persönlichen
 * Anforderungen und Prompts erstellt.
 *
 * Es handelt sich um ein privates, inoffizielles
 * Fanprojekt ohne kommerzielle Absichten.
 *
 * Das Script wird ohne Gewähr für Richtigkeit,
 * Vollständigkeit, Aktualität, Zuverlässigkeit
 * oder Funktionsfähigkeit bereitgestellt.
 *
 * Insbesondere können fehlerhafte oder unvollständige
 * Statistiken, technische Probleme und Inkompatibilitäten
 * mit zukünftigen Spielversionen nicht ausgeschlossen werden.
 *
 * Die Nutzung erfolgt auf eigene Verantwortung.
 * Eine Haftung für Schäden oder Nachteile wird,
 * soweit gesetzlich zulässig, ausgeschlossen.
 * Gesetzlich zwingende Haftungsansprüche bleiben unberührt.
 *
 * Es besteht kein Anspruch auf Updates, Fehlerbehebung
 * oder technischen Support.
 *
 * Dieses Script steht in keiner offiziellen Verbindung
 * zu den Betreibern des Leitstellenspiels oder des
 * LSS-Managers und wird von diesen nicht unterstützt.
 *
 * ==========================================
*/

(() => {
    'use strict';

    if (window.top !== window.self ||
        document.getElementById('lssstat-launcher')) return;

    // ==========================================
    // EINSTELLUNGEN
    // ==========================================

    const MIN_CHART_COUNT = 10; // Unterhalb dieser Anzahl werden Typen als „Sonstige“ zusammengefasst.
    const PAGE_LIMIT = 4000; // Maximale Anzahl der Datensätze pro API-Abfrage. maximal 8.000 je kleiner die Zahl, desto geringer das Risiko eines Timeouts
    const PAGE_ROWS = 100; // Anzahl der sichtbaren Tabellenzeilen pro Seite.

    const ORGS = [
        'Feuerwehr',
        'Rettungsdienst',
        'Polizei',
        'THW'
    ];

    const COLORS = [
        '#e85b59', '#ffb14e', '#5b9bff',
        '#53c3af', '#ae86e8', '#e87eb9',
        '#85b96f', '#f2d465', '#66c4dc',
        '#f28e60', '#bca2f0', '#86abca',
        '#dc9d77', '#62b5aa', '#c9cf74',
        '#d78ea9'
    ];

    const fmt = n =>
    Number(n || 0).toLocaleString('de-DE');

    const low = v =>
    String(v ?? '').toLocaleLowerCase('de');

    const esc = v => String(v ?? '').replace(
        /[&<>"']/g,
        c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c])
    );

    const idOf = v =>
    v == null || v === '' ? null : String(v);

    const inc = (obj, key, n = 1) => {
        obj[key] = (obj[key] || 0) + n;
    };

    const sorted = obj =>
    Object.entries(obj).sort(
        (a, b) =>
        b[1] - a[1] ||
        a[0].localeCompare(b[0], 'de')
    );

    const buildingLink = st => `
     <a
       href="/buildings/${encodeURIComponent(st.id)}"
       target="_blank"
       rel="noopener"
     >${esc(st.name)}</a>
   `;

    const statusName = x =>
    x.available !== true
    ? 'Im Bau'
    : x.enabled === true
    ? 'Aktiv'
    : 'Deaktiviert';

    // ==========================================
    // AUTOMATISCHE DESIGN-ERKENNUNG
    // ==========================================

    const DESIGN = {
        0: 'light',
        1: 'dark',
        2: 'light',
        3: 'light',
        4: 'dark',
        5: 'auto'
    };

    const systemTheme = matchMedia(
        '(prefers-color-scheme: dark)'
    );

    let designMode = 0;

    const state = {
        data: null,
        tab: 'overview',
        detail: null,
        search: '',
        page: 0,
        charts: false,
        mode: 'absolute',
        busy: false,
        abort: null,
        centerFilter: 'all',
        openBuildings: new Set(),
        openExtensions: new Set()
    };

    // ==========================================
    // GEBÄUDETYPEN UND KLEINWACHEN
    // ==========================================

    const FAMILIES = {
        '0': {
            key: 'fire',
            label: 'Feuerwachen',
            org: 'Feuerwehr',
            small: false
        },

        '18': {
            key: 'fire',
            label: 'Feuerwachen',
            org: 'Feuerwehr',
            small: true
        },

        '2': {
            key: 'rescue',
            label: 'Rettungswachen',
            org: 'Rettungsdienst',
            small: false
        },

        '20': {
            key: 'rescue',
            label: 'Rettungswachen',
            org: 'Rettungsdienst',
            small: true
        },

        '6': {
            key: 'police',
            label: 'Polizeiwachen',
            org: 'Polizei',
            small: false
        },

        '19': {
            key: 'police',
            label: 'Polizeiwachen',
            org: 'Polizei',
            small: true
        }
    };

    function organization(type, label) {
        if (FAMILIES[type]) {
            return FAMILIES[type].org;
        }

        const s = low(label);

        if (/thw|ortsverband|technisches hilfswerk/.test(s)) {
            return 'THW';
        }

        if (/polizei|justiz/.test(s)) {
            return 'Polizei';
        }

        if (
            /rettungs|krankenhaus|notarzt|medizin|seg|wasserrettung|bergwacht|rettungshunde/.test(s)
        ) return 'Rettungsdienst';

        if (/feuer|werkfeuer|flughafenfeuer/.test(s)) {
            return 'Feuerwehr';
        }

        return 'Weitere';
    }

    function familyOf(b, label) {
        const type = String(b.building_type);
        const known = FAMILIES[type];

        if (known) {
            return {
                ...known,
                small: b.small_building === true || known.small
            };
        }

        return {
            key: 'type:' + type,
            label,
            org: organization(type, label),
            small: b.small_building === true
        };
    }

    // ==========================================
    // DESIGN – DARKMODE UND LIGHTMODE
    // ==========================================

    const css = `
   /* Statistik-Button in der oberen Navigationsleiste */
   #lssstat-launcher {
    position: static !important;
    display: block !important;
    background: transparent !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 0 !important;
    padding: 15px !important;
    margin: 0 !important;
    box-shadow: none !important;
    font: 14px system-ui, sans-serif !important;
    cursor: pointer !important;
   }

   #lssstat-launcher:hover {
    background: rgba(0, 0, 0, 0.15) !important;
   }

   #lssstat-root {
     --bg:#14181e;
     --panel:#202630;
     --alt:#252c36;
     --head:#363f4b;
     --text:#f0f3f6;
     --muted:#afbac7;
     --line:#414955;
     --input:#292f39;
     --link:#ffa0a5;
     --hover:#343d49;
     --notice:#262d37;
     --status:#424e5e;
     --red:#b8242e;

     position:fixed!important;
     inset:3vh 3vw!important;
     z-index:2147483601!important;
     display:none;
     flex-direction:column!important;
     overflow:hidden!important;
     border:1px solid var(--line)!important;
     border-radius:14px!important;
     background:var(--bg)!important;
     color:var(--text)!important;
     box-shadow:0 24px 90px #000d!important;
     font:16px/1.5 system-ui,sans-serif!important;
     color-scheme:dark!important;
   }

   #lssstat-root[data-theme="light"] {
     --bg:#f3f5f8;
     --panel:#fff;
     --alt:#f5f7fa;
     --head:#e5e9ee;
     --text:#202631;
     --muted:#64717e;
     --line:#d3dbe5;
     --input:#fff;
     --link:#a6212e;
     --hover:#e9edf2;
     --notice:#e8edf3;
     --status:#e1e6ed;

     color-scheme:light!important;
   }

   #lssstat-root * {
     box-sizing:border-box!important;
   }

   #lssstat-root header {
     display:flex!important;
     align-items:center!important;
     justify-content:space-between!important;
     gap:12px!important;
     flex-wrap:wrap!important;
     background:linear-gradient(
       100deg,#b8242e,#751722
     )!important;
     color:#fff!important;
     padding:12px 18px!important;
   }

   #lssstat-root h2 {
     margin:0!important;
     color:#fff!important;
     font:700 21px system-ui!important;
   }

   #lssstat-root h3 {
     color:var(--text)!important;
     font-size:21px!important;
     margin:15px 0 10px!important;
   }

   #lssstat-root button,
   #lssstat-root input,
   #lssstat-root select {
     background:var(--input)!important;
     color:var(--text)!important;
     border:1px solid var(--line)!important;
     border-radius:7px!important;
     padding:8px 11px!important;
     font:inherit!important;
     min-height:34px!important;
   }

   #lssstat-root button {
     cursor:pointer!important;
     font-weight:650!important;
   }

   #lssstat-root button:disabled {
     opacity:.45!important;
     cursor:default!important;
   }

   #lssstat-root button:hover:not(:disabled) {
     background:var(--hover)!important;
     border-color:#d95662!important;
   }

   #lssstat-root button.primary,
   #lssstat-root .tabs button.active {
     background:var(--red)!important;
     border-color:#e45760!important;
     color:#fff!important;
   }

   #lssstat-root .toolbar,
   #lssstat-root .tabs {
     display:flex!important;
     gap:8px!important;
     flex-wrap:wrap!important;
     align-items:center!important;
     padding:10px 17px!important;
     background:var(--panel)!important;
     border-bottom:1px solid var(--line)!important;
   }

   #lssstat-root .body {
     flex:1!important;
     min-height:0!important;
     overflow:auto!important;
     background:var(--bg)!important;
     color:var(--text)!important;
     padding:16px 18px!important;
   }

   #lssstat-root .notice {
     padding:10px 13px!important;
     background:var(--notice)!important;
     color:var(--text)!important;
     border:1px solid var(--line)!important;
     border-radius:8px!important;
     margin-bottom:12px!important;
   }

   #lssstat-root .error {
     border-color:#d24f5b!important;
   }

   #lssstat-root .muted {
     color:var(--muted)!important;
   }

   #lssstat-root .metrics {
     display:grid!important;
     grid-template-columns:
       repeat(auto-fit,minmax(175px,1fr))!important;
     gap:12px!important;
     margin:12px 0 22px!important;
   }

   #lssstat-root .metric,
   #lssstat-root .chart {
     background:var(--panel)!important;
     color:var(--text)!important;
     border:1px solid var(--line)!important;
     border-radius:11px!important;
     padding:15px!important;
   }

   #lssstat-root .metric strong {
     display:block!important;
     color:var(--text)!important;
     font-size:29px!important;
   }

   #lssstat-root .tablebox {
     max-width:100%!important;
     overflow-x:auto!important;
     border:1px solid var(--line)!important;
     border-radius:9px!important;
   }

   #lssstat-root table {
     width:100%!important;
     border-collapse:collapse!important;
     background:var(--panel)!important;
     color:var(--text)!important;
   }

   #lssstat-root th,
   #lssstat-root td {
     padding:9px 11px!important;
     text-align:left!important;
     vertical-align:top!important;
     color:var(--text)!important;
     border-bottom:1px solid var(--line)!important;
   }

   #lssstat-root th {
     background:var(--head)!important;
     color:var(--text)!important;
   }

   #lssstat-root tr:nth-child(even) td {
     background:var(--alt)!important;
   }

   #lssstat-root tr:hover td {
     background:var(--hover)!important;
   }

   #lssstat-root .num {
     text-align:right!important;
     font-variant-numeric:tabular-nums!important;
     white-space:nowrap!important;
   }

   #lssstat-root a,
   #lssstat-root .linkbtn,
   #lssstat-root summary {
     color:var(--link)!important;
     cursor:pointer!important;
   }

   #lssstat-root .linkbtn {
     padding:0!important;
     min-height:0!important;
     border:0!important;
     background:transparent!important;
     text-decoration:underline!important;
     font-weight:600!important;
   }

   #lssstat-root .pager {
     display:flex!important;
     justify-content:center!important;
     align-items:center!important;
     gap:12px!important;
     margin:15px!important;
   }

   #lssstat-root .charts {
     display:grid!important;
     grid-template-columns:
       repeat(auto-fit,minmax(340px,1fr))!important;
     gap:13px!important;
     margin:15px 0!important;
   }

   #lssstat-root .chartrow {
     display:flex!important;
     align-items:center!important;
     gap:14px!important;
     flex-wrap:wrap!important;
   }

   #lssstat-root .donut {
     width:180px!important;
     height:180px!important;
     border-radius:50%!important;
     flex-shrink:0!important;
     position:relative!important;
   }

   #lssstat-root .donut:after {
     content:''!important;
     position:absolute!important;
     inset:53px!important;
     border-radius:50%!important;
     background:var(--panel)!important;
   }

   #lssstat-root .legend {
     flex:1!important;
     min-width:165px!important;
     max-height:300px!important;
     overflow:auto!important;
   }

   #lssstat-root .legenditem {
     display:flex!important;
     align-items:flex-start!important;
     gap:8px!important;
     margin:6px 0!important;
     font-size:14px!important;
   }

   #lssstat-root .swatch {
     width:11px!important;
     height:11px!important;
     min-width:11px!important;
     border-radius:3px!important;
     margin-top:3px!important;
   }

   #lssstat-root details {
     margin:3px 0!important;
     color:var(--text)!important;
   }

   #lssstat-root .stat {
     display:inline-block!important;
     background:var(--status)!important;
     color:var(--text)!important;
     padding:3px 7px!important;
     border-radius:5px!important;
     font-weight:650!important;
   }

   #lssstat-root .subrow td {
     font-size:13px!important;
     color:var(--muted)!important;
   }

   #lssstat-root .indent {
     padding-left:28px!important;
   }

   #lssstat-root .filterlabel {
     font-weight:650!important;
   }

   @media(max-width:700px) {
     #lssstat-root {
       inset:0!important;
       border-radius:0!important;
     }

     #lssstat-root .charts {
       grid-template-columns:1fr!important;
     }

     #lssstat-root .body {
       padding:10px!important;
     }
   }
   /* ==========================================
   SCHRIFTGRÖSSEN – ERWEITERUNGEN
   ========================================== */

   #lssstat-root .tablebox table th,
   #lssstat-root .tablebox table td {
     font-size: 18px !important;
   }

   #lssstat-root .linkbtn {
    font-size: 18px !important;
   }

   #lssstat-root .subrow td {
    font-size: 18px !important;
   }

   lssstat-root .notice {
    font-size: 18px !important;
   }

   #lssstat-root .stat {
    font-size: 18px !important;
   }
   `;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);

    // ==========================================
    // BENUTZEROBERFLÄCHE
    // ==========================================

    // ==========================================
    // STATISTIK-BUTTON IN DER NAVIGATIONSLEISTE
    // ==========================================

    const launcher = document.createElement('button');

    launcher.id = 'lssstat-launcher';
    launcher.type = 'button';
    launcher.textContent = '📊 Statistik';

    // Navigationsleiste suchen
    const navbar = document.querySelector(
        '#navbar-main-collapse > ul'
    );

    if (navbar) {
        // Listenelement erstellen
        const listItem = document.createElement('li');

        listItem.id = 'lssstat-nav-item';
        listItem.appendChild(launcher);

        // Button in die Navigationsleiste einfügen
        navbar.appendChild(listItem);

    } else {
        // Fallback, falls sich die Website-Struktur ändert
        console.warn(
            '[LSS Statistik] Navigationsleiste nicht gefunden.'
        );

        // Button weiterhin erreichbar halten
        launcher.style.position = 'fixed';
        launcher.style.left = '18px';
        launcher.style.bottom = '18px';
        launcher.style.zIndex = '2147483600';
        launcher.style.background = '#b8242e';

        document.body.appendChild(launcher);
    }

    const root = document.createElement('section');

    root.id = 'lssstat-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute(
        'aria-label',
        'LSS Statistik-Dashboard'
    );

    root.innerHTML = `
     <header>
       <h2>📊 LSS Statistik-Dashboard</h2>
       <button id="lssstat-close">
         ✕ Schließen
       </button>
     </header>

     <div class="toolbar">
       <button id="lssstat-load" class="primary">
         Daten laden / aktualisieren
       </button>

       <button id="lssstat-cancel" disabled>
         Abbrechen
       </button>

       <button id="lssstat-export" disabled>
         CSV exportieren
       </button>

       <input
         id="lssstat-search"
         placeholder="Tabelle durchsuchen ..."
       >

       <span class="muted" id="lssstat-progress">
         Noch nicht geladen
       </span>
     </div>

     <nav class="tabs"></nav>

     <main class="body" id="lssstat-content"></main>
   `;

    document.body.append(root);

    const $ = sel => root.querySelector(sel);

    const progress = msg => {
        $('#lssstat-progress').textContent = msg;
    };

    const clearSearch = () => {
        state.search = '';
        $('#lssstat-search').value = '';
    };

    const theme = () => {
        root.dataset.theme = designMode === 5
            ? (systemTheme.matches ? 'dark' : 'light')
        : (DESIGN[designMode] || 'dark');
    };

    async function updateTheme() {
        try {
            const r = await fetch('/api/settings', {
                credentials: 'same-origin',
                cache: 'no-store'
            });

            if (!r.ok) throw Error('HTTP ' + r.status);

            const value = Number(
                (await r.json()).design_mode
            );

            if (
                !Object.prototype.hasOwnProperty.call(
                    DESIGN, value
                )
            ) {
                throw Error('Unbekanntes Design');
            }

            designMode = value;
            theme();

        } catch (e) {
            console.warn(
                '[LSS Statistik] Design:',
                e
            );
        }
    }

    systemTheme.addEventListener('change', () => {
        if (designMode === 5) theme();
    });

    launcher.onclick = () => {
        root.style.display = 'flex';

        if (!root.dataset.theme) {
            root.dataset.theme = 'dark';
        }

        render();
        updateTheme();
    };

    $('#lssstat-close').onclick = () => {
        root.style.display = 'none';
    };

    $('#lssstat-load').onclick = load;

    $('#lssstat-cancel').onclick = () =>
    state.abort?.abort();

    $('#lssstat-export').onclick = exportCSV;

    $('#lssstat-search').oninput = ev => {
        state.search = ev.target.value;
        state.page = 0;
        render();
    };

    document.addEventListener('keydown', e => {
        if (
            e.key === 'Escape' &&
            root.style.display === 'flex'
        ) {
            root.style.display = 'none';
        }
    });

    // ==========================================
    // API
    // ==========================================

    function external(url) {
        return new Promise((resolve, reject) =>
                           GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 18000,

            onload: r => {
                try {
                    if (r.status !== 200) {
                        throw Error('HTTP ' + r.status);
                    }

                    resolve(JSON.parse(r.responseText));
                } catch (e) {
                    reject(e);
                }
            },

            onerror: () =>
            reject(Error('Metadaten-Netzwerkfehler')),

            ontimeout: () =>
            reject(Error('Metadaten-Timeout'))
        })
                          );
    }

    async function fetchJSON(path, signal) {
        let last;

        for (let i = 0; i < 3; i++) {
            if (signal.aborted) {
                throw Error('Abgebrochen');
            }

            try {
                const timeout = AbortSignal.timeout(30000);

                const r = await fetch(path, {
                    credentials: 'same-origin',
                    cache: 'no-store',

                    signal: AbortSignal.any([
                        signal,
                        timeout
                    ]),

                    headers: {
                        Accept: 'application/json'
                    }
                });

                if (!r.ok) {
                    throw Error('HTTP ' + r.status);
                }

                return await r.json();

            } catch (e) {
                if (signal.aborted) throw e;

                last = e;

                if (i < 2) {
                    await new Promise(resolve =>
                                      setTimeout(resolve, 700 * (i + 1))
                                     );
                }
            }
        }

        throw last;
    }

    function nextPage(path) {
        if (!path) return null;

        const u = new URL(path, location.origin);

        if (
            u.origin !== location.origin ||
            !/^\/api\/v2\/(buildings|vehicles)(?:\.json)?$/.test(
                u.pathname
            )
        ) {
            throw Error('Ungültiger Seitenverweis');
        }

        return u.pathname + u.search;
    }

    async function allPages(kind, signal) {
        let url =
            `/api/v2/${kind}?limit=${PAGE_LIMIT}` +
            (kind === 'vehicles'
             ? '&include_image_url=false'
             : '');

        const result = [];
        const visited = new Set();
        const ids = new Set();

        let total = null;

        for (
            let page = 1;
            url && page <= 10000;
            page++
        ) {
            if (visited.has(url)) {
                throw Error('Wiederholte Seite bei ' + kind);
            }

            visited.add(url);

            progress(
                `${kind === 'vehicles'
                ? 'Fahrzeuge'
                : 'Gebäude'}: Seite ${page} – ` +
                `${fmt(result.length)} geladen`
       );

            const data = await fetchJSON(url, signal);

            const list = Array.isArray(data)
            ? data
            : data.result;

            if (!Array.isArray(list)) {
                throw Error(
                    'Unerwartetes API-Format bei ' + kind
                );
            }

            const paging =
                  data.paging || data.pagination || {};

            if (
                paging.count_total != null &&
                Number.isFinite(Number(paging.count_total))
            ) {
                total = Number(paging.count_total);
            }

            for (const row of list) {
                if (row?.id == null) {
                    throw Error('Datensatz ohne ID');
                }

                const id = String(row.id);

                if (ids.has(id)) {
                    throw Error('Doppelte ID ' + id);
                }

                ids.add(id);
                result.push(row);
            }

            url = nextPage(paging.next_page);

            if (!list.length && url) {
                throw Error('Leere Folgeseite');
            }

            if (
                !url &&
                total !== null &&
                total !== result.length
            ) {
                throw Error(
                    `Unvollständige Antwort: ` +
                    `${result.length}/${total}`
         );
            }

            if (
                !url &&
                total === null &&
                list.length === PAGE_LIMIT
            ) {
                throw Error('Paginierung nicht prüfbar');
            }

            if (page === 10000 && url) {
                throw Error('Zu viele Seiten');
            }
        }

        return result;
    }

    // ==========================================
    // DATENVERARBEITUNG
    // ==========================================

    function compile(
    buildings,
     vehicles,
     bmeta,
     vmeta
    ) {
        const byBuilding = new Map();
        const stations = [];
        const vehicleByType = new Map();
        const compactVehicles = [];

        const types = {
            building: {},
            vehicle: {}
        };

        const groups = {
            building: {},
            vehicle: {}
        };

        const families = new Map();
        const centers = new Map();
        const extensions = new Map();

        let missing = 0;
        let extensionEntries = 0;

        // Gebäude und Erweiterungen auswerten
        for (const b of buildings) {
            const typeId = String(b.building_type);

            const type =
                  bmeta[typeId]?.caption ||
                  `Gebäudetyp ${typeId}`;

            const family = familyOf(b, type);

            const center =
                  idOf(b.leitstelle_building_id) || 'ohne';

            const st = {
                id: String(b.id),
                name: String(
                    b.caption || `Gebäude ${b.id}`
         ),
                type,
                typeId,
                org: family.org,
                familyKey: family.key,
                familyName: family.label,
                small: family.small,
                center,
                vehicles: 0,
                byType: {}
            };

            stations.push(st);
            byBuilding.set(st.id, st);

            inc(types.building, type);
            inc(groups.building, st.org);

            // Normale Wachen und Kleinwachen
            if (!families.has(family.key)) {
                families.set(family.key, {
                    key: family.key,
                    name: family.label,
                    org: family.org,
                    count: 0,
                    small: 0,
                    normal: 0
                });
            }

            const fam = families.get(family.key);

            fam.count++;
            fam[st.small ? 'small' : 'normal']++;

            // Leitstellen
            if (!centers.has(center)) {
                centers.set(center, {
                    id: center,
                    buildings: 0,
                    vehicles: 0,
                    byBuilding: {},
                    byVehicle: {}
                });
            }

            const c = centers.get(center);
            c.buildings++;

            inc(c.byBuilding, type);

            // Erweiterungen
            const seen = new Set();

            const buildingExtensions =
                  Array.isArray(b.extensions)
            ? b.extensions
            : [];

            for (const x of buildingExtensions) {
                if (
                    !x ||
                    typeof x !== 'object'
                ) continue;

                const xid = idOf(x.type_id);

                const caption = String(
                    x.caption ||
                    (xid === null
                     ? 'Unbekannte Erweiterung'
                     : `Erweiterung ${xid}`)
                );

                const extKey =
                      `${family.key}::${low(caption)}`;

                const unique =
                      `${xid ?? '?'}::${low(caption)}`;

                if (seen.has(unique)) continue;

                seen.add(unique);

                if (!extensions.has(extKey)) {
                    extensions.set(extKey, {
                        key: extKey,
                        caption,
                        familyKey: family.key,
                        familyName: family.label,
                        org: st.org,
                        bought: 0,
                        active: 0,
                        sites: []
                    });
                }

                const ex = extensions.get(extKey);

                const active =
                      x.available === true &&
                      x.enabled === true;

                ex.bought++;

                if (active) ex.active++;

                ex.sites.push({
                    buildingId: st.id,
                    center,
                    status: statusName(x),
                    active
                });

                extensionEntries++;
            }
        }

        // Fahrzeuge auswerten
        for (const v of vehicles) {
            const typeId = String(v.vehicle_type);

            const type =
                  vmeta[typeId]?.caption ||
                  `Fahrzeugtyp ${typeId}`;

            const buildingId = idOf(v.building_id);
            const st = byBuilding.get(buildingId);

            const cv = {
                id: String(v.id),
                name: String(
                    v.caption || `${type} #${v.id}`
         ),
                type,
                typeId,
                buildingId,
                status:
                v.fms_real ??
                v.fms ??
                v.state ??
                null
            };

            compactVehicles.push(cv);

            if (!vehicleByType.has(typeId)) {
                vehicleByType.set(typeId, []);
            }

            vehicleByType.get(typeId).push(cv);

            inc(types.vehicle, type);

            inc(
                groups.vehicle,
                st?.org || 'Weitere'
            );

            if (st) {
                st.vehicles++;
                inc(st.byType, type);

                const c = centers.get(st.center);

                c.vehicles++;
                inc(c.byVehicle, type);

            } else {
                missing++;
            }
        }

        const centerRows =
              [...centers.values()].map(c => ({
                  ...c,

                  name: c.id === 'ohne'
                  ? 'Ohne Leitstellenzuordnung'
                  : byBuilding.get(c.id)?.name ||
                  `Leitstelle ${c.id}`
       }));

        return {
            buildings: buildings.length,
            vehicles: vehicles.length,
            stations,
            byBuilding,
            vehicleByType,
            compactVehicles,
            types,
            groups,
            families: [...families.values()],
            centers: centerRows,
            extensions: [...extensions.values()],
            extensionEntries,
            missing,
            loadedAt: new Date(),
            warnings: []
        };
    }

    // ==========================================
    // DATEN LADEN
    // ==========================================

    async function load() {
        if (state.busy) return;

        state.busy = true;
        state.abort = new AbortController();

        $('#lssstat-load').disabled = true;
        $('#lssstat-cancel').disabled = false;

        progress('Starte Datenabruf ...');

        try {
            const metas = await Promise.allSettled([
                external(
                    'https://api.lss-manager.de/de_DE/buildings'
                ),
                external(
                    'https://api.lss-manager.de/de_DE/vehicles'
                )
            ]);

            const bm =
                  metas[0].status === 'fulfilled'
            ? metas[0].value
            : {};

            const vm =
                  metas[1].status === 'fulfilled'
            ? metas[1].value
            : {};

            const buildings = await allPages(
                'buildings',
                state.abort.signal
            );

            const vehicles = await allPages(
                'vehicles',
                state.abort.signal
            );

            if (state.abort.signal.aborted) {
                throw Error('Abgebrochen');
            }

            const d = compile(
                buildings,
                vehicles,
                bm,
                vm
            );

            if (
                metas.some(m => m.status !== 'fulfilled')
            ) {
                d.warnings.push(
                    'Einige Typbezeichnungen konnten nicht ' +
                    'geladen werden; IDs werden verwendet.'
                );
            }

            if (d.missing) {
                d.warnings.push(
                    `${fmt(d.missing)} Fahrzeuge konnten ` +
                    'keiner Wache zugeordnet werden.'
                );
            }

            state.data = d;
            state.detail = null;
            state.page = 0;

            state.openBuildings.clear();
            state.openExtensions.clear();

            clearSearch();

            progress(
                `Fertig: ${fmt(d.buildings)} Gebäude, ` +
                `${fmt(d.vehicles)} Fahrzeuge`
       );

            render();

        } catch (e) {
            progress('Fehler: ' + e.message);

            $('#lssstat-content').insertAdjacentHTML(
                'afterbegin',
                `<div class="notice error">` +
                `${esc(e.message)}. ` +
                `Vorherige Statistik bleibt erhalten.` +
                `</div>`
       );

        } finally {
            state.busy = false;
            state.abort = null;

            $('#lssstat-load').disabled = false;
            $('#lssstat-cancel').disabled = true;
        }
    }

    // ==========================================
    // TABS
    // ==========================================

    const tabs = [
        ['overview', 'Übersicht'],
        ['buildingtypes', 'Gebäudetypen'],
        ['vehicletypes', 'Fahrzeugtypen'],
        ['extensions', 'Erweiterungen'],
        ['stations', 'Einzelne Wachen'],
        ['centers', 'Leitstellenbereiche']
    ];

    function detailEntries(obj) {
        const entries = sorted(obj);

        if (!entries.length) return '—';

        return `
       <details>
         <summary>
           Zusammensetzung (${entries.length} Typen)
         </summary>

         ${entries.map(([name, n]) => `
           <div>
             ${esc(name)}: <b>${fmt(n)}</b>
           </div>
         `).join('')}
       </details>
     `;
    }

    function simpleTable(obj) {
        return `
       <div class="tablebox">
         <table>
           <thead>
             <tr>
               <th>Organisation</th>
               <th class="num">Anzahl</th>
             </tr>
           </thead>

           <tbody>
             ${sorted(obj).map(([name, n]) => `
               <tr>
                 <td>${esc(name)}</td>
                 <td class="num">${fmt(n)}</td>
               </tr>
             `).join('')}
           </tbody>
         </table>
       </div>
     `;
    }

    function filtered(rows) {
        const q = low(state.search.trim());

        if (!q) return rows;

        return rows.filter(r =>
                           [
            r.name,
            r.type,
            r.org,
            r.id,
            r.center,
            r.caption,
            r.familyName
        ].some(x => low(x).includes(q))
                          );
    }

    function pager(total) {
        const pages = Math.max(
            1,
            Math.ceil(total / PAGE_ROWS)
        );

        state.page = Math.max(
            0,
            Math.min(state.page, pages - 1)
        );

        return `
       <div class="pager">
         <button
           data-step="-1"
           ${state.page === 0 ? 'disabled' : ''}
         >← Zurück</button>

         Seite ${fmt(state.page + 1)} / ${fmt(pages)}

         <button
           data-step="1"
           ${state.page >= pages - 1
            ? 'disabled'
        : ''}
         >Weiter →</button>
       </div>
     `;
    }

    function paged(rows) {
        const controls = pager(rows.length);

        return {
            controls,

            page: rows.slice(
                state.page * PAGE_ROWS,
                (state.page + 1) * PAGE_ROWS
            )
        };
    }

    const table = (headers, body) => `
     <div class="tablebox">
       <table>
         <thead>
           <tr>
             ${headers.map(([label, num]) => `
               <th${num ? ' class="num"' : ''}>
                 ${label}
               </th>
             `).join('')}
           </tr>
         </thead>

         <tbody>${body}</tbody>
       </table>
     </div>
   `;

    // ==========================================
    // GEBÄUDETYPEN – NORMALE UND KLEINWACHEN
    // ==========================================

    function familyRows() {
        return state.data.families
            .map(f => ({
            ...f,
            id: f.key
        }))
            .sort(
            (a, b) =>
            b.count - a.count ||
            a.name.localeCompare(b.name, 'de')
        );
    }

    // ==========================================
    // KREISDIAGRAMME
    // ==========================================

    function chartData(org, kind) {
        const counts = {};
        const small = {};

        if (kind === 'buildingtypes') {
            for (const f of state.data.families) {
                if (f.org === org) {
                    inc(counts, f.name, f.count);
                    inc(small, f.name, f.small);
                }
            }

        } else {
            for (const v of state.data.compactVehicles) {
                const st = state.data.byBuilding.get(
                    v.buildingId
                );

                if ((st?.org || 'Weitere') === org) {
                    inc(counts, v.type);
                }
            }
        }

        const rows = [];

        let other = 0;
        let otherSmall = 0;

        for (const [name, n] of sorted(counts)) {
            if (n < MIN_CHART_COUNT) {
                other += n;
                otherSmall += small[name] || 0;

            } else {
                rows.push({
                    name,
                    n,
                    small: small[name] || 0
                });
            }
        }

        if (other) {
            rows.push({
                name: 'Sonstige',
                n: other,
                small: otherSmall
            });
        }

        return rows;
    }

    function chart(org, kind) {
        const rows = chartData(org, kind);

        const sum = rows.reduce(
            (a, r) => a + r.n,
            0
        );

        if (!sum) {
            return `
         <section class="chart">
           <h3>${esc(org)}</h3>
           <span class="muted">Keine Einträge</span>
         </section>
       `;
        }

        let acc = 0;

        const parts = rows.map((r, i) => {
            const start = acc / sum * 100;

            acc += r.n;

            return (
                `${COLORS[i % COLORS.length]} ` +
                `${start.toFixed(5)}% ` +
                `${(acc / sum * 100).toFixed(5)}%`
       );
        });

        const gradient = rows.length === 1
        ? COLORS[0]
        : `conic-gradient(${parts.join(',')})`;

        const display = n =>
        state.mode === 'relative'
        ? (n / sum * 100).toLocaleString(
            'de-DE',
            { maximumFractionDigits: 2 }
        ) + ' %'
        : fmt(n);

        return `
       <section class="chart">
         <h3>
           ${esc(org)}
           <span class="muted">(${fmt(sum)})</span>
         </h3>

         <div class="chartrow">
           <div
             class="donut"
             style="background:${gradient}"
             role="img"
             aria-label="Kreisdiagramm ${esc(org)}"
           ></div>

           <div class="legend">
             ${rows.map((r, i) => `
               <div class="legenditem">
                 <span
                   class="swatch"
                   style="background:
                     ${COLORS[i % COLORS.length]}"
                 ></span>

                 <span>
                   ${esc(r.name)}:
                   <b>${display(r.n)}</b>

                   ${kind === 'buildingtypes' && r.small
                        ? `
    <div class="muted">
      davon ${state.mode === 'relative'
                        ? (r.small / r.n * 100).toLocaleString(
            'de-DE',
            { maximumFractionDigits: 2 }
        ) + ' % Kleinwachen'
                        : fmt(r.small) + ' Kleinwachen'}
    </div>
  `
  : ''}
                 </span>
               </div>
             `).join('')}
           </div>
         </div>
       </section>
     `;
    }

    function chartControls() {
        return `
       <div
         class="toolbar"
         style="margin:10px 0"
       >
         <button
           id="lssstat-charts"
           class="${state.charts ? 'primary' : ''}"
         >
           ${state.charts
            ? 'Diagramme ausblenden'
        : 'Kuchendiagramme anzeigen'}
         </button>

         ${state.charts ? `
           <span>Anzeige:</span>

           <button
             data-mode="absolute"
             class="${state.mode === 'absolute'
            ? 'primary'
        : ''}"
           >Absolut</button>

           <button
             data-mode="relative"
             class="${state.mode === 'relative'
            ? 'primary'
        : ''}"
           >Relativ (100 %)</button>

           <span class="muted">
             Typen unter ${MIN_CHART_COUNT}
             → Sonstige
           </span>
         ` : ''}
       </div>

       ${state.charts ? `
         <div class="charts">
           ${ORGS.map(o =>
                      chart(o, state.tab)
                     ).join('')}
         </div>
       ` : ''}
     `;
    }

    // ==========================================
    // FAHRZEUGTYPEN
    // ==========================================

    function vehicleRows() {
        return [
            ...state.data.vehicleByType.entries()
        ].map(([id, vs]) => ({
            id,
            name: vs[0].type,
            count: vs.length
        })).sort(
            (a, b) =>
            b.count - a.count ||
            a.name.localeCompare(b.name, 'de')
        );
    }

    function renderVehicleDetail() {
        const all =
              state.data.vehicleByType.get(
                  state.detail.id
              ) || [];

        const q = low(state.search.trim());

        const rows = q
        ? all.filter(v =>
                     [
            v.name,
            v.id,
            v.status,
            state.data.byBuilding.get(
                v.buildingId
            )?.name
        ].some(x => low(x).includes(q))
                    )
        : all;

        const { controls, page } = paged(rows);

        const body = page.map(v => {
            const st = state.data.byBuilding.get(
                v.buildingId
            );

            return `
         <tr>
           <td>
             <a
               href="/vehicles/${encodeURIComponent(v.id)}"
               target="_blank"
               rel="noopener"
             >${esc(v.name)}</a>
           </td>

           <td>
             <span class="stat">
               ${v.status == null
                ? 'Unbekannt'
            : 'Status ' + esc(v.status)}
             </span>
           </td>

           <td>
             ${st
                ? buildingLink(st)
            : 'Nicht zugeordnet'}
           </td>

           <td class="num">${esc(v.id)}</td>
         </tr>
       `;
        }).join('');

        return `
       <button id="lssstat-back">
         ← Zurück zu Fahrzeugtypen
       </button>

       <h3>
         ${esc(state.detail.name)}
         – ${fmt(rows.length)} Fahrzeuge
       </h3>

       <div class="notice">
         FMS-Status zum Zeitpunkt des letzten Ladens,
         keine Live-Aktualisierung.
       </div>

       ${table([
            ['Fahrzeugname'],
            ['Status'],
            ['Wache'],
            ['Fahrzeug-ID', true]
        ], body)}

       ${controls}
     `;
    }

    // ==========================================
    // ERWEITERUNGEN – LEITSTELLENFILTER
    // ==========================================

    function selectedExtensions() {
        const id = state.centerFilter;

        return state.data.extensions.map(ex => {
            const sites = id === 'all'
            ? ex.sites
            : ex.sites.filter(s => s.center === id);

            return {
                ...ex,
                sites,
                bought: sites.length,
                active: sites.filter(s => s.active).length
            };
        }).filter(ex => ex.bought > 0);
    }

    function extensionsGrouped() {
        const map = new Map();

        for (const ex of selectedExtensions()) {
            const key =
                  ex.org + '::' + ex.familyKey;

            if (!map.has(key)) {
                map.set(key, {
                    key,
                    org: ex.org,
                    name: ex.familyName,
                    items: [],
                    bought: 0,
                    active: 0
                });
            }

            const g = map.get(key);

            g.items.push(ex);
            g.bought += ex.bought;
            g.active += ex.active;
        }

        return [...map.values()].sort(
            (a, b) =>
            a.org.localeCompare(b.org, 'de') ||
            b.bought - a.bought
        );
    }

    function centerSelect() {
        return `
       <div
         class="toolbar"
         style="margin:10px 0"
       >
         <label
           for="lssstat-center"
           class="filterlabel"
         >Leitstellenbereich:</label>

         <select id="lssstat-center">
           <option value="all">
             Alle Leitstellenbereiche
           </option>

           ${state.data.centers.slice()
            .sort((a, b) =>
                  a.name.localeCompare(b.name, 'de')
                 )
            .map(c => `
               <option
                 value="${esc(c.id)}"
                 ${c.id === state.centerFilter
                 ? 'selected'
                 : ''}
               >${esc(c.name)}</option>
             `).join('')}
         </select>

         <span class="muted">
           Aktiviert / Gekauft
           (Im Bau zählt als gekauft)
         </span>
       </div>
     `;
    }

    // ==========================================
    // ERWEITERUNGEN – ÜBERSICHT
    // ==========================================

    function renderExtensions() {
        const groups = extensionsGrouped();

        const q = low(state.search.trim());

        const visible = groups.map(g => ({
            ...g,

            items: g.items.filter(x =>
                                  !q ||
                                  [
                x.caption,
                x.familyName,
                x.org
            ].some(y => low(y).includes(q))
                                 )
        })).filter(g => g.items.length);

        const orgs = new Map();

        for (const g of visible) {
            if (!orgs.has(g.org)) {
                orgs.set(g.org, []);
            }

            orgs.get(g.org).push(g);
        }

        let html = centerSelect();

        html += `
       <div class="notice">
         Gezählt werden nur gekaufte Erweiterungen
         (Einträge in der Gebäude-API).
         Aktiviert = verfügbar und eingeschaltet.
       </div>
     `;

        const body = [];

        for (const [org, gs] of orgs) {
            const active = gs.reduce(
                (n, g) =>
                n + g.items.reduce(
                    (t, x) => t + x.active,
                    0
                ),
                0
            );

            const bought = gs.reduce(
                (n, g) =>
                n + g.items.reduce(
                    (t, x) => t + x.bought,
                    0
                ),
                0
            );

            const ok = state.openExtensions.has(
                'org:' + org
            );

            body.push(`
         <tr>
           <td>
             <button
               class="linkbtn"
               data-expand="${esc('org:' + org)}"
             >
               ${ok ? '▾' : '▸'} ${esc(org)}
             </button>
           </td>

           <td class="num">
             <b>${fmt(active)} / ${fmt(bought)}</b>
           </td>
         </tr>
       `);

            if (!ok) continue;

            for (const g of gs) {
                const opened = state.openExtensions.has(
                    'family:' + g.key
                );

                const ga = g.items.reduce(
                    (n, x) => n + x.active,
                    0
                );

                const gb = g.items.reduce(
                    (n, x) => n + x.bought,
                    0
                );

                body.push(`
           <tr class="subrow">
             <td class="indent">
               <button
                 class="linkbtn"
                 data-expand="${esc('family:' + g.key)}"
               >
                 ${opened ? '▾' : '▸'}
                 ${esc(g.name)}
               </button>
             </td>

             <td class="num">
               ${fmt(ga)} / ${fmt(gb)}
             </td>
           </tr>
         `);

                if (!opened) continue;

                for (const x of g.items.sort(
                    (a, b) => b.bought - a.bought
                )) {
                    body.push(`
             <tr>
               <td style="padding-left:45px!important">
                 <button
                   class="linkbtn"
                   data-extension="${esc(x.key)}"
                 >
                   ↳ ${esc(x.caption)}
                 </button>
               </td>

               <td class="num">
                 ${fmt(x.active)} / ${fmt(x.bought)}
               </td>
             </tr>
           `);
                }
            }
        }

        html += table([
            ['Organisation / Gebäudetyp / Erweiterung'],
            ['Aktiviert / Gekauft', true]
        ], body.join(''));

        return html;
    }

    // ==========================================
    // ERWEITERUNGEN – DETAILANSICHT
    // ==========================================

    function renderExtensionDetail() {
        const ex = selectedExtensions().find(
            x => x.key === state.detail.id
        );

        if (!ex) {
            return `
         <button id="lssstat-back">
           ← Zurück zu Erweiterungen
         </button>

         <div class="notice">
           Keine Erweiterungen für diesen Filter vorhanden.
         </div>
       `;
        }

        const q = low(state.search.trim());

        const rows = ex.sites.map(s => ({
            ...s,
            st: state.data.byBuilding.get(
                s.buildingId
            )
        }))
        .filter(x =>
                !q ||
                [
            x.st?.name,
            x.st?.type,
            x.status,
            x.buildingId
        ].some(v => low(v).includes(q))
               )
        .sort((a, b) =>
              (a.st?.name || '').localeCompare(
            b.st?.name || '',
            'de'
        )
             );

        const { controls, page } = paged(rows);

        const body = page.map(x => `
       <tr>
         <td>
           ${x.st
                              ? buildingLink(x.st)
                              : esc(x.buildingId)}
         </td>

         <td>
           ${esc(x.st?.type || 'Unbekannt')}
         </td>

         <td>
           <span class="stat">
             ${esc(x.status)}
           </span>
         </td>
       </tr>
     `).join('');

        return `
       ${centerSelect()}

       <button id="lssstat-back">
         ← Zurück zu Erweiterungen
       </button>

       <h3>
         ${esc(ex.caption)}
         – ${fmt(ex.active)} aktiviert /
         ${fmt(ex.bought)} gekauft
       </h3>

       ${table([
            ['Wache'],
            ['Gebäudetyp'],
            ['Status']
        ], body)}

       ${controls}
     `;
    }

    // ==========================================
    // HAUPTANSICHT
    // ==========================================

    function render() {
        $('.tabs').innerHTML = tabs.map(
            ([id, title]) => `
         <button
           data-tab="${id}"
           class="${state.tab === id ? 'active' : ''}"
         >${esc(title)}</button>
       `
     ).join('');

        $('.tabs')
            .querySelectorAll('[data-tab]')
            .forEach(el => {
            el.onclick = () => {
                state.tab = el.dataset.tab;
                state.detail = null;
                state.page = 0;

                clearSearch();
                render();
            };
        });

        $('#lssstat-export').disabled =
            !state.data || state.tab === 'overview';

        const content = $('#lssstat-content');

        if (!state.data) {
            content.innerHTML = `
         <div class="notice">
           Klicke auf „Daten laden / aktualisieren“.
         </div>
       `;

            return;
        }

        const d = state.data;

        let html = d.warnings.map(w => `
       <div class="notice">${esc(w)}</div>
     `).join('');

        if (
            state.tab === 'vehicletypes' &&
            state.detail?.kind === 'vehicle'
        ) {
            html += renderVehicleDetail();

        } else if (
            state.tab === 'extensions' &&
            state.detail?.kind === 'extension'
        ) {
            html += renderExtensionDetail();

        } else if (state.tab === 'overview') {
            html += `
         <div class="notice">
           Stand:
           ${esc(d.loadedAt.toLocaleString('de-DE'))}.
           Alle Werte sind eine Momentaufnahme.
         </div>

         <div class="metrics">
           <div class="metric">
             Gebäude
             <strong>${fmt(d.buildings)}</strong>
           </div>

           <div class="metric">
             Fahrzeuge
             <strong>${fmt(d.vehicles)}</strong>
           </div>

           <div class="metric">
             Fahrzeugtypen
             <strong>${fmt(d.vehicleByType.size)}</strong>
           </div>

           <div class="metric">
             Leitstellenbereiche
             <strong>${fmt(d.centers.length)}</strong>
           </div>
         </div>

         <h3>Gebäude nach Organisation</h3>
         ${simpleTable(d.groups.building)}

         <h3>Fahrzeuge nach Organisation ihrer Wache</h3>
         ${simpleTable(d.groups.vehicle)}

         <p class="muted">
           Organisationen werden nach Gebäudetyp
           eingeordnet; unbekannte Typen unter
           „Weitere“.
         </p>
       `;

        } else if (state.tab === 'extensions') {
            html += renderExtensions();

        } else {
            if (
                ['buildingtypes', 'vehicletypes'].includes(
                    state.tab
                )
            ) {
                html += chartControls();
            }

            let rows = [];

            if (state.tab === 'buildingtypes') {
                rows = familyRows();
            }

            if (state.tab === 'vehicletypes') {
                rows = vehicleRows();
            }

            if (state.tab === 'stations') {
                rows = d.stations
                    .map(s => ({
                    ...s,
                    count: s.vehicles
                }))
                    .sort((a, b) => b.count - a.count);
            }

            if (state.tab === 'centers') {
                rows = d.centers
                    .map(c => ({
                    ...c,
                    count: c.vehicles
                }))
                    .sort((a, b) => b.count - a.count);
            }

            rows = filtered(rows);

            const { controls, page } = paged(rows);

            html += `
         <div class="notice">
           ${fmt(rows.length)} Einträge ·
           ${PAGE_ROWS} pro Seite ·
           Stand:
           ${esc(d.loadedAt.toLocaleString('de-DE'))}
         </div>
       `;

             // Gebäudetypen
             if (state.tab === 'buildingtypes') {
                 const body = [];

                 for (const r of page) {
                     const toggle = [
                         'fire',
                         'rescue',
                         'police'
                     ].includes(r.key);

                     const open = state.openBuildings.has(
                         r.key
                     );

                     body.push(`
             <tr>
               <td>
                 ${toggle ? `
                   <button
                     class="linkbtn"
                     data-building="${esc(r.key)}"
                   >
                     ${open ? '▾' : '▸'}
                     ${esc(r.name)}
                   </button>
                 ` : esc(r.name)}
               </td>

               <td class="num">
                 ${fmt(r.count)}
               </td>
             </tr>
           `);

                   if (toggle && open) {
                       body.push(`
               <tr class="subrow">
                 <td class="indent">
                   ↳ ${esc(r.name)} (normal)
                 </td>

                 <td class="num">
                   ${fmt(r.normal)}
                 </td>
               </tr>
             `);

                     body.push(`
               <tr class="subrow">
                 <td class="indent">
                   ↳ ${esc(r.name)} (Kleinwache)
                 </td>

                 <td class="num">
                   ${fmt(r.small)}
                 </td>
               </tr>
             `);
                 }
               }

               html += table([
                   ['Gebäudetyp'],
                   ['Anzahl', true]
               ], body.join(''));
           }

             // Fahrzeugtypen
             if (state.tab === 'vehicletypes') {
                 html += table([
                     ['Fahrzeugtyp'],
                     ['Anzahl', true]
                 ], page.map(r => `
           <tr>
             <td>
               <button
                 class="linkbtn"
                 data-vehicle="${esc(r.id)}"
               >${esc(r.name)}</button>
             </td>

             <td class="num">
               ${fmt(r.count)}
             </td>
           </tr>
         `).join(''));
           }

             // Einzelne Wachen
             if (state.tab === 'stations') {
                 html += table([
                     ['Wache'],
                     ['Gebäudetyp'],
                     ['Organisation'],
                     ['Fahrzeuge', true],
                     ['Zusammensetzung']
                 ], page.map(r => `
           <tr>
             <td>
               ${buildingLink(r)}

               <div class="muted">
                 ID ${esc(r.id)}
               </div>
             </td>

             <td>
               ${esc(r.type)}
               ${r.small ? ' (Kleinwache)' : ''}
             </td>

             <td>${esc(r.org)}</td>

             <td class="num">
               ${fmt(r.count)}
             </td>

             <td>
               ${detailEntries(r.byType)}
             </td>
           </tr>
         `).join(''));
           }

             // Leitstellenbereiche
             if (state.tab === 'centers') {
                 html += table([
                     ['Leitstellenbereich'],
                     ['Gebäude', true],
                     ['Fahrzeuge', true],
                     ['Zusammensetzung']
                 ], page.map(r => `
           <tr>
             <td>
               ${r.id === 'ohne'
                           ? esc(r.name)
                           : `
                   <a
                     href="/buildings/${encodeURIComponent(r.id)}"
                     target="_blank"
                     rel="noopener"
                   >${esc(r.name)}</a>
                 `}
             </td>

             <td class="num">
               ${fmt(r.buildings)}
             </td>

             <td class="num">
               ${fmt(r.count)}
             </td>

             <td>
               ${detailEntries(r.byBuilding)}
               ${detailEntries(r.byVehicle)}
             </td>
           </tr>
         `).join(''));
           }

             html += controls;
         }

        content.innerHTML = html;

        bindContent();
    }

    // ==========================================
    // BEDIENELEMENTE
    // ==========================================

    function bindContent() {
        const content = $('#lssstat-content');

        content.querySelector('#lssstat-charts')
            ?.addEventListener('click', () => {
            state.charts = !state.charts;
            render();
        });

        content.querySelectorAll('[data-mode]')
            .forEach(b => {
            b.onclick = () => {
                state.mode = b.dataset.mode;
                render();
            };
        });

        content.querySelectorAll('[data-step]')
            .forEach(b => {
            b.onclick = () => {
                state.page += Number(b.dataset.step);
                render();
                content.scrollTop = 0;
            };
        });

        // Kleinwachen aufklappen
        content.querySelectorAll('[data-building]')
            .forEach(b => {
            b.onclick = () => {
                const key = b.dataset.building;

                if (state.openBuildings.has(key)) {
                    state.openBuildings.delete(key);
                } else {
                    state.openBuildings.add(key);
                }

                render();
            };
        });

        // Organisationen und Gebäudetypen
        // bei den Erweiterungen aufklappen
        content.querySelectorAll('[data-expand]')
            .forEach(b => {
            b.onclick = () => {
                const key = b.dataset.expand;

                if (state.openExtensions.has(key)) {
                    state.openExtensions.delete(key);
                } else {
                    state.openExtensions.add(key);
                }

                render();
            };
        });

        // Fahrzeugdetail
        content.querySelectorAll('[data-vehicle]')
            .forEach(b => {
            b.onclick = () => {
                state.detail = {
                    kind: 'vehicle',
                    id: b.dataset.vehicle,
                    name: b.textContent
                };

                state.page = 0;
                clearSearch();
                render();
            };
        });

        // Erweiterungsdetail
        content.querySelectorAll('[data-extension]')
            .forEach(b => {
            b.onclick = () => {
                state.detail = {
                    kind: 'extension',
                    id: b.dataset.extension
                };

                state.page = 0;
                clearSearch();
                render();
            };
        });

        content.querySelector('#lssstat-back')
            ?.addEventListener('click', () => {
            state.detail = null;
            state.page = 0;
            clearSearch();
            render();
        });

        // Leitstellenfilter
        content.querySelector('#lssstat-center')
            ?.addEventListener('change', e => {
            state.centerFilter = e.target.value;
            state.page = 0;
            render();
        });
    }

    // ==========================================
    // CSV-EXPORT
    // ==========================================

    function exportCSV() {
        if (
            !state.data ||
            state.tab === 'overview'
        ) return;

        const d = state.data;

        let heads = [];
        let rows = [];

        // Fahrzeugdetails
        if (
            state.tab === 'vehicletypes' &&
            state.detail?.kind === 'vehicle'
        ) {
            heads = [
                'ID',
                'Fahrzeug',
                'Typ',
                'Status',
                'Wache',
                'Gebäude-ID'
            ];

            rows = (
                d.vehicleByType.get(state.detail.id) || []
            ).map(v => [
                v.id,
                v.name,
                v.type,
                v.status ?? '',
                d.byBuilding.get(v.buildingId)?.name || '',
                v.buildingId || ''
            ]);

        } else if (state.tab === 'extensions') {
            if (state.detail?.kind === 'extension') {
                heads = [
                    'Erweiterung',
                    'Wache',
                    'Gebäude-ID',
                    'Leitstellen-ID',
                    'Status'
                ];

                const ex = selectedExtensions().find(
                    x => x.key === state.detail.id
                );

                rows = (ex?.sites || []).map(s => [
                    ex.caption,
                    d.byBuilding.get(s.buildingId)?.name || '',
                    s.buildingId,
                    s.center,
                    s.status
                ]);

            } else {
                heads = [
                    'Organisation',
                    'Gebäudetyp',
                    'Erweiterung',
                    'Aktiviert',
                    'Gekauft'
                ];

                rows = extensionsGrouped().flatMap(g =>
                                                   g.items.map(x => [
                    g.org,
                    g.name,
                    x.caption,
                    x.active,
                    x.bought
                ])
                                                  );
            }

        } else if (state.tab === 'buildingtypes') {
            heads = [
                'Gebäudetyp',
                'Gesamt',
                'Normal',
                'Klein'
            ];

            rows = filtered(familyRows()).map(x => [
                x.name,
                x.count,
                x.normal,
                x.small
            ]);

        } else if (state.tab === 'vehicletypes') {
            heads = [
                'Fahrzeugtyp',
                'Anzahl'
            ];

            rows = filtered(vehicleRows()).map(x => [
                x.name,
                x.count
            ]);

        } else if (state.tab === 'stations') {
            heads = [
                'Gebäude-ID',
                'Wache',
                'Gebäudetyp',
                'Kleinwache',
                'Organisation',
                'Leitstellen-ID',
                'Fahrzeuge',
                'Typen'
            ];

            rows = filtered(
                d.stations.map(s => ({
                    ...s,
                    count: s.vehicles
                }))
            ).map(s => [
                s.id,
                s.name,
                s.type,
                s.small ? 'ja' : 'nein',
                s.org,
                s.center,
                s.vehicles,
                sorted(s.byType)
                .map(x => x.join(': '))
                .join(' | ')
            ]);

        } else if (state.tab === 'centers') {
            heads = [
                'Leitstellen-ID',
                'Leitstelle',
                'Gebäude',
                'Fahrzeuge',
                'Gebäudetypen',
                'Fahrzeugtypen'
            ];

            rows = filtered(
                d.centers.map(c => ({
                    ...c,
                    count: c.vehicles
                }))
            ).map(c => [
                c.id,
                c.name,
                c.buildings,
                c.vehicles,
                sorted(c.byBuilding)
                .map(x => x.join(': '))
                .join(' | '),
                sorted(c.byVehicle)
                .map(x => x.join(': '))
                .join(' | ')
            ]);
        }

        const quote = x =>
        '"' +
              String(x ?? '').replace(/"/g, '""') +
              '"';

        const csv = '\ufeff' +
              [heads, ...rows]
        .map(r => r.map(quote).join(';'))
        .join('\r\n');

        const url = URL.createObjectURL(
            new Blob([csv], {
                type: 'text/csv;charset=utf-8'
            })
        );

        const a = document.createElement('a');

        a.href = url;

        a.download =
            `LSS_Statistik_${state.tab}_` +
            `${new Date().toISOString().slice(0, 10)}.csv`;

        document.body.append(a);
        a.click();
        a.remove();

        setTimeout(
            () => URL.revokeObjectURL(url),
            1000
        );
    }

    render();

})();
