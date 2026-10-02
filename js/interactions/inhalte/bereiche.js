// ═══════════════════════════════════════════════════════════════════════════
//  Bereiche (Inhalte) — Polymer-Bilder in drei Zonen einsortieren
//  Jedes Bild gehört zu genau einem Bereich (links/mitte/rechts); nur dort
//  darf es gestapelt werden.
// ═══════════════════════════════════════════════════════════════════════════

import { socket, shareCalibration } from '../../lib/socket.js';
import { initConnectionBadge } from '../../lib/connection.js';
import { Baseline } from '../../lib/angles.js';
import { createLongShake } from '../../lib/shake.js';
import { initCalibration } from '../../lib/calibration.js';
import { reportCompletion } from '../../lib/completion.js';
import { byId } from '../../lib/dom.js';

const calBtn = byId('calBtn');
const correctEl = byId('correctEl');
const totalEl = byId('totalEl');

const playerItem = byId('playerItem');
const workspace = byId('gameWorkspace');
const bucketLeft = byId('bucketLeft');
const bucketMiddle = byId('bucketMiddle');
const bucketRight = byId('bucketRight');

const buckets = {
    left: bucketLeft,
    middle: bucketMiddle,
    right: bucketRight
};

// Vorbereitungs-Schritt: Haupttext, Erklärtexte über den Bereichen
const scoreBoard = byId('scoreBoard');
const bucketsContainer = byId('bucketsContainer');
const flash = byId('flash');
const introLayer = byId('introLayer');
const introMain = byId('introMain');
const areasNote = byId('areasNote');
const introCols = {
    left: byId('introLeft'),
    middle: byId('introMiddle'),
    right: byId('introRight')
};

// Bilder — der Dateiname bestimmt, in welchen Bereich das Bild gehört.
// Jedes Objekt kommt genau einmal vor.
const IMG_BASE = '/img/interactionen/tetris';
// scale skaliert einzelne Objekte gegenüber der Standardhöhe (--item-h):
// 1 = Standard, 1.4 = 40 % größer.
//
// Die PNGs sind auf das Objekt beschnitten, haben also keinen transparenten
// Rand mehr. Die eingestellte Höhe ist damit die Höhe des Objekts selbst –
// nur so sind die Abstände im Stapel überall gleich. Ein neues Bild deshalb
// ebenfalls beschnitten ablegen und seine Größe hier einstellen.
const ITEMS = [
    { file: 'links1.png', area: 'left', scale: 1.6 },
    { file: 'links2.png', area: 'left', scale: 1.4 },
    { file: 'links3.png', area: 'left', scale: 0.78 },
    { file: 'mitte1.png', area: 'middle', scale: 0.55 },
    { file: 'mitte2.png', area: 'middle', scale: 1.5 },
    { file: 'mitte3.png', area: 'middle', scale: 0.9 },
    { file: 'rechts1.png', area: 'right', scale: 0.74 },
    { file: 'rechts2.png', area: 'right', scale: 1.3 },
    { file: 'rechts3.png', area: 'right', scale: 0.9 }
];

const gammaBase = new Baseline();
let currentArea = 'middle'; // 'left', 'middle', 'right'
const TILT_THRESHOLD = 20;

// Die drei Spuren, in denen sich alles Bewegliche aufhält – das fallende
// Objekt wie der Übungszeiger.
const LANES = { left: '16.66%', middle: '50%', right: '83.33%' };

// Ablauf: Einführungstext → Bereiche mit Erklärungen → Spiel. Weiter führt
// jedes Mal dieselbe Geste, das Schütteln – wie in den übrigen Stationen.
let areasVisible = false;

// Welche Kategorien schon einmal offen waren. Erst wenn alle drei gelesen
// sind, steht der Hinweis zum Starten da: Vorher wäre er die Einladung, den
// Inhalt zu überspringen.
let seenAreas = new Set();

// Sperre zwischen zwei Schritten: Ein Schütteln dauert länger als das
// Ereignis, das es auslöst. Ohne diese Pause trüge dieselbe Bewegung durch
// zwei Schritte auf einmal.
const ADVANCE_COOLDOWN = 1200;
let lastAdvance = 0;

// Kurze Sperre nach dem Laden: Wer die Station durch Kippen betritt, bringt
// diese Bewegung noch mit. Nur so lang, dass sie abklingt, ohne dass man
// bewusst wartet.
const READY_DELAY = 500;
let inputReady = false;
setTimeout(() => { inputReady = true; }, READY_DELAY);

// HIER KANNST DU DIE FALLGESCHWINDIGKEIT EINSTELLEN (Pixel pro Frame):
// kleiner = langsamer. Sie bleibt über das ganze Spiel gleich – hier geht es
// ums Zuordnen, nicht um Reaktion, ein Schnellerwerden arbeitet dagegen.
const FALL_SPEED = 0.9;

// Höhe der Bilder (muss zu --item-h im CSS passen)
const ITEM_HEIGHT = 120;
// Abstand zwischen gestapelten Bildern (muss zu margin-bottom von
// .stacked-item passen; negativ wäre Überlappung)
const STACK_GAP = 8;

// Game State
let correctCount = 0;     // richtig zugeordnete Objekte
let itemY = -ITEM_HEIGHT;
let currentItem = null;   // aktuell fallendes Objekt aus ITEMS
let currentHeight = ITEM_HEIGHT; // dessen Höhe inkl. individueller Skalierung
let queue = [];           // noch nicht zugeordnete Objekte
let gameLoopActive = false;
let gameStarted = false;  // erst nach dem Schütteln fällt das erste Objekt

// Weitergehen als "langes Schütteln", damit eine beiläufige Bewegung keinen
// Schritt auslöst. Dieselbe Auswertung wie in den übrigen Stationen.
const advanceShake = createLongShake();

const connection = initConnectionBadge();

function calibrate() {
    gammaBase.reset(); // der nächste Sensorwert setzt den Nullpunkt neu
    calBtn.style.backgroundColor = '#f1f5f9';
    calBtn.textContent = '✅ Kalibriert';
    setTimeout(() => {
        calBtn.style.backgroundColor = '';
        calBtn.textContent = '⚙️ Mitte kalibrieren';
    }, 1000);
}

// Der Button kalibriert den Controller mit (und umgekehrt).
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


// Die Kalibrierung steht vor der Station: Sie hängt sich in die Arbeitsfläche,
// bittet ohne Controller um die Verbindung und setzt die Mitte, sobald das
// Gerät einen Moment still liegt. Solange sie läuft, bleibt das Neigen
// wirkungslos – und das Einführungsspiel wartet.
const calibration = initCalibration({
    onCalibrate: calibrateEverywhere,
    parent: workspace, // in der Fläche, damit die Kopfzeile erreichbar bleibt
    // Erst wenn sie abgeblendet ist, tritt die Übung in Erscheinung.
    onDone: () => tutorial.classList.remove('is-pending')
});

socket.on('sensorData', (data) => {
    // Während der Sperre gar nichts auswerten – auch der Nullpunkt für das
    // Neigen wird erst danach gesetzt, also aus einer ruhigen Haltung heraus.
    if (!inputReady) return;

    // Vor allem anderen steht die Kalibrierung.
    if (calibration.isActive()) return;

    const gamma = data.gamma !== null ? data.gamma : 0;

    evaluateSelection(gammaBase.delta(gamma));
});

// Schütteln ist die Geste für „weiter": vom Einführungstext zu den Bereichen
// und von dort ins Spiel.
//
// Für das lange Schütteln steht hier bewusst nichts. Es gehört der Landkarte,
// die es mitzählt, solange eine Station geöffnet ist, und dann zu sich
// zurückholt.
socket.on('shake', () => {
    // Während der Kalibrierung ist Schütteln das Gegenteil dessen, was zählt.
    if (calibration.isActive()) return;

    if (!inputReady || gameStarted) return;

    // Während der Übung setzt Schütteln sie zurück, statt sie zu überspringen:
    // Wer hier schüttelt, ist meist nicht fertig, sondern hat sich verheddert.
    // Und die Geste gehört später dem Weitergehen – sie darf die Übung nicht
    // nebenbei erledigen.
    if (isTutorialActive) {
        resetTutorial();
        return;
    }

    if (Date.now() - lastAdvance < ADVANCE_COOLDOWN) return;
    if (!advanceShake.register()) return;

    lastAdvance = Date.now();
    advanceShake.reset();

    if (areasVisible) startGame(); else showAreas();
});

// ═══════════════════════════════════════════════════════════════════════════
//  Einführungsspiel
//
//  Drei Schritte vor dem ersten Text: nach links neigen, nach rechts, zurück
//  in die Mitte – jeweils kurz halten, bis die Fläche gefüllt ist. Verlangt
//  wird damit genau die Bewegung der Station, mit derselben Schwelle
//  (TILT_THRESHOLD) und denselben drei Feldern.
//
//  Der dritte Schritt ist kein Zierrat: Er zeigt, dass die Mitte eine eigene
//  Auswahl ist und nicht bloß "nicht geneigt", und er entlässt in die
//  Ruhelage, aus der das Spiel beginnt.
// ═══════════════════════════════════════════════════════════════════════════

const TUT_DOT = 56;      // Größe des Punkts (muss zu .tut-dot im CSS passen)

// Dieselben Zeiten wie das Halten in den Eintragspfaden: eine halbe Sekunde
// passiert nichts, dann fällt der Punkt eine Sekunde lang. Die Pause davor ist
// der Grund, warum ein Durchwischen nichts auslöst.
const TUT_HOLD_DELAY = 500;
const TUT_HOLD_DURATION = 1000;

const TUT_FADE = 600;   // Standzeit, bevor die Übung abtritt

const TUT_STEPS = [
    { area: 'left', text: 'neige nach links' },
    { area: 'right', text: 'neige nach rechts' },
    { area: 'middle', text: 'halte die Mitte' }
];

const tutorial = byId('tutorial');
const tutDot = byId('tutDot');
const tutFall = byId('tutFall');
const tutMove = byId('tutMove');
const tutFields = {
    left: byId('tutLeft'),
    middle: byId('tutMiddle'),
    right: byId('tutRight')
};

let isTutorialActive = true;
let tutStep = 0;
let tutHoldStart = 0;

// Von wo bis wohin der Punkt fällt – gemessen statt gerechnet, damit die
// Übung bei jeder Fenstergröße auf dem Balken aufsetzt.
function tutFallRange(area) {
    const layer = tutorial.getBoundingClientRect();
    const bar = tutFields[area].querySelector('.tut-bar').getBoundingClientRect();

    return {
        from: tutDot.getBoundingClientRect().top - layer.top,
        to: bar.top - layer.top - TUT_DOT
    };
}

// Der fallende Punkt entsteht aus dem Zeiger heraus; der Zeiger selbst bleibt
// stehen, wo er ist.
function showTutFall(area, progress) {
    const { from, to } = tutFallRange(area);

    tutFall.classList.remove('hidden');
    tutFall.style.left = LANES[area];
    tutFall.style.top = `${from + (to - from) * progress}px`;
}

function hideTutFall() {
    tutFall.classList.add('hidden');
}

// Gehalten wird über die Zeit, nicht über die Zahl der Sensorwerte: Die kommen
// als volatile Pakete und treffen ungleichmäßig ein.
//
// Weitergeplant wird ausschließlich hier. Täte es advanceTutorial auch, liefen
// nach einem Klick zwei Schleifen nebeneinander und alles fiele doppelt so
// schnell.
function tutorialLoop() {
    if (!isTutorialActive) return;

    // Solange kalibriert wird, ruht die Übung: Die Neigung kommt dort noch
    // nicht an, und ein angefangener Punkt hinge in der Luft.
    if (calibration.isActive()) {
        tutHoldStart = 0;
        hideTutFall();
        requestAnimationFrame(tutorialLoop);
        return;
    }

    const step = TUT_STEPS[tutStep];

    if (currentArea === step.area) {
        if (!tutHoldStart) tutHoldStart = Date.now();

        const held = Date.now() - tutHoldStart - TUT_HOLD_DELAY;
        if (held >= 0) {
            const progress = Math.min(1, held / TUT_HOLD_DURATION);
            showTutFall(step.area, progress);
            if (progress === 1) advanceTutorial();
        }
    } else {
        // Wer die Fläche verlässt, fängt für sie von vorn an; der halb
        // gefallene Punkt verschwindet mit.
        tutHoldStart = 0;
        hideTutFall();
    }

    requestAnimationFrame(tutorialLoop);
}

// Angekommen: Der Punkt bleibt im Feld liegen. Am Ende der Übung liegt in
// jedem der drei Felder einer – das Bild, das auch das Spiel hinterlässt.
function advanceTutorial() {
    const step = TUT_STEPS[tutStep];
    const { to } = tutFallRange(step.area);

    const landed = document.createElement('img');
    landed.className = 'tut-landed';
    landed.src = tutFall.src;
    landed.alt = '';
    landed.style.left = LANES[step.area];
    landed.style.top = `${to}px`;
    tutorial.appendChild(landed);

    hideTutFall();
    tutFields[step.area].classList.remove('is-target');

    tutHoldStart = 0;
    tutStep++;

    if (tutStep >= TUT_STEPS.length) {
        finishTutorial();
        return;
    }

    const next = TUT_STEPS[tutStep];
    tutFields[next.area].classList.add('is-target');
    tutMove.textContent = next.text;
}

// Geschafft: Die Übung tritt ab und gibt den Einführungstext frei. Beides zur
// selben Zeit – der Text kommt hinter der abblendenden Schicht hervor, statt
// nach ihr aufzuspringen.
function finishTutorial() {
    isTutorialActive = false;

    setTimeout(() => {
        tutorial.classList.add('is-gone');
        introMain.classList.remove('hidden');
    }, TUT_FADE);
}

// Von vorn – auch nach einem Schütteln mitten in der Übung.
function resetTutorial() {
    tutStep = 0;
    tutHoldStart = 0;

    hideTutFall();
    tutorial.querySelectorAll('.tut-landed').forEach(dot => dot.remove());
    Object.values(tutFields).forEach(field => field.classList.remove('is-target'));

    tutFields[TUT_STEPS[0].area].classList.add('is-target');
    tutMove.textContent = TUT_STEPS[0].text;
}

// Ohne gekoppeltes Smartphone übernimmt die Maus, wie in den übrigen
// Stationen: Die waagerechte Position wählt das Feld – damit lässt sich auch
// die Übung wirklich spielen, statt sie zu überspringen – und ein Klick
// ersetzt das Schütteln. Eine Hilfe fürs Einrichten, die im Betrieb nicht
// greift, weil dort ein Controller hängt.
workspace.addEventListener('mousemove', (event) => {
    if (connection.hasController()) return;

    const rect = workspace.getBoundingClientRect();
    const share = (event.clientX - rect.left) / rect.width;

    currentArea = share < 1 / 3 ? 'left' : share > 2 / 3 ? 'right' : 'middle';
    updatePlayerPosition();
});

workspace.addEventListener('click', () => {
    if (connection.hasController()) return;
    if (isTutorialActive || gameStarted) return;

    if (areasVisible) startGame(); else showAreas();
});

// Die Bereiche mit ihren Begriffen einblenden, der Einführungstext geht weg;
// ab jetzt wählt das Neigen zur Seite eine Kategorie aus und die Erklärung
// erscheint darüber. Das nächste Schütteln startet das Spiel.
function showAreas() {
    areasVisible = true;
    seenAreas = new Set();
    areasNote.classList.remove('is-visible');
    introMain.classList.add('hidden');
    bucketsContainer.classList.add('visible');
    updatePlayerPosition();
}

// Startzustand: nur der Einführungstext. Solange die Übung läuft, bleibt er
// verdeckt – sichtbar wird er erst, wenn sie abtritt.
function showIntroText() {
    areasVisible = false;
    if (!isTutorialActive) introMain.classList.remove('hidden');
    bucketsContainer.classList.remove('visible');
    advanceShake.reset();
    Object.values(introCols).forEach(col => col.classList.remove('active'));
}

function evaluateSelection(dGamma) {
    if (dGamma < -TILT_THRESHOLD) {
        currentArea = 'left';
    } else if (dGamma > TILT_THRESHOLD) {
        currentArea = 'right';
    } else {
        currentArea = 'middle';
    }
    updatePlayerPosition();
}

function updatePlayerPosition() {
    playerItem.style.left = LANES[currentArea];
    tutDot.style.left = LANES[currentArea];

    // Highlight bucket
    bucketLeft.classList.remove('active');
    bucketMiddle.classList.remove('active');
    bucketRight.classList.remove('active');
    buckets[currentArea].classList.add('active');

    // In der Übung zeigt dieselbe Hervorhebung, welches Feld angesteuert ist
    Object.entries(tutFields).forEach(([area, field]) => {
        field.classList.toggle('is-active', area === currentArea);
    });

    // Vor dem Start: passenden Erklärtext einblenden, sobald die Bereiche da sind
    if (!gameStarted) {
        Object.values(introCols).forEach(col => col.classList.remove('active'));

        if (areasVisible) {
            introCols[currentArea].classList.add('active');

            seenAreas.add(currentArea);
            if (seenAreas.size === Object.keys(introCols).length) {
                areasNote.classList.add('is-visible');
            }
        }
    }
}

// Schütteln beendet die Erklärphase und startet das Spiel.
function startGame() {
    gameStarted = true;
    gameLoopActive = true;

    introLayer.classList.add('hidden');
    introMain.classList.add('hidden');
    areasNote.classList.remove('is-visible');
    playerItem.classList.remove('hidden');
    scoreBoard.classList.remove('hidden');

    queue = shuffle(ITEMS);
    spawnItem();
    requestAnimationFrame(gameLoop);
}

function spawnItem() {
    if (queue.length === 0) {
        finish();
        return;
    }

    // Nächstes Objekt aus der Warteschlange – jedes Bild kommt nur einmal vor
    currentItem = queue.shift();
    currentHeight = ITEM_HEIGHT * (currentItem.scale || 1);

    itemY = -currentHeight;
    playerItem.src = `${IMG_BASE}/${currentItem.file}`;
    playerItem.style.height = `${currentHeight}px`;
    playerItem.style.transform = `translate(-50%, ${itemY}px)`;

    updateCounters();
}

// Oberkante des Stapels (bzw. der grauen Fläche) im Koordinatensystem
// des Workspace – daraus ergibt sich, wann das Bild "aufsetzt".
function floorFor(area) {
    const bucket = buckets[area];
    const stacked = bucket.querySelectorAll('.stacked-item');
    // column-reverse: das zuletzt angehängte Element liegt oben
    const topEl = stacked.length
        ? stacked[stacked.length - 1]
        : bucket.querySelector('.bucket-inner');

    // Das Bild setzt genau dort auf, wo es später auch gestapelt liegt –
    // deshalb die Überlappung (STACK_GAP) mitrechnen.
    const wsTop = workspace.getBoundingClientRect().top;
    return topEl.getBoundingClientRect().top - wsTop - currentHeight - STACK_GAP;
}

// Rückmeldung richtig/falsch über die ganze Seite
let flashTimer = null;
function showFlash(kind) {
    clearTimeout(flashTimer);
    flash.classList.remove('ok', 'bad');
    flash.classList.add(kind);
    flashTimer = setTimeout(() => flash.classList.remove('ok', 'bad'), 300);
}

// Anzeige: richtig zugeordnet / Objekte insgesamt
function updateCounters() {
    correctEl.textContent = correctCount;
    totalEl.textContent = ITEMS.length;
}

function checkCollision() {
    if (currentArea === currentItem.area) {
        correctCount++;

        showFlash('ok');

        // Bild im richtigen Bereich stapeln
        const stackedEl = document.createElement('img');
        stackedEl.className = 'stacked-item';
        stackedEl.src = playerItem.src;
        stackedEl.style.height = `${currentHeight}px`;
        stackedEl.alt = '';
        buckets[currentArea].appendChild(stackedEl);
    } else {
        // Falscher Bereich: Bild wird nicht gestapelt, sondern hinten wieder
        // eingereiht – es kommt später noch einmal.
        showFlash('bad');
        queue.push(currentItem);
    }

    spawnItem();
}

// Alle Objekte sind zugeordnet – das Spiel endet hier.
function finish() {
    gameLoopActive = false;
    currentItem = null;
    playerItem.style.visibility = 'hidden';
    showFlash('ok');
    updateCounters();
    reportCompletion({ label: `Alle ${ITEMS.length} Objekte zugeordnet` });
}

function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function gameLoop() {
    if (!gameLoopActive) return;

    // Move image down
    itemY += FALL_SPEED;
    playerItem.style.transform = `translate(-50%, ${itemY}px)`;

    if (itemY > floorFor(currentArea)) {
        checkCollision();
    }

    requestAnimationFrame(gameLoop);
}

// Init: Zuerst die Kalibrierung, dann das Einführungsspiel; darunter steht der
// Einführungstext schon bereit. Danach führt Schütteln zu den Bereichen, das
// nächste startet das Spiel.
updateCounters();
showIntroText();
updatePlayerPosition();
resetTutorial();
requestAnimationFrame(tutorialLoop);
