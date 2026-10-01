// ═══════════════════════════════════════════════════════════════════════════
//  Transportmechanismen (Inhalte)
//
//  interactions/inhalte/transportmechanismen.html
//
//  Ansteuern und halten zum Aufnehmen, ansteuern und halten zum Ablegen, dazu
//  der leichte Magneteffekt: Ein Bodenquerschnitt (hintergrund.png) sitzt als
//  kleineres Bild unten links in der Ecke und zeigt sechs Stellen als
//  blaugraue Skizze; die sechs zugehörigen Objekte starten im freien Bereich
//  rechts und wandern an ihre Stelle. (Die frühere abstrakte Fassung mit
//  Kreisen liegt als Test-Modul im Interaktions-Labor.)
//
//  Das Board deckt sich 1:1 mit der Bühne: Die Leinwände bekommen ihre
//  Auflösung zur Laufzeit aus der Bühnengröße (`resizeBoard`), füllen sie
//  also voll aus – kein Rahmen, kein weißer Balken. Alle Positionen sind
//  relativ (Anteile der Bühne bzw. der verkleinerten Szene) und wandern beim
//  Resize mit.
// ═══════════════════════════════════════════════════════════════════════════

import { socket, shareCalibration } from '../../lib/socket.js';
import { initConnectionBadge } from '../../lib/connection.js';
import { Baseline, clamp } from '../../lib/angles.js';
import { createLongShake } from '../../lib/shake.js';
import { initCalibration } from '../../lib/calibration.js';
import { reportCompletion } from '../../lib/completion.js';
import { byId } from '../../lib/dom.js';

const stage = byId('stage');
const calBtn = byId('calBtn');
const intro = byId('intro');
const resultText = byId('resultText');
// Erde und Zeichnung liegen zusammen auf dieser einen unteren Ebene.
const earthCanvas = byId('earthCanvas');
const ectx = earthCanvas.getContext('2d');
const canvas = byId('boardCanvas');
const ctx = canvas.getContext('2d');

const connection = initConnectionBadge({ onDisconnect: resetInteractiveState });

// Der Akzent der Ausstellung, als Zahlentripel.
const ACCENT_RGB = '253, 100, 88';

// ── Board ────────────────────────────────────────────────────────────────
// Das Board ist die volle Spielfläche und deckt sich 1:1 mit der Bühne (CSS-
// Pixel): Die Leinwände füllen die Bühne ganz aus, es gibt also keinen
// Rahmen und keinen weißen Balken. Größe kommt live aus der Bühne und wird
// bei jedem Resize neu gesetzt (`resizeBoard`).
let BOARD_W = 0;
let BOARD_H = 0;

// Eigenmaße von hintergrund.png (in seinen eigenen Pixeln). Die Zielstellen
// der Objekte (tx/ty) und das Erd-Rechteck sind in diesen Pixeln angegeben.
const DRAW_PX_W = 996;
const DRAW_PX_H = 946;
const DRAW_ASPECT = DRAW_PX_W / DRAW_PX_H;

// ── Zeichnung (Szene) ──────────────────────────────────────────────────────
// hintergrund.png füllt NICHT die ganze Bühne, sondern sitzt als eigenes Bild
// (transparenter Grund) unten links in der Ecke; rechts daneben bleibt Platz,
// in dem die Objekte starten. Hier justieren:
//   SCENE_H_FRAC     Höhe der Zeichnung als Anteil der Bühnenhöhe (0..1)
//   SCENE_MAX_W_FRAC Obergrenze der Breite als Anteil der Bühne – damit rechts
//                    IMMER Platz für die Objektspalten bleibt, egal wie schmal
//                    die Bühne ist. Die Zeichnung wird so groß, wie beides
//                    zulässt (das jeweils Kleinere gewinnt); das Seiten-
//                    verhältnis bleibt erhalten.
//   SCENE_LEFT       Abstand der linken Kante vom linken Rand (Board-Pixel)
// Die Zeichnung sitzt unten bündig in der Ecke.
const SCENE_H_FRAC = 0.92;
const SCENE_MAX_W_FRAC = 0.68;
const SCENE_LEFT = 0;

// Werden in `layoutScene()` aus der aktuellen Bühnengröße berechnet.
let SCENE_X = 0, SCENE_Y = 0, SCENE_W = 0, SCENE_H = 0, SCENE_SCALE = 1;
const sceneX = (px) => SCENE_X + px * SCENE_SCALE;
const sceneY = (py) => SCENE_Y + py * SCENE_SCALE;

function layoutScene() {
    // Gewünschte Höhe, aber nie höher als die Bühne (SCENE_H_FRAC > 1 wirkt
    // damit wie „volle Höhe"): Sonst ragt das fast quadratische Bild oben raus.
    let h = Math.min(BOARD_H, BOARD_H * SCENE_H_FRAC);
    let w = h * DRAW_ASPECT;

    // Zu breit? Auf die Breiten-Obergrenze zurücknehmen, die Höhe zieht mit.
    const maxW = BOARD_W * SCENE_MAX_W_FRAC;
    if (w > maxW) {
        w = maxW;
        h = w / DRAW_ASPECT;
    }

    SCENE_W = w;
    SCENE_H = h;
    SCENE_X = SCENE_LEFT;
    SCENE_Y = BOARD_H - SCENE_H;      // unten bündig in der Ecke
    SCENE_SCALE = SCENE_W / DRAW_PX_W;
}

// ── Startbereich der Objekte ────────────────────────────────────────────────
// Frei gesetzt statt im Raster: Jedes Objekt trägt in OBJECTS seine Start-
// position als Anteil – `fx` waagerecht im freien Bereich rechts der Zeichnung
// (0 = direkt an der Zeichnung, 1 = am rechten Rand), `fy` senkrecht an der
// Bühnenhöhe (0 = oben, 1 = unten). So lässt sich jedes Objekt einzeln und
// bewusst „durcheinander" platzieren.
function objectStart(o) {
    const rightX = SCENE_X + SCENE_W;
    const rightW = Math.max(0, BOARD_W - rightX);
    return {
        x: rightX + rightW * o.fx,
        y: BOARD_H * o.fy,
    };
}

// ── Erde ─────────────────────────────────────────────────────────────────
// Unterste Ebene, unter der Skizze: die Fläche, die die Umrandung in
// hintergrund.png vorgibt (oben die Bodenlinie, rechts die senkrechte Kante).
// Angegeben in hintergrund-Pixeln; über die Szene wird sie mit der Zeichnung
// mitverkleinert. Wer es feinjustieren will, ändert diese vier Zahlen.
const EARTH_X = 10;
const EARTH_Y = 435;
const EARTH_W = 941;
const EARTH_H = DRAW_PX_H - EARTH_Y;

// Zusätzliche Vergrößerung der Reißpapier-Textur über das reine Ausfüllen
// des Rechtecks hinaus (1 = genau ausgefüllt, wie `object-fit: cover`;
// größer zoomt weiter hinein). Eigene Zahl, unabhängig vom Rechteck selbst.
const EARTH_SCALE = 1.4;

// Erde und Zeichnung liegen beide fest unter den Objekten – gemalt wird auf
// dieselbe Ebene: erst die Erde, dann die Skizze darüber. Neu gezeichnet
// wird bei jedem Resize (die Szene verschiebt sich mit der Bühne) und sobald
// die Bilder geladen sind.
const erdeImg = new Image();
const sceneImg = new Image();
let erdeReady = false;
let sceneReady = false;

function drawScene() {
    if (!erdeReady || !sceneReady || !BOARD_W) return;
    ectx.clearRect(0, 0, BOARD_W, BOARD_H);

    // Erde: hintergrund-Pixel-Rechteck → Szene, Textur wie cover eingepasst
    const eX = sceneX(EARTH_X);
    const eY = sceneY(EARTH_Y);
    const eW = EARTH_W * SCENE_SCALE;
    const eH = EARTH_H * SCENE_SCALE;
    const s = Math.max(eW / erdeImg.naturalWidth, eH / erdeImg.naturalHeight) * EARTH_SCALE;
    const w = erdeImg.naturalWidth * s;
    const h = erdeImg.naturalHeight * s;
    ectx.drawImage(erdeImg, eX + (eW - w) / 2, eY + (eH - h) / 2, w, h);

    // Zeichnung darüber, in die Szene eingepasst
    ectx.drawImage(sceneImg, SCENE_X, SCENE_Y, SCENE_W, SCENE_H);
}

erdeImg.onload = () => { erdeReady = true; drawScene(); };
sceneImg.onload = () => { sceneReady = true; drawScene(); };
erdeImg.src = '/img/interactionen/transportmechanismen/erde.png';
sceneImg.src = '/img/interactionen/transportmechanismen/hintergrund.png';

// Bühne = Board: Die Leinwände füllen sie voll aus, Zeiger-Umrechnung ist
// daher schlicht die Mausposition relativ zur Ecke der Bühne.
function boardPointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

// Passt Leinwände und Layout an die aktuelle Bühnengröße an. Wird einmal zu
// Beginn und bei jedem Resize aufgerufen.
function resizeBoard() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    BOARD_W = rect.width;
    BOARD_H = rect.height;

    const dpr = window.devicePixelRatio || 1;
    [earthCanvas, canvas, introCanvas].forEach((cv) => {
        cv.width = Math.round(rect.width * dpr);
        cv.height = Math.round(rect.height * dpr);
        cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    layoutScene();
    layoutObjects();
    layoutLehre();
    layoutResultText();
    drawScene();
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

    const point = boardPointFrom(event);
    targetX = point.x;
    targetY = point.y;

    if (!isCursorPlaced) {
        cursorX = targetX;
        cursorY = targetY;
        isCursorPlaced = true;
    }
});

// Hilfe beim Einrichten: Ein Klick ins Bild schreibt seine Board-Koordinaten
// in die Konsole – genau die Zahlen, die unten in OBJECTS als `tx`/`ty`
// stehen. Nur ohne gekoppeltes Gerät, damit im Betrieb nichts mitläuft.
//
// Derselbe Klick ist zugleich der Fallback-Sprung zum fertigen Bild: Ohne
// Gerät lässt sich das eigentliche Spiel (ansteuern und halten) nicht spielen
// – ein Klick aufs Schaubild setzt darum sofort alle Objekte an ihren Platz
// und zeigt Beschriftungen samt Auswertungstext, wie nach regulärem Abschluss.
canvas.addEventListener('click', (event) => {
    if (connection.hasController()) return;
    const point = boardPointFrom(event);
    console.log(`x: ${Math.round(point.x)}, y: ${Math.round(point.y)}`);

    solveAll();
});

function solveAll() {
    if (objects.every(o => o.placed)) return;

    objects.forEach(o => {
        o.placed = true;
        o.dropped = true;
        o.x = o.tx;
        o.y = o.ty;
    });
    heldId = null;
    targetKind = null;
    targetId = null;

    drawScene();
    showResultText();
    reportCompletion({ label: 'Alle Objekte eingesetzt' });
}

// ── Magnet ───────────────────────────────────────────────────────────────
// Dieselbe Funktion wie im ersten Teil: innerhalb des Radius zieht es leicht
// zum Ziel, ganz nah dran rastet es vollständig ein.
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

// ── Objekte ──────────────────────────────────────────────────────────────
// Alles hier kommt aus der Bilddatei selbst, nicht aus Augenmaß – bis auf
// `fx`/`fy` (Startposition), die reine Geschmackssache sind:
//
//   tx/ty     ►ZIELPOSITION◄ – Mittelpunkt der grauen Stelle IM hintergrund-
//             Bild, in dessen eigenen Pixeln (0..996 / 0..946, siehe
//             DRAW_PX_*). Hier verschieben, um ein Bild an seiner Zielstelle
//             zu platzieren. Wird über die Szene in Board-Koordinaten
//             umgerechnet, wandert also mit der Zeichnung mit.
//   scale     ►GRÖSSE◄ – Feinfaktor auf die gezeichnete Größe (1 = wie aus
//             der Passform berechnet; 1.2 = 20 % größer usw.). Nur zum
//             Nachjustieren einzelner Bilder; die Grundgröße kommt aus
//             boxW/boxH.
//   boxW/boxH Grund-Ausdehnung der Zielstelle, für die Passform nach der
//             Drehung gebraucht
//   rot       Winkel, um den die Skizze gegenüber dem Bildmaterial gedreht
//             im Boden liegt
//   fx/fy     ►STARTPOSITION◄ – frei wählbar, bevor das Objekt aufgenommen
//             wird: `fx` waagerecht als Anteil des freien Bereichs rechts der
//             Zeichnung (0 = an der Zeichnung, 1 = am rechten Rand), `fy`
//             senkrecht als Anteil der Bühnenhöhe (0 = oben, 1 = unten). Fest
//             statt zufällig, damit die Station bei jedem Aufruf gleich
//             aussieht – hier einzeln verschieben, um sie zu verteilen.
//
// tx/ty/boxW/boxH/rot sind ursprünglich über die Lage der blaugrauen
// Skizzenfarbe (rgb(100,116,139)) im Hintergrund gegenüber der Hauptachse
// jedes Objektbilds ermittelt (Hauptachsenanalyse), nicht nach Augenmaß. Zwei
// Objekte (die Regenwürmer) teilen sich dasselbe Bild: Der Bodenquerschnitt
// zeigt zwei gleich gezeichnete Würmer, wir haben aber nur eine Aufnahme
// davon – ihre Kurve deckt sich deshalb nur mit einer der beiden Stellen
// wirklich genau.
//
// `crop` schneidet vorab den durchsichtigen Rand jeder Bilddatei weg
// (x, y, Breite, Höhe im Originalbild) – ohne ihn würde die anschließende
// Passform-Rechnung den Rand mit einpassen und das Motiv selbst zu klein
// werden lassen.
//
// Wer die Zielposition sucht: Ein Klick ins Bild ohne gekoppeltes Gerät
// schreibt die Board-Koordinaten der Klickstelle in die Konsole – diese sind
// zwar Board-Koordinaten; um sie in hintergrund-Pixel (tx/ty) umzurechnen,
// zieht man SCENE_X/SCENE_Y ab und teilt durch SCENE_SCALE.
const IMG_BASE = '/img/interactionen/transportmechanismen/';

const OBJECTS = [
    {
        id: 'akkumulation2', src: IMG_BASE + 'akkumulation2.png',
        crop: [38, 30, 447, 834], tx: 880, ty: 190, boxW: 210, boxH: 355, rot: 8.0,
        scale: 1.25, fx: 0.70, fy: 0.80
    },
    {
        id: 'akkumulation', src: IMG_BASE + 'akkumulation.png',
        crop: [35, 45, 463, 723], tx: 336, ty: 180, boxW: 159, boxH: 250, rot: 3.0,
        scale: 1.1, fx: 0.60, fy: 0.20
    },
    {
        id: 'wasser', src: IMG_BASE + 'wasser.png',
        crop: [28, 24, 870, 2436], tx: 682, ty: 500, boxW: 234, boxH: 636, rot: -15.0,
        scale: 1.65, fx: 0.20, fy: 0.55
    },
    {
        // Platzhalter-Lage oberhalb von `wasser` (kleineres ty) – Feinjustage
        // steht noch aus, sobald die Zeichnung dazu angepasst ist.
        id: 'wasser2', src: IMG_BASE + 'wasser2.png',
        crop: [0, 0, 296, 530], tx: 490, ty: 65, boxW: 150, boxH: 268, rot: 0,
        scale: 0.6, fx: 0.85, fy: 0.30
    },
    {
        id: 'poren', src: IMG_BASE + 'poren.png',
        crop: [15, 33, 1285, 806], tx: 460, ty: 410, boxW: 300, boxH: 210, rot: 10.0,
        scale: 1.25, fx: 0.30, fy: 0.30
    },
    {
        id: 'wurmOben', src: IMG_BASE + 'bodenorganisen.png',
        crop: [203, 230, 664, 749], tx: 200, ty: 495, boxW: 269, boxH: 189, rot: 98,
        scale: 1.4, fx: 0.40, fy: 0.50
    },
    {
        id: 'wurmUnten', src: IMG_BASE + 'bodenorganisen.png',
        crop: [203, 230, 664, 749], tx: 480, ty: 730, boxW: 264, boxH: 317, rot: 0.7,
        scale: 1.1, fx: 0.80, fy: 0.50
    },
];

// Bilder je Quelle nur einmal laden – die beiden Würmer teilen sich eins.
// `ready` steht separat von `img.complete`, weil `poren.png` (unten) statt
// des Bilds selbst ein nachträglich freigestelltes Canvas liefert, das
// dieses Feld nicht kennt.
const imageCache = {};
function getImage(src) {
    if (!imageCache[src]) {
        const entry = { img: new Image(), ready: false };
        entry.img.onload = () => { entry.ready = true; };
        entry.img.src = src;
        imageCache[src] = entry;
    }
    return imageCache[src];
}

// `poren.png` hat, anders als die übrigen Objektbilder, einen schwarzen
// statt durchsichtigen Grund – roh gezeichnet läge ein schwarzes Rechteck
// über der Zeichnung. Einmal geladen, wird es deshalb auf ein Canvas
// gemalt und dort jeder fast schwarze Bildpunkt durchsichtig gemacht;
// gezeichnet wird von da an dieses Canvas statt des Bildes.
function getTransparentImage(src, threshold = 40) {
    if (!imageCache[src]) {
        const entry = { img: null, ready: false };
        imageCache[src] = entry;

        const loader = new Image();
        loader.onload = () => {
            const off = document.createElement('canvas');
            off.width = loader.naturalWidth;
            off.height = loader.naturalHeight;
            const octx = off.getContext('2d');
            octx.drawImage(loader, 0, 0);

            const frame = octx.getImageData(0, 0, off.width, off.height);
            const px = frame.data;
            for (let i = 0; i < px.length; i += 4) {
                if (px[i] + px[i + 1] + px[i + 2] < threshold) px[i + 3] = 0;
            }
            octx.putImageData(frame, 0, 0);

            entry.img = off;
            entry.ready = true;
        };
        loader.src = src;
    }
    return imageCache[src];
}

/**
 * Passt den (bereits beschnittenen) Ausschnitt gedreht in die Zielstelle
 * ein – dieselbe Rechnung wie „contain", nur nach der Drehung: Die
 * gedrehte Hüllbox aus Breite/Höhe des Ausschnitts wird auf die Zielgröße
 * bezogen, nicht der Ausschnitt selbst.
 */
function fitRotated(cropW, cropH, rotDeg, boxW, boxH) {
    const rad = rotDeg * Math.PI / 180;
    const rotW = Math.abs(cropW * Math.cos(rad)) + Math.abs(cropH * Math.sin(rad));
    const rotH = Math.abs(cropW * Math.sin(rad)) + Math.abs(cropH * Math.cos(rad));
    const scale = Math.min(boxW / rotW, boxH / rotH);
    return { w: cropW * scale, h: cropH * scale };
}

const objects = OBJECTS.map(o => {
    const [cropX, cropY, cropW, cropH] = o.crop;
    const fit = fitRotated(cropW, cropH, o.rot, o.boxW, o.boxH);

    return {
        ...o,
        entry: o.id === 'poren' ? getTransparentImage(o.src) : getImage(o.src),
        cropX, cropY, cropW, cropH,
        rawTx: o.tx, rawTy: o.ty, // Zielstelle in hintergrund-Pixeln (Vorlage)
        fitW: fit.w, fitH: fit.h, // gezeichnete Größe in hintergrund-Pixeln
        // Alles Folgende füllt layoutObjects() aus der aktuellen Bühnengröße:
        tx: 0, ty: 0, w: 0, h: 0, x: 0, y: 0,
        placed: false,
    };
});

// Zielstellen, Größen und Startpositionen aus der aktuellen Bühnengröße
// setzen. Bei Resize erneut, damit alles mit der Szene mitwandert. Ein gerade
// getragenes Objekt behält seine Zeigerposition; ein schon gesetztes bleibt
// an seiner Zielstelle.
function layoutObjects() {
    objects.forEach(o => {
        // Zielstelle und Größe wandern in die verkleinerte Szene; `scale`
        // (Vorgabe 1) erlaubt zusätzlich, einzelne Bilder größer zu machen.
        const sc = SCENE_SCALE * (o.scale ?? 1);
        o.tx = sceneX(o.rawTx);
        o.ty = sceneY(o.rawTy);
        o.w = o.fitW * sc; // Drehung kommt beim Zeichnen dazu
        o.h = o.fitH * sc;

        if (o.placed) {
            o.x = o.tx;
            o.y = o.ty;
        } else if (o.id !== heldId && !o.dropped) {
            const start = objectStart(o);
            o.x = start.x;
            o.y = start.y;
        }
    });

    // Einheitliche Kringel-Größe für alle: die des kleinsten Objekts, damit
    // Aufnehmen und Ablegen überall gleich aussehen.
    const kleinste = Math.min(...objects.map(o => Math.max(o.w, o.h)));
    kringelSize = kleinste * KRINGEL_SIZE_FACTOR;
}

// Griffweite und Trefferradius richten sich nach der Größe des Objekts bzw.
// seiner Zielstelle – ein kleines Objekt soll nicht denselben großzügigen
// Radius bekommen wie ein großes.
function pickRadius(o) {
    return Math.max(55, (o.w + o.h) / 4);
}

let heldId = null;      // aufgenommenes Objekt, oder null
let targetKind = null;  // 'object' oder 'target' – worauf das Halten zielt
let targetId = null;
let holdStart = 0;
const HOLD_MS = 900;

// Direkt nach dem Abschütteln liegt das Objekt genau unter dem Zeiger – ohne
// Sperre zöge der Kringel zum Aufnehmen sofort wieder los. Diese kurze Pause
// gibt Zeit, den Zeiger erst wegzubewegen, bevor erneut gegriffen werden kann.
const DROP_COOLDOWN_MS = 500;
let pickupBlockedUntil = 0;

function objectUnderCursor() {
    let nearest = null;
    let nearestDist = Infinity;

    objects.forEach(o => {
        if (o.placed) return;
        const dist = Math.hypot(cursorX - o.x, cursorY - o.y);
        const r = pickRadius(o);
        if (dist < r && dist < nearestDist) {
            nearest = o.id;
            nearestDist = dist;
        }
    });

    return nearest;
}

function setHoldTarget(kind, id) {
    if (targetKind === kind && targetId === id) return;
    targetKind = kind;
    targetId = id;
    holdStart = Date.now();
}

function holdProgress() {
    if (!targetId) return 0;
    return clamp((Date.now() - holdStart) / HOLD_MS, 0, 1);
}

function pickUp(id) {
    heldId = id;
    targetKind = null;
    targetId = null;
}

// Ein kurzes Schütteln lässt das gehaltene Objekt wieder los – genau da, wo
// der Zeiger in diesem Moment steht: `o.x`/`o.y` tragen sich beim Halten
// schon mit dem Zeiger mit (`updateGame`), bleiben also einfach so stehen.
// `dropped` verhindert nur, dass `layoutObjects()` es bei einem Resize auf
// seine Ausgangslage zurückwirft.
function dropObject() {
    const o = objects.find(x => x.id === heldId);
    if (o) o.dropped = true;

    heldId = null;
    targetKind = null;
    targetId = null;
    pickupBlockedUntil = Date.now() + DROP_COOLDOWN_MS;
}

function placeObject(o) {
    o.placed = true;
    o.x = o.tx;
    o.y = o.ty;
    heldId = null;
    targetKind = null;
    targetId = null;

    // Der Leitstrich dieser Beschriftung liegt auf der Erd-Ebene und wird nicht
    // pro Frame neu gezeichnet – die Ebene daher jetzt auffrischen.
    drawScene();

    if (objects.every(x => x.placed)) {
        showResultText();
        reportCompletion({ label: 'Alle Objekte eingesetzt' });
    }
}

// Verbindungsverlust mitten im Spiel: dieselbe Regel wie im ersten Teil –
// der Fortschritt geht verloren, statt mit einem neuen Gerät an unklarer
// Stelle weiterzulaufen.
function resetInteractiveState() {
    heldId = null;
    targetKind = null;
    targetId = null;
    isCursorPlaced = false;

    objects.forEach(o => {
        o.placed = false;
        o.dropped = false;
        const start = objectStart(o);
        o.x = start.x;
        o.y = start.y;
    });

    // Keine Beschriftung mehr sichtbar – die Leitstriche auf der Erd-Ebene
    // ebenfalls entfernen, ebenso den Auswertungstext.
    drawScene();
    hideResultText();
}

function updateGame() {
    if (heldId) {
        const o = objects.find(x => x.id === heldId);
        o.x = cursorX;
        o.y = cursorY;

        // Magnet: In der Nähe der eigenen Zielstelle zieht es das Objekt
        // schon vor dem eigentlichen Halten dorthin – die Auswertung selbst
        // bleibt unberührt und prüft weiter die rohe Zeigerposition.
        const pulled = magnetPull(o.x, o.y, o.tx, o.ty);
        o.x = pulled.x;
        o.y = pulled.y;

        const dist = Math.hypot(cursorX - o.tx, cursorY - o.ty);
        if (dist < pickRadius(o)) {
            setHoldTarget('target', o.id);
            if (holdProgress() >= 1) placeObject(o);
        } else {
            targetKind = null;
            targetId = null;
        }
        return;
    }

    if (Date.now() < pickupBlockedUntil) {
        targetKind = null;
        targetId = null;
        return;
    }

    const candidate = objectUnderCursor();
    if (candidate) {
        setHoldTarget('object', candidate);
        if (holdProgress() >= 1) pickUp(candidate);
    } else {
        targetKind = null;
        targetId = null;
    }
}

// ── Zeichnen ─────────────────────────────────────────────────────────────

// ── Halte-Kringel (Aufnehmen und Ablegen) ──────────────────────────────────
// Beim Halten zum Aufnehmen zeichnet sich der Kringel (kringel2.png) entlang
// seiner Mittellinie (kringel2.svg) fort – dieselbe Sprache wie das Einloggen
// in der Größeneinordnung, dort über eine SVG-Maske. Hier auf dem Canvas
// nachgebaut: Das Bild wird auf ein Zwischen-Canvas gemalt und dort per Strich
// entlang des Pfades freigelegt (`destination-in`); der noch nicht gezeichnete
// Teil bleibt unsichtbar. Er darf die Objekte ruhig überlagern.
const KRINGEL_VB_W = 499;
const KRINGEL_VB_H = 307;
const KRINGEL_D = 'M331.5 70.5L330 65C330 65 287.5 50 258.5 51.5C229.5 53 161.511 63.7435 110.5 96C76.3959 117.566 49.0001 132 34.5002 166C20.0004 200 30.0002 214 30.0002 214C30.0002 214 48 268.5 141 284.5C234 300.5 269.5 289 269.5 289C269.5 289 378.718 274.937 422 227.5C445.036 202.254 466.774 185.1 464.5 151C462 113.5 446.5 97.5 417 68C387.5 38.5 321.5 31 321.5 31L239.5 24H181';

const KRINGEL_STROKE_VB = 26; // Strichbreite (im viewBox-Maß), deckt die Linie im PNG
const KRINGEL_SIZE_FACTOR = 1.6; // Größe bezogen auf das kleinste Objekt

// Einheitliche Kringel-Größe für alle Anzeigen; `layoutObjects()` setzt sie
// auf die des kleinsten Objekts (× KRINGEL_SIZE_FACTOR).
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

// Ein wiederverwendetes Zwischen-Canvas für das Freilegen.
const kringelCanvas = document.createElement('canvas');
const kctx = kringelCanvas.getContext('2d');

function drawKringel(cx, cy, size, progress) {
    if (progress <= 0 || !kringelImg.complete || !kringelImg.naturalWidth) return;

    const boxW = size;
    const boxH = size * (KRINGEL_VB_H / KRINGEL_VB_W); // Seitenverhältnis wie viewBox
    const dpr = window.devicePixelRatio || 1;

    kringelCanvas.width = Math.max(1, Math.round(boxW * dpr));
    kringelCanvas.height = Math.max(1, Math.round(boxH * dpr));
    kctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kctx.clearRect(0, 0, boxW, boxH);

    // Ganzen Kringel malen …
    kctx.drawImage(kringelImg, 0, 0, boxW, boxH);

    // … und nur den bis `progress` gezeichneten Teil des Pfades behalten.
    const sc = boxW / KRINGEL_VB_W; // gleichmäßig (Box hat viewBox-Verhältnis)
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

function drawObject(o) {
    const isHeld = o.id === heldId;
    const scale = isHeld ? 1.06 : 1;
    const w = o.w * scale;
    const h = o.h * scale;

    ctx.save();
    ctx.translate(o.x, o.y);
    // Die Drehung liegt fest an der Zielstelle – hier trägt sie das Objekt
    // schon, solange es noch unterwegs ist: Was zusammengehört, sieht auch
    // beim Tragen schon so aus, statt sich erst beim Ablegen zu drehen.
    ctx.rotate(o.rot * Math.PI / 180);

    if (isHeld) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 16;
    }

    if (o.entry.ready) {
        ctx.drawImage(o.entry.img, o.cropX, o.cropY, o.cropW, o.cropH, -w / 2, -h / 2, w, h);
    } else {
        // Bis das Bild da ist, hält ein schlichter Kreis den Platz.
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100, 116, 139, 0.5)';
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

// ── Beschriftungen (nach dem Ablegen) ──────────────────────────────────────
// Sobald ein Objekt sitzt, erscheint rechts – im Stil von Eintragspfade 2 –
// seine Beschriftung, mit einer Linie zum Objekt. Manche Begriffe stehen für
// zwei Objekte (zwei Akkumulations-Stellen, zwei Bodenorganismen); ihr Kasten
// kommt erst, wenn BEIDE sitzen, und trägt dann eine Linie zu jedem.
//
//   text     Beschriftung
//   ids      zugehörige Objekt-IDs (aus OBJECTS) – alle müssen platziert sein,
//            bevor das Label erscheint
//   posIds   optional: Teilmenge von `ids`, aus deren Zielstellen die y-Position
//            gemittelt wird (statt aus allen `ids`) – für Objekte, die nur die
//            Sichtbarkeits-Bedingung verschärfen, ohne die schon fein
//            justierte Höhe zu verschieben. Fehlt es, zählen alle `ids`.
//   xFrac    waagerechte Lage der LINKEN Kastenkante als Anteil der freien
//            Breite rechts der Zeichnung (0 = direkt an der Zeichnung,
//            1 = am rechten Rand). Alle Kästen sind links bündig, nicht
//            mittig zentriert.
//   yOffset  senkrechte Feinkorrektur in Pixeln (+ = nach unten, - = nach
//            oben), zusätzlich zur automatischen Höhe aus den Objekten.
//            Standard 0, wenn weggelassen.
// Verschiebt ALLE Labels gemeinsam um diesen Betrag nach unten (negativ = nach
// oben), zusätzlich zu den einzelnen `yOffset`-Werten unten.
const LABEL_Y_SHIFT = 13;

const LABELS = [
    { text: 'Wurzelwachstum', ids: ['akkumulation2', 'akkumulation'], xFrac: 0.05, yOffset: 60 },
    { text: 'Wasser', ids: ['wasser', 'wasser2'], posIds: ['wasser'], xFrac: 0.05, yOffset: -300 },
    { text: 'Poren und Risse', ids: ['poren'], xFrac: 0.05, yOffset: 5 },
    { text: 'Bodenorganismen', ids: ['wurmOben', 'wurmUnten'], xFrac: 0.05, yOffset: -10 },
];

const LABEL_CORAL = '#fc655b';
const LABEL_CORAL_DEEP = '#c2372e';
const LABEL_FONT = '400 18px "Inclusive Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

// Waagerechte Innenpolsterung der Kästen. Auch der Auswertungstext richtet
// sich danach, damit er bündig mit dem Kastentext („Akkumulation") beginnt.
const LABEL_PAD_X = 14;

// Lage jeder sichtbaren Beschriftung (nur wenn ALLE zugehörigen Objekte
// sitzen). Wird für die Kästen auf der oberen Ebene gebraucht.
function labelLayouts() {
    const rightX = SCENE_X + SCENE_W;
    const rightW = Math.max(0, BOARD_W - rightX);

    ctx.font = LABEL_FONT;
    const out = [];
    LABELS.forEach(lab => {
        const objs = lab.ids.map(id => objects.find(o => o.id === id)).filter(Boolean);
        if (objs.length === 0 || !objs.every(o => o.placed)) return;

        // Für die Höhe zählen nur `posIds` (falls gesetzt) – so verschiebt ein
        // Objekt, das lediglich die Sichtbarkeits-Bedingung verschärft, nicht
        // die bereits fein justierte Lage des Labels.
        const posIds = lab.posIds || lab.ids;
        const posObjs = posIds.map(id => objects.find(o => o.id === id)).filter(Boolean);

        const padY = 9;
        const width = ctx.measureText(lab.text).width + LABEL_PAD_X * 2;
        const height = 18 + padY * 2;

        // Linke Kante rechts der Zeichnung (bündig für alle), senkrecht auf
        // Höhe der (gemittelten) Zielstelle plus manueller Korrektur (yOffset).
        // lx = Kasten-Mitte, nur für den Text.
        const left = rightX + rightW * lab.xFrac;
        let ly = posObjs.reduce((s, o) => s + o.ty, 0) / posObjs.length + (lab.yOffset || 0) + LABEL_Y_SHIFT;
        ly = clamp(ly, height / 2 + 8, BOARD_H - height / 2 - 8);

        out.push({ text: lab.text, lx: left + width / 2, ly, width, height, left, top: ly - height / 2 });
    });
    return out;
}

// Kästen und Text – auf der oberen Ebene (ctx), über allem.
function drawLabelBoxes() {
    ctx.font = LABEL_FONT;
    labelLayouts().forEach(({ text, lx, ly, left, top, width, height }) => {
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
        ctx.fillText(text, lx, ly + 1);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    });
}

// ── Auswertungstext ────────────────────────────────────────────────────────
// Erscheint rechts NEBEN den Labels, sobald alle Objekte sitzen. Die Spalte
// beginnt hinter dem breitesten Kasten und ihre erste Zeile auf Höhe des ersten
// Labels (Akkumulation).
//
// Feinjustieren:
//   RESULT_LEFT_GAP   waagerechter Abstand zwischen Labels und Textspalte (px)
//   RESULT_RIGHT_GAP  Abstand der Spalte zum rechten Rand (px)
//   RESULT_TOP_OFFSET senkrechte Feinkorrektur der ersten Zeile (px, +/-)
//   Der Text selbst steht als Platzhalter im HTML (<div id="resultText">).
const RESULT_LEFT_GAP = 40;
const RESULT_RIGHT_GAP = 32;
const RESULT_TOP_OFFSET = 5;

function layoutResultText() {
    const rightX = SCENE_X + SCENE_W;
    const rightW = Math.max(0, BOARD_W - rightX);

    const layouts = labelLayouts();
    // Rechte Kante des breitesten Kastens; ohne sichtbare Labels ein Fallback.
    const labelsRight = layouts.length
        ? Math.max(...layouts.map(l => l.left + l.width))
        : rightX + rightW * LABELS[0].xFrac;
    // Oberkante des visuell obersten Labels (kann je nach yOffset ein anderes
    // sein als das erste in LABELS) – dort beginnt die erste Zeile. LABEL_Y_SHIFT
    // wird herausgerechnet, damit der Text nicht mitwandert, wenn nur die
    // Labels gemeinsam verschoben werden.
    const firstTop = layouts.length ? Math.min(...layouts.map(l => l.top)) - LABEL_Y_SHIFT : BOARD_H * 0.08;

    const left = labelsRight + RESULT_LEFT_GAP;
    resultText.style.left = `${left}px`;
    resultText.style.top = `${firstTop + RESULT_TOP_OFFSET}px`;
    resultText.style.width = `${Math.max(0, BOARD_W - left - RESULT_RIGHT_GAP)}px`;
}

function showResultText() {
    layoutResultText();
    resultText.classList.add('is-shown');
}

function hideResultText() {
    resultText.classList.remove('is-shown');
}

function drawFrame() {
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    objects.forEach(o => { if (!o.placed) drawObject(o); });

    objects.forEach(o => { if (o.placed) drawObject(o); });

    // Nur Kästen und Text – die Leitstriche liegen auf der Erd-Ebene (drawScene).
    drawLabelBoxes();

    // Halten – Aufnehmen wie Ablegen – zeigt denselben Kringel, der sich
    // fortzeichnet: beim Aufnehmen über dem angesteuerten Objekt, beim Ablegen
    // über der Zielstelle. Über allen Objekten, damit er nicht verdeckt wird,
    // und überall in derselben Größe (`kringelSize`).
    if (!heldId && targetKind === 'object') {
        const o = objects.find(x => x.id === targetId);
        if (o) drawKringel(o.x, o.y, kringelSize, holdProgress());
    } else if (heldId && targetKind === 'target') {
        const o = objects.find(x => x.id === targetId);
        if (o) drawKringel(o.tx, o.ty, kringelSize, holdProgress());
    }

    drawCursorOn(ctx);
}

let gameFrame = null;

function gameLoop() {
    cursorX += (targetX - cursorX) * SMOOTHING;
    cursorY += (targetY - cursorY) * SMOOTHING;

    if (isIntroVisible) {
        if (!lehreDone) {
            updateLehre();
            drawLehre();
        }
    } else {
        updateGame();
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

    // Das Spielfeld kommt erst jetzt zum Vorschein: Vorher stünde es im
    // Markup schon bereit und wäre in jeder Lücke zu sehen, in der die
    // Einführung selbst noch unsichtbar ist.
    earthCanvas.classList.remove('is-waiting');
    canvas.classList.remove('is-waiting');
}

socket.on('shake', () => {
    if (calibration.isActive()) return;

    if (isIntroVisible) {
        // Während des Übungsspiels lässt ein Schütteln nur einen gehaltenen
        // Punkt los – langes Schütteln überspringt die Übung nicht. Erst
        // danach, auf dem Infotext (`lehreDone`), startet es damit das
        // eigentliche Spiel.
        if (!lehreDone) {
            if (lehreHeldId) lehreDrop();
            return;
        }

        if (startShake.register()) dismissIntro();
        return;
    }

    // Im eigentlichen Spiel lässt sich ein gehaltenes Objekt per Schütteln
    // wieder los, statt es erst zu einer Zielstelle tragen zu müssen.
    if (heldId) dropObject();
});

// .lehre-game hat pointer-events:none, deshalb liegt der Listener auf intro.
// Vor dem Abschluss: Übungsspiel bedingungslos überspringen (wie Eintragspfade
// und Größeneinordnung) – aber nur bis zur intro-box, die danach zu sehen ist.
// Erst ein weiterer Klick, jetzt auf dem Infotext, schließt die Einführung
// ganz, und auch das nur ohne Gerät.
intro.addEventListener('click', () => {
    if (!lehreDone) {
        LEHRE_HOLES.forEach(hole => lehreFilled.add(hole.id));
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

    moveCursor(gammaBase.delta(gamma), betaBase.delta(beta));
});

// ═══════════════════════════════════════════════════════════════════════════
//  Einführungsspiel auf dem Startbildschirm — das Halten üben
//
//  Dieselbe Übung wie im ersten Teil: drei graue Löcher, drei Kreise, ohne
//  Zuordnung – geübt wird nur die Geste. Eigene, abstrakte Lage statt der
//  echten Bildkoordinaten, damit die Übung unabhängig vom Motiv bleibt.
// ═══════════════════════════════════════════════════════════════════════════

const lehreGame = byId('lehreGame');
const introBox = byId('introBox');
const introCanvas = byId('introCanvas');
const ictx = introCanvas.getContext('2d');
// Die Zeichenmatrix von introCanvas setzt `resizeBoard()` mit den anderen.

const LEHRE_GAME_FADE = 400;
const LEHRE_DOT = 30;
const LEHRE_HIT = 42;
const LEHRE_RING_WEIT = 150;
const LEHRE_RING_STRICH = 3;

// Lage als Anteil (0..1) der Bühne – links die Löcher, rechts die Kreise. Die
// Pixelwerte (x/y) setzt `layoutLehre()` bei jedem Resize.
const LEHRE_HOLES = [
    { id: 'h1', fx: 0.20, fy: 0.24, x: 0, y: 0 },
    { id: 'h2', fx: 0.20, fy: 0.50, x: 0, y: 0 },
    { id: 'h3', fx: 0.20, fy: 0.76, x: 0, y: 0 },
];

const LEHRE_DOTS = [
    { id: 'd1', fx: 0.76, fy: 0.22, x: 0, y: 0 },
    { id: 'd2', fx: 0.76, fy: 0.50, x: 0, y: 0 },
    { id: 'd3', fx: 0.76, fy: 0.78, x: 0, y: 0 },
];

function layoutLehre() {
    // Ein per Schütteln fallengelassener Punkt behält seine abgelegte Stelle
    // auch über einen Resize hinweg, statt auf seine Ausgangslage
    // zurückzuspringen.
    [...LEHRE_HOLES, ...LEHRE_DOTS].forEach(p => {
        if (p.dropped) return;
        p.x = p.fx * BOARD_W;
        p.y = p.fy * BOARD_H;
    });
}

const punktBild = new Image();
punktBild.src = '/img/interactionen/eintragspfade/punkt.png';

let lehreHeldId = null;
let lehreTargetKind = null;
let lehreTargetId = null;
let lehreHoldStart = 0;
const lehreFilled = new Set();
const lehreUsed = new Set();
let lehreDone = false;

function nearestOpenLehreHole() {
    let nearest = null;
    let nearestDist = Infinity;

    LEHRE_HOLES.forEach(hole => {
        if (lehreFilled.has(hole.id)) return;
        const dist = Math.hypot(cursorX - hole.x, cursorY - hole.y);
        if (dist < nearestDist) {
            nearest = hole;
            nearestDist = dist;
        }
    });

    return nearest;
}

// Derselbe Gedanke für die noch nicht aufgenommenen Punkte: nicht der
// nächstliegende, sondern der dem Zeiger nächste – für den Magneteffekt
// beim Ansteuern, nicht für die Auswertung.
function nearestOpenLehreDot() {
    let nearest = null;
    let nearestDist = Infinity;

    LEHRE_DOTS.forEach(dot => {
        if (lehreUsed.has(dot.id)) return;
        const dist = Math.hypot(cursorX - dot.x, cursorY - dot.y);
        if (dist < nearestDist) {
            nearest = dot;
            nearestDist = dist;
        }
    });

    return nearest;
}

function setLehreTarget(kind, id) {
    if (lehreTargetKind === kind && lehreTargetId === id) return;
    lehreTargetKind = kind;
    lehreTargetId = id;
    lehreHoldStart = Date.now();
}

function lehreHoldProgress() {
    if (!lehreTargetId) return 0;
    return clamp((Date.now() - lehreHoldStart) / HOLD_MS, 0, 1);
}

function lehrePickUp(id) {
    lehreHeldId = id;
    lehreTargetKind = null;
    lehreTargetId = null;
}

// Ein kurzes Schütteln lässt den gehaltenen Punkt wieder los – und zwar
// genau da, wo der Zeiger in diesem Moment steht, nicht an seiner
// Ausgangslage. Wird nur aufgerufen, wenn tatsächlich etwas gehalten wird
// (siehe `socket.on('shake', …)`).
function lehreDrop() {
    const dot = LEHRE_DOTS.find(d => d.id === lehreHeldId);
    if (dot) {
        dot.dropped = true;
        dot.x = cursorX;
        dot.y = cursorY;
    }

    lehreHeldId = null;
    lehreTargetKind = null;
    lehreTargetId = null;
}

function lehrePlace(hole) {
    lehreFilled.add(hole.id);
    lehreUsed.add(lehreHeldId);
    lehreHeldId = null;
    lehreTargetKind = null;
    lehreTargetId = null;

    if (lehreFilled.size === LEHRE_HOLES.length) finishLehre();
}

function updateLehre() {
    if (lehreHeldId) {
        const hole = LEHRE_HOLES.find(h => {
            if (lehreFilled.has(h.id)) return false;
            return Math.hypot(cursorX - h.x, cursorY - h.y) < LEHRE_HIT;
        });

        if (hole) {
            setLehreTarget('hole', hole.id);
            if (lehreHoldProgress() >= 1) lehrePlace(hole);
        } else {
            lehreTargetKind = null;
            lehreTargetId = null;
        }
        return;
    }

    const candidate = LEHRE_DOTS.find(dot => {
        if (lehreUsed.has(dot.id)) return false;
        return Math.hypot(cursorX - dot.x, cursorY - dot.y) < LEHRE_HIT;
    });

    if (candidate) {
        setLehreTarget('dot', candidate.id);
        if (lehreHoldProgress() >= 1) lehrePickUp(candidate.id);
    } else {
        lehreTargetKind = null;
        lehreTargetId = null;
    }
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

    LEHRE_HOLES.forEach(hole => {
        const filled = lehreFilled.has(hole.id);
        const isTarget = lehreHeldId && lehreTargetKind === 'hole' && lehreTargetId === hole.id;

        if (lehreHeldId && !filled && !isTarget) drawLehrePulse(hole.x, hole.y, now);

        drawLehreDot(hole.x, hole.y, filled ? 1 : 0.35);
        if (isTarget) drawLehreRing(hole.x, hole.y, lehreHoldProgress());
    });

    // Die Punkte bleiben an ihrem Platz liegen – der Magneteffekt zieht
    // stattdessen gleich unten den Zeiger zu ihnen hin, statt sie zum Zeiger
    // zu ziehen.
    LEHRE_DOTS.forEach(dot => {
        if (lehreUsed.has(dot.id) || lehreHeldId === dot.id) return;
        const { x, y } = dot;
        const isTarget = !lehreHeldId && lehreTargetKind === 'dot' && lehreTargetId === dot.id;

        if (!lehreHeldId && !isTarget) drawLehrePulse(x, y, now);

        drawLehreDot(x, y, 1);
        if (isTarget) drawLehreRing(x, y, lehreHoldProgress());
    });

    // Der Zeiger selbst trägt den Magneteffekt: In der Nähe eines noch
    // offenen Punkts – bzw., sobald einer gehalten wird, in der Nähe des
    // nächsten offenen Lochs – rastet er dorthin ein, statt den Punkt zu
    // sich zu ziehen.
    let cursorDrawX = cursorX, cursorDrawY = cursorY;
    const nearestLehreTarget = lehreHeldId ? nearestOpenLehreHole() : nearestOpenLehreDot();
    if (nearestLehreTarget) {
        ({ x: cursorDrawX, y: cursorDrawY } = magnetPull(cursorX, cursorY, nearestLehreTarget.x, nearestLehreTarget.y));
    }

    if (lehreHeldId) drawLehreDot(cursorDrawX, cursorDrawY, 1);

    drawCursorOn(ictx, cursorDrawX, cursorDrawY);
}

// Geschafft: Die Übung tritt ab, die Box mit der eigentlichen Aufgabe kommt.
function finishLehre() {
    lehreDone = true;
    lehreGame.classList.add('is-gone');

    setTimeout(() => {
        lehreGame.remove();
        introBox.classList.remove('pre-game');
    }, LEHRE_GAME_FADE);
}

// ── Start ────────────────────────────────────────────────────────────────
// Erst die Bühne vermessen (setzt BOARD_*, Leinwände, Szene, Objekte, Übung),
// dann den Zeiger in die Mitte und die Schleife starten.
window.addEventListener('resize', resizeBoard);
resizeBoard();
cursorX = targetX = BOARD_W / 2;
cursorY = targetY = BOARD_H / 2;
gameFrame = requestAnimationFrame(gameLoop);
