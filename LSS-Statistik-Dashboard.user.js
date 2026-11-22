
// ==UserScript==
// @name         LSS Statistik-Dashboard
// @license      MIT
// @version      2.6.0
// @author       cpu99 x ChatGPT
// @description  Statistik-Dashboard und Fahrzeug- & Gebäudemanager mit Statusverwaltung und Personalverwalter, Filtern und Diagrammen
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

    // Pause nach jeder erfolgreichen Schreibaktion
    const ACTION_DELAY_MS = 200; // 200 ms müssen mind. vorhanden sein, siehe Forum

    const ORGS = [
        'Feuerwehr',
        'Rettungsdienst',
        'Polizei',
        'THW',
        'Leitstellen',
        'Weitere'
    ];

    const COLORS = [
        '#e85b59', '#ffb14e', '#5b9bff',
        '#53c3af', '#ae86e8', '#e87eb9',
        '#85b96f', '#f2d465', '#66c4dc',
        '#f28e60', '#bca2f0', '#86abca',
        '#dc9d77', '#62b5aa', '#c9cf74',
        '#d78ea9'
    ];

    const FAMILIES = {
        0: ['fire', 'Feuerwachen', 'Feuerwehr', 0],
        18: ['fire', 'Feuerwachen', 'Feuerwehr', 1],
        2: ['rescue', 'Rettungswachen', 'Rettungsdienst', 0],
        20: ['rescue', 'Rettungswachen', 'Rettungsdienst', 1],
        6: ['police', 'Polizeiwachen', 'Polizei', 0],
        19: ['police', 'Polizeiwachen', 'Polizei', 1]
    };

    const state = {
        data: null,
        tab: 'overview',
        detail: null,
        search: '',
        page: 0,
        charts: false,
        mode: 'absolute',
        center: 'all',
        openB: new Set(),
        openE: new Set(),
        loading: false,
        loadAbort: null,
        writing: false,
        stopWrite: false,
        writeNeedsRefresh: false,
        writeLog: [],
        pending: null,
        detailStatus: 'all',
        detailSort: 'name',
        buildingCenter: 'all',
        buildingStatus: 'all',
        buildingSize: 'all',
        personnelCenter: 'all',
        personnelType: 'all',
        personnelFilter: 'all',
        personnelTarget: 80,
        personnelPhase: 3,
        personnelPending: null,
        personnelMessage: '',
        buildingBulkPending: null
    };

    const fmt = n =>
    Number(n || 0).toLocaleString('de-DE');

    const low = s =>
    String(s ?? '').toLocaleLowerCase('de');

    const esc = s =>
    String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));

    const inc = (o, k, n = 1) =>
    o[k] = (o[k] || 0) + n;

    const sorted = o =>
    Object.entries(o).sort(
        (a, b) =>
        b[1] - a[1] ||
        a[0].localeCompare(b[0], 'de')
    );

    const sleep = ms =>
    new Promise(r => setTimeout(r, ms));


    // ==========================================
    // ORGANISATIONSZUORDNUNG NACH GEBÄUDETYP-ID
    // ==========================================

    const ORGANIZATION_TYPES = {
        // Feuerwehr
        0: 'Feuerwehr',          // Feuerwache
        1: 'Feuerwehr',          // Feuerwehrschule
        18: 'Feuerwehr',         // Feuerwache (Kleinwache)

        // Rettungsdienst und Rettungsorganisationen
        2: 'Rettungsdienst',     // Rettungswache
        3: 'Rettungsdienst',     // Rettungsschule
        4: 'Rettungsdienst',     // Krankenhaus
        5: 'Rettungsdienst',     // Rettungshubschrauber-Station
        12: 'Rettungsdienst',    // Schnelleinsatzgruppe (SEG)
        15: 'Rettungsdienst',    // Wasserrettung
        20: 'Rettungsdienst',    // Rettungswache (Kleinwache)
        21: 'Rettungsdienst',    // Rettungshundestaffel
        25: 'Rettungsdienst',    // Bergrettungswache
        26: 'Rettungsdienst',    // Seenotrettungswache
        27: 'Rettungsdienst',    // Schule für Seefahrt und Seenotrettung
        28: 'Rettungsdienst',    // Hubschrauberstation (Seenotrettung)

        // Polizei
        6: 'Polizei',           // Polizeiwache
        8: 'Polizei',           // Polizeischule
        11: 'Polizei',          // Bereitschaftspolizei
        13: 'Polizei',          // Polizeihubschrauberstation
        16: 'Polizei',          // Verbandszellen
        17: 'Polizei',          // Polizei-Sondereinheiten
        19: 'Polizei',          // Polizeiwache (Kleinwache)
        24: 'Polizei',          // Reiterstaffel
        29: 'Polizei',          // Autobahnpolizei

        // Technisches Hilfswerk
        9: 'THW',               // THW-Ortsverband
        10: 'THW',              // THW-Bundesschule

        // Leitstellen
        7: 'Leitstellen',       // Leitstelle

        // Sonstige Gebäude
        14: 'Weitere',          // Bereitstellungsraum
        22: 'Weitere',          // Großer Gebäudekomplex
        23: 'Weitere'           // Kleiner Gebäudekomplex
    };

    const orgFor = id =>
    ORGANIZATION_TYPES[Number(id)] ?? 'Weitere';


    const hrefB = s => `
   <a
     target="_blank"
     rel="noopener"
     href="/buildings/${encodeURIComponent(s.id)}"
   >${esc(s.name)}</a>
 `;

    const extStatus = s =>
    !s.available
    ? 'Im Bau'
    : s.enabled
    ? 'Aktiv'
    : 'Deaktiviert';

    // ==========================================
    // DESIGN
    // ==========================================

    const CSS = `
 #lssstat-launcher {
   display:block!important;
   position:static!important;
   padding:15px!important;
   margin:0!important;
   background:transparent!important;
   color:white!important;
   border:0!important;
   box-shadow:none!important;
   font:14px system-ui!important;
   cursor:pointer!important;
 }

 #lssstat-launcher:hover {
   background:#0002!important;
 }

 #lssstat-nav-item.lssstat-fallback {
   position:fixed!important;
   left:18px!important;
   bottom:18px!important;
   z-index:2147483600!important;
   background:#b8242e!important;
   border-radius:9px!important;
   list-style:none!important;
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
   --red:#b8242e;

   position:fixed!important;
   inset:3vh 3vw!important;
   z-index:2147483601!important;
   display:none;
   flex-direction:column!important;
   overflow:hidden!important;
   border-radius:14px!important;
   border:1px solid var(--line)!important;
   background:var(--bg)!important;
   color:var(--text)!important;
   font:16px/1.5 system-ui,sans-serif!important;
   box-shadow:0 20px 70px #000b!important;
   color-scheme:dark!important;
 }

 #lssstat-root[data-theme=light] {
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
   color-scheme:light!important;
 }

 #lssstat-root * {
   box-sizing:border-box!important;
 }

 #lssstat-root header {
   display:flex!important;
   align-items:center!important;
   justify-content:space-between!important;
   gap:10px!important;
   flex-wrap:wrap!important;
   padding:12px 18px!important;
   background:linear-gradient(
     100deg,#b8242e,#751722
   )!important;
   color:white!important;
 }

 #lssstat-root h2 {
   font:700 21px system-ui!important;
   color:white!important;
   margin:0!important;
 }

 #lssstat-root h3 {
   font-size:21px!important;
   color:var(--text)!important;
   margin:15px 0 10px!important;
 }

 #lssstat-root button,
 #lssstat-root input,
 #lssstat-root select {
   font:inherit!important;
   min-height:34px!important;
   border:1px solid var(--line)!important;
   border-radius:7px!important;
   padding:7px 10px!important;
   background:var(--input)!important;
   color:var(--text)!important;
 }

 #lssstat-root button {
   cursor:pointer!important;
   font-weight:600!important;
 }
 #lssstat-root button.lssstat-detail-btn {
    min-height: 26px !important;
    padding: 3px 9px !important;
    margin-left: 12px !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    color: var(--muted) !important;
    background: var(--panel) !important;
    border: 1px solid var(--line) !important;
}

#lssstat-root button.lssstat-detail-btn:hover {
    color: var(--text) !important;
    border-color: var(--link) !important;
}

  /* ==========================================
     STATUSBUTTONS – AKTIV / INAKTIV
     ========================================== */

  #lssstat-root button.lssstat-status-active {
    background: rgba(63, 142, 106, 0.18) !important;
    border: 1px solid rgba(95, 170, 130, 0.48) !important;
    color: #91d5aa !important;
    font-weight: 600 !important;
    min-width: 92px !important;
    transition: background .15s ease, border-color .15s ease !important;
  }

  #lssstat-root button.lssstat-status-inactive {
    background: rgba(184, 91, 94, 0.18) !important;
    border: 1px solid rgba(200, 110, 115, 0.48) !important;
    color: #eba0a4 !important;
    font-weight: 600 !important;
    min-width: 92px !important;
    transition: background .15s ease, border-color .15s ease !important;
  }

  #lssstat-root button.lssstat-status-active:hover:not(:disabled) {
    background: rgba(63, 142, 106, 0.30) !important;
    border-color: #73b791 !important;
  }

  #lssstat-root button.lssstat-status-inactive:hover:not(:disabled) {
    background: rgba(184, 91, 94, 0.30) !important;
    border-color: #d18b90 !important;
  }

  /* Angepasste Farben für den Light Mode */

  #lssstat-root[data-theme=light] button.lssstat-status-active {
    background: #e1f1e7 !important;
    border-color: #a5cbb3 !important;
    color: #276b46 !important;
  }

  #lssstat-root[data-theme=light] button.lssstat-status-inactive {
    background: #f8e6e7 !important;
    border-color: #dbafb2 !important;
    color: #97454c !important;
  }


 #lssstat-root button:disabled {
   opacity:.42!important;
   cursor:default!important;
 }

 #lssstat-root button:hover:not(:disabled) {
   border-color:#df6870!important;
   background:var(--hover)!important;
 }

 #lssstat-root button.primary,
 #lssstat-root .tabs button.active {
   background:var(--red)!important;
   border-color:#e45760!important;
   color:white!important;
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
   padding:16px 18px!important;
   background:var(--bg)!important;
   color:var(--text)!important;
 }

 #lssstat-root .notice {
   padding:10px 13px!important;
   background:var(--notice)!important;
   color:var(--text)!important;
   border:1px solid var(--line)!important;
   border-radius:8px!important;
   margin:0 0 12px!important;
   font-size:16px!important;
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
   margin:12px 0 20px!important;
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
   font-size:29px!important;
   color:var(--text)!important;
 }

 #lssstat-root .tablebox {
   width:100%!important;
   overflow-x:auto!important;
   border:1px solid var(--line)!important;
   border-radius:9px!important;
 }

 #lssstat-root table {
   width:100%!important;
   border-collapse:collapse!important;
   table-layout:fixed!important;
   color:var(--text)!important;
   background:var(--panel)!important;
 }

 #lssstat-root th,
 #lssstat-root td {
   padding:9px 12px!important;
   border-bottom:1px solid var(--line)!important;
   color:var(--text)!important;
   vertical-align:top!important;
   font-size:18px!important;
   overflow-wrap:anywhere!important;
 }

 #lssstat-root th {
   background:var(--head)!important;
   text-align:left!important;
 }

 #lssstat-root tr:nth-child(even) td {
   background:var(--alt)!important;
 }

 #lssstat-root tr:hover td {
   background:var(--hover)!important;
 }

 #lssstat-root .num {
   text-align:right!important;
   white-space:nowrap!important;
   font-variant-numeric:tabular-nums!important;
 }

 #lssstat-root .linkbtn {
   border:0!important;
   min-height:0!important;
   padding:0!important;
   background:transparent!important;
   color:var(--link)!important;
   font-size:18px!important;
   text-decoration:underline!important;
 }

 #lssstat-root a,
 #lssstat-root summary {
   color:var(--link)!important;
   cursor:pointer!important;
 }

 #lssstat-root .subrow td {
   font-size:18px!important;
   color:var(--muted)!important;
 }

 #lssstat-root .indent {
   padding-left:30px!important;
 }

 #lssstat-root .pager {
   display:flex!important;
   gap:12px!important;
   align-items:center!important;
   justify-content:center!important;
   margin:15px!important;
 }

 #lssstat-root .charts {
   display:grid!important;
   grid-template-columns:
     repeat(auto-fit,minmax(410px,1fr))!important;
   gap:14px!important;
   margin:15px 0!important;
 }

 #lssstat-root .chartrow {
   display:flex!important;
   gap:16px!important;
   align-items:center!important;
   flex-wrap:wrap!important;
 }

 #lssstat-root .legend {
   flex:1!important;
   min-width:170px!important;
   max-height:300px!important;
   overflow:auto!important;
 }

 #lssstat-root .legenditem {
   display:flex!important;
   gap:8px!important;
   align-items:flex-start!important;
   margin:5px 0!important;
   font-size:14px!important;
   cursor:pointer!important;
   padding:3px!important;
   border-radius:5px!important;
 }

 #lssstat-root .legenditem.active {
   background:var(--hover)!important;
   font-weight:700!important;
 }

 #lssstat-root .swatch {
   width:11px!important;
   height:11px!important;
   min-width:11px!important;
   margin-top:5px!important;
   border-radius:3px!important;
 }

 #lssstat-root .pie {
   width:220px!important;
   height:220px!important;
   flex:none!important;
   overflow:visible!important;
 }

 #lssstat-root .pie-segment {
   cursor:pointer!important;
   transition:transform .12s ease,
     opacity .12s ease!important;
   transform-box:fill-box!important;
   transform-origin:center!important;
 }

 #lssstat-root .pie-segment.active {
   transform:scale(1.035)!important;
   filter:brightness(1.16)!important;
   stroke:var(--panel)!important;
   stroke-width:2px!important;
 }
 /* ==========================================
   PERSONALVERWALTUNG
   ========================================== */

#lssstat-root .lssstat-personnel-table {
    min-width: 1100px !important;
}

#lssstat-root .lssstat-personnel-table td {
    vertical-align: middle !important;
}

#lssstat-root .lssstat-personnel-table .actions {
    flex-wrap: wrap !important;
}

#lssstat-root .lssstat-personnel-table .actions button {
    font-size: 14px !important;
    padding: 5px 9px !important;
}

 #lssstat-root .chart-focus {
   margin-top:10px!important;
   min-height:25px!important;
   font-size:14px!important;
   color:var(--text)!important;
 }

 #lssstat-root .stat {
   display:inline-block!important;
   padding:3px 7px!important;
   background:var(--head)!important;
   color:var(--text)!important;
   border-radius:5px!important;
   font-size:18px!important;
 }

 #lssstat-root .actionline {
   display:flex!important;
   gap:8px!important;
   align-items:center!important;
   flex-wrap:wrap!important;
 }

 #lssstat-root .danger {
   border-color:#a82d39!important;
   color:#f08088!important;
 }

 #lssstat-root .actions {
    display: flex !important;
    gap: 8px !important;
    align-items: center !important;
    flex-wrap: nowrap !important;
}

 #lssstat-root .confirmbox {
   border:2px solid #b8242e!important;
   padding:14px!important;
   border-radius:10px!important;
   margin:12px 0!important;
   background:var(--panel)!important;
 }
 /* Breite Wachenliste mit horizontalem Scrollen */

#lssstat-root .tablebox:has(
    table.lssstat-stations-table
) table {
    min-width: 1250px !important;
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

   #lssstat-root table {
     min-width:650px!important;
   }
 }
 `;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    // ==========================================
    // BENUTZEROBERFLÄCHE
    // ==========================================

    const launcher = document.createElement('button');
    launcher.id = 'lssstat-launcher';
    launcher.type = 'button';
    launcher.textContent = '📊 Statistik';

    const navItem = document.createElement('li');
    navItem.id = 'lssstat-nav-item';
    navItem.append(launcher);

    const navbar = document.querySelector(
        '#navbar-main-collapse > ul'
    );

    if (navbar) {
        navbar.append(navItem);
    } else {
        navItem.classList.add('lssstat-fallback');
        document.body.append(navItem);
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
     <button id="lssstat-close">✕ Schließen</button>
   </header>

   <div class="toolbar">
     <button class="primary" id="lssstat-load">
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

     <span id="lssstat-progress" class="muted">
       Noch nicht geladen
     </span>
   </div>

   <nav class="tabs"></nav>
   <main class="body" id="lssstat-content"></main>
 `;

    document.body.append(root);

    const $ = s => root.querySelector(s);

    const progress = s =>
    $('#lssstat-progress').textContent = s;

    const theme = () => {
        root.dataset.theme =
            document.body.classList.contains('dark')
            ? 'dark'
        : 'light';
    };

    const clearSearch = () => {
        state.search = '';
        $('#lssstat-search').value = '';
    };

    launcher.onclick = () => {
        theme();
        root.style.display = 'flex';
        render();
    };

    $('#lssstat-close').onclick = () => {
        root.style.display = 'none';
    };

    $('#lssstat-load').onclick = load;

    $('#lssstat-cancel').onclick = () =>
    state.loadAbort?.abort();

    $('#lssstat-export').onclick = exportCSV;

    $('#lssstat-search').oninput = e => {
        state.search = e.target.value;
        state.page = 0;
        render();
    };

    document.addEventListener('keydown', e => {
        if (
            e.key === 'Escape' &&
            root.style.display === 'flex' &&
            !state.writing
        ) {
            root.style.display = 'none';
        }
    });

    new MutationObserver(theme).observe(
        document.body,
        {
            attributes: true,
            attributeFilter: ['class']
        }
    );

    // ==========================================
    // NETZWERKANFRAGEN
    // ==========================================

    const external = url =>
    new Promise((ok, fail) =>
                GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 18000,

        onload: r => {
            try {
                if (r.status !== 200) {
                    throw Error(`HTTP ${r.status}`);
                }
                ok(JSON.parse(r.responseText));
            } catch (e) {
                fail(e);
            }
        },

        onerror: () =>
        fail(Error('Metadaten-Netzwerkfehler')),

        ontimeout: () =>
        fail(Error('Metadaten-Timeout'))
    })
               );

    async function fetchJSON(url, signal) {
        let last;

        for (let i = 0; i < 3; i++) {
            if (signal.aborted) {
                throw Error('Abgebrochen');
            }

            try {
                const r = await fetch(url, {
                    credentials: 'same-origin',
                    cache: 'no-store',
                    signal: AbortSignal.any([
                        signal,
                        AbortSignal.timeout(30000)
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
                    await sleep(700 * (i + 1));
                }
            }
        }

        throw last;
    }

    function safeNext(url) {
        if (!url) return null;

        const u = new URL(url, location.origin);

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

        const rows = [];
        const ids = new Set();
        const pages = new Set();
        let total = null;

        for (
            let page = 1;
            url && page <= 10000;
            page++
        ) {
            if (pages.has(url)) {
                throw Error('Wiederholte API-Seite');
            }

            pages.add(url);

            progress(
                `${kind === 'vehicles' ? 'Fahrzeuge' : 'Gebäude'}: ` +
                `Seite ${page}, ${fmt(rows.length)} geladen`
     );

            const data = await fetchJSON(url, signal);

            const list = Array.isArray(data)
            ? data
            : data.result;

            if (!Array.isArray(list)) {
                throw Error('Unerwartetes API-Format');
            }

            const paging =
                  data.paging || data.pagination || {};

            if (
                paging.count_total != null &&
                Number.isFinite(+paging.count_total)
            ) {
                total = +paging.count_total;
            }

            for (const row of list) {
                if (
                    row?.id == null ||
                    ids.has(String(row.id))
                ) {
                    throw Error('Ungültige oder doppelte ID');
                }

                ids.add(String(row.id));
                rows.push(row);
            }

            url = safeNext(paging.next_page);

            if (!list.length && url) {
                throw Error('Leere Folgeseite');
            }

            if (
                !url &&
                total !== null &&
                rows.length !== total
            ) {
                throw Error(
                    `Unvollständige Antwort: ${rows.length}/${total}`
       );
            }

            if (
                !url &&
                total === null &&
                list.length === PAGE_LIMIT
            ) {
                throw Error(
                    'Vollständigkeit nicht prüfbar'
                );
            }
        }

        if (url) {
            throw Error('Zu viele Seiten');
        }

        return rows;
    }

    // ==========================================
    // STATISTIKMODELL
    // ==========================================

    function compile(
    buildings,
     vehicles,
     bmeta,
     vmeta
    ) {
        const stations = [];
        const byBuilding = new Map();
        const families = new Map();
        const centers = new Map();
        const extensions = new Map();
        const vehicleByType = new Map();

        const groups = {
            building: {},
            vehicle: {}
        };

        let missing = 0;

        const metaExt = type =>
        bmeta[type]?.extensions;

        // Gebäude
        for (const b of buildings) {
            const typeId = String(b.building_type);

            const type =
                  bmeta[typeId]?.caption ||
                  `Gebäudetyp ${typeId}`;

            const f = FAMILIES[typeId];
            const org = orgFor(typeId, type);

            const familyKey =
                  f?.[0] || `type:${typeId}`;

            const familyName =
                  f?.[1] || type;

            const small = Boolean(
                b.small_building === true ||
                f?.[3]
            );

            const center = String(
                b.leitstelle_building_id ?? 'ohne'
            );

            const st = {
                id: String(b.id),
                name: String(
                    b.caption || `Gebäude ${b.id}`
       ),
                type,
                typeId,
                org,
                familyKey,
                familyName,
                small,
                center,
                vehicles: 0,

                // Personal und Personalwerbung
                personal: Number(b.personal_count) || 0,

                personalTarget:
                b.personal_count_target == null
                ? null
                : Number(b.personal_count_target),

                hiringAutomatic:
                typeof b.hiring_automatic === 'boolean'
                ? b.hiring_automatic
                : null,

                hiringPhase:
                b.hiring_phase == null
                ? null
                : Number(b.hiring_phase),

                extBought: 0,
                extActive: 0,
                byType: {}
            };

            stations.push(st);
            byBuilding.set(st.id, st);

            inc(groups.building, org);

            // Gebäudefamilien
            if (!families.has(familyKey)) {
                families.set(familyKey, {
                    key: familyKey,
                    name: familyName,
                    org,
                    count: 0,

                    normal: {
                        count: 0,
                        vehicles: 0,
                        personal: 0,
                        active: 0,
                        bought: 0
                    },

                    small: {
                        count: 0,
                        vehicles: 0,
                        personal: 0,
                        active: 0,
                        bought: 0
                    }
                });
            }

            const fam = families.get(familyKey);
            fam.count++;

            const part =
                  fam[small ? 'small' : 'normal'];

            part.count++;
            part.personal += st.personal;

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

            for (
                const x of Array.isArray(b.extensions)
                ? b.extensions
                : []
            ) {
                if (!x || typeof x !== 'object') {
                    continue;
                }

                const caption = String(
                    x.caption ||
                    `Erweiterung ${x.type_id ?? '?'}`
       );

                const typeKey =
                      String(x.type_id ?? '?');

                const key =
                      `${familyKey}::${typeId}::${typeKey}`;

                if (seen.has(key)) continue;
                seen.add(key);

                // Der Index der Schreibroute ist nicht
                // zwingend mit type_id identisch.
                const definitions = metaExt(typeId);
                let index = null;

                if (Array.isArray(definitions)) {
                    const matches = definitions
                    .map((m, i) => ({ m, i }))
                    .filter(({ m }) =>
                            m && String(m.caption) === caption
                           );

                    if (matches.length === 1) {
                        index = matches[0].i;
                    }
                }

                if (!extensions.has(key)) {
                    extensions.set(key, {
                        key,
                        caption,
                        org,
                        familyKey,
                        familyName,
                        typeId,
                        typeKey,
                        sites: []
                    });
                }

                const ex = extensions.get(key);

                const site = {
                    buildingId: st.id,
                    center,
                    available: x.available === true,
                    enabled: x.enabled === true,
                    metaIndex: index,
                    caption,
                    typeKey
                };

                ex.sites.push(site);

                st.extBought++;
                part.bought++;

                if (site.available && site.enabled) {
                    st.extActive++;
                    part.active++;
                }
            }
        }

        // Fahrzeuge
        const compactVehicles = [];

        for (const v of vehicles) {
            const typeId = String(v.vehicle_type);

            const type =
                  vmeta[typeId]?.caption ||
                  `Fahrzeugtyp ${typeId}`;

            const buildingId =
                  String(v.building_id ?? '');

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

            inc(
                groups.vehicle,
                st?.org || 'Weitere'
            );

            if (st) {
                st.vehicles++;
                inc(st.byType, type);

                families
                    .get(st.familyKey)[
                    st.small ? 'small' : 'normal'
                ].vehicles++;

                const c = centers.get(st.center);
                c.vehicles++;
                inc(c.byVehicle, type);

            } else {
                missing++;
            }
        }

        return {
            stations,
            byBuilding,
            families: [...families.values()],
            centers: [...centers.values()].map(c => ({
                ...c,
                name: c.id === 'ohne'
                ? 'Ohne Leitstellenzuordnung'
                : byBuilding.get(c.id)?.name ||
                `Leitstelle ${c.id}`
     })),
            extensions: [...extensions.values()],
            vehicleByType,
            compactVehicles,
            groups,
            buildings: buildings.length,
            vehicles: vehicles.length,
            missing,
            loadedAt: new Date(),
            warnings: []
        };
    }

    // ==========================================
    // DATEN LADEN
    // ==========================================

    async function load() {
        if (state.loading || state.writing) return;

        state.loading = true;
        state.loadAbort = new AbortController();

        $('#lssstat-load').disabled = true;
        $('#lssstat-cancel').disabled = false;

        progress('Lade ...');

        try {
            const meta = await Promise.allSettled([
                external(
                    'https://api.lss-manager.de/de_DE/buildings'
                ),
                external(
                    'https://api.lss-manager.de/de_DE/vehicles'
                )
            ]);

            const bm =
                  meta[0].status === 'fulfilled'
            ? meta[0].value
            : {};

            const vm =
                  meta[1].status === 'fulfilled'
            ? meta[1].value
            : {};

            const b = await allPages(
                'buildings',
                state.loadAbort.signal
            );

            const v = await allPages(
                'vehicles',
                state.loadAbort.signal
            );

            if (state.loadAbort.signal.aborted) {
                throw Error('Abgebrochen');
            }

            const d = compile(b, v, bm, vm);

            if (
                meta.some(x => x.status === 'rejected')
            ) {
                d.warnings.push(
                    'Metadaten teilweise nicht geladen. ' +
                    'Erweiterungen ohne eindeutige Zuordnung ' +
                    'sind nicht schaltbar.'
                );
            }

            if (d.missing) {
                d.warnings.push(
                    `${fmt(d.missing)} Fahrzeuge ohne bekannte Wache.`
       );
            }

            state.data = d;
            state.writeNeedsRefresh = false;
            state.detail = null;
            state.page = 0;

            state.openB.clear();
            state.openE.clear();

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
                `<div class="notice error">
         ${esc(e.message)} –
         vorherige Statistik bleibt erhalten.
       </div>`
     );

        } finally {
            state.loading = false;
            state.loadAbort = null;

            $('#lssstat-load').disabled = false;
            $('#lssstat-cancel').disabled = true;
        }
    }

    // ==========================================
    // TABS UND TABELLEN
    // ==========================================

    const tabs = [
        ['overview', 'Übersicht'],
        ['buildingtypes', 'Gebäudetypen'],
        ['vehicletypes', 'Fahrzeugtypen'],
        ['extensions', 'Erweiterungen'],
        ['stations', 'Einzelne Wachen'],
        ['personnel', 'Personalverwaltung'],
        ['centers', 'Leitstellenbereiche']
    ];

    function table(headers, body, widths = []) {
        return `
     <div class="tablebox">
       <table>
         <colgroup>
           ${headers.map((_, i) => `
             <col style="width:${
               widths[i] ||
                         (100 / headers.length) + '%'
                         }">
           `).join('')}
         </colgroup>

         <thead>
           <tr>
             ${headers.map(([t, n]) => `
               <th class="${n ? 'num' : ''}">
                 ${esc(t)}
               </th>
             `).join('')}
           </tr>
         </thead>

         <tbody>${body}</tbody>
       </table>
     </div>
   `;
    }


    function pager(n) {
        const total = Math.max(
            1,
            Math.ceil(n / PAGE_ROWS)
        );

        state.page = Math.max(
            0,
            Math.min(state.page, total - 1)
        );

        const current = state.page + 1;

        // Möglichst zwei Seiten vor und nach
        // der aktuellen Seite anzeigen.
        const start = Math.max(
            1,
            Math.min(current - 2, total - 4)
        );

        const end = Math.min(total, start + 4);

        const numberButton = page => `
        <button
            data-page="${page - 1}"
            class="${page === current ? 'primary' : ''}"
            ${page === current ? 'disabled' : ''}
        >${page}</button>
    `;

        let numbers = '';

        if (start > 1) {
            numbers += numberButton(1);

            if (start > 2) {
                numbers += '<span class="muted">…</span>';
            }
        }

        for (let page = start; page <= end; page++) {
            numbers += numberButton(page);
        }

        if (end < total) {
            if (end < total - 1) {
                numbers += '<span class="muted">…</span>';
            }

            numbers += numberButton(total);
        }

        return `
        <div class="pager">
            <button
                data-step="-1"
                ${current === 1 ? 'disabled' : ''}
            >← Zurück</button>

            ${numbers}

            <button
                data-step="1"
                ${current === total ? 'disabled' : ''}
            >Weiter →</button>
        </div>
    `;
    }


    function pageRows(rows) {
        const pageCtl = pager(rows.length);

        return {
            items: rows.slice(
                state.page * PAGE_ROWS,
                (state.page + 1) * PAGE_ROWS
            ),
            pageCtl
        };
    }

    function filter(rows) {
        const q = low(state.search.trim());

        if (!q) return rows;

        return rows.filter(r =>
                           [
            r.name,
            r.type,
            r.org,
            r.id,
            r.caption,
            r.familyName,
            r.center
        ].some(x => low(x).includes(q))
                          );
    }

    function detailEntries(o, label) {
        const e = sorted(o);

        if (!e.length) return '—';

        return `
     <details>
       <summary>
         ${esc(label)} (${e.length} Typen)
       </summary>

       ${e.map(([n, v]) => `
         <div>
           ${esc(n)}: <b>${fmt(v)}</b>
         </div>
       `).join('')}
     </details>
   `;
    }

    function familyRows() {
        return state.data.families.map(f => ({
            ...f,
            vehicles:
            f.normal.vehicles + f.small.vehicles,
            personal:
            f.normal.personal + f.small.personal,
            active:
            f.normal.active + f.small.active,
            bought:
            f.normal.bought + f.small.bought
        })).sort(
            (a, b) =>
            b.count - a.count ||
            a.name.localeCompare(b.name, 'de')
        );
    }


    // ==========================================
    // GEBÄUDETYP-DETAILANSICHT UND MASSENAKTIONEN
    // ==========================================

    function buildingTypeMatches() {
        const id = state.detail?.id;
        const q = low(state.search.trim());

        return state.data.stations.filter(s =>
                                          s.familyKey === id &&
                                          (state.buildingCenter === 'all' ||
                                           s.center === state.buildingCenter) &&
                                          (state.buildingStatus === 'all' ||
                                           (state.buildingStatus === 'active'
                                            ? s.enabled === true : s.enabled === false)) &&
                                          (state.buildingSize === 'all' ||
                                           (state.buildingSize === 'small' ? s.small : !s.small)) &&
                                          (!q || [s.name, s.id, s.type, s.org]
                                           .some(v => low(v).includes(q)))
                                         ).sort((a, b) => a.name.localeCompare(b.name, 'de', {
            numeric: true
        }));
    }

    function buildingTypeDetail() {
        const rows = buildingTypeMatches();
        const active = rows.filter(s => s.enabled === true).length;
        const inactive = rows.filter(s => s.enabled === false).length;
        const unknown = rows.length - active - inactive;
        const { items, pageCtl } = pageRows(rows);

        const blocked = state.writing || state.loading ||
              state.pending || state.writeNeedsRefresh ||
              v24Busy || v24NeedsReload ||
              state.buildingBulkPending;

        const centerOptions = state.data.centers
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .map(c => `
                <option value="${esc(c.id)}"
                    ${state.buildingCenter === c.id ? 'selected' : ''}>
                    ${esc(c.name)}
                </option>
            `).join('');

        const option = (value, label, current) => `
            <option value="${value}"
                ${value === current ? 'selected' : ''}>
                ${label}
            </option>
        `;

        const pending = state.buildingBulkPending;

        return `
            <button id="lssstat-back">
                ← Zurück zu Gebäudetypen
            </button>

            <h3>${esc(state.detail.name)} – Einzelne Wachen</h3>

            <div class="toolbar" style="margin:12px 0">
                <label>
                    Leitstellenbereich:
                    <select id="lssstat-building-center">
                        ${option('all', 'Alle Leitstellenbereiche',
                                 state.buildingCenter)}
                        ${centerOptions}
                    </select>
                </label>

                <label>
                    Aktivstatus:
                    <select id="lssstat-building-status">
                        ${option('all', 'Alle', state.buildingStatus)}
                        ${option('active', 'Aktiv', state.buildingStatus)}
                        ${option('inactive', 'Inaktiv', state.buildingStatus)}
                    </select>
                </label>

                <label>
                    Wachengröße:
                    <select id="lssstat-building-size">
                        ${option('all', 'Alle', state.buildingSize)}
                        ${option('normal', 'Normal', state.buildingSize)}
                        ${option('small', 'Kleinwache', state.buildingSize)}
                    </select>
                </label>
            </div>

            <div class="notice">
                ${fmt(rows.length)} Treffer ·
                ${fmt(active)} aktiv ·
                ${fmt(inactive)} inaktiv

                ${unknown ? `
                    · ${fmt(unknown)} ohne bekannten Status
                ` : ''}

                <div class="actions" style="margin-top:10px">
                    <button data-building-bulk="on"
                        ${blocked || inactive === 0 ? 'disabled' : ''}>
                        Alle ${fmt(inactive)} aktivieren
                    </button>

                    <button data-building-bulk="off"
                        ${blocked || active === 0 ? 'disabled' : ''}>
                        Alle ${fmt(active)} deaktivieren
                    </button>
                </div>

                <div class="muted"
                    style="font-size:14px;margin-top:8px">
                    Aktionen betreffen alle gefilterten Treffer,
                    auch auf anderen Seiten.
                </div>
            </div>

            ${pending ? `
                <div class="confirmbox"
                    id="lssstat-building-confirmbox">

                    <h3>Massenaktion bestätigen</h3>

                    <p>
                        <b>${fmt(pending.ids.length)}</b>
                        Wachen aus „${esc(pending.description)}“
                        werden
                        <b>${pending.target
            ? 'aktiviert' : 'deaktiviert'}</b>.
                    </p>

                    <p>
                        Die Auswahl wurde beim Klick eingefroren.
                        Bereits passende Serverzustände werden
                        übersprungen.
                    </p>

                    <div class="actions">
                        <button id="lssstat-building-cancel">
                            Abbrechen
                        </button>

                        <button class="primary"
                            id="lssstat-building-confirm">
                            ${fmt(pending.ids.length)}
                            Änderungen bestätigen
                        </button>
                    </div>
                </div>
            ` : ''}

            ${table(
            [
                ['Wache'],
                ['Leitstellenbereich'],
                ['Gebäudetyp'],
                ['Status'],
                ['Aktion']
            ],

            items.map(s => `
                    <tr>
                        <td>${hrefB(s)}</td>

                        <td>
                            ${esc(state.data.centers.find(c =>
                                                          c.id === s.center)?.name ||
                                  'Ohne Leitstelle')}
                        </td>

                        <td>
                            ${esc(s.type)}
                            ${s.small ? ' (Kleinwache)' : ''}
                        </td>

                        <td>
                            ${s.enabled === true ? 'Aktiv' :
                      s.enabled === false ? 'Inaktiv' :
                      'Unbekannt'}
                        </td>

                        <td>
                            ${v24Button(
                'building',
                s.id,
                s.name,
                s.enabled
            )}
                        </td>
                    </tr>
                `).join(''),

            ['27%', '23%', '22%', '10%', '18%']
        )}

            ${pageCtl}
        `;
    }

    function beginBuildingBulk(target) {
        if (
            state.writing ||
            state.loading ||
            state.pending ||
            state.writeNeedsRefresh ||
            state.buildingBulkPending ||
            v24Busy ||
            v24NeedsReload
        ) {
            return;
        }

        const ids = buildingTypeMatches()
        .filter(s =>
                typeof s.enabled === 'boolean' &&
                s.enabled !== target
               )
        .map(s => s.id);

        if (!ids.length) return;

        state.buildingBulkPending = {
            ids,
            target,
            description: state.detail.name
        };

        render();
        $('#lssstat-content').scrollTop = 0;
    }

    async function executeBuildingBulk() {
        const plan = state.buildingBulkPending;

        if (!plan || state.writing || state.loading) {
            return;
        }

        state.buildingBulkPending = null;
        state.writing = true;
        state.stopWrite = false;
        state.writeLog = [];

        let done = 0;
        let skipped = 0;
        let failed = false;

        render();

        for (const id of plan.ids) {
            if (state.stopWrite) break;

            const station = state.data.byBuilding.get(id);

            try {
                if (!station || station.enabled === plan.target) {
                    skipped++;
                    continue;
                }

                // Bereits getesteter 2.4.0-Schreibweg.
                // Prüft den Serverstatus und verwendet /active.
                await v24ChangeBuilding(
                    id,
                    'enabled',
                    plan.target
                );

                done++;

                state.writeLog.push(
                    `OK: ${station.name} (${id})`
                );

            } catch (error) {
                failed = true;
                state.stopWrite = true;
                state.writeNeedsRefresh = true;

                state.writeLog.push(
                    `FEHLER ${id}: ${error.message}`
                );

                console.error(
                    '[LSS Gebäude-Massenaktion]',
                    error
                );

                break;

            } finally {
                progress(
                    `Wachen: ${fmt(done)} geändert, ` +
                    `${fmt(skipped)} übersprungen`
                );

                render();
            }

            if (!state.stopWrite) {
                await sleep(ACTION_DELAY_MS);
            }
        }

        state.writing = false;

        state.writeLog.push(
            `${
                failed ? 'Fehler' :
            state.stopWrite ? 'Abgebrochen' : 'Fertig'
            }: ${fmt(done)} geändert, ` +
            `${fmt(skipped)} übersprungen.`
        );

        progress(
            failed
            ? 'Fehler: Bitte Statistik vollständig neu laden'
            : `Fertig: ${fmt(done)} Wachen geändert`
        );

        render();
    }

    function displayStatus(status) {
        const value = Number(status);

        if (value === 6) {
            return '6';
        }

        if ([1, 2, 3, 4, 5, 7, 8, 9].includes(value)) {
            return '2';
        }

        return 'Unbekannt';
    }

    function vehicleRows() {
        return [...state.data.vehicleByType]
            .map(([id, vs]) => {
            const buildings = new Set(
                vs.map(v => v.buildingId)
                .filter(id =>
                        state.data.byBuilding.has(id)
                       )
            );

            return {
                id,
                name: vs[0].type,
                count: vs.length,
                status2: vs.filter(
                    v => displayStatus(v.status) === '2'
                ).length,
                status6: vs.filter(
                    v => displayStatus(v.status) === '6'
                ).length,
                avg: buildings.size
                ? vs.length / buildings.size
                : null
            };
        })
            .sort(
            (a, b) =>
            b.count - a.count ||
            a.name.localeCompare(b.name, 'de')
        );
    }

    // ==========================================
    // INTERAKTIVE SVG-KREISDIAGRAMME
    // ==========================================

    function chartData(org, kind) {
        const counts = {};
        const small = {};

        if (kind === 'buildingtypes') {
            for (const f of state.data.families) {
                if (f.org === org) {
                    inc(counts, f.name, f.count);
                    inc(small, f.name, f.small.count);
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

    function arcPath(a, b) {
        const r = 88;
        const cx = 110;
        const cy = 110;

        const pos = t => [
            cx + r * Math.cos(t),
            cy + r * Math.sin(t)
        ];

        const start =
              a * 2 * Math.PI - Math.PI / 2;

        const end =
              b * 2 * Math.PI - Math.PI / 2;

        const p1 = pos(start);
        const p2 = pos(end);

        return `
     M ${cx} ${cy}
     L ${p1[0]} ${p1[1]}
     A ${r} ${r} 0 ${b - a > .5 ? 1 : 0} 1
       ${p2[0]} ${p2[1]}
     Z
   `;
    }

    function chart(org, kind) {
        const rows = chartData(org, kind);

        const total = rows.reduce(
            (s, r) => s + r.n,
            0
        );

        if (!total) {
            return `
       <section class="chart">
         <h3>${esc(org)}</h3>
         Keine Einträge
       </section>
     `;
        }

        let start = 0;

        const paths = rows.map((r, i) => {
            const a = start;
            start += r.n / total;
            const b = start;

            if (rows.length === 1) {
                return `
         <circle
           class="pie-segment"
           data-slice="${i}"
           cx="110" cy="110" r="88"
           fill="${COLORS[i % COLORS.length]}"
         ></circle>
       `;
            }

            return `
       <path
         class="pie-segment"
         data-slice="${i}"
         d="${arcPath(a, b)}"
         fill="${COLORS[i % COLORS.length]}"
       ></path>
     `;
        }).join('');

        return `
     <section
       class="chart"
       data-chart="${esc(org)}"
     >
       <h3>
         ${esc(org)}
         <span class="muted">
           (${fmt(total)})
         </span>
       </h3>

       <div class="chartrow">
         <svg
           class="pie"
           viewBox="0 0 220 220"
           role="img"
           aria-label="Kreisdiagramm ${esc(org)}"
         >
           ${paths}

           <circle
             cx="110" cy="110" r="51"
             fill="var(--panel)"
             pointer-events="none"
           ></circle>

           <text
             class="pie-center"
             x="110" y="107"
             fill="var(--text)"
             font-size="13"
             text-anchor="middle"
             pointer-events="none"
           >${fmt(total)} gesamt</text>

           <text
             class="pie-value"
             x="110" y="130"
             fill="var(--text)"
             font-size="13"
             text-anchor="middle"
             pointer-events="none"
           ></text>
         </svg>

         <div class="legend">
           ${rows.map((r, i) => `
             <div
               class="legenditem"
               data-slice="${i}"
             >
               <span
                 class="swatch"
                 style="background:${
                   COLORS[i % COLORS.length]
                      }"
               ></span>

               <span>
                 ${esc(r.name)}:
                 <b>
                   ${state.mode === 'relative'
                      ? (100 * r.n / total).toLocaleString(
            'de-DE',
            { maximumFractionDigits: 2 }
        ) + ' %'
                      : fmt(r.n)}
                 </b>

                 ${kind === 'buildingtypes' && r.small
                      ? `
                     <div class="muted">
                       davon ${
                         state.mode === 'relative'
                      ? (100 * r.small / r.n)
                      .toLocaleString('de-DE', {
            maximumFractionDigits: 2
        }) + ' %'
                      : fmt(r.small)
                      } Kleinwachen
                     </div>
                   `
                   : ''}
               </span>
             </div>
           `).join('')}
         </div>
       </div>

       <div class="chart-focus muted">
         Über ein Segment oder die Legende fahren.
       </div>
     </section>
   `;
    }


    function charts() {
        // Nur diese vier Organisationen in Diagrammen anzeigen
        const chartOrgs = [
            'Feuerwehr',
            'Rettungsdienst',
            'Polizei',
            'THW'
        ];

        return `
        <div class="toolbar" style="margin:10px 0">
            <button
                id="lssstat-charts"
                class="${state.charts ? 'primary' : ''}"
            >
                ${state.charts
            ? 'Diagramme ausblenden'
        : 'Kuchendiagramme anzeigen'}
            </button>

            ${state.charts ? `
                <button
                    data-mode="absolute"
                    class="${state.mode === 'absolute'
            ? 'primary' : ''}"
                >
                    Absolut
                </button>

                <button
                    data-mode="relative"
                    class="${state.mode === 'relative'
            ? 'primary' : ''}"
                >
                    Relativ (100 %)
                </button>

                <span class="muted">
                    Unter ${MIN_CHART_COUNT} → Sonstige
                </span>
            ` : ''}
        </div>

        ${state.charts ? `
            <div class="charts">
                ${chartOrgs
            .map(org => chart(org, state.tab))
            .join('')}
            </div>
        ` : ''}
    `;
    }


    function bindCharts() {
        for (
            const node of root.querySelectorAll(
                '[data-chart]'
            )
        ) {
            const rows = chartData(
                node.dataset.chart,
                state.tab
            );

            const total = rows.reduce(
                (s, r) => s + r.n,
                0
            );

            const focus = i => {
                node.querySelectorAll('[data-slice]')
                    .forEach(el => {
                    el.classList.toggle(
                        'active',
                        +el.dataset.slice === i
                    );
                });

                const x = rows[i];

                node.querySelector('.pie-center')
                    .textContent = x
                    ? x.name.slice(0, 18)
                : `${fmt(total)} gesamt`;

                node.querySelector('.pie-value')
                    .textContent = x
                    ? `${fmt(x.n)} · ${
                        (100 * x.n / total).toLocaleString(
                    'de-DE',
                    { maximumFractionDigits: 2 }
                )
            } %`
           : '';

                node.querySelector('.chart-focus')
                    .textContent = x
                    ? `${x.name}: ${fmt(x.n)} (${
                                               (100 * x.n / total).toLocaleString(
                    'de-DE',
                    { maximumFractionDigits: 2 }
                )
            } %)${
    x.small
                    ? ` · davon ${fmt(x.small)} Kleinwachen`
                 : ''
            }`
           : 'Über ein Segment oder die Legende fahren.';
            };

            node.querySelectorAll('[data-slice]')
                .forEach(el => {
                el.onmouseenter = () =>
                focus(+el.dataset.slice);

                el.onmouseleave = () =>
                focus(-1);

                el.onfocus = () =>
                focus(+el.dataset.slice);

                el.onblur = () =>
                focus(-1);
            });
        }
    }

    // ==========================================
    // LEITSTELLENFILTER
    // ==========================================

    function centerSelect() {
        return `
     <div
class="toolbar"
style="margin:10px 0"
>
    <label for="lssstat-center">
        Leitstellenbereich:
            </label>

<select id="lssstat-center">
    <option value="all">
        Alle Leitstellenbereiche
            </option>

${state.data.centers
            .slice()
            .sort((a, b) =>
                  a.name.localeCompare(b.name, 'de')
                 )
            .map(c => `
             <option
               value="${esc(c.id)}"
               ${c.id === state.center
                 ? 'selected' : ''}
             >${esc(c.name)}</option>
           `).join('')}
</select>

<span class="muted">
    Aktiviert / Gekauft
(im Bau zählt als gekauft)
</span>
</div>
`;
    }

    function selectedExtensions() {
        return state.data.extensions
            .map(ex => {
            const sites = state.center === 'all'
            ? ex.sites
            : ex.sites.filter(
                s => s.center === state.center
            );

            return {
                ...ex,
                sites,
                bought: sites.length,
                active: sites.filter(
                    s => s.available && s.enabled
                ).length
            };
        })
            .filter(x => x.bought);
    }

    function extGroups() {
        const map = new Map();

        for (const ex of selectedExtensions()) {
            const key =
                  ex.org + '::' + ex.familyKey;

            if (!map.has(key)) {
                map.set(key, {
                    key,
                    org: ex.org,
                    name: ex.familyName,
                    items: []
                });
            }

            map.get(key).items.push(ex);
        }

        return [...map.values()].sort(
            (a, b) =>
            a.org.localeCompare(b.org, 'de') ||
            a.name.localeCompare(b.name, 'de')
        );
    }

    // ==========================================
    // ERWEITERUNGSÜBERSICHT
    // ==========================================

    function extOverview() {
        const groups = extGroups();
        const q = low(state.search.trim());
        const orgs = new Map();

        for (const g of groups) {
            const items = g.items.filter(x =>
                                         !q ||
                                         [
                x.caption,
                x.org,
                x.familyName
            ].some(t => low(t).includes(q))
                                        );

            if (!items.length) continue;

            if (!orgs.has(g.org)) {
                orgs.set(g.org, []);
            }

            orgs.get(g.org).push({
                ...g,
                items
            });
        }

        let body = '';

        for (const [org, gs] of orgs) {
            const all = gs.flatMap(g => g.items);

            const active = all.reduce(
                (s, x) => s + x.active,
                0
            );

            const bought = all.reduce(
                (s, x) => s + x.bought,
                0
            );

            const opened =
                  state.openE.has('org:' + org);

            body += `
       <tr>
    <td>
    <button
class="linkbtn"
data-expand="org:${esc(org)}"
>
    ${opened ? '▾' : '▸'} ${esc(org)}
</button>
</td>

<td class="num">
    <b>${fmt(active)} / ${fmt(bought)}</b>
        </td>
<td></td>
</tr>
`;

            if (!opened) continue;

            for (const g of gs) {
                const a = g.items.reduce(
                    (s, x) => s + x.active,
                    0
                );

                const b = g.items.reduce(
                    (s, x) => s + x.bought,
                    0
                );

                const key = 'family:' + g.key;
                const open = state.openE.has(key);

                body += `
         <tr class="subrow">
             <td class="indent">
                 <button
class="linkbtn"
data-expand="${esc(key)}"
>
    ${open ? '▾' : '▸'}
${esc(g.name)}
</button>
</td>

<td class="num">
    ${fmt(a)} / ${fmt(b)}
</td>
<td></td>
</tr>
`;


                if (open) {
                    for (const x of g.items.sort(
                        (a, b) => b.bought - a.bought
                    )) {
                        const canActivate = x.sites.filter(
                            s =>
                            s.available &&
                            !s.enabled &&
                            Number.isInteger(s.metaIndex)
                        ).length;

                        const canDeactivate = x.sites.filter(
                            s =>
                            s.available &&
                            s.enabled &&
                            Number.isInteger(s.metaIndex)
                        ).length;

                        const locked =
                              state.writing ||
                              state.writeNeedsRefresh ||
                              state.pending !== null;

                        body += `
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

<td>
        <div class="actions">
            <button
data-row-bulk="activate"
data-row-extension="${esc(x.key)}"
${locked || !canActivate
                            ? 'disabled' : ''}
>
    Alle aktivieren
    (${fmt(canActivate)})
        </button>

<button
data-row-bulk="deactivate"
data-row-extension="${esc(x.key)}"
class="danger"
${locked || !canDeactivate
                            ? 'disabled' : ''}
>
    Alle deaktivieren
    (${fmt(canDeactivate)})
        </button>
</div>
</td>
</tr>
`;
                    }
                }

            }
        }


        return centerSelect() + `
    <div class="notice">
        Gezählt werden gekaufte Erweiterungen.
        Nur verfügbare und eingeschaltete Erweiterungen
        gelten als aktiviert. Änderungen erfolgen
        ausschließlich nach Bestätigung.
            </div>
` + table(
            [
                ['Organisation / Gebäudetyp / Erweiterung'],
                ['Aktiviert / Gekauft', true],
                ['Aktionen']
            ],
            body,
            ['42%', '17%', '41%']
        );

    }

    // ==========================================
    // ERWEITERUNGSDETAILS
    // ==========================================

    function extDetail() {
        const ex = selectedExtensions().find(
            x => x.key === state.detail.id
        );

        if (!ex) {
            return centerSelect() + `
       <button id="lssstat-back">
           ← Zurück
               </button>

<div class="notice">
    Keine Einträge im gewählten Leitstellenbereich.
        </div>
`;
        }

        const q = low(state.search.trim());

        const rows = ex.sites
        .map(s => ({
            ...s,
            st: state.data.byBuilding.get(s.buildingId)
        }))
        .filter(x => {
            const status = extStatus(x);

            const matchesStatus =
                  state.detailStatus === 'all' ||
                  (state.detailStatus === 'active' &&
                   status === 'Aktiv') ||
                  (state.detailStatus === 'inactive' &&
                   status === 'Deaktiviert') ||
                  (state.detailStatus === 'construction' &&
                   status === 'Im Bau');

            const matchesSearch =
                  !q ||
                  [
                      x.st?.name,
                      x.st?.type,
                      status,
                      x.buildingId
                  ].some(v => low(v).includes(q));

            return matchesStatus && matchesSearch;
        });

        rows.sort((a, b) => {
            if (state.detailSort === 'status') {
                return extStatus(a).localeCompare(
                    extStatus(b),
                    'de'
                );
            }

            return (a.st?.name || '').localeCompare(
                b.st?.name || '',
                'de'
            );
        });


        const { items, pageCtl } = pageRows(rows);

        const inactive = ex.sites.filter(
            s => s.available && !s.enabled
        ).length;

        const active = ex.sites.filter(
            s => s.available && s.enabled
        ).length;

        const buttons = `
     <div
class="toolbar"
style="margin:10px 0"
>
    ${state.writeNeedsRefresh
        ? `
           <span class="notice">
             Nach Änderungen zuerst Daten neu laden.
           </span>
         `
         : ''}

<button
data-bulk="activate"
${inactive &&
              !state.writing &&
              !state.writeNeedsRefresh
        ? '' : 'disabled'}
>
    Alle deaktivierten aktivieren
    (${fmt(inactive)})
        </button>

<button
data-bulk="deactivate"
class="danger"
${active &&
              !state.writing &&
              !state.writeNeedsRefresh
        ? '' : 'disabled'}
>
    Alle aktiven deaktivieren
    (${fmt(active)})
        </button>
</div>
`;

        const body = items.map(x => `
     <tr>
            <td>
            ${x.st
                               ? hrefB(x.st)
                               : esc(x.buildingId)}
</td>

<td>
    ${esc(x.st?.type || 'Unbekannt')}
</td>

<td>
    <span class="stat">
        ${extStatus(x)}
</span>
</td>

<td>
    <div class="actions">
        ${x.available ? `
             <button
               data-single="${esc(x.buildingId)}"
               data-target="${x.enabled ? 'off' : 'on'}"
               ${x.metaIndex === null ||
                               state.writing ||
                               state.writeNeedsRefresh
                               ? 'disabled'
                               : ''}
             >
               ${x.enabled
                               ? 'Deaktivieren'
                               : 'Aktivieren'}
             </button>
           ` : 'Im Bau'}
</div>
</td>
</tr>
`).join('');

        return centerSelect() + `
     <button id="lssstat-back">
         ← Zurück zu Erweiterungen
             </button>

<h3>
             ${esc(ex.caption)} –
             ${fmt(ex.active)} aktiviert /
                 ${fmt(ex.bought)} gekauft
                     </h3>

${buttons}
${detailFilters('extension')}
${table(
            [
                ['Wache'],
                ['Gebäudetyp'],
                ['Status'],
                ['Aktion']
            ],
            body,
            ['35%', '25%', '18%', '22%']
        )}

${pageCtl}
`;
    }

    function detailFilters(kind, statuses = []) {
        const options = kind === 'vehicle'
        ? statuses.map(value => `
            <option
value="${esc(value)}"
${state.detailStatus === value
                       ? 'selected' : ''}
>${value === '2'
                       ? 'S2 – Einsatzbereit'
                       : 'S6 – Nicht einsatzbereit'}</option>
`).join('')
        : [
            ['active', 'Aktiv'],
            ['inactive', 'Deaktiviert'],
            ['construction', 'Im Bau']
        ].map(([value, label]) => `
            <option
value="${value}"
${state.detailStatus === value
              ? 'selected' : ''}
>${label}</option>
`).join('');

        return `
        <div class="toolbar" style="margin:12px 0">
            <label for="lssstat-detail-status">
                Status:
                    </label>

<select id="lssstat-detail-status">
    <option value="all">Alle Status</option>
${options}
</select>

<label for="lssstat-detail-sort">
    Sortieren nach:
</label>

<select id="lssstat-detail-sort">
    <option value="name"
${state.detailSort === 'name'
            ? 'selected' : ''}>
        ${kind === 'vehicle'
            ? 'Fahrzeugname'
        : 'Wachenname'}
</option>

<option value="status"
${state.detailSort === 'status'
            ? 'selected' : ''}>
        Status
</option>

${kind === 'vehicle' ? `
                    <option value="station"
                        ${state.detailSort === 'station'
            ? 'selected' : ''}>
                        Wache
                    </option>
                ` : ''}
</select>
</div>
`;
    }

    // ==========================================
    // FAHRZEUGDETAILS
    // ==========================================

    function vehicleDetail() {
        const all =
              state.data.vehicleByType.get(
                  state.detail.id
              ) || [];

        const q = low(state.search.trim());

        const statuses = ['2', '6'];

        const rows = all.filter(v => {
            const station = state.data.byBuilding.get(
                v.buildingId
            );

            const matchesStatus =
                  state.detailStatus === 'all' ||
                  displayStatus(v.status) === state.detailStatus;

            const matchesSearch =
                  !q ||
                  [
                      v.name,
                      v.id,
                      v.status,
                      station?.name
                  ].some(x => low(x).includes(q));

            return matchesStatus && matchesSearch;
        });

        rows.sort((a, b) => {
            if (state.detailSort === 'status') {
                return String(a.status ?? '').localeCompare(
                    String(b.status ?? ''),
                    'de',
                    { numeric: true }
                );
            }

            if (state.detailSort === 'station') {
                const sa = state.data.byBuilding.get(
                    a.buildingId
                )?.name ?? '';

                const sb = state.data.byBuilding.get(
                    b.buildingId
                )?.name ?? '';

                return sa.localeCompare(sb, 'de');
            }

            return a.name.localeCompare(b.name, 'de', {
                numeric: true
            });
        });


        const { items, pageCtl } = pageRows(rows);

        const body = items.map(v => `
     <tr>
    <td>
    <a
target="_blank"
rel="noopener"
href="/vehicles/${encodeURIComponent(v.id)}"
>${esc(v.name)}</a>
</td>

<td>
    ${displayStatus(v.status) === '2'
                               ? 'S2 – Einsatzbereit'
                               : displayStatus(v.status) === '6'
                               ? 'S6 – Nicht einsatzbereit'
                               : 'Unbekannt'}
</td>

<td>
    ${state.data.byBuilding.has(v.buildingId)
                               ? hrefB(
            state.data.byBuilding.get(v.buildingId)
        )
                               : 'Nicht zugeordnet'}
</td>

<td class="num">
    ${esc(v.id)}
</td>
</tr>
`).join('');

        return `
     <button id="lssstat-back">
         ← Zurück zu Fahrzeugtypen
             </button>

<h3>
             ${esc(state.detail.name)} –
             ${fmt(rows.length)} Fahrzeuge
                 </h3>

<div class="notice">
    FMS-Status zum Zeitpunkt des letzten Ladens.
        </div>
${detailFilters('vehicle', statuses)}
${table(
            [
                ['Fahrzeug'],
                ['Status'],
                ['Wache'],
                ['ID', true]
            ],
            body,
            ['32%', '14%', '42%', '12%']
        )}

${pageCtl}
`;
    }

    // ==========================================
    // SCHREIBAKTIONEN – SICHERHEIT
    // ==========================================

    function actionPlan(sites, target) {
        return sites
            .filter(s =>
                    s.available && s.enabled !== target
                   )
            .map(s => ({
            ...s,
            st: state.data.byBuilding.get(s.buildingId)
        }));
    }


    function beginWrite(sites, target, description) {
        if (
            state.loading ||
            state.writing ||
            state.writeNeedsRefresh ||
            state.pending
        ) {
            return;
        }

        // Erweiterungen ermitteln, deren Status
        // tatsächlich geändert werden muss.
        const candidates = actionPlan(sites, target);

        // Nur Erweiterungen mit eindeutigem Index
        // für die Schreibaktion freigeben.
        const ready = candidates.filter(
            s => Number.isInteger(s.metaIndex)
        );

        // Erweiterungen ohne eindeutige Zuordnung
        // von der Aktion ausschließen.
        const blocked = candidates.length - ready.length;

        state.pending = {
            ready,
            blocked,
            target,
            description
        };

        // Bestätigungsdialog anzeigen.
        render();
    }


    function writeDialog() {
        const p = state.pending;

        if (!p) return '';

        return `
     <div class="confirmbox">
         <h3>${esc(p.description)}</h3>

<p>
             ${fmt(p.ready.length)}
Erweiterungen werden
${p.target ? 'aktiviert' : 'deaktiviert'}.
    </p>

${p.blocked ? `
         <p class="notice">
           ${fmt(p.blocked)} Einträge können wegen
           fehlender eindeutiger Zuordnung nicht
           geändert werden.
         </p>
       ` : ''}

<p class="muted">
    Der Schreib-Endpunkt schaltet den Zustand um.
    Nur fertiggestellte Erweiterungen mit
    abweichendem Status werden ausgewählt.
    Nach der Änderung müssen die Daten
    aktualisiert und kontrolliert werden.
        </p>

<div class="actions">
    <button id="lssstat-write-cancel">
        Zurück
</button>

<button
id="lssstat-write-confirm"
class="primary"
${p.ready.length ? '' : 'disabled'}
>
    ${fmt(p.ready.length)}
Änderungen bestätigen
    </button>
</div>
</div>
`;
    }

    // ==========================================
    // EINZELNE ERWEITERUNG UMSCHALTEN
    // ==========================================



    async function readExtensionState(s) {
        const id = Number(s.buildingId);

        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new Error('Ungültige Gebäude-ID');
        }

        // Die V2-API liefert Gebäude nach ID sortiert.
        // "after" gibt die untere ID-Grenze an.
        const url =
              `/api/v2/buildings?after=${id - 1}&limit=1`;

        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(
                `Gebäudeprüfung: HTTP ${response.status}`
        );
        }

        const payload = await response.json();

        const buildings = Array.isArray(payload)
        ? payload
        : payload.result;

        if (!Array.isArray(buildings)) {
            throw new Error(
                'Unerwartetes Format der Gebäude-API'
            );
        }

        const building = buildings.find(
            b => String(b.id) === String(s.buildingId)
        );

        // Niemals den Zustand einer anderen Wache
        // als Bestätigung akzeptieren.
        if (!building) {
            throw new Error(
                'Gebäude wurde in der V2-Antwort ' +
                'nicht gefunden. Aktion abgebrochen.'
            );
        }

        if (!Array.isArray(building.extensions)) {
            throw new Error(
                'Erweiterungsdaten fehlen in der API'
            );
        }

        const matches = building.extensions.filter(x =>
                                                   String(x.type_id) === String(s.typeKey) &&
                                                   String(x.caption) === String(s.caption)
                                                  );

        if (matches.length !== 1) {
            throw new Error(
                'Erweiterung nicht eindeutig zuordenbar'
            );
        }

        return matches[0];
    }



    function updateLocalExtension(s, current) {
        const newAvailable = current.available === true;
        const newEnabled = current.enabled === true;

        // Originaldatensatz im Statistikmodell suchen.
        // Nicht nur die Kopie aus actionPlan() ändern!
        const matches = state.data.extensions.flatMap(ex =>
                                                      ex.sites.filter(site =>
                                                                      String(site.buildingId) === String(s.buildingId) &&
                                                                      String(site.typeKey) === String(s.typeKey) &&
                                                                      String(site.caption) === String(s.caption)
                                                                     )
                                                     );

        if (matches.length !== 1) {
            throw new Error(
                'Lokale Erweiterung nicht eindeutig gefunden. ' +
                'Bitte Daten neu laden.'
            );
        }

        const original = matches[0];

        const oldActive =
              original.available === true &&
              original.enabled === true;

        const newActive = newAvailable && newEnabled;

        const difference =
              Number(newActive) - Number(oldActive);

        // Tatsächlich gespeicherte Erweiterung aktualisieren
        original.available = newAvailable;
        original.enabled = newEnabled;

        // Gebäude-Statistik aktualisieren
        const station = state.data.byBuilding.get(
            String(s.buildingId)
        );

        if (station && difference !== 0) {
            station.extActive += difference;

            // Statistik der Gebäudefamilie aktualisieren
            const family = state.data.families.find(
                f => f.key === station.familyKey
            );

            if (family) {
                const section = family[
                    station.small ? 'small' : 'normal'
                ];

                section.active += difference;
            }
        }

        console.log(
            '[LSS Statistik] Erweiterung aktualisiert:',
            s.caption,
            'Gebäude:',
            s.buildingId,
            'Aktiv:',
            newActive
        );
    }


    async function postToggle(s, target) {
        const token = document.querySelector(
            'meta[name="csrf-token"]'
        )?.content;

        if (!token) {
            throw Error('CSRF-Token fehlt');
        }

        if (!Number.isInteger(s.metaIndex)) {
            throw Error('Erweiterungsindex nicht eindeutig');
        }

        // Vor der Änderung den aktuellen Zustand prüfen.
        const before = await readExtensionState(s);

        if (before.available !== true) {
            throw Error('Erweiterung ist noch im Bau');
        }

        if (before.enabled !== s.enabled) {
            throw Error(
                'Der gespeicherte Zustand ist veraltet. ' +
                'Bitte Daten aktualisieren.'
            );
        }

        if (before.enabled === target) {
            // Bereits im gewünschten Zustand:
            // Kein Umschalt-Aufruf erforderlich.
            updateLocalExtension(s, before);
            return false;
        }

        const url =
              `/buildings/${encodeURIComponent(s.buildingId)}` +
              `/extension_ready/${s.metaIndex}/` +
              encodeURIComponent(s.buildingId);

        const body = new URLSearchParams({
            authenticity_token: token,
            _method: 'post'
        });

        const response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            redirect: 'follow',
            headers: {
                'Content-Type':
                'application/x-www-form-urlencoded; charset=UTF-8',
                'X-CSRF-Token': token,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body
        });

        if (
            !response.ok ||
            new URL(
                response.url,
                location.origin
            ).pathname.includes('sign_in')
        ) {
            throw Error(
                `Änderung fehlgeschlagen: HTTP ${response.status}`
        );
        }

        // Nach der Änderung den tatsächlichen Status
        // aus der Einzelgebäude-API kontrollieren.
        let verified = false;

        for (let attempt = 0; attempt < 3; attempt++) {
            await sleep(500);

            const current = await readExtensionState(s);

            if (
                current.available === true &&
                current.enabled === target
            ) {
                updateLocalExtension(s, current);
                verified = true;
                break;
            }
        }

        if (!verified) {
            throw Error(
                'Serverzustand konnte nicht bestätigt werden. ' +
                'Keine weiteren Änderungen durchführen.'
            );
        }

        return true;
    }



    // ==========================================
    // MASSENAKTIONEN
    // ==========================================


    async function executeWrites() {
        const p = state.pending;

        if (!p || !p.ready.length || state.writing) {
            return;
        }

        state.pending = null;
        state.writing = true;
        state.stopWrite = false;
        state.writeLog = [];

        let done = 0;
        let skipped = 0;
        let failed = false;

        render();

        for (const s of p.ready) {
            if (state.stopWrite) break;

            try {
                const changed = await postToggle(
                    s,
                    p.target
                );

                if (changed) {
                    done++;
                } else {
                    skipped++;
                }

                state.writeLog.push(
                    `${changed ? 'OK' : 'ÜBERSPRUNGEN'}: ` +
                    `${s.st?.name || s.buildingId}`
            );

            } catch (error) {
                failed = true;
                state.stopWrite = true;

                // Nach unklaren Fehlern können lokale und
                // serverseitige Daten auseinanderliegen.
                state.writeNeedsRefresh = true;

                state.writeLog.push(
                    `FEHLER ${s.buildingId}: ${error.message}`
            );

                break;
            }

            progress(
                `Erweiterungen: ${fmt(done)} geändert, ` +
                `${fmt(skipped)} übersprungen`
        );

            render();

            if (!state.stopWrite) {
                await sleep(ACTION_DELAY_MS);
            }
        }

        state.writing = false;
        state.pending = null;

        state.writeLog.push(
            `Beendet: ${fmt(done)} geändert, ` +
            `${fmt(skipped)} übersprungen.`
    );

        progress(
            failed
            ? 'Fehler: Daten bitte vollständig aktualisieren'
            : `Fertig: ${fmt(done)} Erweiterungen geändert`
    );

        render();
    }


    // ==========================================
    // PERSONALVERWALTUNG – VERSION 2.6.0
    // ==========================================

    // ==========================================
    // GEBÄUDETYPEN MIT PERSONALVERWALTUNG
    // ==========================================

    const PERSONNEL_BUILDING_TYPES = new Set([
        0,  // Feuerwache
        2,  // Rettungswache
        5,  // Rettungshubschrauber-Station
        6,  // Polizeiwache
        9,  // THW-Ortsverband
        11, // Bereitschaftspolizei
        12, // Schnelleinsatzgruppe
        13, // Polizeihubschrauberstation
        15, // Wasserrettung
        17, // Polizei-Sondereinheiten
        18, // Feuerwache (Kleinwache)
        19, // Polizeiwache (Kleinwache)
        20, // Rettungswache (Kleinwache)
        21, // Rettungshundestaffel
        24, // Reiterstaffel
        25, // Bergrettungswache
        26, // Seenotrettungswache
        28, // Hubschrauberstation (Seenotrettung)
        29  // Autobahnpolizei
    ]);

    function supportsPersonnel(building) {
        return PERSONNEL_BUILDING_TYPES.has(
            Number(building.typeId ?? building.building_type)
        );
    }

    function personnelRows() {
        const q = low(state.search.trim());

        return state.data.stations
            .filter(s => {
            // Nur Gebäudetypen mit Personalverwaltung
            if (!supportsPersonnel(s)) return false;

            if (
                state.personnelCenter !== 'all' &&
                s.center !== state.personnelCenter
            ) return false;

            if (
                state.personnelType !== 'all' &&
                s.typeId !== state.personnelType
            ) return false;

            const target = Number(state.personnelTarget);

            if (state.personnelFilter === 'different' &&
                s.personalTarget === target) return false;

            if (state.personnelFilter === 'missing' &&
                Number(s.personalTarget) > 0) return false;

            if (state.personnelFilter === 'under' &&
                !(Number.isFinite(s.personalTarget) &&
                  s.personalTarget > s.personal)) return false;

            if (state.personnelFilter === 'noauto' &&
                s.hiringAutomatic !== false) return false;

            return !q || [
                s.name, s.type, s.org, s.id
            ].some(x => low(x).includes(q));
        })
            .sort((a, b) =>
                  a.name.localeCompare(b.name, 'de', {
            numeric: true
        })
                 );
    }

    function personnelPremium() {
        // Tampermonkey kann ein isoliertes window bereitstellen.
        if (typeof unsafeWindow !== 'undefined' &&
            typeof unsafeWindow.user_premium === 'boolean') {
            return unsafeWindow.user_premium;
        }

        if (typeof window.user_premium === 'boolean') {
            return window.user_premium;
        }

        return null; // Unbekannt, nicht automatisch "kein Premium"
    }

    function personnelSelect(id, value, options) {
        return `
            <select id="${id}">
                ${options.map(([v, label]) => `
                    <option value="${esc(v)}"
                        ${String(v) === String(value)
                              ? 'selected' : ''}>
                        ${esc(label)}
                    </option>
                `).join('')}
            </select>
        `;
    }

    function personnelView() {
        const rows = personnelRows();

        const validTarget =
              Number.isSafeInteger(Number(state.personnelTarget)) &&
              Number(state.personnelTarget) > 0;

        const needTarget = rows.filter(s =>
                                       validTarget &&
                                       s.personalTarget !== Number(state.personnelTarget)
                                      );

        const needAuto = rows.filter(s =>
                                     s.hiringAutomatic === false &&
                                     Number(s.personalTarget) > 0
                                    );

        const premium = personnelPremium();

        const disabled =
              state.writing ||
              state.loading ||
              state.pending ||
              state.personnelPending ||
              state.writeNeedsRefresh ||
              (typeof v24Busy !== 'undefined' && v24Busy);

        const types = [
            ...new Map(
                state.data.stations
                .filter(s => s.typeId !== '7')
                .map(s => [s.typeId, s.type])
            ).entries()
        ].sort((a, b) => a[1].localeCompare(b[1], 'de'));

        const centers = state.data.centers
        .slice()
        .sort((a, b) =>
              a.name.localeCompare(b.name, 'de')
             )
        .map(c => [c.id, c.name]);

        const { items, pageCtl } = pageRows(rows);

        const pending = state.personnelPending;

        return `
            <h3>Personalverwaltung</h3>

            <div class="notice">
                Personalziel und automatische Werbung
                für einzelne oder mehrere Wachen verwalten.
                Die Änderungen werden nach jeder Aktion
                vom Server überprüft.
            </div>

            <div class="toolbar" style="margin:12px 0">
                <label>
                    Leitstellenbereich:
                    ${personnelSelect(
            'lssstat-personnel-center',
            state.personnelCenter,
            [['all', 'Alle Leitstellen'], ...centers]
        )}
                </label>

                <label>
                    Gebäudetyp:
                    ${personnelSelect(
            'lssstat-personnel-type',
            state.personnelType,
            [['all', 'Alle Gebäudetypen'], ...types]
        )}
                </label>

                <label>
                    Anzeigen:
                    ${personnelSelect(
            'lssstat-personnel-filter',
            state.personnelFilter,
            [
                ['all', 'Alle Wachen'],
                ['different', 'Soll weicht vom Eingabewert ab'],
                ['missing', 'Kein Personal-Soll'],
                ['under', 'Personal unter aktuellem Soll'],
                ['noauto', 'Automatische Werbung aus']
            ]
        )}
                </label>
            </div>

            <div class="toolbar" style="margin:12px 0">
                <label>
                    Gewünschtes Personal-Soll:
                    <input
                        id="lssstat-personnel-target"
                        type="number"
                        min="1"
                        step="1"
                        value="${esc(state.personnelTarget)}"
                        style="width:110px"
                    >
                </label>

                <button
                    id="lssstat-personnel-bulk-target"
                    ${disabled || !validTarget ||
            !needTarget.length ? 'disabled' : ''}
                >
                    ${fmt(needTarget.length)}
                    Personalziele anpassen
                </button>

                <button
                    id="lssstat-personnel-bulk-auto"
                    ${disabled || premium !== true ||
            !needAuto.length ? 'disabled' : ''}
                >
                    ${fmt(needAuto.length)}
                    automatische Werbungen starten
                </button>

<label>
    Werbedauer:
    ${personnelSelect(
            'lssstat-personnel-phase',
            state.personnelPhase,
            [
                ['1', '1 Tag'],
                ['2', '2 Tage'],
                ['3', '3 Tage']
            ]
        )}
</label>

<button
    id="lssstat-personnel-bulk-phase"
    ${disabled || !rows.some(s =>
                             s.hiringAutomatic === false &&
                             s.hiringPhase === 0
                            ) ? 'disabled' : ''}
>
    Werbephase bei ${fmt(rows.filter(s =>
                                     s.hiringAutomatic === false &&
                                     s.hiringPhase === 0
                                    ).length)} Wachen starten
</button>

            </div>

            <div class="notice">
                <b>${fmt(rows.length)}</b> Wachen gefunden ·
                <b>${fmt(needTarget.length)}</b>
                abweichende Personalziele ·
                <b>${fmt(needAuto.length)}</b>
                Wachen mit Soll, aber ohne Werbeautomatik.

                <div class="muted"
                    style="font-size:14px;margin-top:6px">
                    Premium:
                    ${premium === true
            ? 'Aktiv'
        : premium === false
            ? 'Nicht aktiv'
        : 'Nicht ermittelbar'}
                    · Die Massenaktionen gelten für alle
                    gefilterten Wachen, nicht nur die aktuelle Seite.
                </div>
            </div>

            ${state.personnelMessage ? `
                <div class="notice">
                    ${esc(state.personnelMessage)}
                </div>
            ` : ''}

            ${pending ? `
                <div class="confirmbox">
                    <h3>Personaländerungen bestätigen</h3>

                    <p>
                        ${pending.action === 'target'
            ? `Personal-Soll von
       <b>${fmt(pending.ids.length)}</b>
       Wachen auf
       <b>${fmt(pending.value)}</b> setzen.`
    : pending.action === 'auto'
            ? `Automatische Werbung bei
           <b>${fmt(pending.ids.length)}</b>
           Wachen einschalten.`
        : `Manuelle Personalwerbung für
           <b>${fmt(pending.ids.length)}</b>
           Wachen für
           <b>${pending.value} Tage</b> starten.`}
                    </p>

                    <p class="muted">
                        Die Auswahl ist eingefroren.
                        Bereits passende Serverzustände
                        werden übersprungen.
                    </p>

                    <div class="actions">
                        <button id="lssstat-personnel-cancel">
                            Abbrechen
                        </button>

                        <button
                            class="primary"
                            id="lssstat-personnel-confirm"
                        >
                            Änderungen durchführen
                        </button>
                    </div>
                </div>
            ` : ''}

            ${table(
            [
                ['Wache'],
                ['Gebäudetyp'],
                ['Personal Ist / Soll', true],
                ['Werbung'],
                ['Aktionen']
            ],

            items.map(s => {
                const target = s.personalTarget;
                const phase = s.hiringPhase;

                return `
                        <tr>
                            <td>${hrefB(s)}</td>

                            <td>${esc(s.type)}</td>

                            <td class="num">
                                ${fmt(s.personal)} /
                                ${target == null
                    ? '—'
                : fmt(target)}
                            </td>

                            <td>
                                ${s.hiringAutomatic === true
                    ? 'Automatisch'
                : s.hiringAutomatic === false
                    ? 'Nicht automatisch'
                : 'Unbekannt'}

                                <div class="muted"
                                    style="font-size:14px">
                                    Phase:
                                    ${phase == null
                    ? '—'
                : esc(phase)}
                                </div>
                            </td>

                            <td>
                                <div class="actions">
                                    <button
                                        data-person-target="${esc(s.id)}"
                                        ${disabled || !validTarget ||
                    s.personalTarget ===
                    Number(state.personnelTarget)
                    ? 'disabled' : ''}
                                    >
                                        Soll setzen
                                    </button>

                                    <button
                                        data-person-auto="${esc(s.id)}"
                                        ${disabled ||
                    premium !== true ||
                    s.hiringAutomatic !== false ||
                    !(Number(s.personalTarget) > 0)
                    ? 'disabled' : ''}
                                    >
                                        Automatik starten
                                    </button>

<button
    data-person-phase="${esc(s.id)}"
    ${disabled ||
                    s.hiringAutomatic !== false ||
                    s.hiringPhase !== 0
                    ? 'disabled' : ''}
>
    ${state.personnelPhase} Tage werben
</button>

                                </div>
                            </td>
                        </tr>
                    `;
            }).join(''),

            ['26%', '18%', '16%', '16%', '24%']
        )}

            ${pageCtl}
        `;
    }


    function personnelPrepare(action, ids) {
        if (
            state.writing ||
            state.loading ||
            state.pending ||
            state.personnelPending ||
            state.writeNeedsRefresh
        ) return;

        if (!['target', 'auto', 'phase'].includes(action)) {
            return;
        }

        if (
            action === 'auto' &&
            personnelPremium() !== true
        ) {
            state.personnelMessage =
                'Premiumstatus nicht bestätigt.';
            render();
            return;
        }

        const target = Number(state.personnelTarget);
        const phase = Number(state.personnelPhase);

        if (
            action === 'target' &&
            (!Number.isSafeInteger(target) || target <= 0)
        ) {
            state.personnelMessage =
                'Bitte ein gültiges Personalziel eingeben.';
            render();
            return;
        }

        if (
            action === 'phase' &&
            ![1, 2, 3].includes(phase)
        ) {
            state.personnelMessage =
                'Bitte eine Werbedauer von 1 bis 3 Tagen wählen.';
            render();
            return;
        }

        const allowed = new Set(
            personnelRows().map(s => s.id)
        );

        const selected = [...new Set(ids)]
        .filter(id => allowed.has(id))
        .filter(id => {
            const s = state.data.byBuilding.get(id);

            if (!s || !supportsPersonnel(s)) {
                return false;
            }

            if (action === 'target') {
                return s.personalTarget !== target;
            }

            if (action === 'auto') {
                return s.hiringAutomatic === false &&
                    Number(s.personalTarget) > 0;
            }

            // Eine laufende oder automatische
            // Personalwerbung nicht überschreiben.
            return s.hiringAutomatic === false &&
                s.hiringPhase === 0;
        });

        if (!selected.length) return;

        state.personnelPending = {
            action,
            ids: selected,
            value:
            action === 'target' ? target :
            action === 'phase' ? phase : null
        };

        render();
        $('#lssstat-content').scrollTop = 0;
    }


    async function personnelServerBuilding(id) {
        const response = await fetch(
            `/api/buildings/${encodeURIComponent(id)}`,
            {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            }
        );

        if (!response.ok) {
            throw Error(`Gebäude-API: HTTP ${response.status}`);
        }

        const data = await response.json();
        const building = data.result ?? data;

        if (String(building.id) !== String(id)) {
            throw Error('Falsche Gebäude-ID zurückgegeben');
        }

        return building;
    }

    async function personnelWriteTarget(id, target) {
        const token = document.querySelector(
            'meta[name="csrf-token"]'
        )?.content;

        if (!token) throw Error('CSRF-Token fehlt');

        const body = new URLSearchParams({
            utf8: '✓',
            _method: 'put',
            authenticity_token: token,
            'building[personal_count_target]': String(target)
        });

        const response = await fetch(
            `/buildings/${encodeURIComponent(id)}` +
            '?personal_count_target_only=1',
            {
                method: 'POST',
                credentials: 'same-origin',
                redirect: 'follow',
                headers: {
                    'Content-Type':
                    'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-CSRF-Token': token,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body
            }
        );

        if (
            !response.ok ||
            new URL(response.url).pathname.includes('sign_in')
        ) {
            throw Error(
                `Personalziel speichern: HTTP ${response.status}`
            );
        }
    }

    async function personnelWritePhase(id, days) {
        const numericId = Number(id);

        if (
            !Number.isSafeInteger(numericId) ||
            numericId <= 0 ||
            ![1, 2, 3].includes(days)
        ) {
            throw new Error(
                'Ungültige Gebäude-ID oder Werbedauer'
            );
        }

        // Spielinterne Aktion zum Start einer
        // manuellen Personalwerbephase.
        const response = await fetch(
            `/buildings/${numericId}/hire_do/${days}`,
            {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                redirect: 'follow'
            }
        );

        if (
            !response.ok ||
            new URL(response.url)
            .pathname.includes('sign_in')
        ) {
            throw new Error(
                `Werbephase konnte nicht gestartet werden: ` +
                `HTTP ${response.status}`
        );
        }
    }

    async function personnelWriteAuto(id) {
        if (personnelPremium() !== true) {
            throw Error('Premiumstatus nicht bestätigt');
        }

        const response = await fetch(
            `/buildings/${encodeURIComponent(id)}/hire_do/automatic`,
            {
                credentials: 'same-origin',
                cache: 'no-store',
                redirect: 'follow'
            }
        );

        if (
            !response.ok ||
            new URL(response.url).pathname.includes('sign_in')
        ) {
            throw Error(
                `Automatische Werbung: HTTP ${response.status}`
            );
        }
    }


    async function personnelConfirm() {
        const plan = state.personnelPending;

        if (
            !plan ||
            state.writing ||
            state.loading ||
            !['target', 'auto', 'phase'].includes(plan.action)
        ) return;

        if (
            plan.action === 'auto' &&
            personnelPremium() !== true
        ) {
            state.personnelPending = null;
            state.personnelMessage =
                'Premiumstatus nicht bestätigt.';
            render();
            return;
        }

        if (
            plan.action === 'phase' &&
            ![1, 2, 3].includes(plan.value)
        ) {
            state.personnelPending = null;
            state.personnelMessage =
                'Ungültige Werbedauer.';
            render();
            return;
        }

        state.personnelPending = null;
        state.writing = true;
        state.stopWrite = false;
        state.writeLog = [];
        state.personnelMessage = '';

        let changed = 0;
        let skipped = 0;
        let failed = false;

        render();

        for (const id of plan.ids) {
            if (state.stopWrite) break;

            try {
                const local =
                      state.data.byBuilding.get(String(id));

                if (!local) {
                    throw new Error('Wache nicht gefunden');
                }

                if (!supportsPersonnel(local)) {
                    throw new Error(
                        'Dieser Gebäudetyp unterstützt keine ' +
                        'Personalverwaltung. Aktion abgebrochen.'
                    );
                }

                // Vor jedem Schreibzugriff den tatsächlichen
                // Serverzustand kontrollieren.
                const server = await personnelServerBuilding(id);

                let skip = false;

                if (plan.action === 'target') {
                    const current = server.personal_count_target;

                    if (
                        current == null ||
                        !Number.isFinite(Number(current))
                    ) {
                        throw new Error(
                            'Personalziel nicht auslesbar'
                        );
                    }

                    if (Number(current) === plan.value) {
                        skip = true;
                    } else {
                        await personnelWriteTarget(
                            id,
                            plan.value
                        );
                    }

                } else if (plan.action === 'auto') {
                    if (
                        typeof server.hiring_automatic !== 'boolean'
                    ) {
                        throw new Error(
                            'Werbeautomatik nicht auslesbar'
                        );
                    }

                    if (server.hiring_automatic === true) {
                        skip = true;
                    } else {
                        if (
                            !(Number(server.personal_count_target) > 0)
                        ) {
                            throw new Error(
                                'Kein Personalziel konfiguriert'
                            );
                        }

                        await personnelWriteAuto(id);
                    }

                } else if (plan.action === 'phase') {
                    const current = Number(server.hiring_phase);

                    if (
                        server.hiring_phase == null ||
                        !Number.isInteger(current) ||
                        ![0, 1, 2, 3].includes(current) ||
                        typeof server.hiring_automatic !== 'boolean'
                    ) {
                        throw new Error(
                            'Werbezustand nicht eindeutig auslesbar'
                        );
                    }

                    if (
                        server.hiring_automatic === true ||
                        current !== 0
                    ) {
                        // Automatische oder laufende manuelle
                        // Werbung nicht überschreiben.
                        skip = true;
                    } else {
                        await personnelWritePhase(
                            id,
                            plan.value
                        );
                    }
                }

                // Serverzustand erneut prüfen.
                // Auch bei übersprungenen Datensätzen wird
                // das lokale Modell aktualisiert.
                let verified = false;
                let confirmed = null;

                for (let attempt = 0; attempt < 5; attempt++) {
                    if (!skip) await sleep(450);

                    const check =
                          await personnelServerBuilding(id);

                    let matches = false;

                    if (plan.action === 'target') {
                        matches =
                            Number(check.personal_count_target) ===
                            plan.value;

                    } else if (plan.action === 'auto') {
                        matches =
                            check.hiring_automatic === true;

                    } else {
                        // Falls inzwischen eine andere Werbung
                        // läuft, ist ein übersprungener Datensatz
                        // ebenfalls ein gültiger Zustand.
                        matches = skip ||
                            (
                            check.hiring_automatic === false &&
                            Number(check.hiring_phase) ===
                            plan.value
                        );
                    }

                    if (matches) {
                        verified = true;
                        confirmed = check;
                        break;
                    }

                    if (skip) break;
                }

                if (!verified) {
                    throw new Error(
                        'Server hat den Zielzustand ' +
                        'nicht bestätigt'
                    );
                }

                if (
                    confirmed.personal_count_target != null &&
                    Number.isFinite(
                        Number(confirmed.personal_count_target)
                    )
                ) {
                    local.personalTarget =
                        Number(confirmed.personal_count_target);
                }

                if (
                    typeof confirmed.hiring_automatic === 'boolean'
                ) {
                    local.hiringAutomatic =
                        confirmed.hiring_automatic;
                }

                if (
                    confirmed.hiring_phase != null &&
                    Number.isInteger(
                        Number(confirmed.hiring_phase)
                    )
                ) {
                    local.hiringPhase =
                        Number(confirmed.hiring_phase);
                }

                if (skip) {
                    skipped++;
                } else {
                    changed++;
                }

                state.writeLog.push(
                    `${skip ? 'ÜBERSPRUNGEN' : 'OK'}: ` +
                    `${local.name} (${id})`
            );

            } catch (error) {
                failed = true;
                state.stopWrite = true;
                state.writeNeedsRefresh = true;

                state.writeLog.push(
                    `FEHLER ${id}: ${error.message}`
            );

                console.error(
                    '[LSS Personalverwaltung]',
                    error
                );

            } finally {
                progress(
                    `Personal: ${fmt(changed)} geändert, ` +
                    `${fmt(skipped)} übersprungen`
            );

                render();
            }

            if (!state.stopWrite) {
                await sleep(ACTION_DELAY_MS);
            }
        }

        state.writing = false;

        state.personnelMessage = failed
            ? 'Aktion bei einem Fehler angehalten. ' +
            'Bitte Daten vollständig neu laden.'
        : state.stopWrite
            ? `${fmt(changed)} Änderungen durchgeführt; ` +
            'Aktion abgebrochen.'
        : `${fmt(changed)} erfolgreich geändert, ` +
            `${fmt(skipped)} übersprungen.`;

        render();
    }


    // ==========================================
    // HAUPTANSICHT
    // ==========================================

    function render() {
        const content = $('#lssstat-content');

        $('.tabs').innerHTML = tabs.map(
            ([id, n]) => `
       <button
         data-tab="${id}"
         class="${state.tab === id ? 'active' : ''}"
         ${state.writing ? 'disabled' : ''}
       >${n}</button>
     `
   ).join('');

        $('#lssstat-export').disabled =
            !state.data ||
            state.tab === 'overview' ||
            state.writing;

        $('#lssstat-load').disabled =
            state.loading ||
            state.writing;

        if (!state.data) {
            content.innerHTML = `
       <div class="notice">
         Klicke auf „Daten laden / aktualisieren“.
       </div>
     `;

            bind();
            return;
        }

        const d = state.data;

        let html = d.warnings.map(w => `
     <div class="notice">
       ${esc(w)}
     </div>
   `).join('');

        if (state.writing) {
            html += `
       <div class="notice">
         Änderungen laufen …
         <button id="lssstat-stop">
           Nach aktueller Anfrage stoppen
         </button>
       </div>
     `;
        }

        if (state.writeLog.length) {
            html += `
       <details>
         <summary>
           Änderungsprotokoll
           (${state.writeLog.length})
         </summary>
         <pre>${esc(
                state.writeLog.slice(-100).join('\n')
            )}</pre>
       </details>
     `;
        }

        if (state.pending) {
            html += writeDialog();
        }
        // Personalverwaltung
        if (state.tab === 'personnel') {
            html += personnelView();
            html = html.replace(
                '<div class="tablebox">',
                '<div class="tablebox lssstat-personnel-table">'
            );

            // Gebäudetyp-Detailansicht
        } else if (
            state.tab === 'buildingtypes' &&
            state.detail?.kind === 'building'
        ) {
            html += buildingTypeDetail();
            // Gebäudetyp-Detailansicht
        } else if (
            state.tab === 'buildingtypes' &&
            state.detail?.kind === 'building'
        ) {
            html += buildingTypeDetail();

            // Fahrzeugdetailansicht
        } else if (
            state.tab === 'vehicletypes' &&
            state.detail?.kind === 'vehicle'
        ) {
            html += vehicleDetail();

            // Erweiterungsdetailansicht
        } else if (
            state.tab === 'extensions' &&
            state.detail?.kind === 'extension'
        ) {
            html += extDetail();

            // Hauptübersicht
        } else if (state.tab === 'overview') {
            html += `
       <div class="notice">
         Stand:
         ${esc(d.loadedAt.toLocaleString('de-DE'))}.
         Alle Werte sind eine Momentaufnahme.
       </div>

       <div class="metrics">
         ${[
                ['Gebäude', d.buildings],
                ['Fahrzeuge', d.vehicles],
                ['Fahrzeugtypen', d.vehicleByType.size],
                ['Leitstellenbereiche', d.centers.length]
            ].map(([name, n]) => `
           <div class="metric">
             ${name}
             <strong>${fmt(n)}</strong>
           </div>
         `).join('')}
       </div>
     `;

            for (
                const [title, group] of [
                    [
                        'Gebäude nach Organisation',
                        d.groups.building
                    ],
                    [
                        'Fahrzeuge nach Organisation ihrer Wache',
                        d.groups.vehicle
                    ]
                ]
            ) {
                html += `
         <h3>${title}</h3>
       ` + table(
                    [
                        ['Organisation'],
                        ['Anzahl', true]
                    ],
                    sorted(group).map(([name, n]) => `
           <tr>
             <td>${esc(name)}</td>
             <td class="num">${fmt(n)}</td>
           </tr>
         `).join(''),
                    ['75%', '25%']
                );
            }

        } else if (state.tab === 'extensions') {
            html += extOverview();

        } else {
            // Diagramme
            if (
                ['buildingtypes', 'vehicletypes'].includes(
                    state.tab
                )
            ) {
                html += charts();
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

            rows = filter(rows);

            const { items, pageCtl } = pageRows(rows);

            html += `
       <div class="notice">
         ${fmt(rows.length)} Einträge ·
         ${PAGE_ROWS} pro Seite ·
         Stand:
         ${esc(d.loadedAt.toLocaleString('de-DE'))}
       </div>
     `;

            // ======================================
            // GEBÄUDETYPEN
            // ======================================


            // ======================================
            // GEBÄUDETYPEN
            // ======================================

            if (state.tab === 'buildingtypes') {
                let body = '';

                for (const r of items) {
                    const can = [
                        'fire',
                        'rescue',
                        'police'
                    ].includes(r.key);

                    const open = state.openB.has(r.key);

                    const stations = d.stations.filter(
                        s => s.familyKey === r.key
                    );

                    const active = list =>
                    list.filter(s => s.enabled === true).length;

                    const cells = (p, list) => `
                        <td class="num">
                            ${fmt(p.count)}
                        </td>

                        <td class="num">
                            ${fmt(active(list))} / ${fmt(p.count)}
                        </td>

                        <td class="num">
                            ${fmt(p.vehicles)}
                        </td>

                        <td class="num">
                            ${fmt(p.personal)}
                        </td>

                        <td class="num">
                            ${fmt(p.active)} / ${fmt(p.bought)}
                        </td>
                    `;

                    body += `
    <tr>
        <td>
            ${can ? `
                <button
                   class="linkbtn"
                    data-building="${esc(r.key)}"
                    title="Normal- und Kleinwachen aufklappen"
                >
                    ${open ? '▾' : '▸'} ${esc(r.name)}
                </button>

                <button
                    class="lssstat-detail-btn"
                    data-building-detail="${esc(r.key)}"
                    title="Alle einzelnen Wachen anzeigen"
                >
                    Wachen anzeigen
                </button>
            ` : `
                <button
                    class="linkbtn"
                    data-building-detail="${esc(r.key)}"
                >
                    ${esc(r.name)}
                </button>
            `}
        </td>

        ${cells(r, stations)}
    </tr>
`;


                    if (can && open) {
                        for (const [key, label] of [
                            ['normal', 'normal'],
                            ['small', 'Kleinwache']
                        ]) {
                            const part = stations.filter(
                                s => s.small === (key === 'small')
                            );

                            body += `
                                <tr class="subrow">
                                    <td class="indent">
                                        ↳ ${esc(label)}
                                    </td>

                                    ${cells(r[key], part)}
                                </tr>
                            `;
                        }
                    }
                }

                html += table(
                    [
                        ['Gebäudetyp'],
                        ['Gebäude', true],
                        ['Aktiv / Gesamt', true],
                        ['Fahrzeuge', true],
                        ['Personal', true],
                        ['Erweiterungen Aktiv / Gekauft', true]
                    ],

                    body,

                    ['29%','10%','15%','11%','12%','23%']
                );
            }



            // ======================================
            // FAHRZEUGTYPEN
            // ======================================

            if (state.tab === 'vehicletypes') {
                html += table(
                    [
                        ['Fahrzeugtyp'],
                        ['Gesamt', true],
                        ['Status 2', true],
                        ['Status 6', true],
                        ['Ø je Wache', true]
                    ],

                    items.map(r => `
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

             <td class="num">
               ${fmt(r.status2)}
             </td>

             <td class="num">
               ${fmt(r.status6)}
             </td>

             <td class="num">
               ${r.avg === null
                              ? '—'
                              : r.avg.toLocaleString('de-DE', {
                        maximumFractionDigits: 2
                    })}
             </td>
           </tr>
         `).join(''),

                    ['39%', '14%', '14%', '14%', '19%']
                );
            }

            // ======================================
            // EINZELNE WACHEN
            // ======================================


            if (state.tab === 'stations') {
                html += table(
                    [
                        ['Wache'],
                        ['Gebäudetyp'],
                        ['Organisation'],
                        ['Fahrzeuge', true],
                        ['Personal Ist / Soll', true],
                        ['Personalwerbung'],
                        ['Zusammensetzung']
                    ],

                    items.map(r => {
                        const target =
                              r.personalTarget === null ||
                              !Number.isFinite(r.personalTarget)
                        ? '—'
                        : fmt(r.personalTarget);

                        const hiring =
                              r.hiringAutomatic === true
                        ? 'Automatisch'
                        : r.hiringAutomatic === false
                        ? 'Manuell'
                        : 'Unbekannt';

                        const phase =
                              r.hiringPhase !== null &&
                              Number.isInteger(r.hiringPhase) &&
                              r.hiringPhase >= 0 &&
                              r.hiringPhase <= 3
                        ? `Phase ${r.hiringPhase}`
                    : 'Phase unbekannt';

                        return `
                <tr>
                    <td>${hrefB(r)}</td>

                    <td>
                        ${esc(r.type)}
                        ${r.small
                            ? ' (Kleinwache)'
                        : ''}
                    </td>

                    <td>${esc(r.org)}</td>

                    <td class="num">
                        ${fmt(r.count)}
                    </td>

                    <td class="num">
                        ${fmt(r.personal)} / ${target}
                    </td>

                    <td>
                        <div>${hiring}</div>
                        <div class="muted"
                            style="font-size:14px">
                            ${phase}
                        </div>
                    </td>

                    <td>
                        ${detailEntries(
                            r.byType,
                            'Fahrzeuge'
                        )}
                    </td>
                </tr>
            `;
                    }).join(''),

                    ['19%','13%','9%','7%','13%','17%','22%']
                );
            }


            // ======================================
            // LEITSTELLENBEREICHE
            // ======================================

            if (state.tab === 'centers') {
                html += table(
                    [
                        ['Leitstellenbereich'],
                        ['Gebäude', true],
                        ['Fahrzeuge', true],
                        ['Zusammensetzung']
                    ],

                    items.map(r => `
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
               ${fmt(r.vehicles)}
             </td>

             <td>
               ${detailEntries(
                        r.byBuilding,
                        'Gebäude'
                    )}

               ${detailEntries(
                        r.byVehicle,
                        'Fahrzeuge'
                    )}
             </td>
           </tr>
         `).join(''),

                    ['41%', '14%', '14%', '31%']
                );
            }

            html += pageCtl;
        }

        content.innerHTML = html;
        bind();
    }

    // ==========================================
    // BUTTONS UND INTERAKTIONEN
    // ==========================================

    function bind() {
        const c = $('#lssstat-content');

        // ==========================================
        // PERSONALVERWALTUNG – INTERAKTIONEN
        // ==========================================

        for (const [selector, property] of [
            ['#lssstat-personnel-center', 'personnelCenter'],
            ['#lssstat-personnel-type', 'personnelType'],
            ['#lssstat-personnel-filter', 'personnelFilter']
        ]) {
            c.querySelector(selector)
                ?.addEventListener('change', event => {
                state[property] = event.target.value;
                state.page = 0;
                state.personnelPending = null;
                render();
            });
        }

        c.querySelector('#lssstat-personnel-target')
            ?.addEventListener('change', event => {
            const value = Number(event.target.value);

            if (!Number.isSafeInteger(value) || value <= 0) {
                state.personnelMessage =
                    'Personalziel muss eine positive ganze Zahl sein.';
                render();
                return;
            }

            state.personnelTarget = value;
            state.personnelMessage = '';
            state.personnelPending = null;
            state.page = 0;
            render();
        });

        // Gewünschte Werbedauer ändern
        c.querySelector('#lssstat-personnel-phase')
            ?.addEventListener('change', event => {
            state.personnelPhase =
                Number(event.target.value);

            state.personnelPending = null;
            render();
        });

        // Manuelle Werbephase für alle gefilterten
        // geeigneten Wachen vorbereiten
        c.querySelector('#lssstat-personnel-bulk-phase')
            ?.addEventListener('click', () => {
            personnelPrepare(
                'phase',
                personnelRows().map(s => s.id)
            );
        });

        // Einzelne manuelle Werbephase starten
        c.querySelectorAll('[data-person-phase]')
            .forEach(button => {
            button.onclick = () => {
                personnelPrepare(
                    'phase',
                    [button.dataset.personPhase]
                );
            };
        });


        c.querySelector('#lssstat-personnel-bulk-target')
            ?.addEventListener('click', () => {
            personnelPrepare(
                'target',
                personnelRows().map(s => s.id)
            );
        });

        c.querySelector('#lssstat-personnel-bulk-auto')
            ?.addEventListener('click', () => {
            personnelPrepare(
                'auto',
                personnelRows().map(s => s.id)
            );
        });

        // Einzelaktionen pro Wache
        c.querySelectorAll('[data-person-target]')
            .forEach(button => {
            button.onclick = () => {
                personnelPrepare(
                    'target',
                    [button.dataset.personTarget]
                );
            };
        });

        c.querySelectorAll('[data-person-auto]')
            .forEach(button => {
            button.onclick = () => {
                personnelPrepare(
                    'auto',
                    [button.dataset.personAuto]
                );
            };
        });

        // Bestätigungsdialog
        c.querySelector('#lssstat-personnel-confirm')
            ?.addEventListener('click', personnelConfirm);

        c.querySelector('#lssstat-personnel-cancel')
            ?.addEventListener('click', () => {
            state.personnelPending = null;
            render();
        });

        $('.tabs')
            .querySelectorAll('[data-tab]')
            .forEach(b => {
            b.onclick = () => {
                state.tab = b.dataset.tab;
                state.detail = null;
                state.pending = null;
                state.buildingBulkPending = null;
                state.personnelPending = null;
                state.page = 0;
                clearSearch();
                render();
            };
        });
        c.querySelector('#lssstat-detail-status')
            ?.addEventListener('change', e => {
            state.detailStatus = e.target.value;
            state.page = 0;
            render();
        });

        c.querySelector('#lssstat-detail-sort')
            ?.addEventListener('change', e => {
            state.detailSort = e.target.value;
            state.page = 0;
            render();
        });
        c.querySelector('#lssstat-charts')
            ?.addEventListener('click', () => {
            state.charts = !state.charts;
            render();
        });

        c.querySelectorAll('[data-mode]')
            .forEach(b => {
            b.onclick = () => {
                state.mode = b.dataset.mode;
                render();
            };
        });

        c.querySelectorAll('[data-step]')
            .forEach(b => {
            b.onclick = () => {
                state.page += Number(b.dataset.step);
                render();
                c.scrollTop = 0;
            };
        });
        c.querySelectorAll('[data-page]').forEach(button => {
            button.onclick = () => {
                state.page = Number(button.dataset.page);
                render();
                c.scrollTop = 0;
            };
        });

        // ==========================================
        // GEBÄUDETYP-DETAILANSICHT – INTERAKTIONEN
        // ==========================================

        // Gebäudetyp öffnen
        c.querySelectorAll('[data-building-detail]')
            .forEach(b => {
            b.onclick = () => {
                state.detail = {
                    kind: 'building',
                    id: b.dataset.buildingDetail,
                    name: b.textContent.trim()
                };

                state.page = 0;
                state.buildingCenter = 'all';
                state.buildingStatus = 'all';
                state.buildingSize = 'all';
                state.buildingBulkPending = null;

                clearSearch();
                render();
            };
        });

        // Filter in der Gebäudetyp-Detailansicht
        for (const [selector, property] of [
            ['#lssstat-building-center', 'buildingCenter'],
            ['#lssstat-building-status', 'buildingStatus'],
            ['#lssstat-building-size', 'buildingSize']
        ]) {
            c.querySelector(selector)
                ?.addEventListener('change', e => {
                state[property] = e.target.value;
                state.page = 0;
                state.buildingBulkPending = null;
                render();
            });
        }

        // Massenaktion vorbereiten
        c.querySelectorAll('[data-building-bulk]')
            .forEach(button => {
            button.onclick = () => {
                beginBuildingBulk(
                    button.dataset.buildingBulk === 'on'
                );
            };
        });

        // Massenaktion abbrechen, bevor sie startet
        c.querySelector('#lssstat-building-cancel')
            ?.addEventListener('click', () => {
            state.buildingBulkPending = null;
            render();
        });

        // Bestätigte Massenaktion starten
        c.querySelector('#lssstat-building-confirm')
            ?.addEventListener(
            'click',
            executeBuildingBulk
        );

        // Kleinwachen aufklappen
        c.querySelectorAll('[data-building]')
            .forEach(b => {
            b.onclick = () => {
                const k = b.dataset.building;

                if (state.openB.has(k)) {
                    state.openB.delete(k);
                } else {
                    state.openB.add(k);
                }

                render();
            };
        });

        // Erweiterungen aufklappen
        c.querySelectorAll('[data-expand]')
            .forEach(b => {
            b.onclick = () => {
                const k = b.dataset.expand;

                if (state.openE.has(k)) {
                    state.openE.delete(k);
                } else {
                    state.openE.add(k);
                }

                render();
            };
        });

        // Fahrzeugtyp öffnen
        c.querySelectorAll('[data-vehicle]')
            .forEach(b => {
            b.onclick = () => {
                state.detail = {
                    kind: 'vehicle',
                    id: b.dataset.vehicle,
                    name: b.textContent.trim()
                };

                state.page = 0;
                clearSearch();
                state.detailStatus = 'all';
                state.detailSort = 'name';
                render();
            };
        });

        // Erweiterung öffnen
        c.querySelectorAll('[data-extension]')
            .forEach(b => {
            b.onclick = () => {
                state.detail = {
                    kind: 'extension',
                    id: b.dataset.extension
                };

                state.page = 0;
                clearSearch();
                state.detailStatus = 'all';
                state.detailSort = 'name';
                render();
            };
        });

        c.querySelector('#lssstat-back')
            ?.addEventListener('click', () => {
            state.detail = null;
            state.pending = null;
            state.buildingBulkPending = null;
            state.page = 0;
            clearSearch();
            render();
        });

        // Leitstellenfilter
        c.querySelector('#lssstat-center')
            ?.addEventListener('change', e => {
            state.center = e.target.value;
            state.page = 0;
            state.pending = null;
            render();
        });

        const ex =
              state.detail?.kind === 'extension'
        ? selectedExtensions().find(
            x => x.key === state.detail.id
        )
        : null;

        // Sammelaktionen direkt in der Erweiterungsübersicht
        c.querySelectorAll('[data-row-bulk]').forEach(button => {
            button.onclick = () => {
                if (
                    state.writing ||
                    state.writeNeedsRefresh ||
                    state.pending
                ) {
                    return;
                }

                const extension = selectedExtensions().find(
                    x => x.key === button.dataset.rowExtension
                );

                if (!extension) {
                    console.warn(
                        '[LSS Statistik] Erweiterung nicht gefunden'
                    );
                    return;
                }

                const activate =
                      button.dataset.rowBulk === 'activate';

                beginWrite(
                    extension.sites,
                    activate,
                    `${extension.caption}: Alle ${
                activate ? 'aktivieren' : 'deaktivieren'
                    }`
        );
            };
        });

        // Sammelaktionen vorbereiten
        c.querySelectorAll('[data-bulk]')
            .forEach(b => {
            b.onclick = () => {
                if (!ex) return;

                const activate =
                      b.dataset.bulk === 'activate';

                beginWrite(
                    ex.sites,
                    activate,
                    `${ex.caption}: Alle ${
             activate
                    ? 'aktivieren'
                    : 'deaktivieren'
                    }`
         );
            };
        });

        // Einzelaktionen vorbereiten
        c.querySelectorAll('[data-single]')
            .forEach(b => {
            b.onclick = () => {
                if (!ex) return;

                beginWrite(
                    ex.sites.filter(
                        s =>
                        s.buildingId === b.dataset.single
                    ),
                    b.dataset.target === 'on',
                    `Einzeländerung: ${ex.caption}`
         );
            };
        });

        c.querySelector('#lssstat-write-confirm')
            ?.addEventListener(
            'click',
            executeWrites
        );

        c.querySelector('#lssstat-write-cancel')
            ?.addEventListener('click', () => {
            state.pending = null;
            render();
        });

        c.querySelector('#lssstat-stop')
            ?.addEventListener('click', () => {
            state.stopWrite = true;
            progress(
                'Wird nach aktueller Anfrage angehalten …'
            );
        });

        bindCharts();
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

        if (state.tab === 'buildingtypes') {
            heads = [
                'Gebäudetyp',
                'Gebäude',
                'Fahrzeuge',
                'Personal',
                'Aktiviert',
                'Gekauft',
                'Kleinwachen'
            ];

            rows = filter(familyRows()).map(r => [
                r.name,
                r.count,
                r.vehicles,
                r.personal,
                r.active,
                r.bought,
                r.small.count
            ]);

        } else if (state.tab === 'vehicletypes') {
            if (state.detail?.kind === 'vehicle') {
                heads = [
                    'ID',
                    'Fahrzeug',
                    'Typ',
                    'Status',
                    'Wache'
                ];

                rows = (
                    d.vehicleByType.get(
                        state.detail.id
                    ) || []
                ).map(v => [
                    v.id,
                    v.name,
                    v.type,
                    v.status,
                    d.byBuilding.get(
                        v.buildingId
                    )?.name
                ]);

            } else {
                heads = [
                    'Fahrzeugtyp',
                    'Gesamt',
                    'Status 2',
                    'Status 6',
                    'Durchschnitt je Wache'
                ];

                rows = filter(vehicleRows()).map(r => [
                    r.name,
                    r.count,
                    r.status2,
                    r.status6,
                    r.avg
                ]);
            }

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
                    d.byBuilding.get(s.buildingId)?.name,
                    s.buildingId,
                    s.center,
                    extStatus(s)
                ]);

            } else {
                heads = [
                    'Organisation',
                    'Gebäudetyp',
                    'Erweiterung',
                    'Aktiviert',
                    'Gekauft'
                ];

                rows = extGroups().flatMap(g =>
                                           g.items.map(x => [
                    g.org,
                    g.name,
                    x.caption,
                    x.active,
                    x.bought
                ])
                                          );
            }

        } else if (state.tab === 'stations') {
            heads = [
                'ID',
                'Wache',
                'Gebäudetyp',
                'Kleinwache',
                'Organisation',
                'Personal',
                'Fahrzeuge'
            ];

            rows = filter(d.stations).map(s => [
                s.id,
                s.name,
                s.type,
                s.small ? 'ja' : 'nein',
                s.org,
                s.personal,
                s.vehicles
            ]);

        } else if (state.tab === 'centers') {
            heads = [
                'ID',
                'Leitstelle',
                'Gebäude',
                'Fahrzeuge'
            ];

            rows = filter(d.centers).map(c => [
                c.id,
                c.name,
                c.buildings,
                c.vehicles
            ]);
        }

        const csv = '\ufeff' +
              [heads, ...rows].map(r =>
                                   r.map(x =>
                                         '"' +
                                         String(x ?? '').replace(/"/g, '""') +
                                         '"'
                                        ).join(';')
                                  ).join('\r\n');

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

    // ==========================================================
    // VERSION 2.4.0 – FAHRZEUGE, WACHEN UND LEITSTELLEN
    // Vor dem abschließenden render(); innerhalb der IIFE einfügen.
    // ==========================================================

    const v24Filter = {
        station: 'all',
        stationCenter: 'all',
        center: 'all',
        own: 'all'
    };
    let v24Busy = false;
    let v24NeedsReload = false;
    let v24Message = '';

    // Beide Gebäude-Eigenschaften kommen direkt aus der V2-Antwort.
    const v24OriginalCompile = compile;
    compile = function (buildings, vehicles, bmeta, vmeta) {
        const data = v24OriginalCompile(buildings, vehicles, bmeta, vmeta);

        for (const b of buildings) {
            const station = data.byBuilding.get(String(b.id));
            if (!station) continue;

            station.enabled = typeof b.enabled === 'boolean'
                ? b.enabled : null;

            station.ownMissions =
                typeof b.generate_own_missions === 'boolean'
                ? b.generate_own_missions : null;
        }

        for (const c of data.centers) {
            const station = data.byBuilding.get(String(c.id));
            c.enabled = station?.enabled ?? null;
            c.ownMissions = station?.ownMissions ?? null;
        }

        v24NeedsReload = false;
        v24Message = '';
        return data;
    };

    const v24Bool = value =>
    value === true || value === 'true' ||
          value === '1' || value === 1;

    async function v24JSON(url) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' }
        });

        if (!response.ok) {
            throw Error(`HTTP ${response.status}: ${url}`);
        }

        const data = await response.json();
        return data?.result ?? data;
    }

    async function v24Building(id) {
        const numericId = Number(id);

        if (!Number.isSafeInteger(numericId) || numericId <= 0) {
            throw Error('Ungültige Gebäude-ID');
        }

        const result = await v24JSON(
            `/api/buildings/${numericId}`
        );

        if (String(result?.id) !== String(id)) {
            throw Error(
                'Gebäude-ID der API-Antwort stimmt nicht überein'
            );
        }

        return result;
    }

    async function v24Vehicle(id) {
        const numericId = Number(id);

        if (!Number.isSafeInteger(numericId) || numericId <= 0) {
            throw Error('Ungültige Fahrzeug-ID');
        }

        const result = await v24JSON(
            `/api/vehicles/${numericId}`
        );

        if (String(result?.id) !== String(id)) {
            throw Error(
                'Fahrzeug-ID der API-Antwort stimmt nicht überein'
            );
        }

        const status =
              result.fms_real ?? result.fms ?? result.state;

        if (
            status == null ||
            !Number.isFinite(Number(status))
        ) {
            throw Error('FMS-Status konnte nicht gelesen werden');
        }

        return Number(status);
    }

    async function v24Verify(check, expected) {
        for (let i = 0; i < 4; i++) {
            await sleep(450);

            if (await check() === expected) {
                return true;
            }
        }

        return false;
    }

    // Normales Spielformular laden und nur die gewünschte
    // Checkbox verändern. Alle anderen Felder bleiben erhalten.
    async function v24SubmitBuildingField(
    id, field, target, before
    ) {
        const edit = await fetch(
            `/buildings/${encodeURIComponent(id)}/edit`,
            {
                credentials: 'same-origin',
                cache: 'no-store'
            }
        );

        if (!edit.ok) {
            throw Error(
                `Bearbeitungsseite: HTTP ${edit.status}`
            );
        }

        const html = await edit.text();
        const doc = new DOMParser().parseFromString(
            html, 'text/html'
        );

        const inputs = [...doc.querySelectorAll('input')]
        .filter(input => input.name === field);

        const checkbox = inputs.find(
            input => input.type === 'checkbox'
        );

        const hidden = inputs.find(
            input => input.type === 'hidden'
        );

        const form = checkbox?.form;

        if (!form || !hidden) {
            throw Error(
                'Erwartetes Bearbeitungsformular nicht gefunden'
            );
        }

        const enabledValue = v24Bool(checkbox.value);
        const hiddenValue = v24Bool(hidden.value);

        if (enabledValue === hiddenValue) {
            throw Error('Formularwerte sind nicht eindeutig');
        }

        const formCurrent = checkbox.checked
        ? enabledValue : hiddenValue;

        if (formCurrent !== before) {
            throw Error(
                'Formular und API widersprechen sich. ' +
                'Kein Schreibzugriff.'
            );
        }

        checkbox.checked = enabledValue === target;

        const action = new URL(
            form.getAttribute('action') ||
            `/buildings/${id}`,
            location.origin
        );

        const allowedPath = new RegExp(
            `^/buildings/${id}(?:/edit)?$`
        );

        if (
            action.origin !== location.origin ||
            !allowedPath.test(action.pathname)
        ) {
            throw Error(
                'Unerwartete Formularadresse: ' +
                'Schreibaktion abgebrochen'
            );
        }

        if (form.method.toUpperCase() !== 'POST') {
            throw Error('Unbekannte Formularmethode');
        }

        const token = document.querySelector(
            'meta[name="csrf-token"]'
        )?.content;

        if (!token) {
            throw Error('CSRF-Token fehlt');
        }

        const response = await fetch(
            action.pathname + action.search,
            {
                method: 'POST',
                credentials: 'same-origin',
                redirect: 'follow',
                headers: {
                    'X-CSRF-Token': token
                },
                body: new FormData(form)
            }
        );

        if (
            !response.ok ||
            new URL(response.url)
            .pathname.includes('sign_in')
        ) {
            throw Error(
                `Speichern fehlgeschlagen: HTTP ${response.status}`
            );
    }
    }

    async function v24ChangeBuilding(id, field, target) {
        const local = state.data.byBuilding.get(String(id));

        if (!local) {
            throw Error(
                'Wache/Leitstelle nicht im Statistikmodell'
            );
        }

        if (
            field === 'generate_own_missions' &&
            local.typeId !== '7'
        ) {
            throw Error(
                'Eigener Einsatzbereich ist nur für ' +
                'Leitstellen verfügbar'
            );
        }

        const prop = field === 'enabled'
        ? 'enabled' : 'ownMissions';

        const before = await v24Building(id);

        if (typeof before[field] !== 'boolean') {
            throw Error(`API-Feld ${field} fehlt`);
        }

        if (before[field] !== local[prop]) {
            local[prop] = before[field];

            const center = state.data.centers.find(
                x => x.id === String(id)
            );

            if (center) {
                center[prop] = before[field];
            }

            throw Error(
                'Status wurde extern geändert. ' +
                'Anzeige korrigiert; erneut prüfen.'
            );
        }

        if (before[field] === target) return;

        const name = field === 'enabled'
        ? 'building[active]'
        : 'building[generate_own_missions]';


        if (field === 'enabled') {
            // Einheitlicher Aktivierungsschalter für alle Gebäude,
            // einschließlich Leitstellen.
            const response = await fetch(
                `/buildings/${encodeURIComponent(id)}/active`,
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    redirect: 'follow'
                }
            );

            if (
                !response.ok ||
                new URL(response.url)
                .pathname.includes('sign_in')
            ) {
                throw new Error(
                    `Gebäude-Umschaltung fehlgeschlagen: ` +
                    `HTTP ${response.status}`
        );
            }

        } else if (field === 'generate_own_missions') {
            // Nur der eigene Leitstellenbereich wird
            // über das Bearbeitungsformular geändert.
            await v24SubmitBuildingField(
                id, name, target, before[field]
            );

        } else {
            throw new Error(
                `Unbekannte Gebäudeeinstellung: ${field}`
    );
    }


        const confirmed = await v24Verify(async () => {
            const current = await v24Building(id);
            return current[field];
        }, target);

        if (!confirmed) {
            v24NeedsReload = true;

            throw Error(
                'Schreibzugriff erfolgte, aber neuer ' +
                'Serverstatus nicht bestätigt. ' +
                'Bitte alle Daten neu laden.'
            );
        }

        local[prop] = target;

        const center = state.data.centers.find(
            x => x.id === String(id)
        );

        if (center) {
            center[prop] = target;
        }
    }

    async function v24ChangeVehicle(id, target) {
        const vehicle = state.data.compactVehicles.find(
            x => x.id === String(id)
        );

        if (!vehicle) {
            throw Error(
                'Fahrzeug nicht im Statistikmodell'
            );
        }

        const before = await v24Vehicle(id);

        if (before !== Number(vehicle.status)) {
            vehicle.status = before;

            throw Error(
                'FMS wurde extern geändert. ' +
                'Anzeige korrigiert; erneut prüfen.'
            );
        }

        if (![2, 6].includes(before)) {
            throw Error(
                `FMS ${before} darf nicht automatisch geändert werden`
            );
        }

        if ((before === 2 ? 6 : 2) !== target) {
            throw Error(
                'Zielstatus passt nicht zum Ausgangsstatus'
            );
        }

        const response = await fetch(
            `/vehicles/${encodeURIComponent(id)}/set_fms/${target}`,
            {
                credentials: 'same-origin',
                cache: 'no-store'
            }
        );

        if (
            !response.ok ||
            new URL(response.url)
            .pathname.includes('sign_in')
        ) {
            throw Error(
                `FMS-Umschaltung fehlgeschlagen: ` +
                `HTTP ${response.status}`
            );
        }

        const confirmed = await v24Verify(
            () => v24Vehicle(id),
            target
        );

        if (!confirmed) {
            v24NeedsReload = true;

            throw Error(
                'FMS-Änderung konnte nicht bestätigt werden. ' +
                'Bitte Daten neu laden.'
            );
        }

        vehicle.status = target;
    }

    async function v24Run(button) {
        if (
            v24Busy ||
            v24NeedsReload ||
            state.loading ||
            state.writing ||
            state.pending ||
            state.buildingBulkPending ||
            state.writeNeedsRefresh
        ) return;

        const id = button.dataset.v24Id;
        const kind = button.dataset.v24Kind;
        const target =
              button.dataset.v24Target === 'true';
        const label = button.dataset.v24Label;

        const decision = kind === 'vehicle'
        ? `Fahrzeug ${label}: auf FMS ${
                target ? '2' : '6'
        } setzen?`
            : `${label}: ${
                kind === 'own'
        ? 'eigenen Einsatzbereich'
        : 'Gebäude'
        } ${
                target ? 'aktivieren' : 'deaktivieren'
        }?`;

        if (!window.confirm(decision)) return;

        v24Busy = true;
        v24Message = `Prüfe und ändere: ${label} …`;
        render();

        try {
            if (kind === 'vehicle') {
                await v24ChangeVehicle(
                    id,
                    target ? 2 : 6
                );
            } else {
                await v24ChangeBuilding(
                    id,
                    kind === 'own'
                    ? 'generate_own_missions'
                    : 'enabled',
                    target
                );
            }

            v24Message =
                `Erfolgreich bestätigt: ${label}`;

        } catch (error) {
            v24Message =
                `FEHLER bei ${label}: ${error.message}`;

            console.error(
                '[LSS Statistik 2.4]',
                error
            );

        } finally {
            v24Busy = false;
            render();
        }
    }

    function v24Button(kind, id, label, current) {
        if (typeof current !== 'boolean') {
            return 'Unbekannt';
        }

        const target = !current;

        const statusClass = current
        ? 'lssstat-status-active'
        : 'lssstat-status-inactive';

        const actionName = kind === 'own'
        ? 'Eigenen Einsatzbereich'
        : kind === 'vehicle'
        ? 'Fahrzeug'
        : 'Gebäude';

        const title = `${actionName} ${
        target ? 'aktivieren' : 'deaktivieren'
        }`;

        const disabled =
              v24Busy ||
              v24NeedsReload ||
              state.loading ||
              state.writing ||
              state.pending ||
              state.buildingBulkPending ||
              state.writeNeedsRefresh;

        return `
        <button
            type="button"
            class="${statusClass}"
            data-v24-kind="${kind}"
            data-v24-id="${esc(id)}"
            data-v24-label="${esc(label)}"
            data-v24-target="${target}"
            title="${esc(title)}"
            ${disabled ? 'disabled' : ''}
        >
            ${current ? 'Aktiv' : 'Inaktiv'}
        </button>
    `;
    }



    function v24FilterUI(kind) {
        const element = document.createElement('div');

        element.className = 'toolbar';
        element.style.margin = '10px 0';

        const statusOptions = [
            ['all', 'Alle'],
            ['active', 'Aktiv'],
            ['inactive', 'Inaktiv']
        ];

        const centerOptions = [
            ['all', 'Alle Leitstellenbereiche'],
            ...state.data.centers
            .slice()
            .sort((a, b) =>
                  a.name.localeCompare(b.name, 'de')
                 )
            .map(c => [c.id, c.name])
        ];

        const entries = kind === 'stations'
        ? [
            [
                'stationCenter',
                'Leitstellenbereich',
                centerOptions
            ],
            [
                'station',
                'Aktivstatus',
                statusOptions
            ]
        ]
        : [
            [
                'center',
                'Aktivstatus',
                statusOptions
            ],
            [
                'own',
                'Eigener Bereich',
                [
                    ['all', 'Alle'],
                    ['yes', 'Ja'],
                    ['no', 'Nein']
                ]
            ]
        ];

        for (const [key, label, options] of entries) {
            const selectLabel =
                  document.createElement('label');

            selectLabel.textContent = `${label}: `;

            const select =
                  document.createElement('select');

            select.setAttribute('aria-label', label);

            for (const [value, text] of options) {
                const option =
                      document.createElement('option');

                option.value = value;
                option.textContent = text;

                select.append(option);
            }

            select.value = v24Filter[key];

            select.addEventListener('change', () => {
                v24Filter[key] = select.value;

                state.page = 0;
                render();
            });

            selectLabel.append(select);
            element.append(selectLabel);
        }

        return element;
    }


    function v24Decorate() {
        const c = $('#lssstat-content');

        if (!state.data || !c) return;

        if (v24Message) {
            const notice =
                  document.createElement('div');

            notice.className =
                'notice' +
                (
                v24Message.startsWith('FEHLER')
                ? ' error'
                : ''
            );

            notice.textContent = v24Message;
            c.prepend(notice);
        }

        const disabled =
              v24Busy ||
              v24NeedsReload ||
              state.writing ||
              state.loading ||
              Boolean(state.pending) ||
              state.writeNeedsRefresh;

        // ------------------------------------------
        // FAHRZEUGDETAILS
        // ------------------------------------------

        if (
            state.tab === 'vehicletypes' &&
            state.detail?.kind === 'vehicle'
        ) {
            const tableEl =
                  c.querySelector('.tablebox table');

            if (!tableEl) return;

            const colgroup =
                  tableEl.querySelectorAll(
                      'colgroup col'
                  );

            [27, 25, 28, 9].forEach((w, i) => {
                if (colgroup[i]) {
                    colgroup[i].style.width =
                        `${w}%`;
                }
            });

            const col =
                  document.createElement('col');

            col.style.width = '11%';

            tableEl.querySelector('colgroup')
                ?.append(col);

            const th =
                  document.createElement('th');

            th.textContent = 'FMS-Aktion';

            tableEl.querySelector('thead tr')
                ?.append(th);

            for (
                const tr of tableEl.querySelectorAll(
                    'tbody tr'
                )
            ) {
                const link = tr.querySelector(
                    'a[href^="/vehicles/"]'
                );

                const id = link
                ?.getAttribute('href')
                ?.match(/\/vehicles\/(\d+)/)?.[1];

                if (!id) continue;

                const vehicle = (
                    state.data.vehicleByType.get(
                        state.detail.id
                    ) || []
                ).find(x => x.id === id);

                if (!vehicle) continue;

                const fms = Number(vehicle.status);
                const statusCell = tr.cells[1];

                if (
                    statusCell &&
                    fms !== 2 &&
                    fms !== 6
                ) {
                    statusCell.insertAdjacentHTML(
                        'beforeend',
                        `<div
                            class="muted"
                            style="font-size:13px"
                        >
                            Tatsächlich S${esc(fms)}
                        </div>`
                    );
                }

                const td =
                      document.createElement('td');

                if ([2, 6].includes(fms)) {
                    td.innerHTML = `
                        <button
                            type="button"
                            data-v24-kind="vehicle"
                            data-v24-id="${esc(id)}"
                            data-v24-label="${
                                esc(vehicle.name)
            }"
                            data-v24-target="${
                                fms === 6
            }"
                            ${
                                disabled
                    ? 'disabled' : ''
            }
                        >
                            ${
                                fms === 2
                    ? 'Auf S6'
                : 'Auf S2'
            }
                        </button>
                    `;
            } else {
                td.textContent =
                    'Nicht schaltbar';

                td.className = 'muted';
            }

                tr.append(td);
            }
        }

        // ------------------------------------------
        // WACHEN UND LEITSTELLEN
        // ------------------------------------------

        if (
            state.tab === 'stations' ||
            state.tab === 'centers'
        ) {
            const tableEl =
                  c.querySelector('.tablebox table');

            if (!tableEl) return;
            // Zusätzliche CSS-Klasse für die breite Wachenliste
            if (state.tab === 'stations') {
                tableEl.classList.add('lssstat-stations-table');
            }

            tableEl.parentElement.before(
                v24FilterUI(state.tab)
            );

            const centers =
                  state.tab === 'centers';

            const th =
                  document.createElement('th');

            th.textContent = 'Aktivstatus';

            tableEl.querySelector('thead tr')
                ?.append(th);

            if (centers) {
                const ownTh =
                      document.createElement('th');

                ownTh.textContent =
                    'Eigener Bereich';

                tableEl.querySelector('thead tr')
                    ?.append(ownTh);
            }

            const widths = centers
            ? [25, 9, 9, 25, 16, 16]
            : [19, 13, 9, 7, 13, 17, 11, 11];

            const cols =
                  tableEl.querySelectorAll(
                      'colgroup col'
                  );

            widths.forEach((w, i) => {
                if (cols[i]) {
                    cols[i].style.width =
                        `${w}%`;
                } else {
                    const col =
                          document.createElement('col');

                    col.style.width = `${w}%`;

                    tableEl.querySelector('colgroup')
                        ?.append(col);
                }
            });

            for (
                const tr of tableEl.querySelectorAll(
                    'tbody tr'
                )
            ) {
                const link = tr.querySelector(
                    'a[href^="/buildings/"]'
                );

                const id = link
                ?.getAttribute('href')
                ?.match(/\/buildings\/(\d+)/)?.[1];

                const station = id &&
                      state.data.byBuilding.get(id);

                const td =
                      document.createElement('td');

                td.innerHTML = station
                    ? v24Button(
                    'building',
                    id,
                    station.name,
                    station.enabled
                )
                : '—';

                tr.append(td);

                if (centers) {
                    const ownTd =
                          document.createElement('td');

                    ownTd.innerHTML = station
                        ? v24Button(
                        'own',
                        id,
                        station.name,
                        station.ownMissions
                    )
                    : '—';

                    tr.append(ownTd);
                }
            }
        }

        // Klickereignisse für die neuen Buttons
        c.querySelectorAll('[data-v24-kind]')
            .forEach(b => {
            b.addEventListener(
                'click',
                () => v24Run(b)
            );
        });
    }

    // ------------------------------------------
    // BESTEHENDE ANSICHTEN ERWEITERN
    // ------------------------------------------

    const v24OriginalRender = render;

    render = function () {
        const d = state.data;

        let origStations;
        let origCenters;

        if (d && state.tab === 'stations') {
            origStations = d.stations;

            d.stations = origStations.filter(s => {
                const matchesStatus =
                      v24Filter.station === 'all' ||
                      (
                          v24Filter.station === 'active'
                          ? s.enabled === true
                          : s.enabled === false
                      );

                const matchesCenter =
                      v24Filter.stationCenter === 'all' ||
                      s.center === v24Filter.stationCenter;

                return (
                    s.typeId !== '7' &&
                    matchesStatus &&
                    matchesCenter
                );
            });

        } else if (
            d &&
            state.tab === 'centers'
        ) {
            origCenters = d.centers;

            d.centers = origCenters.filter(c => {
                const activeOK =
                      v24Filter.center === 'all' ||
                      (
                          v24Filter.center === 'active'
                          ? c.enabled === true
                          : c.enabled === false
                      );

                const ownOK =
                      v24Filter.own === 'all' ||
                      (
                          v24Filter.own === 'yes'
                          ? c.ownMissions === true
                          : c.ownMissions === false
                      );

                return activeOK && ownOK;
            });
        }

        try {
            v24OriginalRender();

        } finally {
            if (origStations) {
                d.stations = origStations;
            }

            if (origCenters) {
                d.centers = origCenters;
            }
        }

        v24Decorate();
    };

})();
