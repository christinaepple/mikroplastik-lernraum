// ═══════════════════════════════════════════════════════════════════════════
//  Sucher (Anzeige / Laptop) — das weiße Blatt
//
//  Zu Beginn nur ein QR-Code, über den das Handy die eigene Sucher-Oberfläche
//  (controller_sucher.html) öffnet. Läuft der Sucher dort, verschwindet der Code
//  und übrig bleibt ein weißes Blatt: die Fläche, auf der collagiert wird.
//
//  Das Handy schickt laufend Zielpunkt, Traglast und ein Ruhe-Signal. Alles
//  Weitere entscheidet diese Seite — sie allein weiß, was auf dem Blatt liegt:
//
//    • trägt das Handy ein Bild und ruht die Lage → Halte-Ring füllt sich,
//      danach liegt das Bild an dieser Stelle auf dem Blatt (blass, noch nicht
//      betreten). Das Ablegen startet ausdrücklich noch keine Station.
//    • trägt es nichts und der Cursor steht auf einem blassen Bild → derselbe
//      Ring, danach wird die Station dieses Bildes betreten. So sucht man sich
//      aus, wann und worin es weitergeht.
//    • ist eine Station durch, steht ihr Bild in voller Farbe auf dem Blatt.
//
//  Nach und nach entsteht daraus die eigene Collage aus Stationsbildern.
// ═══════════════════════════════════════════════════════════════════════════

import { socket } from './lib/socket.js';
import { byId } from './lib/dom.js';
import { loadModuleFrame, clearModuleFrame } from './lib/embed.js';
import { onCompletion } from './lib/completion.js';
import { STATIONEN } from './lib/sucher-stationen.js';

const connect = byId('connect');
const qrImage = byId('qrImage');
const sheet = byId('sheet');
const station = byId('station');
const cursor = byId('cursor');
const cursorHand = byId('cursorHand');
const cursorProgress = byId('cursorProgress');

// Hand-Cursor: offen frei, geschlossen beim Tragen. Quelle nur bei Wechsel setzen,
// sonst lädt das Bild jedes Bild neu und flackert.
const CURSOR_DROP = '/img/interactionen/einstieg/cursor_drop.png';
const CURSOR_DRAG = '/img/interactionen/einstieg/cursor_drag.png';
let cursorCarrying = null;
function setCursorHand(carrying) {
    if (carrying === cursorCarrying) return;
    cursorCarrying = carrying;
    cursorHand.src = carrying ? CURSOR_DRAG : CURSOR_DROP;
}
const carriedEl = byId('carried');
const hintEl = byId('hint');

const CONTROLLER_PATH = '/controller_sucher.html';

// Umfang des Fortschrittsrings im Cursor (r=21, siehe sucher.html).
const RING_C = 2 * Math.PI * 21;

// ====================================================================
// ANPASSBARE PARAMETER
// ====================================================================
// Wie lange ruhig gehalten werden muss — zum Ablegen und zum Betreten.
//
// Jede Geste hat zwei Abschnitte: erst eine stille Zeit ohne jede Anzeige, dann
// erst füllt sich der Ring. So kann man in Ruhe umherfahren und einen Platz auf
// dem Blatt suchen, ohne dass sofort ein Balken drängt. Das Ablegen dauert
// bewusst am längsten — es ist die Entscheidung, wo das Bild liegen bleibt.
const PLACE_DELAY_MS = 900;
const PLACE_HOLD_MS = 2600;
const ENTER_DELAY_MS = 500;
const ENTER_HOLD_MS = 1500;

// Ist der Blend voll (Foto ganz in die Skizze übergegangen), steht die Zeichnung
// diese Spanne allein, bevor die Station lädt — sonst blitzte am Ende wieder das
// Foto auf. Wie SELECT_DRAWING_PAUSE in eintragspfade-2.
const ENTER_DRAWING_PAUSE_MS = 350;

// Kommt so lange kein Zielpunkt mehr, gilt das Handy als abwesend.
const AIM_STALE_MS = 400;

// Sperrfrist nach einer Aktion. Der Zielpunkt des Handys ist einen Wimpernschlag
// alt; ohne die Sperre könnte dieselbe Haltung sofort die nächste auslösen.
const ACTION_LOCK_MS = 600;

// Fangbereich um ein Collage-Bild: Liegt der Zeiger darin, ist das Bild anvisiert.
// Der Zug auf die Mitte selbst läuft dann parallel zur Überblendung (siehe tick).
// MAGNET_RADIUS ist die Untergrenze — bei den großen Bildern richtet sich der
// Fangbereich nach ihrer Größe (MAGNET_SIZE_FACTOR).
const MAGNET_RADIUS = 85;
const MAGNET_SIZE_FACTOR = 0.75;

// Dämpfung des Cursors: Der Zielpunkt vom Handy wird nicht direkt übernommen,
// sondern der Cursor zieht ihm je Bild nur um diesen Anteil nach. Klein =
// schwergängig und ruhig (Zittern wird geschluckt), groß = direkt und flink.
const CURSOR_SMOOTHING = 0.03;
// ====================================================================

// Letzte Meldung des Handys.
let aim = null;           // { x, y, carrying, steady, t }
let curX = 0, curY = 0, curInit = false;   // gedämpfte Cursor-Lage (px)
let busy = false;         // eine Station läuft
let dwellStart = 0;
let dwellTarget = null;   // null = ablegen, sonst das Bild, das betreten wird
let activePiece = null;   // Bild der gerade laufenden Station
let activeWasDone = false; // war diese Station beim Betreten schon abgeschlossen?
let enterPause = false;   // Übergang ins Betreten läuft — tick ruht so lange
let lockUntil = 0;        // Sperrfrist nach einer ausgelösten Aktion

// Die abgelegten Bilder: { el, index, done }
const pieces = [];

// ─────────────────────────────────────────────
// SITZUNG, QR-CODE UND VERBINDUNG
// ─────────────────────────────────────────────
// Der Desktop ist der „host" seiner Sitzung. Die id kommt vom Server und wandert
// in den QR-Code (das Handy tritt darüber demselben Raum bei) und in den
// localStorage — so landet der Desktop nach einem Reload wieder in derselben
// Sitzung und baut die Collage aus dem Server-Stand neu auf.
let origin = window.location.origin;
let hasController = false;

// Die Session-id vergibt der Desktop selbst (der Server übernimmt sie) und merkt
// sie im localStorage. So steht der QR-Code sofort, ohne auf eine Server-Antwort
// zu warten, und nach einem Reload landet der Desktop in derselben Sitzung.
let session = null;
try { session = localStorage.getItem('sucherSession'); } catch (e) { /* Privatmodus */ }
if (!session) {
    session = Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem('sucherSession', session); } catch (e) { /* egal */ }
}

function buildQr(id) {
    const url = origin + CONTROLLER_PATH + '?session=' + encodeURIComponent(id);
    qrImage.src = 'https://api.qrserver.com/v1/create-qr-code/'
        + `?size=240x240&data=${encodeURIComponent(url)}&color=0f172a&margin=8`;
}

function setConnected(connected) {
    hasController = connected;
    connect.classList.toggle('is-hidden', connected);
    // Während einer Station regelt deren Rahmen die Sichtbarkeit, nicht dies.
    if (!busy) sheet.hidden = !connected;
}

let originReady = false;
function hostSession() {
    socket.emit('sucherHost', session ? { id: session } : {});
}

// Nach jedem Reconnect der Sitzung wieder beitreten — aber erst, wenn die
// Origin-Adresse für den QR steht, damit der Code nicht mit „localhost" entsteht.
socket.on('connect', () => { if (originReady) hostSession(); });

socket.on('sucherJoined', (data) => {
    if (!data) return;
    // Der QR steht schon (client-seitige id). Weicht die Server-id doch ab, hier
    // nachziehen; dann den Stand übernehmen.
    if (data.id && data.id !== session) {
        session = data.id;
        try { localStorage.setItem('sucherSession', session); } catch (e) { /* egal */ }
        buildQr(session);
    }
    rehydrate(data.state);
});

socket.on('sucherStatus', (data) => setConnected(!!(data && data.controller)));

/** Collage und Phase aus dem Server-Stand wiederherstellen. */
function rehydrate(state) {
    if (!state) return;

    // Lief in DIESER Seiteninstanz schon eine Station? Nach einem echten Reload ist
    // das Modul frisch (busy=false); bei einem bloßen Socket-Reconnect während einer
    // laufenden Station steht busy noch auf true. Das ist das verlässliche Signal —
    // anders als „erster Join", der bei doppeltem hostSession() durcheinandergerät.
    const wasRunningLocally = busy;

    for (const el of sheet.querySelectorAll('.piece')) el.remove();
    pieces.length = 0;

    for (const p of state.placed) {
        const entry = STATIONEN[p.index];
        if (!entry) continue;
        const piece = createPiece(entry, p.index, p.done);
        piece.el.style.left = (p.x * 100) + '%';
        piece.el.style.top = (p.y * 100) + '%';
        sheet.appendChild(piece.el);
        pieces.push(piece);
    }

    // Reconnect ohne Neuladen: Die Station lief in dieser Instanz weiter, ihr Rahmen
    // steht noch — nichts anrühren, nur activePiece auf das neu aufgebaute Element
    // umhängen (das alte wurde eben entfernt).
    if (state.phase === 'station' && state.activeIndex >= 0 && wasRunningLocally) {
        const piece = pieces.find((q) => q.index === state.activeIndex);
        if (piece) { activePiece = piece; activeWasDone = piece.done; }
        return;
    }

    // Alles andere — insbesondere ein Reload während einer Station — landet auf der
    // Übersicht (mit aktuellem Stand). Lief serverseitig eine Station, wird sie
    // abgebrochen (nicht durchgespielt) und das Handy per sucherReturn nachgezogen.
    if (state.phase === 'station' && state.activeIndex >= 0) {
        socket.emit('customAction', { type: 'sucherReturn' });
    }

    busy = false;
    activePiece = null;
    activeWasDone = false;
    enterPause = false;
    if (!station.hidden) { clearModuleFrame(station); station.hidden = true; }
    sheet.hidden = !hasController;
}

// ─────────────────────────────────────────────
// MELDUNGEN VOM HANDY
// ─────────────────────────────────────────────
socket.on('customAction', (data) => {
    if (!data) return;

    // Langes Schütteln am Handy bricht eine laufende Station ab. Der Fortschritt
    // dazu wird auf dem Handy selbst gezeigt, nicht hier.
    if (data.type === 'sucherReturn') { returnFromStation(); return; }

    if (data.type !== 'sucherAim') return;
    aim = {
        x: data.x,
        y: data.y,
        // Der Zeiger ist wie eine Maus zwischen zwei Monitoren immer nur auf
        // einem Gerät. Erst wenn das Handy in das Bildschirm-Fenster zielt,
        // liegt er hier — vorher gehört er der Bodenansicht am Handy.
        onScreen: !!data.onScreen,
        carrying: typeof data.carrying === 'number' ? data.carrying : -1,
        steady: !!data.steady,
        t: performance.now(),
    };
});

// ─────────────────────────────────────────────
// CURSOR UND HINWEIS
// ─────────────────────────────────────────────
function setRing(progress) {
    cursorProgress.setAttribute('stroke-dasharray', `${progress * RING_C} ${RING_C}`);
}

function hideCursor() {
    cursor.classList.remove('is-on');
    setRing(0);
    // Beim nächsten Erscheinen ohne Nachziehen direkt an der Zielstelle aufsetzen.
    curInit = false;
}

// ─────────────────────────────────────────────
// AUSWAHL-BLEND — Foto löst sich in die Umrissskizze auf
// ─────────────────────────────────────────────
// Die Halte-Rückmeldung fürs Starten einer Station: Hat die Station eine Skizze,
// blendet ihr Bild mit dem Haltefortschritt vom Foto in die Zeichnung — dieselbe
// Handschrift wie die Szenenwahl in eintragspfade-2. Der Übergang läuft allein
// über --selection-progress (kein CSS-transition darauf), die Weichheit kommt aus
// dem Haltefortschritt selbst. Ohne Skizze passiert nichts.
let blendedPiece = null;

function applyBlend(piece, progress) {
    if (blendedPiece && blendedPiece !== piece) {
        blendedPiece.el.style.removeProperty('--selection-progress');
    }
    blendedPiece = piece;
    if (piece && piece.stroke) {
        piece.el.style.setProperty('--selection-progress', progress.toFixed(3));
    }
}

function clearBlend() {
    if (blendedPiece) blendedPiece.el.style.removeProperty('--selection-progress');
    blendedPiece = null;
}

// ─────────────────────────────────────────────
// DAS GETRAGENE BILD
// ─────────────────────────────────────────────
// Es hängt am Zeiger und wechselt mit ihm das Gerät: solange der Zeiger am
// Boden ist, trägt das Handy es; kommt er herüber, hängt es hier.
let carriedIndex = -1;

function showCarried(index, px, py) {
    const entry = STATIONEN[index];
    if (!entry) return;

    if (carriedIndex !== index) {
        carriedIndex = index;
        carriedEl.src = entry.img;
        carriedEl.hidden = false;
        carriedEl.classList.add('is-arriving');
        carriedEl.style.left = px + 'px';
        carriedEl.style.top = py + 'px';
        // Lage festschreiben, damit das Ankommen nicht von irgendwo herfliegt.
        void carriedEl.offsetWidth;
        requestAnimationFrame(() => carriedEl.classList.remove('is-arriving'));
        return;
    }

    carriedEl.style.left = px + 'px';
    carriedEl.style.top = py + 'px';
}

function hideCarried() {
    if (carriedIndex === -1) return;
    carriedIndex = -1;
    carriedEl.hidden = true;
    carriedEl.classList.remove('is-arriving');
}

let hintText = '';
function setHint(text) {
    if (text === hintText) return;
    hintText = text;
    if (text) hintEl.textContent = text;
    hintEl.classList.toggle('is-on', !!text);
}

// ─────────────────────────────────────────────
// COLLAGE
// ─────────────────────────────────────────────
/**
 * Das nächste Bild im Fangbereich um (px, py) — nur die Erkennung, ohne Zug.
 * Den eigentlichen Zug auf die Mitte übernimmt `tick` parallel zur Überblendung.
 * @returns {{piece: object, cx: number, cy: number, radius: number}|null}
 */
function nearestPiece(px, py) {
    let best = null;
    let bestDist = Infinity;

    // Von hinten nach vorn: das zuletzt abgelegte Bild liegt oben. Auch fertige
    // Bilder zählen — eine abgeschlossene Station lässt sich so erneut betreten.
    for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i];

        const r = piece.el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const radius = Math.max(MAGNET_RADIUS, Math.max(r.width, r.height) * MAGNET_SIZE_FACTOR);
        const dist = Math.hypot(cx - px, cy - py);

        if (dist < radius && dist < bestDist) {
            bestDist = dist;
            best = { piece, cx, cy, radius };
        }
    }

    return best;
}

/**
 * Baut ein Collage-Bild: das Foto und – wenn die Station eine `stroke`-Skizze
 * hat – die Umrissskizze deckungsgleich darüber. Der Blend zwischen beiden läuft
 * allein über die CSS-Variable --selection-progress am Container.
 */
function createPiece(entry, index, done) {
    const el = document.createElement('div');
    el.className = 'piece' + (done ? ' done' : '');

    const base = document.createElement('img');
    base.className = 'piece-base';
    base.src = entry.img;
    base.alt = entry.name;
    el.appendChild(base);

    let stroke = null;
    if (entry.stroke) {
        stroke = document.createElement('img');
        stroke.className = 'piece-stroke';
        stroke.src = entry.stroke;
        stroke.alt = '';
        el.appendChild(stroke);
    }

    return { el, stroke, index, done };
}

/** Legt das Bild der Station `index` an der Stelle (0..1) auf das Blatt. */
function placePiece(index, ax, ay) {
    const entry = STATIONEN[index];
    if (!entry) return;

    // Das getragene Bild geht in das abgelegte über.
    hideCarried();

    const piece = createPiece(entry, index, false);
    piece.el.classList.add('is-dropping');
    piece.el.style.left = (ax * 100) + '%';
    piece.el.style.top = (ay * 100) + '%';
    sheet.appendChild(piece.el);

    // Absetzen: von leicht zu groß und durchsichtig auf seine Lage.
    void piece.el.offsetWidth;
    requestAnimationFrame(() => piece.el.classList.remove('is-dropping'));

    pieces.push(piece);
    // x/y mitgeben, damit der Server die Ablageorte kennt und die Collage nach
    // einem Reload an denselben Stellen wieder aufbauen kann.
    socket.emit('customAction', { type: 'sucherPlaced', index, x: ax, y: ay });
}

// ─────────────────────────────────────────────
// STATION BETRETEN UND ABSCHLIESSEN
// ─────────────────────────────────────────────
function enterStation(piece) {
    const entry = STATIONEN[piece.index];
    if (!entry) return;

    busy = true;
    activePiece = piece;
    activeWasDone = piece.done;
    // tick ruht bis der Rahmen steht, damit der Blend (die volle Skizze) nicht
    // vorzeitig geräumt wird und das Foto zurückschnappt.
    enterPause = true;
    hideCursor();
    hideCarried();
    setHint('');

    // Hat die Station eine Skizze, steht diese nach dem vollen Blend kurz allein,
    // bevor das Blatt verdeckt wird und die Station lädt. Ohne Skizze bleibt es
    // beim bisherigen kurzen Takt.
    const delay = piece.stroke ? ENTER_DRAWING_PAUSE_MS : 400;

    socket.emit('customAction', { type: 'sucherEnter', index: piece.index });

    setTimeout(() => {
        sheet.hidden = true;
        station.hidden = false;
        loadModuleFrame(station, entry.page);
        // Das Blatt ist verdeckt — der Blend darf zurückgesetzt werden.
        clearBlend();
        enterPause = false;
    }, delay);
}

/**
 * Bricht die laufende Station ab (langes Schütteln am Handy) und kehrt zum
 * Blatt zurück. Anders als beim regulären Abschluss gilt die Station dabei nicht
 * als durchgespielt: ihr Bild bleibt blass und lässt sich später erneut betreten.
 */
function returnFromStation() {
    if (!busy) return;

    clearModuleFrame(station);
    station.hidden = true;
    sheet.hidden = false;

    activePiece = null;
    activeWasDone = false;
    busy = false;
    dwellStart = 0;
    dwellTarget = null;
}

onCompletion((detail, source) => {
    if (!activePiece || source !== station.contentWindow) return;

    clearModuleFrame(station);
    station.hidden = true;
    sheet.hidden = false;

    if (activeWasDone) {
        // Wiederholung einer bereits gespielten Station: Sie bleibt erledigt und
        // der Ablauf rückt nicht weiter. Das Handy verlässt die Station über
        // dieselbe Meldung wie beim Abbruch.
        socket.emit('customAction', { type: 'sucherReturn' });
    } else {
        // Die durchgespielte Station steht jetzt in voller Farbe auf dem Blatt.
        activePiece.done = true;
        activePiece.el.classList.add('done');
        socket.emit('customAction', { type: 'sucherAdvance', index: activePiece.index });
    }

    activePiece = null;
    activeWasDone = false;
    busy = false;
    dwellStart = 0;
    dwellTarget = null;
});

// ─────────────────────────────────────────────
// HALTEN: ABLEGEN ODER BETRETEN
// ─────────────────────────────────────────────
// Ein Ring, zwei Bedeutungen — welche gilt, entscheidet die Traglast des
// Handys. Beides ist dieselbe Geste, die der Sucher schon beim Aufnehmen am
// Boden lehrt: zielen und ruhig halten.
function tick() {
    requestAnimationFrame(tick);

    // Während der Übergang ins Betreten läuft, nichts anrühren: die Skizze soll
    // stehen bleiben, bis der Rahmen sie abdeckt.
    if (enterPause) return;

    const now = performance.now();

    // Kein Handy, Station läuft, oder der Zeiger ist drüben am Boden: hier ist
    // dann nichts zu sehen.
    if (busy || !aim || !aim.onScreen || now - aim.t > AIM_STALE_MS) {
        hideCursor();
        hideCarried();
        clearBlend();
        if (!busy) setHint(aim && !aim.onScreen ? hintForIdle() : '');
        dwellStart = 0;
        dwellTarget = null;
        return;
    }

    const carrying = aim.carrying >= 0;

    // Den Zielpunkt vom Handy gedämpft nachführen, statt ihn direkt zu übernehmen:
    // Das schluckt das Zittern und macht die Steuerung spürbar schwergängiger.
    // Beim ersten Bild (oder nach einer Pause) ohne Sprung direkt aufsetzen.
    const rawX = aim.x * window.innerWidth;
    const rawY = aim.y * window.innerHeight;
    if (!curInit) {
        curX = rawX; curY = rawY; curInit = true;
    } else {
        curX += (rawX - curX) * CURSOR_SMOOTHING;
        curY += (rawY - curY) * CURSOR_SMOOTHING;
    }

    // Ohne Traglast bestimmt der Magnet nur, welches Bild anvisiert ist — der Zug
    // auf dessen Mitte läuft erst parallel zur Überblendung (weiter unten), nicht
    // schon beim bloßen Annähern.
    let target = null;
    let hit = null;
    if (!carrying) {
        hit = nearestPiece(curX, curY);
        target = hit ? hit.piece : null;
    }

    // Wird gerade gehalten? Nur dann läuft eine Geste (Ablegen oder Betreten).
    const holding = !(now < lockUntil || !aim.steady || (!carrying && !target));

    if (holding) {
        if (dwellStart === 0 || dwellTarget !== target) {
            dwellStart = now;
            dwellTarget = target;
        }
    } else {
        dwellStart = 0;
        dwellTarget = null;
    }

    // Haltefortschritt: erst eine stille Zeit (delay), dann füllt er sich bis 1.
    const delay = carrying ? PLACE_DELAY_MS : ENTER_DELAY_MS;
    const span = carrying ? PLACE_HOLD_MS : ENTER_HOLD_MS;
    const held = holding ? now - dwellStart - delay : -1;
    const progress = held < 0 ? 0 : Math.min(held / span, 1);

    // Cursor setzen: beim Betreten zieht er parallel zur Überblendung auf die
    // Bildmitte (mit demselben progress), sonst bleibt er auf der gedämpften Lage.
    let px = curX;
    let py = curY;
    if (!carrying && hit) {
        px = curX + (hit.cx - curX) * progress;
        py = curY + (hit.cy - curY) * progress;
    }

    cursor.style.left = px + 'px';
    cursor.style.top = py + 'px';
    cursor.classList.add('is-on');
    setCursorHand(carrying);

    // Das getragene Bild ist mit dem Zeiger herübergekommen und hängt an ihm.
    if (carrying) showCarried(aim.carrying, px, py);
    else hideCarried();

    // Nichts zu halten: Rückmeldung zurücknehmen.
    if (!holding) {
        setRing(0);
        clearBlend();
        setHint(carrying
            ? 'such dir einen platz und halte ruhig'
            : (target ? startHint(target) : hintForIdle()));
        return;
    }

    // Stille Zeit vor dem Fortschritt.
    if (held < 0) {
        setRing(0);
        clearBlend();
        setHint(carrying ? 'such dir einen platz und halte ruhig' : startHint(target));
        return;
    }

    // Ablegen zeigt den Ring am Cursor; das Starten blendet das Bild in seine
    // Skizze und zieht den Cursor gleichzeitig auf die Mitte.
    if (carrying) setRing(progress);
    else applyBlend(target, progress);

    setHint(carrying
        ? 'weiter halten — das bild bleibt hier liegen'
        : (target && target.done ? 'weiter halten — die station startet erneut' : 'weiter halten — die station startet'));

    if (progress < 1) return;

    dwellStart = 0;
    dwellTarget = null;
    lockUntil = now + ACTION_LOCK_MS;
    setRing(0);

    if (carrying) {
        clearBlend();
        placePiece(aim.carrying, aim.x, aim.y);
    } else {
        // Der Blend bleibt voll stehen — enterStation räumt ihn, sobald der
        // Stationsrahmen das Bild abdeckt.
        enterStation(target);
    }
}

/** Was zu tun ist, wenn der Zeiger gerade nichts trifft oder drüben ist. */
function hintForIdle() {
    if (pieces.length === 0) return 'suche das erste bild am boden';
    if (pieces.some((p) => !p.done)) return 'ziele auf ein blasses bild, um seine station zu starten';
    return 'ziele auf ein bild, um seine station noch einmal zu machen';
}

/** Halte-Hinweis für ein Ziel — je nachdem, ob die Station schon gespielt wurde. */
function startHint(target) {
    return target && target.done
        ? 'halten, um die station noch einmal zu machen'
        : 'halten, um die station zu starten';
}

// Erst die im Netzwerk erreichbare Adresse holen (für den QR), dann der Sitzung
// beitreten. Der Serverzustand kommt als Antwort (sucherJoined) zurück.
(async () => {
    try {
        const res = await fetch('/api/config');
        origin = (await res.json()).origin;
    } catch (e) {
        console.warn('Konnte Server-IP nicht laden, nutze Fallback:', e);
    }
    originReady = true;
    buildQr(session);   // QR sofort zeigen, unabhängig von der Server-Antwort
    hostSession();
})();

requestAnimationFrame(tick);
