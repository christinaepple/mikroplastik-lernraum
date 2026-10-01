// ═══════════════════════════════════════════════════════════════════════════
//  Einflüsse auf Bodenfunktionen (Inhalte)
//
//  interactions/inhalte/einfluesse-bodenfunktionen.html
//
//  Ein Bodenquerschnitt (0-start.png) füllt als Hintergrund die Bühne. Darauf
//  liegen fünf Mikroplastik-Partikel (partikel.png). Ansteuern und Halten nimmt
//  eines auf (der Kringel zeichnet sich dazu fort) – es klebt dann am Zeiger.
//  Über dem Bodenbereich (der braunen Collage) abgelegt, löst jedes Partikel
//  einen Effekt aus (Wasser, Schadstoffe, Organismen, Kohlenstoff,
//  Pflanzenwachstum – in dieser Reihenfolge). Die Effekte sind Abschnitte EINER
//  fortlaufenden Bildfolge (0 → 27): Das Ablegen zeigt das ERSTE Bild des
//  Abschnitts; die WEITEREN Bilder kommen durchs Drehen des Smartphones – „die
//  Zeit weiterdrehen", genau wie in `produktionsabriss.js`. Die Bilder blenden
//  ineinander über (Stop-Motion). Es lässt sich immer nur ein Partikel tragen.
//
//  Das Board deckt sich 1:1 mit der Bühne: Die Leinwände bekommen ihre
//  Auflösung zur Laufzeit aus der Bühnengröße (`resizeBoard`). Alle Positionen
//  sind relativ (Anteile der Bühne bzw. Pixel der Szene) und wandern beim
//  Resize mit.
//
//  Zeiger-, Magnet- und Kringel-Mechanik sowie das Einführungsspiel sind wie
//  bei `transportmechanismen.js`; ausgetauscht ist der Kern – statt Objekten an
//  Bild-Stellen sind es auswählbare Partikel auf dem Hintergrund.
// ═══════════════════════════════════════════════════════════════════════════

import { socket, shareCalibration } from '../../lib/socket.js';
import { initConnectionBadge } from '../../lib/connection.js';
import { Baseline, clamp, wrapDeg180 } from '../../lib/angles.js';
import { createLongShake } from '../../lib/shake.js';
import { initCalibration } from '../../lib/calibration.js';
import { reportCompletion } from '../../lib/completion.js';
import { byId } from '../../lib/dom.js';

const stage = byId('stage');
const calBtn = byId('calBtn');
const intro = byId('intro');
// Untere Ebene: der Hintergrund. Obere Ebene: alles Bewegliche.
const bgCanvas = byId('bgCanvas');
const bgctx = bgCanvas.getContext('2d');
const canvas = byId('boardCanvas');
const ctx = canvas.getContext('2d');

const connection = initConnectionBadge({ onDisconnect: resetInteractiveState });

// Der Akzent der Ausstellung, als Zahlentripel.
const ACCENT_RGB = '253, 100, 88';

// ── Board ────────────────────────────────────────────────────────────────
// Das Board ist die volle Spielfläche und deckt sich 1:1 mit der Bühne (CSS-
// Pixel). Größe kommt live aus der Bühne und wird bei jedem Resize neu gesetzt.
let BOARD_W = 0;
let BOARD_H = 0;

// ── Hintergrund-Szene (0_start.png + Effekt-Bilder) ─────────────────────────
// Der Bodenquerschnitt füllt die Bühne. Seine Eigenmaße geben das Koordinaten-
// system für die Partikel-Positionen und den Bodenbereich (in diesen Pixeln
// angegeben, damit alles mit dem Bild mitwandert). Alle Bilder der Folge haben
// dieselbe Größe.
const SCENE_PX_W = 1512;
const SCENE_PX_H = 870;
const SCENE_ASPECT = SCENE_PX_W / SCENE_PX_H;

// Höhe der Szene als Anteil der Bühnenhöhe (1 = volle Höhe; wird zusätzlich
// durch die Breite begrenzt, damit nichts seitlich hinausragt).
const SCENE_H_FRAC = 1.0;

// Werden in `layoutScene()` aus der aktuellen Bühnengröße berechnet.
let SCENE_X = 0, SCENE_Y = 0, SCENE_W = 0, SCENE_H = 0, SCENE_SCALE = 1;
const sceneX = (px) => SCENE_X + px * SCENE_SCALE;
const sceneY = (py) => SCENE_Y + py * SCENE_SCALE;

function layoutScene() {
    // Ganz in die Bühne einpassen (contain), mittig – so bleibt der komplette
    // Querschnitt sichtbar, egal wie die Bühne steht.
    let h = BOARD_H * SCENE_H_FRAC;
    let w = h * SCENE_ASPECT;
    if (w > BOARD_W) {
        w = BOARD_W;
        h = w / SCENE_ASPECT;
    }

    SCENE_W = w;
    SCENE_H = h;
    SCENE_X = (BOARD_W - SCENE_W) / 2;
    SCENE_Y = (BOARD_H - SCENE_H) / 2;
    SCENE_SCALE = SCENE_W / SCENE_PX_W;
}

// ── Bild-Sequenz (Stop-Motion) ──────────────────────────────────────────────
// Der Hintergrund ist keine einzelne Aufnahme, sondern eine Folge gleich großer
// Vollbilder. 0_start ist der Ausgangszustand; jeder Effekt ist ein Abschnitt
// daraus, der beim Ablegen eines Partikels der Reihe nach abgespielt wird – die
// Bilder blenden dabei ineinander über. Reihenfolge = Ablege-Reihenfolge.
const FRAME_FILES = [
    '0-start.png',                // 0  Ausgangszustand
    '1-wasser.png',               // 1
    '2-wasser.png',               // 2
    '3-wasser.png',               // 3
    '4-wasser.png',               // 4
    '5-wasser.png',               // 5
    '6-schadstoffe.png',          // 6
    '7-schadstoffe.png',          // 7
    '8-schadstoffe.png',          // 8
    '9-schadstoffe.png',          // 9
    '10-schadstoffe.png',         // 10
    '11-organismen.png',          // 11
    '12-organismen.png',          // 12
    '13-organismen.png',          // 13
    '14-organismen.png',          // 14
    '15-organismen.png',          // 15
    '16-kohlenstoff.png',         // 16
    '17-kohlenstoff.png',         // 17
    '18-kohlenstoff.png',         // 18
    '19-kohlenstoff.png',         // 19
    '20-kohlenstoff.png',         // 20
    '21-pflanzenwachstum.png',    // 21
    '22-pflanzenwachstum.png',    // 22
    '23-pflanzenwachstum.png',    // 23
    '24-pflanzenwachstum.png',    // 24
    '25-pflanzenwachstum.png',    // 25
    '26-pflanzenwachstum.png',    // 26
    '27-pflanzenwachstum.png',    // 27
];

// Jedes Bild wird einmal auf einen weißen, deckenden Zwischen-Canvas gemalt.
// Grund: Die Vorlagen sind teils durchsichtig. Beim direkten Überblenden zweier
// durchsichtiger Bilder bleibt ein nur im alten Bild vorhandenes Element stehen
// (die durchsichtigen Stellen des neuen Bildes übermalen es nicht) und
// „springt" erst beim Bildwechsel weg – das sichtbare Aufblitzen. Auf weißem
// Grund (die Seite ist ohnehin weiß) sind die Bilder deckend, und die
// Überblendung wird zu einer sauberen, gleichmäßigen Auf-/Abblende.
const frames = FRAME_FILES.map(file => {
    const entry = { canvas: null, ready: false };
    const img = new Image();
    img.onload = () => {
        const off = document.createElement('canvas');
        off.width = SCENE_PX_W;
        off.height = SCENE_PX_H;
        const octx = off.getContext('2d');
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, SCENE_PX_W, SCENE_PX_H);
        octx.drawImage(img, 0, 0, SCENE_PX_W, SCENE_PX_H);
        entry.canvas = off;
        entry.ready = true;
        drawBackground();
    };
    img.src = '/img/interactionen/bodenfunktion/' + file;
    return entry;
});

// Die fünf Effekte in Auslöse-Reihenfolge. Jeder nennt die Bild-Indizes (in
// FRAME_FILES), die sein Abschnitt der Reihe nach zeigt.
const EFFECTS = [
    { id: 'wasser', frames: [1, 2, 3, 4, 5] },
    { id: 'schadstoffe', frames: [6, 7, 8, 9, 10] },
    { id: 'organismen', frames: [11, 12, 13, 14, 15] },
    { id: 'kohlenstoff', frames: [16, 17, 18, 19, 20] },
    { id: 'pflanzenwachstum', frames: [21, 22, 23, 24, 25, 26, 27] },
];
let effectIndex = 0;   // nächster auszulösender Effekt

// ── Erklär-Labels je Bild ────────────────────────────────────────────────────
// Zu jedem Bild ein kurzer Text, der mittig unter dem Boden erscheint, sobald
// das Bild dran ist. Stil wie die übrigen Labels (Akzentfarbe wie in
// Eintragspfade 2). Leerer Text ('') = kein Label. Index wie FRAME_FILES – hier
// die echten Erklärungen eintragen (die Platzhalter unten austauschen).
const FRAME_LABELS = [
    '',                                 // 0  Start
    'Bodenwasserhaushalt',                                          // 1
    'Neue Kanäle entstehen durch Partikel',                         // 2
    'Veränderung des Bodengefüges',                                 // 3
    'beschleunigter Wassertransport an die Oberfläche',             // 4
    'erhöhter Wasserverlust durch Verdunstung',                     // 5
    'Schadstoffe ',                                                 // 6
    'Mikroplastik als Träger von Schadstoffen',                     // 7
    'Bindung von Schwermetallen und Toxinen',                       // 8
    'Migration der Partikel tief in die Erde',                     // 9
    'Freisetzung der Toxine bei Zersetzung',                        // 10
    'Bodenorganismen',                                              // 11
    'Bodenorganismen nehmen Partikel auf',                          // 12
    'verursacht gesundheitliche Schäden und führt zu geringerem Überleben', // 13
    'Veränderung der mikrobiellen Umgebung',                        // 14
    'Steigerung der mikrobiellen Atmung',                           // 15
    'Kohlenstoffgehalt',                                            // 16
    'Partikel sind künstliche Kohlenstoffquelle',                   // 17
    'Beeinträchtigung der Kohlenstoffspeicherung',                  // 18
    'Rückgang der organischen Bodensubstanz',                       // 19
    'sinkende Nährstoffversorgung im Ökosystem',                    // 20
    'Pflanzenwachstum',                                             // 21
    'Wurzelaufnahme von Partikeln',                                 // 22
    'gehemmtes Wachstum',                                           // 23
    'Oxidativer Stress, gestörte Photosynthese, Genexpression',     // 24
    'Weitergabe über die Pflanzen in die Nahrungskette',            // 25
    'Gefährdung der Ernährungssicherung',                           // 26
    'langfristige Auswirkungen auf Böden, Organismen und Ernährungssicherung',   // 27
];

// Aussehen (wie die übrigen Labels) und Lage des Erklär-Labels. LABEL_UNDER_SOIL
// ist der senkrechte Abstand unter der Boden-Unterkante in Szene-Pixeln, damit
// das Label mit dem Bild mitwandert.
const LABEL_CORAL = '#fc655b';
const LABEL_CORAL_DEEP = '#c2372e';
const LABEL_UNDER_SOIL = 60;

// Überblendung (Stop-Motion): Dauer des Übergangs und Standzeit je Bild (ms).
const FRAME_FADE_MS = 500;
const FRAME_HOLD_MS = 260;

let animFrom = 0;        // vollständig gezeigtes Bild (Index in frames)
let animTo = null;       // Bild, das gerade eingeblendet wird, oder null
let animStart = 0;
let animHoldUntil = 0;
const animQueue = [];    // noch zu zeigende Bild-Indizes

function isAnimating() {
    return animTo !== null || animQueue.length > 0;
}

// Ein einzelnes Bild anfordern (eine Überblendung dorthin). Anders als früher
// wandert NICHT der ganze Abschnitt auf einmal in die Warteschlange: Das erste
// Bild kommt durchs Ablegen, die weiteren durchs Weiterdrehen.
function queueFrame(idx) {
    animQueue.push(idx);
    animHoldUntil = performance.now();   // sofort loslegen
}

// ── „Zeit weiterdrehen" (wie in produktionsabriss.js) ───────────────────────
// Das erste Bild eines Effekts löst das Ablegen aus. Die weiteren Bilder
// desselben Effekts kommen durchs Drehen des Smartphones: Die Winkeländerung
// (Beta) wird wie dort aufsummiert. Für den GESAMTEN Effekt ist eine ganze
// Umdrehung nötig (wie das linke Rad im Einführungsspiel) – die restlichen
// Bilder verteilen sich gleichmäßig auf diese 360° (vor wie zurück).
const WIND_FULL_TURN = 360;   // ganze Umdrehung zeigt den gesamten Effekt

let windMode = false;         // dreht der Besucher gerade die Zeit weiter?
let windEffect = null;        // Effekt, dessen Bilder gerade weitergedreht werden
let windSub = 0;              // erreichtes Bild im Abschnitt (0 = das erste)
let windCumulative = 0;       // aufsummierter Drehwinkel (mit Vorzeichen)
let windLastBeta = null;
let windPending = null;       // Effekt, dessen Weiterdrehen erst beginnt, sobald
                              // sein erstes Bild vollständig steht – nicht schon
                              // während der Überblendung, sonst zählte die
                              // Bewegung beim Ablegen mit und ein Bild rückte ohne
                              // Drehen weiter.

// Löst den nächsten Effekt aus: erstes Bild sofort (durchs Ablegen). Das
// Weiterdrehen für die restlichen Bilder wird erst scharf gestellt, wenn dieses
// erste Bild fertig eingeblendet ist (activateWinding im gameLoop).
function startNextEffect() {
    const eff = EFFECTS[effectIndex];
    if (!eff) return;
    effectIndex++;

    queueFrame(eff.frames[0]);
    windPending = eff.frames.length > 1 ? eff : null;
}

// Weiterdrehen scharf stellen – mit frischem Nullpunkt, damit nur die Drehung
// AB HIER zählt.
function activateWinding() {
    windEffect = windPending;
    windPending = null;
    windSub = 0;
    windCumulative = 0;
    windLastBeta = null;
    windMode = true;
}

// Dreht die Zeit um `deltaDeg` Grad weiter (Gerät oder Maus liefern die Grad).
function windBy(deltaDeg) {
    if (!windMode) return;
    windCumulative += deltaDeg;
}

// Grad, die einem Bild-Schritt des aktuellen Effekts entsprechen (die ganze
// Umdrehung gleichmäßig auf die restlichen Bilder verteilt). Ein Maus-Klick
// dreht genau so viel – sonst schösse ein fester Winkel bei ungerader Bildzahl
// über einen Schritt hinaus und ein Bild rückte ohne Klick weiter.
function windStepDeg() {
    if (!windEffect || windEffect.frames.length < 2) return WIND_FULL_TURN;
    return WIND_FULL_TURN / (windEffect.frames.length - 1);
}

// Rückt Bild für Bild vor bzw. zurück – aber nur, wenn keine Überblendung läuft,
// damit sich zwei nicht überlagern. Am letzten Bild ist der Effekt durch.
function updateWinding() {
    if (!windMode || isAnimating()) return;

    const n = windEffect.frames.length;
    // Die (n − 1) weiteren Bilder verteilen sich gleichmäßig auf eine ganze
    // Umdrehung; das letzte ist erst nach vollen 360° erreicht.
    const reached = clamp(Math.floor(Math.abs(windCumulative) / windStepDeg()), 0, n - 1);

    if (reached > windSub) {
        windSub += 1;                       // ein Schritt nach vorn
        queueFrame(windEffect.frames[windSub]);
        if (windSub === n - 1) finishWinding();
    } else if (reached < windSub) {
        windSub -= 1;                       // ein Schritt zurück
        queueFrame(windEffect.frames[windSub]);
    }
}

// Weiterdrehen beendet: zurück in den Zeiger-/Ablege-Betrieb. Der Zeiger behält
// seinen alten Nullpunkt – nach einer ganzen Umdrehung steht das Gerät wieder
// wie zuvor, der Zeiger macht also dort weiter, wo er war. (Ihn hier auf die
// aktuelle, evtl. verdrehte Lage neu zu beziehen, ließ ihn an den Rand springen.)
function finishWinding() {
    windMode = false;
    windEffect = null;
}

// Treibt die Überblendung Bild für Bild voran; wird im gameLoop aufgerufen.
function updateAnimation() {
    if (!isAnimating()) return;
    const now = performance.now();

    if (animTo !== null) {
        const t = clamp((now - animStart) / FRAME_FADE_MS, 0, 1);
        drawBackground(t);
        if (t >= 1) {
            animFrom = animTo;
            animTo = null;
            animHoldUntil = now + FRAME_HOLD_MS;
            drawBackground();
        }
    } else if (now >= animHoldUntil) {
        animTo = animQueue.shift();
        animStart = now;
    }
}

// Hintergrund malen: das aktuelle Bild voll, bei laufender Überblendung das
// nächste mit Deckkraft `t` darüber. Wird bei Resize, nach dem Laden und
// während der Animation aufgerufen.
function drawBackground(t) {
    if (!BOARD_W) return;
    const from = frames[animFrom];
    if (!from || !from.ready) return;

    bgctx.clearRect(0, 0, BOARD_W, BOARD_H);
    bgctx.drawImage(from.canvas, SCENE_X, SCENE_Y, SCENE_W, SCENE_H);

    if (animTo !== null && t !== undefined) {
        const to = frames[animTo];
        if (to && to.ready) {
            bgctx.save();
            bgctx.globalAlpha = t;
            bgctx.drawImage(to.canvas, SCENE_X, SCENE_Y, SCENE_W, SCENE_H);
            bgctx.restore();
        }
    }
}

// Bühne = Board: Zeiger-Umrechnung ist die Mausposition relativ zur Ecke.
function boardPointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

// Passt Leinwände und Layout an die aktuelle Bühnengröße an.
function resizeBoard() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    BOARD_W = rect.width;
    BOARD_H = rect.height;

    const dpr = window.devicePixelRatio || 1;
    [bgCanvas, canvas, introCanvas].forEach((cv) => {
        cv.width = Math.round(rect.width * dpr);
        cv.height = Math.round(rect.height * dpr);
        cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    layoutScene();
    layoutParticles();
    layoutLehre();
    drawBackground();
}

// ── Zeiger ───────────────────────────────────────────────────────────────
const TILT_RANGE_X = 40;
const TILT_RANGE_Y = 30;
const DEAD_ZONE = 2.5;
const SMOOTHING = 0.08;

const gammaBase = new Baseline({ wrap: false });
const betaBase = new Baseline({ wrap: false });

let targetX = BOARD_W / 2;
let targetY = BOARD_H / 2;
let cursorX = BOARD_W / 2;
let cursorY = BOARD_H / 2;
let isCursorPlaced = false;

function moveCursor(dGamma, dBeta) {
    let x = Math.abs(dGamma) < DEAD_ZONE ? 0 : dGamma;
    let y = Math.abs(dBeta) < DEAD_ZONE ? 0 : dBeta;

    x = clamp(x, -TILT_RANGE_X, TILT_RANGE_X);
    y = clamp(y, -TILT_RANGE_Y, TILT_RANGE_Y);

    targetX = ((x + TILT_RANGE_X) / (2 * TILT_RANGE_X)) * BOARD_W;
    targetY = ((y + TILT_RANGE_Y) / (2 * TILT_RANGE_Y)) * BOARD_H;

    if (!isCursorPlaced) {
        cursorX = targetX;
        cursorY = targetY;
        isCursorPlaced = true;
    }
}

// Ohne gekoppeltes Smartphone folgt der Zeiger der Maus – auch während der
// Einführung, deren Übungsspiel denselben Zeiger braucht.
stage.addEventListener('mousemove', (event) => {
    if (connection.hasController()) return;
    if (calibration.isActive()) return;
    // Während der Dreh-Übung ruht der Zeiger.
    if (isIntroVisible && !lehreDone && lehreWindActive) return;

    const point = boardPointFrom(event);
    targetX = point.x;
    targetY = point.y;

    if (!isCursorPlaced) {
        cursorX = targetX;
        cursorY = targetY;
        isCursorPlaced = true;
    }
});

// Hilfe beim Einrichten: Ein Klick ohne gekoppeltes Gerät schreibt die
// Board-Koordinaten der Klickstelle in die Konsole – zusätzlich in Szene-Pixeln
// (die Zahlen, die unten in PARTIKEL als sx/sy stehen).
canvas.addEventListener('click', (event) => {
    if (connection.hasController()) return;

    // Ohne Gerät: im Weiterdrehen-Modus dreht ein Klick die Zeit ein Stück weiter.
    if (windMode) { windBy(windStepDeg()); return; }

    const point = boardPointFrom(event);
    const sx = Math.round((point.x - SCENE_X) / SCENE_SCALE);
    const sy = Math.round((point.y - SCENE_Y) / SCENE_SCALE);
    console.log(`board x:${Math.round(point.x)} y:${Math.round(point.y)}  szene sx:${sx} sy:${sy}`);
});

// ── Magnet ───────────────────────────────────────────────────────────────
const MAGNET_RADIUS = 85;
const MAGNET_STRENGTH = 0.4;
const MAGNET_SNAP_RATIO = 0.25;

function magnetPull(x, y, tx, ty, radius = MAGNET_RADIUS, strength = MAGNET_STRENGTH) {
    const dx = tx - x;
    const dy = ty - y;
    const dist = Math.hypot(dx, dy);

    if (dist >= radius) return { x, y };
    if (dist < radius * MAGNET_SNAP_RATIO) return { x: tx, y: ty };

    const pull = (1 - dist / radius) * strength;
    return { x: x + dx * pull, y: y + dy * pull };
}

// ── Bodenbereich (Ablege-Zone) ──────────────────────────────────────────────
// Ein getragenes Partikel lässt sich nur über der braunen Boden-Collage ablegen.
// Die Grenzen sind in Szene-Pixeln (0..1512 / 0..870) angegeben und wandern mit
// dem Bild. HIER die vier Werte anpassen (ein Klick ohne Gerät schreibt passende
// Szene-Koordinaten in die Konsole). DEBUG_SOIL blendet ein rotes Testrechteck
// um die Zone ein – zum Einstellen; später auf false setzen.
const SOIL_ZONE = { left: 355, top: 250, right: 1090, bottom: 665 };
const DEBUG_SOIL = false;

function inSoilZone(x, y) {
    return x >= sceneX(SOIL_ZONE.left) && x <= sceneX(SOIL_ZONE.right)
        && y >= sceneY(SOIL_ZONE.top) && y <= sceneY(SOIL_ZONE.bottom);
}

// ── Partikel ────────────────────────────────────────────────────────────────
// Fünf Mikroplastik-Partikel liegen auf dem Hintergrund verteilt. Positionen in
// Szene-Pixeln (0..1512 / 0..870, siehe SCENE_PX_*), damit sie mit dem Bild
// mitwandern. Ansteuern und Halten nimmt eines auf (es klebt dann am Zeiger),
// über dem Bodenbereich abgelegt löst es den nächsten Effekt aus. Ein Klick ohne
// Gerät schreibt passende sx/sy in die Konsole.
//   sx/sy  Position in Szene-Pixeln
//   rot    ►DREHUNG◄ des Partikels in Grad (frei einstellbar; 0 = wie das Bild;
//          bleibt auch erhalten, während es am Zeiger klebt)
const PARTIKEL_NAT_W = 139;
const PARTIKEL_NAT_H = 130;
const PARTIKEL_SCALE = 0.85;   // Größe bezogen auf die Szene

const PARTIKEL = [
    { id: 'p1', sx: 90, sy: 332, rot: 0 },
    { id: 'p2', sx: 214, sy: 222, rot: 65 },
    { id: 'p3', sx: 131, sy: 552, rot: -50 },
    { id: 'p4', sx: 240, sy: 480, rot: -10 },
    { id: 'p5', sx: 270, sy: 574, rot: -150 },
];

const partikelImg = new Image();
let partikelReady = false;
partikelImg.onload = () => { partikelReady = true; };
partikelImg.src = '/img/interactionen/bodenfunktion/partikel.png';

const particles = PARTIKEL.map(p => ({
    ...p,
    x: 0, y: 0, w: 0, h: 0,   // aktuelle Lage/Größe in Board-Pixeln
    carried: false,           // klebt gerade am Zeiger
    placed: false,            // im Boden abgelegt (verbraucht)
}));

function layoutParticles() {
    const w = PARTIKEL_NAT_W * SCENE_SCALE * PARTIKEL_SCALE;
    const h = PARTIKEL_NAT_H * SCENE_SCALE * PARTIKEL_SCALE;
    particles.forEach(p => {
        p.x = sceneX(p.sx);
        p.y = sceneY(p.sy);
        p.w = w;
        p.h = h;
    });

    // Einheitliche Kringel-Größe für alle: an der Partikelgröße ausgerichtet.
    kringelSize = Math.max(w, h) * KRINGEL_SIZE_FACTOR;
}

// Griffweite/Trefferradius: an die Partikelgröße gekoppelt.
function pickRadius(p) {
    return Math.max(50, (p.w + p.h) / 3);
}

// Ziel des Haltens: beim Aufnehmen die Partikel-Id, beim Ablegen 'soil', sonst
// null. `carriedId` ist das getragene Partikel (oder null).
let targetId = null;
let holdStart = 0;
const HOLD_MS = 900;
let carriedId = null;

// Kurze Sperre nach Aufnehmen/Ablegen, damit dieselbe Haltegeste nicht sofort
// erneut greift (etwa Ablegen unmittelbar nach dem Aufnehmen im Bodenbereich).
const ACTION_COOLDOWN_MS = 450;
let actionBlockedUntil = 0;

function particleUnderCursor() {
    let nearest = null;
    let nearestDist = Infinity;

    particles.forEach(p => {
        if (p.placed || p.carried) return;
        const dist = Math.hypot(cursorX - p.x, cursorY - p.y);
        const r = pickRadius(p);
        if (dist < r && dist < nearestDist) {
            nearest = p.id;
            nearestDist = dist;
        }
    });

    return nearest;
}

function setHoldTarget(id) {
    if (targetId === id) return;
    targetId = id;
    holdStart = Date.now();
}

function holdProgress() {
    if (!targetId) return 0;
    return clamp((Date.now() - holdStart) / HOLD_MS, 0, 1);
}

function pickUp(p) {
    carriedId = p.id;
    p.carried = true;
    targetId = null;
    actionBlockedUntil = Date.now() + ACTION_COOLDOWN_MS;
}

// Über dem Bodenbereich abgelegt: Das Partikel ist verbraucht und startet den
// nächsten Effekt-Abschnitt der Bildfolge.
function dropCarried() {
    const p = particles.find(x => x.id === carriedId);
    if (!p) return;
    p.carried = false;
    p.placed = true;
    carriedId = null;
    targetId = null;
    actionBlockedUntil = Date.now() + ACTION_COOLDOWN_MS;

    startNextEffect();

    if (particles.every(x => x.placed)) {
        reportCompletion({ label: 'Alle Partikel abgelegt' });
    }
}

// Verbindungsverlust: Fortschritt und Animation gehen zurück auf Anfang, statt
// mit einem neuen Gerät an unklarer Stelle weiterzulaufen.
function resetInteractiveState() {
    targetId = null;
    carriedId = null;
    isCursorPlaced = false;
    particles.forEach(p => { p.carried = false; p.placed = false; });

    windMode = false;
    windEffect = null;
    windPending = null;
    windCumulative = 0;
    windSub = 0;
    windLastBeta = null;

    effectIndex = 0;
    animQueue.length = 0;
    animTo = null;
    animFrom = 0;
    drawBackground();
}

function updateGame() {
    // Getragenes Partikel folgt dem Zeiger.
    if (carriedId) {
        const p = particles.find(x => x.id === carriedId);
        p.x = cursorX;
        p.y = cursorY;
    }

    if (Date.now() < actionBlockedUntil) {
        targetId = null;
        return;
    }

    // Etwas in der Hand: nur über dem Bodenbereich ablegen.
    if (carriedId) {
        if (inSoilZone(cursorX, cursorY)) {
            setHoldTarget('soil');
            if (holdProgress() >= 1) dropCarried();
        } else {
            targetId = null;
        }
        return;
    }

    // Nichts in der Hand: ein ruhendes Partikel aufnehmen.
    const candidate = particleUnderCursor();
    if (candidate) {
        setHoldTarget(candidate);
        if (holdProgress() >= 1) pickUp(particles.find(p => p.id === candidate));
    } else {
        targetId = null;
    }
}

// ── Kringel (Aufnehmen und Ablegen) ─────────────────────────────────────────
// Beim Halten zeichnet sich der Kringel (kringel2.png) entlang seiner
// Mittellinie (kringel2.svg) fort – dieselbe Sprache wie in den übrigen
// Stationen. Auf dem Canvas per Strich entlang des Pfades freigelegt.
const KRINGEL_VB_W = 499;
const KRINGEL_VB_H = 307;
const KRINGEL_D = 'M331.5 70.5L330 65C330 65 287.5 50 258.5 51.5C229.5 53 161.511 63.7435 110.5 96C76.3959 117.566 49.0001 132 34.5002 166C20.0004 200 30.0002 214 30.0002 214C30.0002 214 48 268.5 141 284.5C234 300.5 269.5 289 269.5 289C269.5 289 378.718 274.937 422 227.5C445.036 202.254 466.774 185.1 464.5 151C462 113.5 446.5 97.5 417 68C387.5 38.5 321.5 31 321.5 31L239.5 24H181';

const KRINGEL_STROKE_VB = 26;
const KRINGEL_SIZE_FACTOR = 1.7; // Größe bezogen auf das Partikel

let kringelSize = 0;

const kringelImg = new Image();
kringelImg.src = '/img/interactionen/transportmechanismen/kringel2.png';
const kringelPath = new Path2D(KRINGEL_D);

// Pfadlänge einmal messen – ein kurzlebiges Off-Screen-SVG gibt den nötigen
// Rendering-Kontext für getTotalLength().
const kringelLen = (() => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', KRINGEL_D);
    svg.appendChild(p);
    document.body.appendChild(svg);
    const len = p.getTotalLength();
    document.body.removeChild(svg);
    return len;
})();

const kringelCanvas = document.createElement('canvas');
const kctx = kringelCanvas.getContext('2d');

function drawKringel(cx, cy, size, progress) {
    if (progress <= 0 || !kringelImg.complete || !kringelImg.naturalWidth) return;

    const boxW = size;
    const boxH = size * (KRINGEL_VB_H / KRINGEL_VB_W);
    const dpr = window.devicePixelRatio || 1;

    kringelCanvas.width = Math.max(1, Math.round(boxW * dpr));
    kringelCanvas.height = Math.max(1, Math.round(boxH * dpr));
    kctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kctx.clearRect(0, 0, boxW, boxH);

    kctx.drawImage(kringelImg, 0, 0, boxW, boxH);

    const sc = boxW / KRINGEL_VB_W;
    kctx.save();
    kctx.globalCompositeOperation = 'destination-in';
    kctx.scale(sc, sc);
    kctx.lineWidth = KRINGEL_STROKE_VB;
    kctx.lineCap = 'round';
    kctx.lineJoin = 'round';
    kctx.setLineDash([kringelLen]);
    kctx.lineDashOffset = kringelLen * (1 - progress);
    kctx.strokeStyle = '#000';
    kctx.stroke(kringelPath);
    kctx.restore();

    ctx.drawImage(kringelCanvas, cx - boxW / 2, cy - boxH / 2, boxW, boxH);
}

// ── Zeichnen ─────────────────────────────────────────────────────────────

function drawParticle(p) {
    ctx.save();
    // Getragen: klebt am Zeiger und wird angehoben (Schatten).
    if (p.carried) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 16;
    }

    ctx.translate(p.x, p.y);
    ctx.rotate((p.rot || 0) * Math.PI / 180);

    if (partikelReady) {
        ctx.drawImage(partikelImg, -p.w / 2, -p.h / 2, p.w, p.h);
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(p.w, p.h) / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#f472b6';
        ctx.fill();
    }
    ctx.restore();
}

function drawCursorOn(context, x = cursorX, y = cursorY) {
    context.beginPath();
    context.arc(x, y, 16, 0, Math.PI * 2);
    context.fillStyle = 'rgba(15, 23, 42, 0.12)';
    context.fill();

    context.beginPath();
    context.arc(x, y, 9, 0, Math.PI * 2);
    context.fillStyle = '#0f172a';
    context.fill();
}

// Rotes Testrechteck um den Bodenbereich (nur wenn DEBUG_SOIL).
function drawSoilZone() {
    const x = sceneX(SOIL_ZONE.left);
    const y = sceneY(SOIL_ZONE.top);
    const w = (SOIL_ZONE.right - SOIL_ZONE.left) * SCENE_SCALE;
    const h = (SOIL_ZONE.bottom - SOIL_ZONE.top) * SCENE_SCALE;
    ctx.save();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
}

// Erklär-Label mittig unter dem Boden – Stil wie die übrigen Labels. Gezeigt
// wird der Text des gerade dran seienden Bildes (bei laufender Überblendung das
// einblendende). Leerer Text = kein Label.
function drawStepLabel() {
    const idx = animTo !== null ? animTo : animFrom;
    const text = FRAME_LABELS[idx];
    if (!text) return;

    const cx = sceneX((SOIL_ZONE.left + SOIL_ZONE.right) / 2);
    const cy = sceneY(SOIL_ZONE.bottom + LABEL_UNDER_SOIL);

    const padX = 14;
    const padY = 9;
    ctx.font = '400 18px "Inclusive Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
    const width = ctx.measureText(text).width + padX * 2;
    const height = 18 + padY * 2;
    const left = cx - width / 2;
    const top = cy - height / 2;

    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 11);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fill();
    ctx.strokeStyle = LABEL_CORAL;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = LABEL_CORAL_DEEP;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

function drawFrame() {
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    if (DEBUG_SOIL) drawSoilZone();

    // Erklär-Label mittig unter dem Boden.
    drawStepLabel();

    // Ruhende Partikel zuerst, das getragene darüber. Abgelegte sind verbraucht.
    particles.forEach(p => { if (!p.placed && !p.carried) drawParticle(p); });
    const held = particles.find(p => p.carried);
    if (held) drawParticle(held);

    // Kringel beim Halten – über dem Partikel (Aufnehmen) bzw. am Zeiger im
    // Bodenbereich (Ablegen).
    if (targetId === 'soil') {
        drawKringel(cursorX, cursorY, kringelSize, holdProgress());
    } else if (targetId) {
        const p = particles.find(x => x.id === targetId);
        if (p) drawKringel(p.x, p.y, kringelSize, holdProgress());
    }

    // Beim Weiterdrehen ruht der Zeiger und ist ausgeblendet.
    if (!windMode) drawCursorOn(ctx);
}

let gameFrame = null;

function gameLoop() {
    cursorX += (targetX - cursorX) * SMOOTHING;
    cursorY += (targetY - cursorY) * SMOOTHING;

    if (isIntroVisible) {
        if (!lehreDone) {
            // Beim Weiterdrehen ruht das Aufnehmen/Ablegen – nur die Drehung zählt.
            if (!lehreWindActive) updateLehre();
            drawLehre();
        }
    } else {
        // Läuft eine Überblendung, ruht die Bedienung, bis sie durch ist.
        updateAnimation();
        // Weiterdrehen erst scharf stellen, wenn das erste Bild des Effekts steht.
        if (windPending && !isAnimating()) activateWinding();
        if (windMode) {
            updateWinding();
        } else if (!isAnimating()) {
            updateGame();
        }
        drawFrame();
    }

    gameFrame = requestAnimationFrame(gameLoop);
}

// ── Einführung ───────────────────────────────────────────────────────────
let isIntroVisible = true;
const startShake = createLongShake();

function dismissIntro() {
    if (!isIntroVisible) return;
    isIntroVisible = false;
    intro.classList.add('is-gone');

    bgCanvas.classList.remove('is-waiting');
    canvas.classList.remove('is-waiting');
}

socket.on('shake', () => {
    if (calibration.isActive()) return;

    if (isIntroVisible) {
        if (!lehreDone) {
            if (lehreHeldId) lehreReleaseCarried();
            return;
        }

        if (startShake.register()) dismissIntro();
        return;
    }
    // Im eigentlichen Spiel hat das Schütteln vorerst keine Wirkung.
});

// .lehre-game hat pointer-events:none, deshalb liegt der Listener auf intro.
// Ein Klick auf die weiße Fläche überspringt das Einführungsspiel und führt
// direkt zur Intro-Box.
intro.addEventListener('click', () => {
    if (!lehreDone) {
        finishLehre();
        return;
    }
    if (connection.hasController()) return;
    dismissIntro();
});

// ── Kalibrierung & Sensordaten ────────────────────────────────────────────
function calibrate() {
    gammaBase.reset();
    betaBase.reset();
    isCursorPlaced = false;
}

const calibrateEverywhere = shareCalibration(calibrate);
calBtn.addEventListener('click', calibrateEverywhere);

window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    calibrateEverywhere();
});

const calibration = initCalibration({
    onCalibrate: calibrateEverywhere,
    parent: stage,
    accentRgb: ACCENT_RGB,
    onDone: () => intro.classList.remove('is-waiting'),
});

socket.on('sensorData', (data) => {
    if (calibration.isActive()) return;

    const gamma = data.gamma !== null ? data.gamma : 0;
    const beta = data.beta !== null ? data.beta : 0;

    // Einführungsspiel: während der Dreh-Übung zählt nur die Beta-Drehung.
    if (isIntroVisible && !lehreDone && lehreWindActive) {
        if (lehreWindLastBeta === null) { lehreWindLastBeta = beta; return; }
        turnLehreWind(wrapDeg180(beta - lehreWindLastBeta));
        lehreWindLastBeta = beta;
        return;
    }

    // Beim Weiterdrehen zählt nur die Beta-Drehung (wie in Produktionsabriss);
    // der Zeiger ruht solange.
    if (windMode) {
        if (windLastBeta === null) { windLastBeta = beta; return; }
        windBy(wrapDeg180(beta - windLastBeta));
        windLastBeta = beta;
        return;
    }

    moveCursor(gammaBase.delta(gamma), betaBase.delta(beta));
});

// ═══════════════════════════════════════════════════════════════════════════
//  Einführungsspiel auf dem Startbildschirm — die vier Gesten üben
//
//  Drei Kreise liegen links (Vorrat, Startposition). Ansteuern und Halten nimmt
//  einen auf; über dem nächsten freien Platz der welligen Linie abgelegt (wieder
//  Halten) setzt ihn dort. Danach muss das Smartphone einmal gedreht werden – wie
//  im Spiel „die Zeit weiterdrehen" (produktionsabriss.js): Die hell-orange Linie
//  füllt sich dabei in der Akzentfarbe bis zum nächsten Platz, der so erst
//  freigegeben wird. Nacheinander geübt: freie Bewegung, Halten (Aufnehmen und
//  Ablegen) und Drehen.
// ═══════════════════════════════════════════════════════════════════════════

const lehreGame = byId('lehreGame');
const introBox = byId('introBox');
const introCanvas = byId('introCanvas');
const ictx = introCanvas.getContext('2d');
const lehreInstruction = lehreGame.querySelector('.lehre-instruction');
const lehreWheel = byId('lehreWheel');
const lehreWheelFill = byId('lehreWheelFill');
const phoneLehre = byId('phoneLehre');

const LEHRE_GAME_FADE = 400;
const LEHRE_DOT = 30;
const LEHRE_HIT = 46;
const LEHRE_RING_WEIT = 150;
const LEHRE_RING_STRICH = 3;

// Kreise-Vorrat links (Startposition). Reihenfolge egal – jeder Kreis passt auf
// den jeweils nächsten freien Platz.
const LEHRE_DOTS = [
    { id: 'd1', fx: 0.11, fy: 0.20, x: 0, y: 0 },
    { id: 'd2', fx: 0.11, fy: 0.40, x: 0, y: 0 },
    { id: 'd3', fx: 0.11, fy: 0.60, x: 0, y: 0 },
];

// ── Wellige Linie (Zeitstrahl) ──────────────────────────────────────────────
// Eine einfache Sinuswelle etwas unterhalb der Mitte. Drei Plätze im gleichen
// Abstand (t = 0, ½, 1) sitzen darauf; die Füllung (Akzent über hell-orange)
// wandert beim Drehen von Platz zu Platz. Alles in Board-Anteilen, damit es beim
// Resize mitwandert.
const LINE_X0 = 0.20, LINE_X1 = 0.80;   // Anfang/Ende auf der Bühne (horizontal mittig)
const LINE_Y = 0.62;                      // Mittellinie (etwas unter der Mitte)
const LINE_AMP = 0.06;                    // Wellenhöhe (Anteil der Bühnenhöhe)
const LINE_PERIODS = 2;                   // volle Wellen je t-Einheit
// Zeichenbereich der Welle. Die drei Plätze liegen bei t = 0, ½, 1 (Minima);
// t = 1…1.5 ist der Schwanz hinter dem letzten Platz – ein Maximum (t = 1.25)
// und ein Minimum (t = 1.5), in dem die Linie ohne weiteren Platz endet. Weil
// der ganze Bereich (0…1.5) in dieselbe Breite gemappt wird, staucht sich die
// Kurve.
const LINE_T_END = 1.5;
const LINE_WIDTH = 5;
const LINE_LIGHT = `rgba(${ACCENT_RGB}, 0.35)`;   // Akzent, nur heller (Grundlinie)
const LINE_ACCENT = `rgb(${ACCENT_RGB})`;         // Akzent (gefüllt)

// Punkt t entlang der Linie -> Board-Koordinaten. Cosinus, damit die Welle in
// einem Minimum (unteres Wellental) startet und bei t = 0, ½, 1 wieder dort ist.
function lineX(t) { return (LINE_X0 + (LINE_X1 - LINE_X0) * (t / LINE_T_END)) * BOARD_W; }
function lineY(t) { return LINE_Y * BOARD_H + Math.cos(t * Math.PI * 2 * LINE_PERIODS) * LINE_AMP * BOARD_H; }

// Die drei Plätze mit ihrer Füll-Marke (Anteil der Linie, den die Füllung dort
// erreicht hat).
const LEHRE_SPOTS = [
    { t: 0.0, fill: 0.0, x: 0, y: 0 },
    { t: 0.5, fill: 0.5, x: 0, y: 0 },
    { t: 1.0, fill: 1.0, x: 0, y: 0 },
];

function layoutLehre() {
    LEHRE_DOTS.forEach(d => { d.x = d.fx * BOARD_W; d.y = d.fy * BOARD_H; });
    // Die Plätze sitzen in den Wellentälern (Minima) – bei t = 0, ½, 1 gleich
    // hoch, weil die Cosinus-Welle dort jeweils ihr Minimum hat.
    LEHRE_SPOTS.forEach(s => { s.x = lineX(s.t); s.y = lineY(s.t); });
}

const punktBild = new Image();
punktBild.src = '/img/interactionen/eintragspfade/punkt.png';

// ── Ablauf-Zustand ──────────────────────────────────────────────────────────
let lehreHeldId = null;       // getragener Kreis (oder null)
let lehreTargetKind = null;   // 'dot' (aufnehmen) | 'spot' (ablegen) | null
let lehreTargetId = null;
let lehreHoldStart = 0;
const lehreUsed = new Set();  // verbrauchte Vorrats-Kreise
let lehrePlaced = 0;          // gesetzte Kreise = Index des nächsten Platzes
let lehreDone = false;
let lehreFill = 0;            // Füllstand der Linie (0..1)

// ── Zeit weiterdrehen (wie in produktionsabriss.js) ─────────────────────────
// Nach jedem Ablegen füllt eine ganze Umdrehung die Linie bis zum nächsten Platz
// und gibt ihn frei. Gezählt wird die Beta-Drehung, kumulativ und mit Vorzeichen.
const LEHRE_TURN = 360;        // eine ganze Umdrehung je Platz
const LEHRE_MOUSE_TURN = 45;   // Grad je Mausklick ohne Gerät
let lehreWindActive = false;
let lehreWindFrom = 0, lehreWindTo = 0;
let lehreWindCumulative = 0;
let lehreWindLastBeta = null;
let lehreWindFinal = false;   // die Schluss-Drehung, nach der die Übung endet

function startLehreWind(from, to, final = false) {
    lehreWindActive = true;
    lehreWindFrom = from;
    lehreWindTo = to;
    lehreWindFinal = final;
    lehreWindCumulative = 0;
    lehreWindLastBeta = null;
    lehreWheel.classList.add('is-active');   // Ring + Gerät voll sichtbar beim Drehen
    setLehreWheel(0);
    updateLehrePhone();
    setLehreInstruction();
}

function turnLehreWind(delta) {
    if (!lehreWindActive) return;
    lehreWindCumulative += delta;
    updateLehrePhone();
    const progress = clamp(Math.abs(lehreWindCumulative) / LEHRE_TURN, 0, 1);
    setLehreWheel(progress);
    lehreFill = lehreWindFrom + (lehreWindTo - lehreWindFrom) * progress;
    if (progress >= 1) finishLehreWind();
}

// Das Gerät auf dem Bildschirm dreht sich 1:1 mit (wie in produktionsabriss.js).
// Minus, weil rotateX die Oberkante bei positivem Wert vom Betrachter wegkippt,
// während beta dabei kleiner wird.
function updateLehrePhone() {
    phoneLehre.style.transform = `rotateX(${(-lehreWindCumulative).toFixed(1)}deg)`;
}

// Der Ring zeigt den Fortschritt der einen Umdrehung (0..1) – wie in
// produktionsabriss.js über den Versatz des Strichmusters.
function setLehreWheel(share) {
    const limited = clamp(share, 0, 1);
    lehreWheelFill.style.strokeDashoffset = String(100 * (1 - limited));
}

// Umdrehung voll: nächster Platz frei, zurück ins Ablegen. War es die
// Schluss-Drehung (Schwanz gefüllt), ist die Übung aus. Ring + Gerät werden
// wieder gedimmt, sobald nicht mehr gedreht werden soll.
function finishLehreWind() {
    lehreWindActive = false;
    lehreFill = lehreWindTo;
    lehreWheel.classList.remove('is-active');
    if (lehreWindFinal) { finishLehre(); return; }
    setLehreInstruction();
}

function setLehreInstruction() {
    if (!lehreInstruction) return;
    lehreInstruction.textContent = lehreWindActive
        ? 'drehe von dir weg, um die zeit weiterzudrehen'
        : 'kreis aufnehmen und auf der linie platzieren';
}

function setLehreTarget(kind, id) {
    if (lehreTargetKind === kind && lehreTargetId === id) return;
    lehreTargetKind = kind;
    lehreTargetId = id;
    lehreHoldStart = Date.now();
}

function clearLehreTarget() {
    lehreTargetKind = null;
    lehreTargetId = null;
}

function lehreHoldProgress() {
    if (!lehreTargetId) return 0;
    return clamp((Date.now() - lehreHoldStart) / HOLD_MS, 0, 1);
}

function lehrePickUp(id) {
    lehreHeldId = id;
    clearLehreTarget();
}

// Schütteln bricht das Tragen ab: Der Kreis wandert zurück in den Vorrat.
function lehreReleaseCarried() {
    lehreHeldId = null;
    clearLehreTarget();
}

// Auf dem aktiven Platz abgelegt: Kreis verbraucht, Füllung springt auf den
// Platz. Bleibt ein weiterer, muss erst gedreht werden; sonst ist die Übung aus.
function lehrePlaceSpot() {
    const i = lehrePlaced;
    lehreUsed.add(lehreHeldId);
    lehreHeldId = null;
    clearLehreTarget();
    lehrePlaced += 1;
    lehreFill = LEHRE_SPOTS[i].fill;

    if (lehrePlaced >= LEHRE_SPOTS.length) {
        // Letztes Platzieren: noch einmal drehen füllt den Schwanz (Maximum,
        // Minimum), danach ist die Übung aus.
        startLehreWind(LEHRE_SPOTS[i].fill, LINE_T_END, true);
        return;
    }
    startLehreWind(LEHRE_SPOTS[i].fill, LEHRE_SPOTS[i + 1].fill);
}

function updateLehre() {
    // Etwas in der Hand: nur der nächste freie Platz nimmt es an.
    if (lehreHeldId) {
        const spot = LEHRE_SPOTS[lehrePlaced];
        if (spot && Math.hypot(cursorX - spot.x, cursorY - spot.y) < LEHRE_HIT) {
            setLehreTarget('spot', 'spot' + lehrePlaced);
            if (lehreHoldProgress() >= 1) lehrePlaceSpot();
        } else {
            clearLehreTarget();
        }
        return;
    }

    // Nichts in der Hand: einen Vorrats-Kreis aufnehmen.
    const candidate = LEHRE_DOTS.find(dot => {
        if (lehreUsed.has(dot.id)) return false;
        return Math.hypot(cursorX - dot.x, cursorY - dot.y) < LEHRE_HIT;
    });

    if (candidate) {
        setLehreTarget('dot', candidate.id);
        if (lehreHoldProgress() >= 1) lehrePickUp(candidate.id);
    } else {
        clearLehreTarget();
    }
}

// ── Zeichnen ────────────────────────────────────────────────────────────────

// Den Wellenpfad in den aktuellen Kontext legen (noch nicht zeichnen).
function traceWave(steps) {
    ictx.beginPath();
    for (let k = 0; k <= steps; k++) {
        const t = (k / steps) * LINE_T_END;
        const x = lineX(t), y = lineY(t);
        if (k === 0) ictx.moveTo(x, y); else ictx.lineTo(x, y);
    }
}

// Wellige Linie: erst die helle Grundlinie ganz, dann dieselbe Welle in der
// Akzentfarbe bis zur Füll-Kante (per Clip abgeschnitten). Nach dem Clip wird
// der Wellenpfad neu gelegt – sonst stünde noch das Clip-Rechteck im Pfad.
function drawLehreLine() {
    const steps = 120;

    ictx.save();
    ictx.lineWidth = LINE_WIDTH;
    ictx.lineCap = 'round';
    ictx.lineJoin = 'round';

    traceWave(steps);
    ictx.strokeStyle = LINE_LIGHT;
    ictx.stroke();

    // Akzent nur bis zur Füll-Kante.
    ictx.save();
    ictx.beginPath();
    ictx.rect(0, 0, lineX(lehreFill), BOARD_H);
    ictx.clip();
    traceWave(steps);
    ictx.strokeStyle = LINE_ACCENT;
    ictx.stroke();
    ictx.restore();

    ictx.restore();
}

function drawLehreRing(x, y, progress) {
    if (progress <= 0) return;
    const aussen = LEHRE_RING_WEIT + (LEHRE_DOT - LEHRE_RING_WEIT) * progress;
    const strich = LEHRE_RING_STRICH + (LEHRE_DOT / 2 - LEHRE_RING_STRICH) * progress;

    ictx.beginPath();
    ictx.arc(x, y, (aussen - strich) / 2, 0, Math.PI * 2);
    ictx.strokeStyle = `rgba(${ACCENT_RGB}, ${0.45 + 0.55 * progress})`;
    ictx.lineWidth = strich;
    ictx.stroke();
}

function drawLehrePulse(x, y, now) {
    const phase = (now % 1500) / 1500;
    ictx.beginPath();
    ictx.arc(x, y, 14 + phase * 34, 0, Math.PI * 2);
    ictx.strokeStyle = `rgba(${ACCENT_RGB}, ${0.6 * (1 - phase)})`;
    ictx.lineWidth = 2 + 6 * (1 - phase);
    ictx.stroke();
}

function drawLehreDot(x, y, alpha) {
    ictx.save();
    ictx.globalAlpha = alpha;

    if (punktBild.complete) {
        ictx.drawImage(punktBild, x - LEHRE_DOT / 2, y - LEHRE_DOT / 2, LEHRE_DOT, LEHRE_DOT);
    } else {
        ictx.beginPath();
        ictx.arc(x, y, LEHRE_DOT / 2, 0, Math.PI * 2);
        ictx.fillStyle = '#fc655b';
        ictx.fill();
    }

    ictx.restore();
}

function drawLehre() {
    ictx.clearRect(0, 0, BOARD_W, BOARD_H);
    const now = Date.now();

    drawLehreLine();

    // Plätze: gesetzte tragen ihren Kreis, freie eine helle Marke. Der aktive
    // (nächste) Platz pulsiert, sobald ein Kreis getragen wird.
    LEHRE_SPOTS.forEach((spot, i) => {
        if (i < lehrePlaced) { drawLehreDot(spot.x, spot.y, 1); return; }
        drawLehreDot(spot.x, spot.y, 0.35);
        // Der nächste freie Platz blinkt (wie die freien Plätze in
        // transportmechanismen), auch schon vor dem Aufnehmen.
        if (i === lehrePlaced && !lehreWindActive) drawLehrePulse(spot.x, spot.y, now);
    });

    // Vorrats-Kreise links.
    LEHRE_DOTS.forEach(dot => {
        if (lehreUsed.has(dot.id) || lehreHeldId === dot.id) return;
        const isTarget = !lehreHeldId && lehreTargetKind === 'dot' && lehreTargetId === dot.id;

        if (!lehreHeldId && !isTarget && !lehreWindActive) drawLehrePulse(dot.x, dot.y, now);

        drawLehreDot(dot.x, dot.y, 1);
        if (isTarget) drawLehreRing(dot.x, dot.y, lehreHoldProgress());
    });

    // Zeiger (Magnet auf das jeweils nächste Ziel) und getragener Kreis. Beim
    // Weiterdrehen ruht der Zeiger und ist ausgeblendet.
    let cursorDrawX = cursorX, cursorDrawY = cursorY;
    if (!lehreWindActive) {
        const magnetTarget = lehreHeldId
            ? LEHRE_SPOTS[lehrePlaced]
            : LEHRE_DOTS.find(d => !lehreUsed.has(d.id) && Math.hypot(cursorX - d.x, cursorY - d.y) < MAGNET_RADIUS);
        if (magnetTarget) {
            ({ x: cursorDrawX, y: cursorDrawY } = magnetPull(cursorX, cursorY, magnetTarget.x, magnetTarget.y));
        }

        if (lehreHeldId) {
            drawLehreDot(cursorDrawX, cursorDrawY, 1);
            if (lehreTargetKind === 'spot') drawLehreRing(cursorDrawX, cursorDrawY, lehreHoldProgress());
        }

        drawCursorOn(ictx, cursorDrawX, cursorDrawY);
    }
}

function finishLehre() {
    lehreDone = true;
    lehreGame.classList.add('is-gone');

    setTimeout(() => {
        lehreGame.remove();
        introBox.classList.remove('pre-game');
    }, LEHRE_GAME_FADE);
}

setLehreInstruction();

// ── Start ────────────────────────────────────────────────────────────────
window.addEventListener('resize', resizeBoard);
resizeBoard();
cursorX = targetX = BOARD_W / 2;
cursorY = targetY = BOARD_H / 2;
gameFrame = requestAnimationFrame(gameLoop);
