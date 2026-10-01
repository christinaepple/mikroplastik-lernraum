// ═══════════════════════════════════════════════════════════════════════════
//  Module einbetten
//  Eine Interaktion des Labors in einer anderen Seite laufen lassen.
// ═══════════════════════════════════════════════════════════════════════════

// Die Module sind vollständige Seiten mit Kopf-, Fußzeile und Seitenrand. In
// einer einbettenden Seite stört dieses Gerüst, denn die stellt es bereits
// selbst. Statt jeder Interaktion eine zweite, eingebettete Fassung zu geben,
// bekommt sie beim Laden diese Ergänzung mit.
const EMBED_CSS = `
    html, body { overflow: hidden !important; }
    body { padding: 18px 20px !important; background: transparent !important; }
    header, footer { display: none !important; }
    .container { gap: 20px !important; }
`;

/**
 * Lädt ein Modul in einen Rahmen.
 *
 * Sichtbar wird es erst, wenn sein Seitengerüst ausgeblendet ist – die
 * einbettende Seite hält den Rahmen dafür auf `opacity: 0`, hier wird er
 * freigegeben. Ohne das blitzten Kopf- und Fußzeile der Einzelseite auf.
 *
 * @param {HTMLIFrameElement} frame
 * @param {string} src Pfad der Modulseite
 */
export function loadModuleFrame(frame, src) {
    frame.addEventListener('load', () => applyEmbedStyles(frame), { once: true });
    frame.src = src;
}

/**
 * Leert den Rahmen wieder.
 *
 * Das ist mehr als Aufräumen: Der Server verteilt jedes Sensor-Event an alle
 * verbundenen Clients, ein im Hintergrund geöffnetes Modul liefe also mit.
 * Beim nächsten Laden beginnt es außerdem von vorn.
 *
 * @param {HTMLIFrameElement} frame
 */
export function clearModuleFrame(frame) {
    frame.style.opacity = '';
    frame.src = 'about:blank';
}

/**
 * Blendet im geladenen Modul das Seitengerüst aus.
 *
 * Die Module liegen auf demselben Server und damit im selben Origin; ihr
 * Dokument ist von der einbettenden Seite aus erreichbar.
 */
function applyEmbedStyles(frame) {
    // Auch das Leeren des Rahmens meldet ein 'load'. Wurde das Modul in der
    // Zwischenzeit entladen, ist hier nichts mehr zu tun.
    if (frame.src === 'about:blank') return;

    const doc = frame.contentDocument;
    if (!doc || !doc.head) return;

    const style = doc.createElement('style');
    style.textContent = EMBED_CSS;
    doc.head.appendChild(style);

    frame.style.opacity = '1';
}
