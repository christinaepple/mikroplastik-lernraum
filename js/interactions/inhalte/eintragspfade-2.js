// ═══════════════════════════════════════════════════════════════════════════
//  Eintragspfade 2 (Punkte verbinden) — den Weg eines Objekts beschreiben
//
//  Die aktuelle, geführte Fassung der Station; die ältere liegt daneben (im
//  Menü als „alt").
//
//  Zweite Station zu den Eintragspfaden. Die erste zeigt in einer Collage, aus
//  welchen Richtungen Mikroplastik in den Boden kommt; hier wird ein einzelner
//  Weg beschrieben – vom Makroplastik bis zur Ablagerung.
//
//  Der Ablauf hat drei Stufen:
//    1. Startbildschirm mit einem kleinen Übungsspiel („Punkte verbinden"), das
//       die Geste erklärt; Schütteln beendet ihn.
//    2. Szenenwahl durch Neigen und Halten – Landwirtschaft (links) oder
//       Straße (rechts).
//    3. Das eigentliche Spiel auf der gewählten Szene.
// ═══════════════════════════════════════════════════════════════════════════

import { socket, shareCalibration } from '../../lib/socket.js';
import { initConnectionBadge } from '../../lib/connection.js';
import { Baseline, clamp, createJumpFilter } from '../../lib/angles.js';
import { createLongShake } from '../../lib/shake.js';
import { reportCompletion } from '../../lib/completion.js';
import { initCalibration } from '../../lib/calibration.js';
import { byId } from '../../lib/dom.js';
import { qFromDeviceOrientation, qMul, qRotate, qConj } from '../../lib/quaternion.js';

const RAD = 180 / Math.PI;

const calBtn = byId('calBtn');
const intro = byId('intro');
const introBox = intro.querySelector('.intro-box');
const lehreGame = byId('lehreGame');

// Dauer des Abblendens, wenn das Übungsspiel fertig ist – deckt sich mit der
// CSS-Transition von `.lehre-game` (0.4s), damit sie entfernt wird, sobald
// sie unsichtbar ist, statt mittendrin zu springen.
const LEHRE_GAME_FADE = 400;

// ── Szenenwahl ───────────────────────────────────────────────────────────────
// Nach der Einführung, vor dem Spiel: zwei Szenen stehen zur Wahl. Neigen hebt
// eine hervor (wie in der Begriffseinordnung, hier nur links/rechts), das
// Halten der Neigung bestätigt sie (wie in der Größeneinordnung). Rechts liegt
// die gebaute Landwirtschafts-Szene; links ist noch frei – die zweite Szene
// kommt noch, deshalb lässt sie sich derzeit nicht bestätigen.
const selectEl = byId('select');
const sideEls = { left: byId('optLeft'), right: byId('optRight') };
// Beide Seiten tragen eine spielbereite Szene: links die Landwirtschaft, rechts
// die Straße. Die Zuordnung Seite → Szene steckt in SCENES weiter unten.
const SCENE_READY = { left: true, right: true };

// Zwei Schwellen gegen das Springen: Ab SELECT_ENTER gilt eine Seite als
// gewählt, erst unter SELECT_RELEASE wird wieder neutral. Dazwischen bleibt es,
// wie es ist – eine ruhige Hand flackert damit nicht zwischen den Seiten.
// Bewusst niedrig gehalten, damit eine sanfte Neigung genügt und niemand so
// stark kippen muss, dass der Sensor an seine Grenze gerät.
const SELECT_ENTER = 12;
const SELECT_RELEASE = 6;
const SELECT_HOLD = 2000; // ms Halten bis bestätigt
const SELECT_DRAWING_PAUSE = 350; // Zeichnung steht nach dem Fade kurz allein

let isSelecting = false;
let selectReady = false;  // erst nach dem Setzen des Nullpunkts wertet die Wahl
let selSide = null;       // 'left', 'right' oder null (neutral)
let selHoldStart = 0;     // seit wann die aktuelle Seite gehalten wird
let selConfirmed = false;
let selectFrame = null;

// Der Nullpunkt entsteht beim ersten Sensorwert; die Kopfzeile setzt ihn neu.
const gammaBase = new Baseline({ wrap: false });
const betaBase = new Baseline({ wrap: false });

// Gegen die Sprünge beim Neigen zur Seite: Nahe der Senkrechten schlägt der
// Rohwert um. Verworfen wird das für Einführung und Szenenwahl, die mit den
// rohen Winkeln arbeiten — das Hauptspiel hat dafür mainTilt() weiter unten.
const gammaJump = createJumpFilter();
const betaJump = createJumpFilter();

// Nullpunkt des Hauptspiel-Zeigers, als volle Gerätelage statt als rohes
// beta/gamma — siehe mainTilt(). null = noch nicht gesetzt, wird beim
// nächsten Sensorwert aus der aktuellen Lage gesetzt (wie Baseline.delta()).
let qZero = null;
let lastOrientation = null;

function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
        return screen.orientation.angle;
    }
    return typeof window.orientation === 'number' ? window.orientation : 0;
}

function deviceQuaternion(alpha, beta, gamma) {
    return qFromDeviceOrientation(alpha, beta, gamma, screenAngle());
}

/**
 * Haltung des Hauptspiel-Zeigers gegenüber dem Nullpunkt, als (dGamma, dBeta)
 * wie gewohnt — aber aus der vollen Gerätelage (Quaternion) berechnet statt
 * aus rohem beta/gamma. Bei starker Neigung nach unten (dorthin, wo die
 * unteren Punkte der Schaubilder liegen) geraten die rohen Winkel in den
 * Gimbal Lock: beta nähert sich 90°, und gamma kann dabei unvermittelt
 * umschlagen — der Zeiger sprang dadurch an den Rand. Die Drehung gegenüber
 * dem Nullpunkt bleibt dagegen überall stetig (dieselbe Überlegung wie beim
 * Sucher, lib/quaternion.js).
 */
function mainTilt(alpha, beta, gamma) {
    const q = deviceQuaternion(alpha, beta, gamma);
    if (!qZero) qZero = q;

    const rel = qMul(qConj(qZero), q);
    const f = qRotate(rel, 0, 0, -1);
    const dGamma = -Math.atan2(f.x, -f.z) * RAD;
    const dBeta = Math.asin(clamp(f.y, -1, 1)) * RAD;
    return { dGamma, dBeta };
}

// Kurze Sperre nach dem Laden: Wer die Station durch eine Bewegung betritt,
// bringt diese noch mit – sie soll nicht sofort den Zeiger verreißen und vor
// allem nicht den Nullpunkt auf sie setzen.
const READY_DELAY = 500;
let inputReady = false;
setTimeout(() => { inputReady = true; }, READY_DELAY);

// Schütteln beendet erst die Einführung und setzt danach das Spiel zurück –
// wie im Prototyp (js/interactions/punkte.js) und in der Begriffseinordnung.
// Verlangt sind jeweils mehrere Ereignisse in Folge, damit eine beiläufige
// Bewegung weder den Text wegwischt noch den halb gelegten Weg verwirft.
//
// Zwei getrennte Zähler, weil immer nur einer von beiden an der Reihe ist:
// Ein gemeinsamer trüge die Ereignisse des Startens in das Zurücksetzen
// hinüber.
const startShake = createLongShake();
const resetShake = createLongShake();

// Wartezeit, bis die Schüttelbewegung abgeklungen ist.
const SETTLE_DELAY = 600;

let isIntroVisible = true;

const connection = initConnectionBadge();

function calibrate() {
    gammaBase.reset(); // der nächste Sensorwert setzt den Nullpunkt neu
    betaBase.reset();
    // Die beiden Szenen steuern den Zeiger über die volle Gerätelage. Den
    // Quaternion-Nullpunkt direkt aus dem letzten Messwert setzen, damit die
    // Kalibrierung sofort wirkt und nicht von einem späteren Sensorpaket
    // abhängt.
    qZero = lastOrientation
        ? deviceQuaternion(lastOrientation.alpha, lastOrientation.beta, lastOrientation.gamma)
        : null;
    isCursorPlaced = false;
    gammaJump.reset(); // sonst gälte die neue Haltung selbst als Sprung
    betaJump.reset();
    calBtn.style.backgroundColor = '#f1f5f9';
    calBtn.textContent = 'Kalibriert';
    setTimeout(() => {
        calBtn.style.backgroundColor = '';
        calBtn.textContent = 'Mitte kalibrieren';
    }, 1000);
}

const calibrateEverywhere = shareCalibration(calibrate);
calBtn.addEventListener('click', calibrateEverywhere);

// Dieselbe Kalibrierung über die Leertaste, wie in den Prototyp-Modulen: Am
// Desktop liegt sie näher als die Schaltfläche, und gerade beim Ausprobieren
// wird oft nachkalibriert.
window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    calibrateEverywhere();
});

// Die Kalibrierung steht vor der Station: Sie hängt sich in die Bühne, bittet
// ohne Controller um die Verbindung und setzt die Mitte, sobald das Gerät einen
// Moment still liegt. Solange sie läuft, halten Neigen und Schütteln still
// (`calibration.isActive()` weiter unten).
const calibration = initCalibration({
    onCalibrate: calibrateEverywhere,
    parent: byId('stage'), // in der Bühne, damit die Kopfzeile erreichbar bleibt
    accentRgb: '253, 100, 88',
    onDone: revealIntro
});

function revealIntro() {
    intro.classList.remove('is-waiting');
}


socket.on('sensorData', (data) => {
    if (!inputReady) return;

    const alpha = data.alpha !== null ? data.alpha : 0;
    const gamma = data.gamma !== null ? data.gamma : 0;
    const beta = data.beta !== null ? data.beta : 0;
    lastOrientation = { alpha, beta, gamma };

    // Vor allem anderen steht die Kalibrierung; erst danach nimmt die Station
    // die Neigung als Eingabe.
    if (calibration.isActive()) return;

    // Das Hauptspiel wertet die volle Gerätelage aus (mainTilt), nicht rohes
    // beta/gamma — siehe dort. Der Sprungfilter unten gilt deshalb nur noch
    // für Einführung und Szenenwahl, die weiterhin mit den rohen Winkeln
    // arbeiten (dort reicht die Neigung nie in den kritischen Bereich).
    if (!isIntroVisible && !isSelecting) {
        const tilt = mainTilt(alpha, beta, gamma);
        moveCursor(tilt.dGamma, tilt.dBeta);
        return;
    }

    // Sprünge des Lagesensors verwerfen, bevor sie in eine der Phasen laufen.
    if (gammaJump.check(gamma) || betaJump.check(beta)) return;

    // Auf dem Startbildschirm läuft das Einführungsspiel: dasselbe Neigen führt
    // dort einen Übungszeiger, damit das Prinzip vor dem Spiel klar ist.
    if (isIntroVisible) {
        moveIntroCursor(gammaBase.delta(gamma), betaBase.delta(beta));
        return;
    }

    // Solange gewählt wird, steuert das Neigen die Szenenwahl, nicht den Zeiger.
    evaluateSide(gammaBase.delta(gamma));
});

socket.on('shake', () => {
    if (!inputReady) return;

    // Während der Kalibrierung ist Schütteln das Gegenteil dessen, was zählt.
    if (calibration.isActive()) return;

    if (isIntroVisible) {
        if (startShake.register()) dismissIntro();
        return;
    }

    // Während der Szenenwahl entscheidet allein das Halten – ein Schütteln
    // würde hier nur den halb gewählten Zustand stören.
    if (isSelecting) return;

    if (resetShake.register()) resetBoard();
});

// Ein Klick führt an der Einführung vorbei – anders als die übrigen
// Maus-Hilfen ohne Rücksicht darauf, ob ein Gerät gekoppelt ist. Beim
// Einrichten hängt oft eines dran, und dann wäre gerade der Weg zum Spiel
// versperrt. An der Station selbst gibt es keine Maus, die Geste kann dort
// also niemand auslösen.
intro.addEventListener('click', () => {
    if (isIntroVisible) dismissIntro();
});

function dismissIntro() {
    isIntroVisible = false;
    intro.classList.add('is-gone');

    // Statt direkt ins Spiel führt der Weg in die Szenenwahl. Sie deckt die
    // Bühne sofort ab, damit zwischen Einführung und Wahl nichts vom Schaubild
    // aufblitzt.
    openSelect();
}

// Die Szenenwahl aufschlagen – einmal nach der Einführung und später wieder,
// wenn ein beschriebener Weg über den Kasten in der Mitte verlassen wird.
function openSelect() {
    isSelecting = true;
    selectReady = false;
    selConfirmed = false;
    setSide(null);

    selectEl.classList.remove('is-gone');
    selectEl.classList.add('is-shown');
    if (selectFrame === null) selectFrame = requestAnimationFrame(selectLoop);

    // Das Gerät liegt jetzt neu in der Hand. Der Nullpunkt für das Neigen wird
    // deshalb erst gesetzt, wenn die Bewegung abgeklungen ist – sonst stünde
    // die Wahl von Anfang an auf einer Seite.
    setTimeout(() => {
        gammaBase.reset();
        betaBase.reset();
        qZero = null;
        setSide(null);
        // Nullpunkt und Sprung-Referenz frisch aus ruhiger Lage
        gammaJump.reset();
        betaJump.reset();
        selectReady = true;
    }, SETTLE_DELAY);
}

// Neigen wählt eine Seite – mit Hysterese, damit es nicht springt.
function evaluateSide(dGamma) {
    if (!selectReady || selConfirmed) return;

    let side = selSide;
    if (selSide === 'left' && dGamma > -SELECT_RELEASE) side = null;
    else if (selSide === 'right' && dGamma < SELECT_RELEASE) side = null;

    if (side === null) {
        if (dGamma < -SELECT_ENTER) side = 'left';
        else if (dGamma > SELECT_ENTER) side = 'right';
    }

    if (side !== selSide) setSide(side);
}

// Hebt eine Seite hervor und beginnt ihre Haltezeit neu.
function setSide(side) {
    selSide = side;
    selHoldStart = Date.now();
    sideEls.left.classList.toggle('active', side === 'left');
    sideEls.right.classList.toggle('active', side === 'right');
    sideEls.left.style.setProperty('--selection-progress', '0');
    sideEls.right.style.setProperty('--selection-progress', '0');
}

// Das Halten blendet das Bild in seine Zeichnung über. Ist sie vollständig zu
// sehen, bleibt sie kurz allein stehen, bevor die Szene übernimmt.
function selectLoop() {
    if (!isSelecting) { selectFrame = null; return; }

    if (selSide && SCENE_READY[selSide] && !selConfirmed) {
        const progress = clamp((Date.now() - selHoldStart) / SELECT_HOLD, 0, 1);
        sideEls[selSide].style.setProperty('--selection-progress', String(progress));
        if (progress >= 1) confirmSide(selSide);
    }

    selectFrame = requestAnimationFrame(selectLoop);
}

function confirmSide(side) {
    if (selConfirmed || !SCENE_READY[side]) return;
    selConfirmed = true;
    sideEls.left.classList.toggle('active', side === 'left');
    sideEls.right.classList.toggle('active', side === 'right');
    sideEls[side].style.setProperty('--selection-progress', '1');
    setTimeout(() => startScene(side), SELECT_DRAWING_PAUSE);
}

// Die Wahl steht – die gewählte Szene wird aufgebaut und übernimmt. Der
// Nullpunkt bleibt bewusst der der Anfangskalibrierung: Beim Auswählen wird
// seitlich gekippt, ein Reset hier setzte die Mitte auf diese gekippte Lage und
// verschöbe die Skalierung der Neigung. Nur die Zeigerposition wird neu gesetzt,
// damit der Zeiger nicht von seinem alten Platz herüberschleift.
function startScene(side) {
    board.classList.remove('is-visible');
    board.classList.add('is-fading-in');
    loadScene(side);

    const revealScene = () => {
        isSelecting = false;
        selectEl.classList.remove('is-shown');
        selectEl.classList.add('is-gone');
        requestAnimationFrame(() => board.classList.add('is-visible'));
    };

    // Die Auswahl bleibt stehen, bis das Schaubild geladen ist. Es blendet
    // dann zusammen mit der Auswahl ein, statt unvermittelt aufzutauchen.
    if (boardImg.complete && boardImg.naturalWidth) revealScene();
    else boardImg.addEventListener('load', revealScene, { once: true });

    isCursorPlaced = false;
}

// Ohne gekoppeltes Smartphone lässt sich nicht neigen. Ein Klick auf eine
// spielbereite Seite übernimmt dann das Bestätigen – wie schon der Klick an
// der Einführung vorbei.
selectEl.addEventListener('click', (event) => {
    if (connection.hasController()) return;
    if (!isSelecting || selConfirmed) return;

    const option = event.target.closest('.select-option');
    if (option && SCENE_READY[option.dataset.side]) confirmSide(option.dataset.side);
});


// ═══════════════════════════════════════════════════════════════════════════
//  Spiel auf dem Schaubild — den Weg eines Objekts als Punkte verbinden
//
//  Übernommen ist die Zeigerführung aus dem Prototyp (js/interactions/
//  punkte.js): freie Bewegung über beide Achsen, Totzone gegen das Wackeln,
//  und der Zeiger zieht der Neigung nur gedämpft nach. Das Führen ist damit
//  eine motorische Aufgabe und bleibt es auch hier.
//
//  Zwei Dinge sind anders als im Prototyp, beide aus demselben Grund – dort
//  war die Reihenfolge vorgegeben, hier ist sie die eigentliche Frage:
//
//  1. Die Punkte tragen keine Nummern, und der nächste ist nicht markiert.
//     Wer den Weg beschreiben soll, darf ihn nicht ablesen können.
//  2. Gespielt wird immer nur eine Szene – die zuvor gewählte. Jede bringt
//     ihre eigene Route mit; welche geladen wird, entscheidet die Szenenwahl
//     (SCENES, loadScene).
// ═══════════════════════════════════════════════════════════════════════════

const canvas = byId('boardCanvas');
const ctx = canvas.getContext('2d');

// Maße, in denen gerechnet und gezeichnet wird — dieselben, in denen das
// Schaubild angelegt ist. Die Fläche ergibt sich aus dem Fenster des 14"-Macs
// (1512 × 982) abzüglich Kopfleiste (64) und Aufgabenzeile (48).
//
// Der Canvas selbst hat die doppelte Auflösung; diese Verdopplung wird einmal
// in die Zeichenmatrix gelegt, damit alle Koordinaten unten den Maßen des
// Bildes entsprechen und aus Figma unverändert übernommen werden können.
const BOARD_W = 1512;
const BOARD_H = 870;
ctx.setTransform(canvas.width / BOARD_W, 0, 0, canvas.height / BOARD_H, 0, 0);

// Zwei Szenen stehen zur Wahl. Jede bringt ihr eigenes Hintergrundbild, ihre
// Stationsebenen und ihre Punkte mit; gespielt wird immer nur eine, die bei der
// Bestätigung geladen wird.
//
// Je Punkt: `x`/`y` der Ort am Motiv, `lx`/`ly` die Mitte der Beschriftung
// (getrennt, weil die Motive im dichten Teil sitzen, die Schrift aber Platz in
// freien Flächen braucht). `img` ist die Stationsebene über der Szene, `grau`
// setzt sie zusätzlich zurück, falls das Motiv schon von sich aus fast grau ist.
//
// Hinweis: Die Koordinaten der Straße sind aus Eintragspfade 2 übernommen und
// noch auf das alte Schaubild bezogen – sie müssen auf strasseSzene.png neu
// eingemessen werden (Klick ins Bild schreibt die Koordinaten in die Konsole).
const IMG_BASE = '/img/interactionen/eintragspfade/';

const SCENES = {
    left: {
        bg: IMG_BASE + 'lawiSzene.png',
        route: 'c',
        points: [
            { id: 'c1', route: 'c', label: 'Mulchfolie im Einsatz', x: 145, y: 555, lx: 200, ly: 400, img: 'lawi1.png', grau: true },
            { id: 'c2', route: 'c', label: 'Verwitterung über die Saison', x: 360, y: 500, lx: 380, ly: 330, img: 'lawi2.png', grau: true },
            { id: 'c3', route: 'c', label: 'Reste nach der Bergung', x: 660, y: 535, lx: 690, ly: 110, img: 'lawi3.png' },
            { id: 'c4', route: 'c', label: 'Einarbeitung durch Pflügen', x: 1240, y: 560, lx: 1160, ly: 110, img: 'lawi4.png' },
            { id: 'c5', route: 'c', label: 'Verlagerung in die Tiefe', x: 945, y: 787, lx: 1270, ly: 750, img: 'lawi5.png', grau: true },
            { id: 'z', route: 'ziel', label: 'Akkumulation im Boden', x: 385, y: 787, lx: 350, ly: 700, img: 'lawi6.png' }
        ]
    },
    right: {
        bg: IMG_BASE + 'strasseSzene.png',
        route: 'a',
        points: [
            { id: 'a1', route: 'a', label: 'Tüte am Straßenrand', x: 85, y: 360, lx: 197, ly: 120, img: 'strasse1.png' },
            { id: 'a2', route: 'a', label: 'Zerfall durch UV und Überfahren', x: 235, y: 320, lx: 290, ly: 180, img: 'strasse2.png' },
            { id: 'a3', route: 'a', label: 'Aufwirbelung', x: 334, y: 460, lx: 460, ly: 330, img: 'strasse3.png' },
            { id: 'a4', route: 'a', label: 'Transport durch die Luft', x: 990, y: 240, lx: 990, ly: 330, img: 'strasse4.png' },
            { id: 'a5', route: 'a', label: 'Deposition auf Blättern', x: 1310, y: 380, lx: 1300, ly: 290, img: 'strasse5.png' },
            { id: 'a6', route: 'a', label: 'Laubfall', x: 1390, y: 625, lx: 1270, ly: 550, img: 'strasse6.png' },
            { id: 'z', route: 'ziel', label: 'Akkumulation im Boden', x: 800, y: 805, lx: 630, ly: 790, img: 'strasse7.png' }
        ]
    }
};

const board = document.querySelector('.board');
const boardImg = byId('boardImg');

// Werden erst mit der gewählten Szene gefüllt (loadScene).
let POINTS = [];
let ROUTES = {};
let pointById = {};
let stationsBilder = {};

// Baut Hintergrund, Stationsebenen und Punkte der gewählten Szene auf. Die
// Stationsbilder werden neu erzeugt und vor dem Canvas eingehängt, damit die
// Zeichenfläche oben bleibt.
function loadScene(side) {
    const scene = SCENES[side];
    boardImg.src = scene.bg;

    board.querySelectorAll('.station').forEach(el => el.remove());
    scene.points.forEach(point => {
        if (!point.img) return; // ein Punkt ohne eigene Ebene (z. B. das Ziel)
        const img = document.createElement('img');
        img.className = 'station' + (point.grau ? ' station-grau' : '');
        img.id = 'station-' + point.id;
        img.src = IMG_BASE + point.img;
        img.alt = '';
        board.insertBefore(img, canvas);
    });

    POINTS = scene.points;
    ROUTES = { [scene.route]: scene.points.map(point => point.id) };
    pointById = Object.fromEntries(POINTS.map(point => [point.id, point]));
    stationsBilder = Object.fromEntries(
        POINTS.filter(point => point.img).map(point => [point.id, byId('station-' + point.id)])
    );

    resetBoard();
}

function zeigeStationen() {
    POINTS.forEach(point => {
        const bild = stationsBilder[point.id];
        if (bild) bild.classList.toggle('is-farbig', isPlaced(point));
    });
}

// Die Punkte sind gemalt, nicht gezeichnet: ein Bild aus derselben Werkstatt
// wie die Collage. Ein geometrisch exakter Kreis stand als Fremdkörper darin.
const punktBild = new Image();
punktBild.src = '/img/interactionen/eintragspfade/punkt.png';

// Der Zeiger selbst ist aus demselben Grund kein gezeichneter Kreis, sondern
// ein Partikel – passend zur Collage-Optik der Punkte.
const zeigerBild = new Image();
zeigerBild.src = '/img/interactionen/eintragspfade/partikel.png';
const ZEIGER_SEITENVERHAELTNIS = 139 / 130;

// Ein gemalter Punkt trägt seine Fläche schlechter als ein gefüllter Kreis –
// er braucht mehr Raum, damit die Textur überhaupt zu sehen ist.
const BILD_GROESSE = 30;
const BILD_GROESSE_ANGEBOT = 40;
const BILD_GROESSE_GRAU = 24;

// Der Akzent stammt aus dem Punktbild selbst (dessen mittlere Farbe), damit
// Welle, Ring und Linie zu ihm passen statt daneben zu liegen.
const PUNKT = '#fc655b';
const PUNKT_TIEF = '#c2372e';
const PUNKT_SANFT = 'rgba(252, 101, 91, 0.22)';

// ── Zeiger ─────────────────────────────────────────────────────────────────
// Werte aus dem Prototyp; der Fangradius ist auf die doppelte Bildbreite
// umgerechnet (dort 33 bei 960 Punkten Breite).
const TILT_RANGE_X = 40;
const TILT_RANGE_Y = 30;
const DEAD_ZONE = 2.5;
const SMOOTHING = 0.04;
const HIT_RADIUS = 47;


let targetX = BOARD_W / 2;
let targetY = BOARD_H / 2;
let cursorX = BOARD_W / 2;
let cursorY = BOARD_H / 2;
let isCursorPlaced = false;

let activeRoute = null;      // 'a', 'c' oder null (noch keine Wahl)
let step = 0;                // wie viele Punkte der aktiven Route sitzen
const doneRoutes = new Set();
let wrongId = null;          // zuletzt fälschlich angesteuerter Punkt
let wrongUntil = 0;
let boardFrame = null;

// Fehlgriff-Rückmeldung: roter Ring plus ein kurzes Kopfschütteln – dieselbe
// Bewegung wie das „falsch" im Größeneinordnungs-Quiz (schnipsel-shake): ein
// horizontales Hin und Her mit abklingendem Ausschlag.
const WRONG_SHOW = 600;   // ms, wie lange der Fehlgriff markiert bleibt
const WRONG_SHAKE = 450;  // ms Dauer des Kopfschüttelns (wie im Quiz)
// Versatz bei 0/20/40/60/80/100 % – gleicher Rhythmus und gleiches Abkling-
// Verhältnis (~1,6) wie im Quiz (dort ±14/±9), aber auf die kleine Punktgröße
// (30) herunterskaliert, damit der Punkt schüttelt statt zu springen.
const WRONG_SHAKE_KEYS = [0, -8, 8, -5, 5, 0];

// Der Versatz zum Zeitpunkt `elapsed` (ms seit Beginn), mit ease-in-out je
// Abschnitt – wie die CSS-Animation zwischen ihren Keyframes.
function wrongShakeDX(elapsed) {
    if (elapsed < 0 || elapsed >= WRONG_SHAKE) return 0;
    const seg = (elapsed / WRONG_SHAKE) * (WRONG_SHAKE_KEYS.length - 1);
    const i = Math.min(Math.floor(seg), WRONG_SHAKE_KEYS.length - 2);
    const f = seg - i;
    const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    return WRONG_SHAKE_KEYS[i] + (WRONG_SHAKE_KEYS[i + 1] - WRONG_SHAKE_KEYS[i]) * e;
}

/** Setzt die Zielposition aus der Neigung — beide Achsen zugleich. */
function moveCursor(dGamma, dBeta) {
    let x = Math.abs(dGamma) < DEAD_ZONE ? 0 : dGamma;
    let y = Math.abs(dBeta) < DEAD_ZONE ? 0 : dBeta;

    x = clamp(x, -TILT_RANGE_X, TILT_RANGE_X);
    y = clamp(y, -TILT_RANGE_Y, TILT_RANGE_Y);

    targetX = ((x + TILT_RANGE_X) / (2 * TILT_RANGE_X)) * BOARD_W;
    targetY = ((y + TILT_RANGE_Y) / (2 * TILT_RANGE_Y)) * BOARD_H;

    // Der erste Wert setzt den Zeiger, statt ihn dorthin laufen zu lassen.
    if (!isCursorPlaced) {
        cursorX = targetX;
        cursorY = targetY;
        isCursorPlaced = true;
    }
}

// ── Ablauf ─────────────────────────────────────────────────────────────────

/** Die Punkte, die gerade als Nächstes zählen. */
function expectedIds() {
    if (activeRoute) return [ROUTES[activeRoute][step]];

    // Ohne Wahl stehen die Anfänge aller noch offenen Wege bereit.
    return Object.keys(ROUTES)
        .filter(name => !doneRoutes.has(name))
        .map(name => ROUTES[name][0]);
}

function isPlaced(point) {
    if (doneRoutes.has(point.route)) return true;
    if (point.route === 'ziel') return doneRoutes.size > 0;
    if (point.route !== activeRoute) return false;

    return ROUTES[activeRoute].indexOf(point.id) < step;
}

function checkConnection() {
    const expected = expectedIds();

    for (const point of POINTS) {
        if (Math.hypot(cursorX - point.x, cursorY - point.y) > HIT_RADIUS) continue;

        if (expected.includes(point.id)) {
            advance(point);
        } else if (!isPlaced(point)) {
            // Kein Fehlschlag mit Folgen, nur eine Rückmeldung: Dieser Schritt
            // ist noch nicht dran. Der Weg bleibt stehen, wo er war.
            //
            // Nur neu auslösen, wenn es ein anderer Punkt ist oder das letzte
            // Schütteln schon durch ist – sonst setzte jeder Frame den Start
            // zurück und die Bewegung liefe nie los, solange der Zeiger auf dem
            // Punkt bleibt. So schüttelt er sofort beim Anwählen und wiederholt
            // sich, solange man auf ihm verweilt.
            if (point.id !== wrongId || Date.now() >= wrongUntil) {
                wrongId = point.id;
                wrongUntil = Date.now() + WRONG_SHOW;
            }
        }

        return; // nur der erste getroffene Punkt zählt
    }
}

function advance(point) {
    // Der erste Punkt entscheidet, welcher Weg beschrieben wird.
    if (!activeRoute) {
        activeRoute = point.route;
        step = 0;
    }

    step++;
    wrongId = null;
    zeigeStationen();

    if (step < ROUTES[activeRoute].length) return;

    doneRoutes.add(activeRoute);
    activeRoute = null;
    step = 0;
    zeigeStationen();

    if (isFinished()) {
        // Der Zeiger bleibt, wo er ist, und bleibt führbar: Von hier aus wird
        // der Kasten in der Mitte angesteuert, der zurück zur Wahl führt.
        backHoldStart = 0;
        backDone = false;
        backShownAt = Date.now(); // von hier an blendet der Kasten ein
        reportCompletion({ label: 'Der Weg ist beschrieben' });
    }
}

/** Der Weg liegt – es ist nichts mehr zu legen. */
function isFinished() {
    return doneRoutes.size === Object.keys(ROUTES).length;
}

function resetBoard() {
    activeRoute = null;
    step = 0;
    doneRoutes.clear();
    wrongId = null;
    backHoldStart = 0;
    backDone = false;
    backShownAt = 0;
    isCursorPlaced = false;
    zeigeStationen();
}

// ── Rückweg zur Auswahl ────────────────────────────────────────────────────
// Ist der Weg beschrieben, bleibt der Zeiger führbar und in der Mitte steht ein
// Kasten. Wer ihn ansteuert und hält, kommt zurück zur Wahl und kann die zweite
// Szene beschreiben. Dieselbe Geste wie bei der Wahl selbst: hinsteuern, halten.
const BACK_TEXT = 'hier halten, um zurück zur Auswahl zu gelangen';
const BACK_H = 60;
const BACK_PAD_X = 26;
const BACK_HOLD = 1500;   // ms
const BACK_FADE = 400;    // ms, in denen der Kasten einblendet
const BACK_SETTLE = 400;  // ms: kurzes Einrasten nach dem Halten, dann Rücksprung
const BACK_FONT = '400 20px "Inclusive Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

let backHoldStart = 0;   // 0 = der Zeiger liegt nicht auf dem Kasten
let backDone = false;
let backShownAt = 0;     // wann der Kasten erschienen ist (fürs Einblenden)

// Die Breite ergibt sich aus dem Text, wie bei den Beschriftungen der Punkte.
function backBox() {
    ctx.font = BACK_FONT;
    const w = ctx.measureText(BACK_TEXT).width + BACK_PAD_X * 2;

    return {
        left: (BOARD_W - w) / 2,
        top: (BOARD_H - BACK_H) / 2,
        w,
        h: BACK_H
    };
}

function isCursorOnBack() {
    const box = backBox();
    return cursorX >= box.left && cursorX <= box.left + box.w
        && cursorY >= box.top && cursorY <= box.top + box.h;
}

function checkBackBox() {
    if (backDone) return;

    // Verlässt der Zeiger den Kasten, beginnt das Halten von vorn.
    if (!isCursorOnBack()) {
        backHoldStart = 0;
        return;
    }

    if (!backHoldStart) {
        backHoldStart = Date.now();
        return;
    }

    if (Date.now() - backHoldStart >= BACK_HOLD) {
        // Gehalten – aber nicht sofort weg: Der Kasten rastet erst kurz ein
        // (das Schütteln klingt aus, ein kleiner Snap bestätigt), dann folgt
        // der Rücksprung zur Auswahl.
        backDone = true;
        setTimeout(() => {
            resetBoard();
            openSelect();
        }, BACK_SETTLE);
    }
}

// ── Zeichnen ───────────────────────────────────────────────────────────────

function routeColor(name, isDone) {
    if (isDone) return 'rgba(253, 100, 88, 0.4)';
    return name === activeRoute ? '#fd6458' : 'rgba(253, 100, 88, 0.16)';
}

function drawRouteLine(name) {
    const ids = ROUTES[name];
    const isDone = doneRoutes.has(name);
    const upTo = isDone ? ids.length : (name === activeRoute ? step : 0);
    if (upTo < 2) return;

    ctx.beginPath();
    ctx.moveTo(pointById[ids[0]].x, pointById[ids[0]].y);
    for (let i = 1; i < upTo; i++) {
        const p = pointById[ids[i]];
        ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = routeColor(name, isDone);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
}

function drawPoints() {
    const now = Date.now();
    const isChoosing = !activeRoute;

    // Beschriftet wird erst, was sitzt: So entsteht der Weg als lesbare Kette,
    // ohne vorher zu verraten, was wohin gehört.
    //
    // Und zwar vollständig vor den Punkten – dadurch verschwindet der Anfang
    // jeder Verbindungslinie unter seinem Punkt, statt sichtbar aus dessen
    // Mitte zu kommen.
    POINTS.forEach(point => {
        if (isPlaced(point)) drawLabel(point);
    });

    POINTS.forEach(point => {
        const placed = isPlaced(point);
        const isStart = ROUTES[point.route] && ROUTES[point.route][0] === point.id;
        const isOffered = isChoosing && isStart && !doneRoutes.has(point.route);
        const isWrong = point.id === wrongId && now < wrongUntil;
        // Kopfschütteln des Fehlgriffs: horizontaler Versatz für Bild und Ring.
        const wrongDX = isWrong ? wrongShakeDX(now - (wrongUntil - WRONG_SHOW)) : 0;

        // Der Weg, der gerade nicht gespielt wird, tritt zurück – sichtbar
        // bleibt er trotzdem, sonst verschwände das Angebot ganz.
        const isAside = activeRoute
            && point.route !== activeRoute
            && point.route !== 'ziel'
            && !doneRoutes.has(point.route);

        // Vor der Wahl steht alles außer den beiden Anfängen im Grau: Zu
        // Beginn ist nur eine Frage offen – wo es losgeht. Die übrigen Punkte
        // sind dann noch keine Möglichkeit, sondern nur Ausblick, und je
        // weniger sie mitleuchten, desto klarer stehen die Anfänge da.
        const isDimmed = isChoosing && !isOffered && !placed;

        // Ein Angebot darf pulsieren, das nächste Ziel nicht: Es zu markieren
        // hieße, die Antwort mitzuliefern.
        if (isOffered) {
            // Eine Welle, die nach außen läuft und dabei verblasst. Sie zieht
            // den Blick auch dann auf sich, wenn er gerade woanders im Bild
            // ist – ein bloß größer und kleiner werdender Kreis tut das nicht.
            const phase = (now % 1500) / 1500;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 14 + phase * 42, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(252, 101, 91, ${0.6 * (1 - phase)})`;
            ctx.lineWidth = 2 + 6 * (1 - phase);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(point.x, point.y, 24 + Math.sin(now / 220) * 5, 0, Math.PI * 2);
            ctx.fillStyle = PUNKT_SANFT;
            ctx.fill();
        }

        // Die Zustände trägt das Bild über Größe und Deckkraft: Umfärben wie
        // eine Füllung lässt es sich nicht.
        let seite = BILD_GROESSE;
        if (isOffered) seite = BILD_GROESSE_ANGEBOT;
        else if (isDimmed) seite = BILD_GROESSE_GRAU;

        // Solange das Bild noch lädt, hält ein schlichter Kreis den Platz –
        // sonst fehlten die Punkte in den ersten Bildern ganz.
        if (!punktBild.complete) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, seite / 2, 0, Math.PI * 2);
            ctx.fillStyle = PUNKT;
            ctx.fill();
            return;
        }

        ctx.save();
        if (isDimmed) ctx.globalAlpha = 0.45;
        else if (isAside) ctx.globalAlpha = 0.5;
        ctx.drawImage(punktBild, point.x + wrongDX - seite / 2, point.y - seite / 2, seite, seite);
        ctx.restore();

        // Gesetzte Punkte tragen keinen Ring – wie im Einführungsspiel bleiben
        // sie schlicht das Bild. Ein Fehlgriff meldet sich allein über das
        // Kopfschütteln (wrongDX oben), ohne roten Ring.
    });
}

// Die Beschriftung steht nicht am Motiv, sondern in der nächsten freien
// Fläche — auf der Collage selbst wäre sie kaum zu lesen. Kasten und Linie
// tragen die Farbe des Partikels, damit erkennbar bleibt, wozu sie gehören.
function drawLabel(point) {
    const padX = 14;
    const padY = 9;

    // Dünnere Schrift als zuvor (400 statt 600) und ein durchscheinend weißer
    // Hintergrund, durch den die Collage schimmert.
    ctx.font = '400 18px "Inclusive Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
    const width = ctx.measureText(point.label).width + padX * 2;
    const height = 18 + padY * 2;
    const left = point.lx - width / 2;
    const top = point.ly - height / 2;

    // Linie vom Punkt zum Kasten, an dessen Rand sie endet
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(
        clamp(point.x, left, left + width),
        clamp(point.y, top, top + height)
    );
    ctx.strokeStyle = 'rgba(252, 101, 91, 0.4)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 11);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fill();
    ctx.strokeStyle = PUNKT;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = PUNKT_TIEF;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(point.label, point.lx, point.ly + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

// Der Kasten, der zurück zur Auswahl führt – im Stil der idle-box der ersten
// Station: weißer Kasten mit hellgrauem Rand und weichem Schatten, darin der
// Hinweis im Instruction-Stil (Akzentfarbe, kleingeschrieben). Der
// Haltefortschritt füllt ihn dabei einfach von links nach rechts.
function drawBackBox() {
    const box = backBox();

    // Sanftes Einblenden: Der Kasten kommt nicht mit dem letzten Punkt
    // zugleich, sondern zieht langsam auf – wie die idle-box per Opacity.
    const alpha = backShownAt
        ? clamp((Date.now() - backShownAt) / BACK_FADE, 0, 1)
        : 1;

    // Haltefortschritt, 0..1 — bleibt nach dem Einrasten voll gefüllt stehen,
    // bis der Rücksprung zur Auswahl folgt (checkBackBox).
    const held = backDone ? 1
        : backHoldStart ? clamp((Date.now() - backHoldStart) / BACK_HOLD, 0, 1)
        : 0;

    const boxPath = new Path2D();
    boxPath.roundRect(box.left, box.top, box.w, box.h, 14);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Weiße Fläche mit weichem Schatten (wie die idle-box).
    ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#ffffff';
    ctx.fill(boxPath);

    // Rand und Füllbalken ohne Schatten.
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Haltefortschritt als Balken, der den Kasten von links nach rechts füllt.
    if (held > 0) {
        ctx.save();
        ctx.clip(boxPath);
        ctx.fillStyle = 'rgba(253, 100, 88, 0.35)';
        ctx.fillRect(box.left, box.top, box.w * held, box.h);
        ctx.restore();
    }

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.stroke(boxPath);

    ctx.font = BACK_FONT;
    ctx.fillStyle = '#fd6458';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(BACK_TEXT.toLowerCase(), BOARD_W / 2, BOARD_H / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.restore();
}

function drawCursor() {
    // Hinter Einführung und Szenenwahl hat der Zeiger nichts zu suchen. Nach
    // dem letzten Punkt bleibt er dagegen stehen: Mit ihm wird der Kasten in
    // der Mitte angesteuert.
    if (isIntroVisible || isSelecting) return;

    // Der Zeiger bleibt die ganze Zeit knallig pink und groß, damit er in der
    // bunten Collage jederzeit leicht zu sehen ist.
    const hoehe = 46;
    const breite = hoehe * ZEIGER_SEITENVERHAELTNIS;

    ctx.save();

    if (zeigerBild.complete) {
        ctx.drawImage(zeigerBild, cursorX - breite / 2, cursorY - hoehe / 2, breite, hoehe);
    } else {
        // Solange das Bild noch lädt, steht wenigstens ein Kreis am Platz.
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, hoehe / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ff1493';
        ctx.fill();
    }

    ctx.restore();
}

function drawBoard() {
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    Object.keys(ROUTES).forEach(drawRouteLine);

    // Der Faden vom zuletzt gesetzten Punkt zum Zeiger
    if (activeRoute && step > 0) {
        const last = pointById[ROUTES[activeRoute][step - 1]];
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(cursorX, cursorY);
        ctx.strokeStyle = 'rgba(253, 100, 88, 0.55)';
        ctx.lineWidth = 5;
        ctx.stroke();
    }

    drawPoints();

    // Ist der Weg beschrieben, steht der Kasten in der Mitte – unter dem
    // Zeiger, damit dieser darauf sichtbar bleibt.
    if (isFinished()) drawBackBox();

    drawCursor();
}

function boardLoop() {
    // Der Zeiger folgt der Neigung auch nach dem letzten Punkt weiter: Dann
    // gibt es zwar nichts mehr zu fangen, aber der Kasten in der Mitte will
    // angesteuert werden.
    if (!isIntroVisible && !isSelecting) {
        cursorX += (targetX - cursorX) * SMOOTHING;
        cursorY += (targetY - cursorY) * SMOOTHING;

        if (isFinished()) checkBackBox();
        else checkConnection();
    }

    drawBoard();

    boardFrame = requestAnimationFrame(boardLoop);
}

function startBoard() {
    resetBoard();
    if (boardFrame === null) boardFrame = requestAnimationFrame(boardLoop);
}


/**
 * Rechnet einen Mauszeiger in Bildkoordinaten um.
 *
 * Die Zeichenfläche wird über `object-fit: cover` eingepasst und ragt deshalb
 * in einer Richtung über ihre Box hinaus. Dieser Überstand muss heraus,
 * sonst läuft der Zeiger versetzt zur Maus – `Math.max` liefert dabei den
 * Maßstab, mit dem gefüllt wird.
 */
function boardPointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(rect.width / BOARD_W, rect.height / BOARD_H);
    const left = rect.left + (rect.width - BOARD_W * scale) / 2;
    const top = rect.top + (rect.height - BOARD_H * scale) / 2;

    return {
        x: (event.clientX - left) / scale,
        y: (event.clientY - top) / scale
    };
}

// Ohne gekoppeltes Smartphone folgt der Zeiger der Maus. Das ist kein zweiter
// Bedienweg, sondern die Möglichkeit, die Lage der Punkte am Bild zu prüfen,
// ohne jedes Mal ein Gerät zu verbinden.
canvas.addEventListener('mousemove', (event) => {
    if (connection.hasController()) return;

    const point = boardPointFrom(event);
    targetX = point.x;
    targetY = point.y;

    if (!isCursorPlaced) {
        cursorX = targetX;
        cursorY = targetY;
        isCursorPlaced = true;
    }
});

// Hilfe beim Einrichten der Punkte: Ein Klick ins Bild schreibt seine
// Koordinaten in die Konsole – genau die Zahlen, die oben in POINTS stehen.
// Nur ohne gekoppeltes Gerät, damit im Betrieb nichts mitläuft.
canvas.addEventListener('click', (event) => {
    if (connection.hasController()) return;

    const point = boardPointFrom(event);
    console.log(`x: ${Math.round(point.x)}, y: ${Math.round(point.y)}`);
});

startBoard();


// ═══════════════════════════════════════════════════════════════════════════
//  Einführungsspiel auf dem Startbildschirm — das Prinzip vorab erklären
//
//  Ein kleines "Punkte verbinden" wie im Prototyp (js/interactions/punkte.js),
//  hier nur als Übung: Der Übungszeiger (ein schwarzer Punkt) folgt der Neigung
//  und fängt die nummerierten Punkte der Reihe nach ein – Start ist oben links.
//  Wer das hier tut, hat die Geste verstanden, bevor die eigentliche Aufgabe
//  beginnt. Die Punkte liegen als Bild (dasselbe punkt.png wie im Spiel) in den
//  Rändern um den Einführungskasten, das Schütteln beendet die Einführung.
// ═══════════════════════════════════════════════════════════════════════════

const introCanvas = byId('introCanvas');
const ictx = introCanvas.getContext('2d');

// Anteilig zur Bühne angelegt, damit die Punkte bei jeder Fenstergröße im Rand
// um den Kasten liegen. Reihenfolge im Uhrzeigersinn, beginnend oben links.
const INTRO_DOTS = [
    { label: '01', nx: 0.200, ny: 0.500 },
    { label: '02', nx: 0.350, ny: 0.250 },
    { label: '03', nx: 0.500, ny: 0.600 },
    { label: '04', nx: 0.650, ny: 0.250 },
    { label: '05', nx: 0.800, ny: 0.500 },
];

// Fangradius des Übungszeigers – bewusst identisch zur folgenden Interaktion.
// Im Spiel gilt HIT_RADIUS im 1512×870-Board; die Übung bildet dieselbe Neigung
// auf introW statt BOARD_W ab, deshalb wird der Radius mit demselben Verhältnis
// umgerechnet (in sizeIntroCanvas gesetzt). So ist die Fangtoleranz dieselbe und
// nicht mehr großzügiger.
let introHit = HIT_RADIUS;
const INTRO_DOT = 30; // Kantenlänge des Punktbildes
// Schrift der Zahlen: dieselbe Familie wie im Modul.
const INTRO_LABEL_FONT = "'Inclusive Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";

let introW = 0;
let introH = 0;
let introTargetX = 0;
let introTargetY = 0;
let introCursorX = 0;
let introCursorY = 0;
let introCursorPlaced = false;
let nextIntroDot = 0;
let introGameCompleted = false;
let introFrame = null;

// Die Zeichenfläche in Bühnenpixeln, für scharfe Kanten mit der Pixeldichte
// multipliziert. Gerechnet und gezeichnet wird danach in CSS-Pixeln.
function sizeIntroCanvas() {
    const rect = introCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    introW = rect.width;
    introH = rect.height;
    // Denselben Board-Anteil wie im Spiel fangen: HIT_RADIUS gilt dort in
    // BOARD_W, die Übungsfläche ist introW breit.
    introHit = HIT_RADIUS * (introW / BOARD_W);
    introCanvas.width = rect.width * dpr;
    introCanvas.height = rect.height * dpr;
    ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function introDotXY(dot) {
    return { x: dot.nx * introW, y: dot.ny * introH };
}

// Neigen führt den Übungszeiger – dieselbe Zuordnung wie im Spiel, nur auf die
// Bühne statt aufs Schaubild abgebildet.
function moveIntroCursor(dGamma, dBeta) {
    let x = Math.abs(dGamma) < DEAD_ZONE ? 0 : dGamma;
    let y = Math.abs(dBeta) < DEAD_ZONE ? 0 : dBeta;

    x = clamp(x, -TILT_RANGE_X, TILT_RANGE_X);
    y = clamp(y, -TILT_RANGE_Y, TILT_RANGE_Y);

    introTargetX = ((x + TILT_RANGE_X) / (2 * TILT_RANGE_X)) * introW;
    introTargetY = ((y + TILT_RANGE_Y) / (2 * TILT_RANGE_Y)) * introH;

    if (!introCursorPlaced) {
        introCursorX = introTargetX;
        introCursorY = introTargetY;
        introCursorPlaced = true;
    }
}

function checkIntroConnection() {
    if (nextIntroDot >= INTRO_DOTS.length) return;

    const { x, y } = introDotXY(INTRO_DOTS[nextIntroDot]);
    if (Math.hypot(introCursorX - x, introCursorY - y) < introHit) {
        nextIntroDot++;
        if (!introGameCompleted && nextIntroDot >= INTRO_DOTS.length) {
            introGameCompleted = true;

            // Das Übungsspiel hat seinen Zweck erfüllt: Es blendet als
            // eigenes Overlay ab und geht danach aus dem DOM, bevor die Box
            // erscheint – wie in Eintragspfade 1, Produktionsabriss und
            // 3 Bereiche, statt nur an Ort und Stelle unsichtbar zu werden.
            lehreGame.classList.add('is-gone');
            if (introFrame !== null) {
                cancelAnimationFrame(introFrame);
                introFrame = null;
            }

            setTimeout(() => {
                lehreGame.remove();
                introBox.classList.remove('pre-game');
            }, LEHRE_GAME_FADE);
        }
    }
}

function drawIntro() {
    ictx.clearRect(0, 0, introW, introH);
    const now = Date.now();

    // Der schon verbundene Weg – in der Koralle des Spiels, damit die Übung
    // dieselbe Sprache spricht wie das Schaubild später.
    if (nextIntroDot > 1) {
        ictx.beginPath();
        const first = introDotXY(INTRO_DOTS[0]);
        ictx.moveTo(first.x, first.y);
        for (let i = 1; i < nextIntroDot; i++) {
            const p = introDotXY(INTRO_DOTS[i]);
            ictx.lineTo(p.x, p.y);
        }
        ictx.strokeStyle = '#fd6458';
        ictx.lineWidth = 4;
        ictx.lineCap = 'round';
        ictx.lineJoin = 'round';
        ictx.stroke();
    }

    // Der Faden vom zuletzt gefangenen Punkt zum Zeiger – dieselbe Farbe, nur
    // durchscheinend, damit er als noch offener Weg lesbar bleibt.
    if (nextIntroDot > 0 && nextIntroDot < INTRO_DOTS.length) {
        const last = introDotXY(INTRO_DOTS[nextIntroDot - 1]);
        ictx.beginPath();
        ictx.moveTo(last.x, last.y);
        ictx.lineTo(introCursorX, introCursorY);
        ictx.strokeStyle = 'rgba(253, 100, 88, 0.55)';
        ictx.lineWidth = 3;
        ictx.stroke();
    }

    INTRO_DOTS.forEach((dot, index) => {
        const { x, y } = introDotXY(dot);
        const isConnected = index < nextIntroDot;
        const isTarget = index === nextIntroDot;

        // Der nächste Punkt pulsiert – wie das Angebot im Spiel.
        if (isTarget) {
            const phase = (now % 1500) / 1500;
            ictx.beginPath();
            ictx.arc(x, y, 14 + phase * 34, 0, Math.PI * 2);
            ictx.strokeStyle = `rgba(252, 101, 91, ${0.6 * (1 - phase)})`;
            ictx.lineWidth = 2 + 5 * (1 - phase);
            ictx.stroke();
        }

        if (punktBild.complete) {
            ictx.drawImage(punktBild, x - INTRO_DOT / 2, y - INTRO_DOT / 2, INTRO_DOT, INTRO_DOT);
        } else {
            ictx.beginPath();
            ictx.arc(x, y, INTRO_DOT / 2, 0, Math.PI * 2);
            ictx.fillStyle = PUNKT;
            ictx.fill();
        }

        // Zahl daneben – nach oben links versetzt wie im Prototyp.
        ictx.font = '600 15px ' + INTRO_LABEL_FONT;
        ictx.fillStyle = isConnected ? PUNKT_TIEF : (isTarget ? '#0f172a' : '#94a3b8');
        ictx.textAlign = 'left';
        ictx.textBaseline = 'alphabetic';
        ictx.fillText(dot.label, x - 24, y - 14);
    });

    // Der Übungszeiger: einfach ein schwarzer Punkt, mit weichem Hof, damit er
    // auch auf einem der korallenen Punkte sichtbar bleibt.
    ictx.beginPath();
    ictx.arc(introCursorX, introCursorY, 16, 0, Math.PI * 2);
    ictx.fillStyle = 'rgba(15, 23, 42, 0.12)';
    ictx.fill();

    ictx.beginPath();
    ictx.arc(introCursorX, introCursorY, 9, 0, Math.PI * 2);
    ictx.fillStyle = '#0f172a';
    ictx.fill();
}

function introLoop() {
    // Mit dem Ende der Einführung endet auch das Übungsspiel.
    if (!isIntroVisible) { introFrame = null; return; }

    introCursorX += (introTargetX - introCursorX) * SMOOTHING;
    introCursorY += (introTargetY - introCursorY) * SMOOTHING;

    checkIntroConnection();
    drawIntro();

    introFrame = requestAnimationFrame(introLoop);
}

// Ohne gekoppeltes Gerät folgt der Übungszeiger der Maus – wie im Prototyp,
// damit sich die Einführung auch am Schreibtisch ausprobieren lässt.
intro.addEventListener('mousemove', (event) => {
    if (connection.hasController()) return;
    // Nach dem Einführungsspiel ist die Zeichenfläche aus dem DOM – ohne
    // diese Wache läse `getBoundingClientRect()` an ihr nur noch Nullen.
    if (!lehreGame.isConnected) return;

    const rect = introCanvas.getBoundingClientRect();
    introTargetX = event.clientX - rect.left;
    introTargetY = event.clientY - rect.top;

    if (!introCursorPlaced) {
        introCursorX = introTargetX;
        introCursorY = introTargetY;
        introCursorPlaced = true;
    }
});

window.addEventListener('resize', sizeIntroCanvas);
sizeIntroCanvas();
introCursorX = introW / 2;
introCursorY = introH / 2;
introTargetX = introW / 2;
introTargetY = introH / 2;
introFrame = requestAnimationFrame(introLoop);
