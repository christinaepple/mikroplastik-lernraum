// ═══════════════════════════════════════════════════════════════════════════
//  Größeneinordnung — Quiz mit vier Antwortfeldern, Auswahl durch Kippen und
//  Neigen. Inhaltliche Fassung des Labor-Moduls "Neigen"; die Aufgabe wird
//  hier noch erweitert.
//
//  interactions/inhalte/groesseneinordnung.html
// ═══════════════════════════════════════════════════════════════════════════

import { socket, shareCalibration } from '../../lib/socket.js';
import { initConnectionBadge } from '../../lib/connection.js';
import { Baseline, clamp } from '../../lib/angles.js';
import { createLongShake } from '../../lib/shake.js';
import { initCalibration } from '../../lib/calibration.js';
import { reportCompletion } from '../../lib/completion.js';
import { byId } from '../../lib/dom.js';

// UI-Elemente
const stage = byId('stage');
const bubble = byId('bubble');
const calBtn = byId('calBtn');
const skipToRoundTwoBtn = byId('skipToRoundTwoBtn');

const optTop = byId('optTop');
const optBottom = byId('optBottom');
const optLeft = byId('optLeft');
const optRight = byId('optRight');

const questionContainer = byId('questionContainer');
const questionText = byId('questionText');
const exampleContainer = byId('exampleContainer');
const exampleFrame = byId('exampleFrame');
const exampleImg = byId('exampleImg');
const roundNoteOne = byId('roundNoteOne');
const roundNoteTwo = byId('roundNoteTwo');
const intro = byId('intro');
const introBox = intro.querySelector('.intro-box');
const lehreGame = byId('lehreGame');

// Dauer des Abblendens, wenn das Einführungsspiel fertig ist – deckt sich
// mit der CSS-Transition von `.lehre-game` (0.4s), damit sie entfernt wird,
// sobald sie unsichtbar ist, statt mittendrin zu springen.
const LEHRE_GAME_FADE = 400;

const betaVal = byId('betaVal');
const gammaVal = byId('gammaVal');
const baseBetaSpan = byId('baseBeta');
const baseGammaSpan = byId('baseGamma');
const activeSelect = byId('activeSelect');
const toggleSensorBtn = byId('toggleSensorBtn');
const sensorPanel = document.querySelector('.sensor-panel');

// Sensordaten Toggle
toggleSensorBtn.addEventListener('click', () => {
    // Check computed style or inline style
    const isHidden = window.getComputedStyle(sensorPanel).display === 'none';
    sensorPanel.style.display = isHidden ? 'flex' : 'none';
});

// Baselines & Schwellenwerte
let shakeTimestamp = 0;
let lastSnappedId = null;

// Nullpunkte der beiden Achsen; der angezeigte Wert wird beim Kalibrieren
// automatisch nachgetragen.
const betaBase = new Baseline({
    wrap: false,
    onCalibrate: (v) => { baseBetaSpan.textContent = Math.round(v) + '°'; },
});
const gammaBase = new Baseline({
    wrap: false,
    onCalibrate: (v) => { baseGammaSpan.textContent = Math.round(v) + '°'; },
});

// X-Achse (Gamma) - Links/Rechts
const THRESHOLD_X = 22;
const SNAP_THRESHOLD_X = 26;

// Y-Achse (Beta) - Oben/Unten (früher wegen Bildschirmformat)
const THRESHOLD_Y = 16;
const SNAP_THRESHOLD_Y = 20;

// Visualisierungskonstanten
const maxOffset = 220; // Ausschlag der Bubble in Pixel - groß genug um die Box zu erreichen
const tiltRange = 30;  // Winkel bei dem die Bubble maxOffset erreicht

// Akzentfarbe als Zahlentripel: Das Einführungsspiel braucht sie für
// durchscheinende Canvas-Farben.
const cssRgb = (name) => getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();

const ACCENT_RGB = cssRgb('--accent-rgb');

// Quiz-Daten & Status
// Zwei Runden auf demselben Spielfeld: Erst wird gefragt, welche Größe zu
// einem Begriff gehört. Ist das durchgespielt, stehen die Begriffe an den
// Rändern fest – und gefragt ist, wo ein Beispiel einzuordnen ist.
const ROUND_ONE = [
    { img: "/img/interactionen/groessen/makroText.png", text: "Makroplastik", correctOptionId: "optBottom", value: "> 2,5 cm" },
    { img: "/img/interactionen/groessen/mesoText.png",  text: "Mesoplastik",  correctOptionId: "optLeft",   value: "2,5 cm - 5 mm" },
    { img: "/img/interactionen/groessen/mikroText.png", text: "Mikroplastik", correctOptionId: "optRight",  value: "5 mm - 1 µm" },
    { img: "/img/interactionen/groessen/nanoText.png",  text: "Nanoplastik",  correctOptionId: "optTop",    value: "< 1 µm" }
];

// Beispiele der zweiten Runde: Zu jeder Klasse zwei Gegenstände, die ihre
// Spanne aufspannen – der größere am oberen Ende, der kleinere am unteren.
// Plastik ist hier keins zu sehen, und das ist der Punkt: Gefragt sind
// Größen, und die lassen sich nur an Bekanntem ermessen.
const ROUND_TWO = [
    {
        src: "/img/interactionen/groessen/makro.png",
        text: "Getränkebecher und Kronkorken",
        // Das einzige aufrechte Bild: Es wird von der Höhe des Rahmens
        // begrenzt und bliebe neben den liegenden Motiven zu klein.
        zoom: 1.3,
        correctOptionId: "optBottom", value: "> 2,5 cm"
    },
    {
        src: "/img/interactionen/groessen/meso.png",
        text: "Würfel und Konfetti",
        correctOptionId: "optLeft", value: "2,5 cm - 5 mm"
    },
    {
        src: "/img/interactionen/groessen/mikro.png",
        text: "menschliches Haar und ein Reiskorn",
        correctOptionId: "optRight", value: "5 mm - 1 µm"
    },
    {
        src: "/img/interactionen/groessen/nano.png",
        text: "Virus und DNA-Strang",
        correctOptionId: "optTop", value: "< 1 µm"
    }
];

// Die Bilder gleich zu Beginn anfordern, nicht erst beim Wechsel: Sie sind
// über ein Megabyte groß, und wer sie erst braucht, wenn sie zu sehen sein
// sollen, blickt einen Moment lang auf eine leere Fläche.
ROUND_TWO.forEach(({ src }) => { new Image().src = src; });

let round = 1;
let shuffledQuestions = [];
let currentQuestionIndex = 0;

// Takt des Rundenwechsels in Millisekunden. Solange keine Frage aussteht,
// nimmt das Spiel ohnehin keine Auswahl mehr an – die Pausen sind deshalb
// reine Dramaturgie und lassen sich hier frei einstellen.
const FADE_MS = 300;         // Übergang, den `.slide-out` im CSS braucht
const VEIL_MS = 500;         // Aufziehen des Schleiers, wie im CSS gesetzt
const SETTLE_MS = 700;       // Ruhe nach der letzten Antwort, bevor der Überblick kommt
const CALIBRATE_DELAY_MS = 600; // Abklingen des Schüttelns, bevor die Mitte gesetzt wird

// Zwischen den Runden und im Überblick nimmt das Spiel nichts entgegen.
let isPaused = false;

// ── Halte-Ring (CSS Masking) ──────────────────────────────────────────────────
// strich.png liegt im HTML; eine SVG-Maske legt es beim Halten schrittweise
// frei. Vier Pfade in der Maske, gezeichnet in Weiß – was weiß ist, ist
// sichtbar; was schwarz ist, bleibt verdeckt. stroke-dashoffset steuert, wie
// viel vom Pfad gezeichnet ist.
//
// Einzelner Pfad aus kringel.svg; PNG und SVG haben identische Größe (499×307).
// Runde 1 nutzt kringel.png/RING_D, Runde 2 kringel2.png/RING2_D.
const RING_D = [
    "M146 119.5C146 119.5 144.433 116 152.5 105C160.566 93.9999 228 61.4999 273 55.4999C318 49.4999 385 60.9999 413 74.9999C441 88.9999 456.398 109 454.5 137C452.602 165 442.769 179 410.5 214C378.23 249 321 272 274.5 278.5C228 285 186 279.5 138 255.5C89.9998 231.5 78.9998 186.5 78.9998 186.5C78.9998 186.5 70.0001 151 84.5 121.5C98.9999 91.9999 136.5 63.9999 136.5 63.9999C136.5 63.9999 178.719 37.9746 209 30.4999C231.108 25.0426 249.5 23.9163 268.5 25.4999C287.5 27.0835 303.5 45 303.5 45"
];
const RING2_D = [
    "M331.5 70.5L330 65C330 65 287.5 50 258.5 51.5C229.5 53 161.511 63.7435 110.5 96C76.3959 117.566 49.0001 132 34.5002 166C20.0004 200 30.0002 214 30.0002 214C30.0002 214 48 268.5 141 284.5C234 300.5 269.5 289 269.5 289C269.5 289 378.718 274.937 422 227.5C445.036 202.254 466.774 185.1 464.5 151C462 113.5 446.5 97.5 417 68C387.5 38.5 321.5 31 321.5 31L239.5 24H181"
];

// Für jedes Option-Element: Array der Maskenpfade (mit gespeicherter Länge).
const ringMaskPaths = new Map();

/**
 * Berechnet die Länge eines SVG-Pfads zuverlässig.
 * Pfade in <defs> haben keinen Rendering-Kontext; ein kurzlebiges Off-Screen-
 * SVG außerhalb des Viewports gibt getTotalLength() den nötigen Kontext.
 */
function pathLength(d) {
    const ns = 'http://www.w3.org/2000/svg';
    const tmp = document.createElementNS(ns, 'svg');
    tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:476px;height:239px';
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    tmp.appendChild(p);
    document.body.appendChild(tmp);
    const len = p.getTotalLength();
    document.body.removeChild(tmp);
    return len;
}

/** Baut ein Ring-SVG (mask+image) für ein Options-Element und gibt seine Pfade zurück. */
function buildRing(el, ringD, lengths, idPrefix, extraClass, imgSrc) {
    const ns = 'http://www.w3.org/2000/svg';

    // SVG-Element mit <mask> und <image> im selben Dokument-Kontext.
    // mask="url(#id)" auf dem <image> referenziert die Maske lokal –
    // keine CSS-Property, keine dokumentübergreifende Referenz.
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', `lock-ring ${extraClass}`);
    // viewBox = PNG-Größe; PNG und SVG haben identische Größe (499×307).
    svg.setAttribute('viewBox', '0 0 499 307');
    svg.setAttribute('aria-hidden', 'true');

    const defs = document.createElementNS(ns, 'defs');
    const mask = document.createElementNS(ns, 'mask');
    mask.setAttribute('id', idPrefix);
    defs.appendChild(mask);
    svg.appendChild(defs);

    const imgEl = document.createElementNS(ns, 'image');
    imgEl.setAttribute('href', imgSrc);
    imgEl.setAttribute('width', '499');
    imgEl.setAttribute('height', '307');
    imgEl.setAttribute('mask', `url(#${idPrefix})`);
    svg.appendChild(imgEl);

    el.appendChild(svg);

    return ringD.map((d, i) => {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', 'white');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-width', '8');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        const len = lengths[i];
        path._len = len;
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        mask.appendChild(path);
        return path;
    });
}

function initRings() {
    // Längen einmalig vorberechnen (Off-Screen, nicht in <defs>).
    const lengths1 = RING_D.map(pathLength);
    const lengths2 = RING2_D.map(pathLength);

    const opts = [
        { el: optTop,    id: 'rm-top'    },
        { el: optBottom, id: 'rm-bottom' },
        { el: optLeft,   id: 'rm-left'   },
        { el: optRight,  id: 'rm-right'  },
    ];

    opts.forEach(({ el, id }) => {
        // Zwei Ringe pro Feld: kringel für Runde 1, kringel2 für Runde 2.
        // Welcher zu sehen ist, entscheidet .stage.is-round-two im CSS.
        const paths1 = buildRing(el, RING_D, lengths1, `${id}-r1`, 'lock-ring-r1', '/img/interactionen/groessen/kringel.png');
        const paths2 = buildRing(el, RING2_D, lengths2, `${id}-r2`, 'lock-ring-r2', '/img/interactionen/groessen/kringel2.png');

        ringMaskPaths.set(el, { r1: paths1, r2: paths2 });
    });
}

/** Legt den Kringel entlang der Pfade progressiv frei (progress 0–1). */
function setRingProgress(optionEl, progress) {
    const entry = ringMaskPaths.get(optionEl);
    if (!entry) return;
    const paths = round === 2 ? entry.r2 : entry.r1;
    const total = paths.reduce((s, p) => s + p._len, 0);
    let remaining = progress * total;
    paths.forEach(path => {
        if (remaining >= path._len) {
            path.style.strokeDashoffset = 0;
            remaining -= path._len;
        } else if (remaining > 0) {
            path.style.strokeDashoffset = path._len - remaining;
            remaining = 0;
        } else {
            path.style.strokeDashoffset = path._len;
        }
    });
}

function resetRingPaths(optionEl) {
    const entry = ringMaskPaths.get(optionEl);
    if (!entry) return;
    [...entry.r1, ...entry.r2].forEach(p => {
        p.style.strokeDashoffset = p._len;
    });
}

// ── Runden-Splash ────────────────────────────────────────────────────────────
const SCHNIPSEL_SRCS = [
    'blau', 'gelb', 'grün', 'hellblau', 'lachs', 'mint', 'pink', 'rosa', 'rot'
].map(n => `/img/interactionen/groessen/schnipsel/${n}.png`);

const GEGENSTAENDE_SRCS = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `/img/interactionen/groessen/gegenstaende/${n}.png`);

// Wird gesetzt, solange der Runde-1-Splash auf Schütteln wartet.
let pendingSplashDismiss = null;
// Schütteln vom Intro-Abschluss soll den Splash nicht sofort auflösen.
let splashReadyAt = 0;
const SPLASH_BLOCK_MS = 1200;

function initRoundSplash() {
    const splash = byId('roundSplash');
    const count = 80;

    for (let i = 0; i < count; i++) {
        const img = document.createElement('img');
        img.src = SCHNIPSEL_SRCS[i % SCHNIPSEL_SRCS.length];
        img.alt = '';

        // Mitte freihalten (x 10–70 %, y 35–65 %)
        let x, y;
        do {
            x = 3 + Math.random() * 94;
            y = 3 + Math.random() * 94;
        } while (x > 10 && x < 70 && y > 35 && y < 65);

        const size = 45 + Math.random() * 110;
        const rot  = Math.random() * 360;
        // Position und Rotation als data-Attribute speichern für die Wegflug-Animation.
        img.dataset.x = x;
        img.dataset.y = y;
        img.dataset.rot = rot;
        // translate(-50%,-50%) zentriert das Bild auf (x%,y%), damit die
        // Freihalte-Prüfung den Mittelpunkt trifft, nicht die obere linke Ecke.
        img.style.cssText = `position:absolute;left:${x}%;top:${y}%;width:${size}px;transform:translate(-50%,-50%) rotate(${rot}deg);`;
        splash.appendChild(img);
    }

}

/** Schnipsel auf ihre Startposition zurücksetzen (vor Runde-2-Splash). */
/** Splash für Runde 2 neu befüllen: Gegenstände statt Schnipsel. */
function resetRoundSplash() {
    const splash = byId('roundSplash');
    splash.innerHTML = '';
    const count = 80;
    for (let i = 0; i < count; i++) {
        const img = document.createElement('img');
        img.src = GEGENSTAENDE_SRCS[i % GEGENSTAENDE_SRCS.length];
        img.alt = '';
        let x, y;
        do {
            x = 3 + Math.random() * 94;
            y = 3 + Math.random() * 94;
        } while (x > 30 && x < 70 && y > 35 && y < 65);
        const size = 45 + Math.random() * 110;
        const rot  = Math.random() * 360;
        img.dataset.x = x;
        img.dataset.y = y;
        img.dataset.rot = rot;
        img.style.cssText = `position:absolute;left:${x}%;top:${y}%;width:${size}px;transform:translate(-50%,-50%) rotate(${rot}deg);`;
        splash.appendChild(img);
    }
}

/** Schnipsel fliegen vom Zentrum nach außen weg, dann wird callback aufgerufen. */
function shakeOutSplash(callback) {
    const splash = byId('roundSplash');
    const imgs = Array.from(splash.querySelectorAll('img'));
    let done = 0;
    imgs.forEach(img => {
        const dx = (parseFloat(img.dataset.x) - 50) * 18;
        const dy = (parseFloat(img.dataset.y) - 50) * 18;
        const rot = img.dataset.rot;
        img.style.transition = 'transform 1.4s ease-out';
        // Centering (-50%,-50%) beibehalten, Verschiebung addieren.
        img.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`;
        img.addEventListener('transitionend', () => {
            done++;
            if (done === imgs.length) callback();
        }, { once: true });
    });
}

// Vor dem Spiel steht die Einführung; sie endet mit anhaltendem Schütteln.
const startShake = createLongShake();
let isIntroVisible = true;

// Hold-Timer Variablen
const holdDuration = 1000; // x Sekunden halten
const PRE_LOCK_DELAY = 500; // halbe Sekunde warten vor Einloggen
let preLockInTimeout = null;
let correctHoldTimeout = null;
let lockInStartTime = null;
let isLockedIn = false;
let progressInterval = null;
let lastSelectedId = null;

// WebSocket-Verbindungen
const connection = initConnectionBadge({ onDisconnect: resetInteractiveState });

// Sensordaten verarbeiten
socket.on('sensorData', (data) => {
    const beta = data.beta !== null ? data.beta : 90;
    const gamma = data.gamma !== null ? data.gamma : 0;

    // UI-Sensordaten aktualisieren
    betaVal.textContent = Math.round(beta) + '°';
    gammaVal.textContent = Math.round(gamma) + '°';

    // Vor allem anderen steht die Kalibrierung. Erst an ihrem Ende wird der
    // Nullpunkt gesetzt – bis dahin gäbe es auch keine sinnvolle Abweichung
    // zu rechnen.
    if (calibration.isActive()) return;

    applyTilt(betaBase.delta(beta), gammaBase.delta(gamma));
});

/**
 * Eine Neigung anwenden – woher sie kommt, ist hier gleichgültig.
 *
 * Getrennt vom Empfang der Sensordaten, weil ohne gekoppeltes Smartphone die
 * Maus dieselbe Stelle bedient: So gibt es einen Weg in das Spiel und nicht
 * zwei, die auseinanderlaufen können.
 */
function applyTilt(dBeta, dGamma) {
    // Vor dem Spiel steht das Einführungsspiel: Dieselbe Neigung führt dort
    // einen Übungszeiger zu den vier Punkten.
    if (isIntroVisible) {
        moveLehreCursor(dBeta, dGamma);
        return;
    }

    // Zwischen den Runden und im Überblick bleibt das Spielfeld, wie es ist:
    // Es steht nichts zur Auswahl, also soll auch nichts auf Bewegung
    // reagieren. Die Messwerte laufen weiter, sie sind nur Anzeige.
    if (isPaused) return;

    // Bubble-Position & Skalierung berechnen (freie Bewegung, keine Kreisbegrenzung)
    let xOffset = dGamma * (maxOffset / tiltRange);
    let yOffset = dBeta * (maxOffset / tiltRange);

    // Snapping: ab SNAP_THRESHOLD springt die Bubble in die Antwort-Box
    const snappedId = getSelectedOptionId(dBeta, dGamma);

    if (snappedId) {
        // Bubble ausblenden – Box wird zum Cursor
        bubble.style.opacity = '0';
        bubble.style.transform = `translate(${xOffset}px, ${yOffset}px) scale(0.4)`;

        // cursor-active auf die richtige Box setzen
        if (snappedId !== lastSnappedId) {
            if (lastSnappedId) {
                document.getElementById(lastSnappedId).classList.remove('cursor-active');
            }
            document.getElementById(snappedId).classList.add('cursor-active');
            lastSnappedId = snappedId;
        }
    } else {
        // Frei bewegliche Bubble sichtbar
        bubble.style.opacity = '1';

        // Wenn die Option gehalten wird, vergrößert sich die Bubble
        let scale = 1;
        if (lockInStartTime && !isLockedIn) {
            const elapsed = Date.now() - lockInStartTime;
            scale = 1 + Math.min(1, Math.max(0, elapsed / holdDuration)) * 0.25;
        }
        bubble.style.transform = `translate(${xOffset}px, ${yOffset}px) scale(${scale})`;

        // cursor-active von allen Boxen entfernen
        if (lastSnappedId) {
            document.getElementById(lastSnappedId).classList.remove('cursor-active');
            lastSnappedId = null;
        }
    }

    // Auswahl ermitteln (wenn nicht gerade Sieg gefeiert wird)
    if (currentQuestionIndex < shuffledQuestions.length) {
        evaluateSelection(dBeta, dGamma);
    }
}

// Ohne gekoppeltes Smartphone folgt der Zeiger der Maus. Das ist kein zweiter
// Bedienweg, sondern die Möglichkeit, die Station am Schreibtisch zu prüfen,
// ohne jedes Mal ein Gerät zu verbinden – wie in den Eintragspfaden.
//
// Umgerechnet wird über dieselbe Strecke, mit der die Bubble der Neigung
// folgt (maxOffset je tiltRange). Dadurch liegt sie genau unter dem Mauszeiger
// und schlägt bei derselben Entfernung von der Mitte aus, bei der auch das
// Gerät auslösen würde: rund 160 Punkte zur Seite, 120 nach oben oder unten.
stage.addEventListener('mousemove', (event) => {
    if (connection.hasController()) return;
    if (calibration.isActive()) return;

    // Das Einführungsspiel hat seine eigene Umrechnung – seine Punkte liegen
    // nicht dort, wo die Bubble hinreicht, sondern am Rand der Fläche.
    if (isIntroVisible) return;

    const rect = stage.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);

    applyTilt(dy * (tiltRange / maxOffset), dx * (tiltRange / maxOffset));
});

// Berechnet welche Option (ID) aktuell für das Snapping in Frage kommt
function getSelectedOptionId(dBeta, dGamma) {
    const absBeta = Math.abs(dBeta);
    const absGamma = Math.abs(dGamma);

    const ratioY = absBeta / SNAP_THRESHOLD_Y;
    const ratioX = absGamma / SNAP_THRESHOLD_X;

    if (ratioY < 1 && ratioX < 1) return null;

    if (ratioY > ratioX) {
        return dBeta < 0 ? 'optTop' : 'optBottom';
    } else {
        return dGamma > 0 ? 'optRight' : 'optLeft';
    }
}

// Auswertung der Neigungs-Richtung
/**
 * Auf welches Feld die Neigung zeigt – oder `null` in der Neutralstellung.
 *
 * Jede Achse wird an ihrer eigenen Schwelle gemessen: Zur Seite neigt man das
 * Gerät weit, nach vorn oder hinten kippt man es nur wenig. Ausschlagen muss
 * nur eine von beiden; welche gilt, entscheidet die stärkere.
 *
 * Steht als eigene Funktion da, weil das Einführungsspiel dieselbe Regel
 * braucht: Dort wird geübt, was hier später zählt, und beides darf nicht
 * auseinanderlaufen.
 */
function selectionFor(dBeta, dGamma) {
    const ratioY = Math.abs(dBeta) / THRESHOLD_Y;
    const ratioX = Math.abs(dGamma) / THRESHOLD_X;

    if (ratioY < 1 && ratioX < 1) return null;

    if (ratioY > ratioX) return dBeta < 0 ? 'optTop' : 'optBottom';
    return dGamma > 0 ? 'optRight' : 'optLeft';
}

function evaluateSelection(dBeta, dGamma) {
    const selectedId = selectionFor(dBeta, dGamma);

    // Neutralstellung / Keine Auswahl
    if (!selectedId) {
        if (lastSelectedId !== null) {
            resetHoldState();
            clearFeedbackStyles();
            activeSelect.textContent = 'Keine';
            lastSelectedId = null;
        }
        return;
    }

    // Ausgewählte Option hat sich geändert
    if (selectedId !== lastSelectedId) {
        resetHoldState();
        clearFeedbackStyles();
        lastSelectedId = selectedId;

        const currentQuestion = shuffledQuestions[currentQuestionIndex];
        const selectedElement = document.getElementById(selectedId);
        // Die Felder enthalten neben der Angabe noch Bild und Begriff, der Text
        // steht dadurch mehrzeilig und eingerückt im Markup – für die Anzeige
        // in eine Zeile bringen.
        activeSelect.textContent = selectedElement.textContent.replace(/\s+/g, ' ').trim();

        // Markiere Kasten als ausgewählt
        selectedElement.classList.add('selected');

        // Starte Lock-In Timer erst nach einer halben Sekunde
        preLockInTimeout = setTimeout(() => {
            startLockInTimer(selectedId, currentQuestion.correctOptionId);
        }, PRE_LOCK_DELAY);
    }
}

// Lock-In Timer starten
function startLockInTimer(selectedId, correctOptionId) {
    lockInStartTime = Date.now();
    isLockedIn = false;
    const selectedElement = document.getElementById(selectedId);

    // Der Halte-Timer: Er läuft bis holdDuration und löst dann das Einloggen
    // aus. Die wachsende Bubble in applyTilt liest denselben Startzeitpunkt.
    progressInterval = setInterval(() => {
        const elapsed = Date.now() - lockInStartTime;
        const progress = Math.min(1, Math.max(0, elapsed / holdDuration)); // 0.0 bis 1.0

        // Ring aufzeichnen
        if (selectedElement) setRingProgress(selectedElement, progress);

        if (progress >= 1 && !isLockedIn) {
            clearInterval(progressInterval);
            isLockedIn = true;

            if (selectedElement) {

                if (selectedId === correctOptionId) {
                    selectedElement.classList.add('correct');

                    const qContainer = activeQuestionBox();

                    // Timeout nach kurzer Pause um fortzufahren
                    correctHoldTimeout = setTimeout(() => {
                        qContainer.classList.add('slide-out');

                        setTimeout(() => {
                            const hasNext = currentQuestionIndex + 1 < shuffledQuestions.length;
                            advanceToNextQuestion();

                            // Slide-in nur wenn noch eine Frage folgt – bei der
                            // letzten Antwort bleibt der Container ausgeblendet,
                            // damit kein Text mehr kurz aufblitzt.
                            if (hasNext) {
                                qContainer.classList.remove('slide-out');
                                qContainer.classList.add('slide-in-prepare');
                                void qContainer.offsetWidth;
                                qContainer.classList.remove('slide-in-prepare');
                            }
                        }, 300);
                    }, 500);
                } else {
                    selectedElement.classList.add('wrong');
                }
            }
        }
    }, 16);
}

// Eingaben stilllegen. Der Cursor, der gerade noch auf einem Feld lag, wird
// dabei mit abgeräumt: Er hat sonst keinen Anlass mehr zu gehen, weil das
// Spiel die Bewegung des Geräts nicht mehr verfolgt.
function pauseInput() {
    isPaused = true;

    if (lastSnappedId) {
        document.getElementById(lastSnappedId).classList.remove('cursor-active');
        lastSnappedId = null;
    }
}

// ── Schein am Rand ────────────────────────────────────────────────────────

// Hold-Timer zurücksetzen
function resetHoldState() {
    if (preLockInTimeout) {
        clearTimeout(preLockInTimeout);
        preLockInTimeout = null;
    }
    if (correctHoldTimeout) {
        clearTimeout(correctHoldTimeout);
        correctHoldTimeout = null;
    }
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    lockInStartTime = null;
    isLockedIn = false;
}

// CSS Styles von den Kacheln entfernen
function clearFeedbackStyles() {
    [optTop, optBottom, optLeft, optRight].forEach(el => {
        el.classList.remove('selected', 'correct', 'wrong');
        resetRingPaths(el);
    });
}

// Nächste Frage laden
function advanceToNextQuestion() {
    resetHoldState();
    clearFeedbackStyles();
    lastSelectedId = null;

    currentQuestionIndex++;
    if (currentQuestionIndex >= shuffledQuestions.length) {
        finishRound();
    } else {
        displayQuestion();
    }
}

// Ende einer Runde: Alle Felder leuchten grün, dann geht es weiter – nach der
// ersten Runde in die zweite, nach der zweiten von vorn.
// Die Pause dazwischen ist der Moment, in dem der Wechsel zu sehen ist: Die
// Tüten gehen, die Begriffe kommen. Ohne sie stünde die neue Aufgabe da, ohne
// dass jemand den Übergang bemerkt hätte.
function finishRound() {
    // Die Felder bleiben unberührt. Der grüne Rahmen gehört der einzelnen
    // Antwort; vier davon auf einmal beantworten nichts mehr, sie füllen nur
    // den Bildschirm. Das Ende einer Runde meldet der Rand.
    pauseInput();

    if (round === 1) {
        activeSelect.textContent = 'Runde 1 geschafft';
        // Bildschirm kurz stehen lassen, dann Runde-2-Overlay drüberlegen.
        setTimeout(() => announceRound(2), SETTLE_MS);
        return;
    }

    exampleContainer.classList.add('is-hidden');
    activeSelect.textContent = 'Runde 2 geschafft';

    // Erst mit der zweiten Runde ist die Aufgabe der Station erfüllt.
    reportCompletion({ label: 'Größen und Beispiele zugeordnet' });

    // Die Felder treten ab, damit sie sich unbeobachtet neu ordnen können.
    stage.classList.add('is-announcing');

    setTimeout(showSummary, SETTLE_MS);
}

// Der Überblick: dieselben vier Felder, nebeneinander statt an den Rändern,
// jedes mit seinem Beispiel. Umgestellt wird, während sie ausgeblendet sind –
// zu sehen ist nur, wie die fertige Reihe aufblendet.
function showSummary() {
    stage.classList.add('is-summary');
    stage.classList.remove('is-announcing');

    // Der Überblick bleibt stehen, bis langes Schütteln zur Gesamtübersicht
    // zurückführt — kein automatischer Rückweg, kein Neustart hier.
}

// Reset bei Verbindungsverlust
function resetInteractiveState() {
    resetHoldState();
    clearFeedbackStyles();
    lastSelectedId = null;
    activeSelect.textContent = 'Keine';
    bubble.style.transform = 'translate(0px, 0px)';
}

// Kalibrierungs-Funktion
function calibrate() {
    betaBase.reset();
    gammaBase.reset();
    resetInteractiveState();
    // Hinweis: hier stand eine Rückmeldung über ein Element #holdTimerText,
    // das es im Markup nicht (mehr) gibt. Der Zugriff darauf hat die Funktion
    // an dieser Stelle jedes Mal mit einem Fehler abgebrochen.
}

// Hilfsfunktion zum Mischen
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Ankündigung einer Runde: Sie steht allein in der leeren Mitte, die Felder
// sind ausgeblendet. Beim Wechsel in die zweite Runde steht sie zudem im
// grünen Schein, nicht nach ihm – der leere Bildschirm mit dem leuchtenden
// Rand ist der Rahmen, in den sie hineingesetzt wird, und erst zusammen sind
// sie ein Moment und nicht zwei.
// Das Spielfeld wird dahinter schon gebaut, zu sehen ist davon nichts; es

function endAnnouncement(note, onDone) {
    // Erst die Einblendung abwählen: Sie hält die Deckkraft fest und ließe
    // das Abtreten sonst nicht zu.
    note.classList.remove('with-splash');
    note.classList.add('slide-out');
    stage.classList.remove('is-announcing', 'is-splash');

    // Die Mitte erst räumen, wenn die Ankündigung verblasst ist: Beide Kästen
    // gleichzeitig sichtbar hieße, dass sie übereinander stehen und die Mitte
    // springt.
    setTimeout(() => {
        note.classList.add('is-hidden');
        note.classList.remove('slide-out');
        onDone();
    }, FADE_MS);
}

// Der Beginn einer Runde, von der Ansage an. Das Spielfeld wird dabei schon
// auf sie eingestellt, während es ausgeblendet ist – so steht hinter der
// Ansage nie das Feld der vorigen Runde.
function announceRound(number) {
    isPaused = true;
    clearFeedbackStyles();

    if (number === 2) resetRoundSplash();
    stage.classList.add('is-splash', 'is-announcing');

    const note = number === 1 ? roundNoteOne : roundNoteTwo;

    // Shake-Handler sofort registrieren.
    pendingSplashDismiss = () => endAnnouncement(note, () => startRound(number));
    splashReadyAt = Date.now() + SPLASH_BLOCK_MS;

    // Die Mitte zuerst räumen, dann die Note setzen: Beide sind Geschwister in
    // derselben Spalte – bliebe der ausgeblendete Kasten stehen, hielte er
    // seinen Platz und die Note spränge, sobald er später weicht. Sichtbar ist
    // davon nichts, er steht ohnehin schon auf Deckkraft null.
    questionContainer.classList.add('is-hidden');
    exampleContainer.classList.add('is-hidden');
    note.classList.remove('is-hidden');
    note.classList.add('with-splash');

    // Der Umbau der Felder wartet, bis der Splash deckt.
    setTimeout(() => {
        stage.classList.remove('is-summary');
        stage.classList.toggle('is-round-two', number === 2);
    }, VEIL_MS);
}

// Die Einführung geht, die erste Runde kündigt sich an.
function dismissIntro() {
    if (!isIntroVisible) return;

    isIntroVisible = false;
    stopLehre();

    announceRound(1);

    // Die Einführung bleibt stehen, bis der Schleier der Ansage steht, und
    // geht erst dann. Beide zugleich zu überblenden hieße, zwei halb
    // durchsichtige Decken übereinanderzulegen: Auf halbem Weg lassen sie
    // zusammen mehr durch als jede von beiden am Ende – das Spielfeld blitzt
    // im Übergang heller auf, als es danach steht.
    setTimeout(() => intro.classList.add('is-gone'), VEIL_MS);

    // Wer eben geschüttelt hat, hält das Gerät jetzt so, wie er spielen will –
    // und liest die Ansage. Genau diese Haltung ist die Mitte, und hier ist
    // der einzige Moment, in dem sie sich von selbst ergibt.
    // Gesetzt wird sie erst, wenn die Bewegung des Schüttelns abgeklungen ist,
    // sonst wäre der Nullpunkt eine Zufallslage. Bis zur ersten Frage bleibt
    // dabei reichlich Zeit, die Ansage steht deutlich länger.
    // Das Smartphone erfährt es mit: Es bestätigt die Kalibrierung an seinem
    // Ring, und ohne diese Rückmeldung geschähe hier etwas Wichtiges,
    // ohne dass es jemand merkt.
    setTimeout(calibrateEverywhere, CALIBRATE_DELAY_MS);
}

// Eine Runde beginnen. Das Spielfeld wechselt dabei sein Gesicht: In der
// ersten Runde stehen an den Rändern die Größen mit den Tüten, in der zweiten
// die Begriffe darüber – und in der Mitte steht statt des Begriffs das
// Beispiel.
function startRound(number) {
    round = number;

    // Der Zustand hängt an der Bühne: Es wechselt die ganze Station, nicht
    // jedes Feld für sich. Was das im Einzelnen bedeutet, steht im CSS.
    stage.classList.toggle('is-round-two', round === 2);

    questionContainer.classList.toggle('is-hidden', round !== 1);
    exampleContainer.classList.toggle('is-hidden', round !== 2);

    // Die letzte Antwort einer Runde lässt ihren Kasten ausgeblendet stehen –
    // hier tritt er wieder an.
    questionContainer.classList.remove('slide-out');
    exampleContainer.classList.remove('slide-out');

    // Alles, was nur zwischen den Runden gilt, endet hier – auch auf dem Weg
    // zurück vom Überblick zur ersten Runde.
    stage.classList.remove('is-announcing', 'is-summary');
    roundNoteOne.classList.add('is-hidden');
    roundNoteTwo.classList.add('is-hidden');
    isPaused = false;

    resetInteractiveState();
    shuffledQuestions = shuffle([...(round === 1 ? ROUND_ONE : ROUND_TWO)]);
    currentQuestionIndex = 0;
    displayQuestion();
}

// Der Kasten in der Mitte, der gerade sichtbar ist – nur er wird beschrieben
// und bewegt.
function activeQuestionBox() {
    return round === 1 ? questionContainer : exampleContainer;
}

// Aktuelle Frage anzeigen
function displayQuestion() {
    const currentQuestion = shuffledQuestions[currentQuestionIndex];

    if (round === 1) {
        questionText.src = currentQuestion.img;
        questionText.alt = currentQuestion.text;
    } else {
        exampleImg.src = currentQuestion.src;
        // Ohne sichtbare Bildunterschrift steht der Name nur noch hier, für
        // eine Vorlesehilfe.
        exampleImg.alt = currentQuestion.text;
        exampleFrame.style.setProperty('--zoom', currentQuestion.zoom || 1);
    }
}

// Event-Listener
// Der Button kalibriert den Controller mit (und umgekehrt).
const calibrateEverywhere = shareCalibration(calibrate);
calBtn.addEventListener('click', calibrateEverywhere);

// Nur zum Testen: überspringt Intro und Runde 1, springt direkt zu Runde 2.
skipToRoundTwoBtn.addEventListener('click', () => {
    if (isIntroVisible) {
        isIntroVisible = false;
        stopLehre();
        intro.classList.add('is-gone');
    }
    announceRound(2);
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        calibrateEverywhere();
    }
});

// Die Kalibrierung steht vor der Station – noch vor der Einführung. Sie hängt
// sich in die Bühne, bittet ohne Controller um die Verbindung und setzt die
// Mitte, sobald das Gerät einen Moment still liegt. Solange sie läuft, bleibt
// das Neigen wirkungslos, auch im Einführungsspiel.
//
// Sie steht hier unten, weil sie `calibrateEverywhere` braucht: Ein `const`
// lässt sich nicht benutzen, bevor es dasteht.
const calibration = initCalibration({
    onCalibrate: calibrateEverywhere,
    parent: stage, // in der Bühne, damit die Kopfzeile erreichbar bleibt
    accentRgb: ACCENT_RGB, // ihr eigener Vorgabewert liegt daneben
    onDone: revealIntro
});

// Schütteln startet – vor dem Spiel die Einführung, nach dem Spiel den
// Überblick. Dazwischen bleibt die Geste frei: Ein Spiel, das sich beim
// Hantieren mit dem Gerät selbst zurücksetzt, wäre kaum zu Ende zu bringen.
//
// Zum Beenden der Einführung braucht es mehrere Ereignisse in kurzer Folge,
// wie in den Nachbarmodulen: Ein einzelnes entsteht schon beim Aufnehmen des
// Geräts, und der Text wäre weg, bevor ihn jemand gelesen hat. Aus dem
// Überblick heraus genügt eines – dort ist alles gesagt.
//
// Für das lange Schütteln steht hier bewusst nichts. Es gehört der Landkarte,
// die es mitzählt, solange eine Station geöffnet ist, und dann zu sich
// zurückholt. Sie hört dieselben Ereignisse; ein zweiter Zähler an dieser
// Stelle käme ihr nur in die Quere.
// Ein hier verbrauchtes Schütteln (Einführung/Runden-Ankündigung schließen,
// Spiel aus dem Überblick starten) zählt sonst im Sucher auf dem Handy
// unbemerkt mit zum langen Schütteln, das zurück zur Übersicht führt — ein
// paar dieser kurzen Gesten hintereinander reichen dafür schon aus. Der
// Zähler dort wird deshalb bei jeder hier verbrauchten Geste zurückgesetzt.
function consumeShakeLocally() {
    socket.emit('customAction', { type: 'sucherResetReturnShake' });
}

socket.on('shake', () => {
    if (calibration.isActive()) return;

    if (isIntroVisible) {
        if (startShake.register()) { consumeShakeLocally(); dismissIntro(); }
        return;
    }

    if (pendingSplashDismiss && Date.now() >= splashReadyAt) {
        const dismiss = pendingSplashDismiss;
        pendingSplashDismiss = null;
        consumeShakeLocally();
        shakeOutSplash(dismiss);
        return;
    }

    // Im Überblick löst ein einfaches Schütteln nichts mehr aus — der bleibt
    // stehen, bis langes Schütteln zur Gesamtübersicht zurückführt.
});

// Startzustand: Das Spielfeld steht schon, gespielt wird noch nicht. Zu sehen
// ist davon nichts, die Einführung deckt die Fläche – sie braucht sie gleich
// selbst. Die Frage in der Mitte bleibt trotzdem aus: Wenn die Einführung
// geht, soll dort die Ansage der Runde stehen und kein „Laden…" von vorher.
initRings();
initRoundSplash();
isPaused = true;
questionContainer.classList.add('is-hidden');


// ═══════════════════════════════════════════════════════════════════════════
//  Einführungsspiel
//
//  Es liegt mit der Einführung auf derselben Fläche und verlangt genau das,
//  worum es hier später geht: in jede der vier Richtungen neigen. Wer das
//  getan hat, hat die Bedienung verstanden, ohne dass sie erklärt werden
//  müsste — und wer den Text liest, hat die Punkte gleich neben sich.
//
//  Die Punkte liegen nicht irgendwo am Rand, sondern genau auf den Neigungen,
//  bei denen die Auswahl später auslöst (THRESHOLD_X/THRESHOLD_Y). Geübt wird
//  damit dieselbe Bewegung, die danach zählt. Anders als in den Eintragspfaden
//  sind es vier Richtungen und keine vier Ecken: Hier schlägt immer nur eine
//  Achse aus, dort mussten es beide zugleich sein.
//
//  Übergangen werden darf es: Schütteln startet jederzeit. Es ist ein
//  Angebot, keine Schranke — wer die Station schon kennt, wartet nicht.
// ═══════════════════════════════════════════════════════════════════════════

const introCanvas = byId('introCanvas');
const lctx = introCanvas.getContext('2d');

const LEHRE_PAD = 92;          // Abstand der Punkte vom Rand der Fläche
const LEHRE_DEAD_ZONE = 2.5;   // gegen das Wackeln der Ruhelage
const LEHRE_SMOOTHING = 0.04;  // der Zeiger zieht der Neigung nur gedämpft nach — war zu direkt, zitterte mit dem Rauschen der Rohwerte mit
const LEHRE_DOT = 46;          // Durchmesser der Punkte

const LEHRE_RING_WEIT = 150;   // Außendurchmesser des Halte-Rings am Anfang
const LEHRE_RING_STRICH = 3;   // und seine Strichstärke dort

// Die vier Ziele sitzen auf den Achsen, nicht in den Ecken – oben und unten
// schlägt allein das Kippen aus, links und rechts allein das Neigen.
const LEHRE_ZIELE = [
    { id: 'optTop', gamma: 0, beta: -THRESHOLD_Y },
    { id: 'optRight', gamma: THRESHOLD_X, beta: 0 },
    { id: 'optBottom', gamma: 0, beta: THRESHOLD_Y },
    { id: 'optLeft', gamma: -THRESHOLD_X, beta: 0 }
];

// Derselbe Punkt wie in den Eintragspfaden: Es ist das Zeichen der Ausstellung
// für „hier hin", nicht das Bildmaterial jener Station.
const punktBild = new Image();
punktBild.src = '/img/interactionen/eintragspfade/punkt.png';

let lehreW = 0;
let lehreH = 0;
let lehreTargetX = 0;
let lehreTargetY = 0;
let lehreCursorX = 0;
let lehreCursorY = 0;
let lehreCursorPlaced = false;
let lehreFrame = null;
const lehreErreicht = new Set();

// Welches Ziel gerade gehalten wird und seit wann. Die Zeiten sind die des
// Spiels (PRE_LOCK_DELAY, holdDuration) – auch das Warten will geübt sein.
let lehreHoldId = null;
let lehreHoldStart = 0;

// Der zuletzt eingeloggte Punkt; alle vier erreicht → Intro-Box einblenden.
let lehreZuletzt = null;
let lehreAbgeschlossen = false;

function sizeLehreCanvas() {
    const rect = introCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    lehreW = rect.width;
    lehreH = rect.height;
    introCanvas.width = rect.width * dpr;
    introCanvas.height = rect.height * dpr;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Rechnet eine Neigung in einen Punkt auf der Fläche um. */
function lehrePos(gamma, beta) {
    const g = clamp(gamma, -THRESHOLD_X, THRESHOLD_X);
    const b = clamp(beta, -THRESHOLD_Y, THRESHOLD_Y);

    return {
        x: LEHRE_PAD + ((g + THRESHOLD_X) / (2 * THRESHOLD_X)) * (lehreW - 2 * LEHRE_PAD),
        y: LEHRE_PAD + ((b + THRESHOLD_Y) / (2 * THRESHOLD_Y)) * (lehreH - 2 * LEHRE_PAD)
    };
}

/** Und zurück: aus der Lage des Zeigers wieder eine Neigung. */
function lehreTilt() {
    if (!lehreW || !lehreH) return { gamma: 0, beta: 0 };

    const breite = lehreW - 2 * LEHRE_PAD;
    const hoehe = lehreH - 2 * LEHRE_PAD;

    return {
        gamma: ((lehreCursorX - LEHRE_PAD) / breite) * 2 * THRESHOLD_X - THRESHOLD_X,
        beta: ((lehreCursorY - LEHRE_PAD) / hoehe) * 2 * THRESHOLD_Y - THRESHOLD_Y
    };
}

// Die Totzone wird nicht abgeschnitten, sondern herausgerechnet: Sonst
// spränge der Zeiger an ihrem Rand, statt gleichmäßig zu laufen.
function lehreEntzerrt(wert, bereich) {
    const betrag = Math.abs(wert);
    if (betrag <= LEHRE_DEAD_ZONE) return 0;

    const gedehnt = (betrag - LEHRE_DEAD_ZONE) / (bereich - LEHRE_DEAD_ZONE) * bereich;
    return Math.sign(wert) * gedehnt;
}

function moveLehreCursor(dBeta, dGamma) {
    const ziel = lehrePos(
        lehreEntzerrt(dGamma, THRESHOLD_X),
        lehreEntzerrt(dBeta, THRESHOLD_Y)
    );
    lehreTargetX = ziel.x;
    lehreTargetY = ziel.y;

    // Der erste Wert setzt den Zeiger, statt ihn dorthin laufen zu lassen.
    if (!lehreCursorPlaced) {
        lehreCursorX = lehreTargetX;
        lehreCursorY = lehreTargetY;
        lehreCursorPlaced = true;
    }
}

/**
 * Das noch offene Ziel, in dem die Neigung gerade steht – oder null.
 *
 * Gefragt wird mit derselben Regel wie im Spiel (`selectionFor`), nicht über
 * einen Abstand in Bildpunkten: Ein Kreis um den Punkt ragt zur Mitte hin über
 * die Schwelle hinaus, und die Übung löste dadurch früher aus als der Inhalt
 * danach.
 */
function lehreZielUnterZeiger() {
    const { gamma, beta } = lehreTilt();
    const id = selectionFor(beta, gamma);

    if (!id || lehreErreicht.has(id)) return null;
    return id;
}

function lehreHoldProgress() {
    if (!lehreHoldId) return 0;

    const seither = Date.now() - lehreHoldStart - PRE_LOCK_DELAY;
    return clamp(seither / holdDuration, 0, 1);
}

function checkLehreZiele() {
    const id = lehreZielUnterZeiger();

    // Halten beginnt von vorn
    if (!id) {
        lehreHoldId = null;
        return;
    }

    if (id !== lehreHoldId) {
        lehreHoldId = id;
        lehreHoldStart = Date.now();
        return;
    }

    if (lehreHoldProgress() < 1) return;

    finalizeLehreZiel(id);
}

/** Markiert ein Ziel als erreicht und schließt das Einführungsspiel, wenn alle done. */
function finalizeLehreZiel(id) {
    lehreHoldId = null;
    lehreErreicht.add(id);
    lehreZuletzt = id;

    if (!lehreAbgeschlossen && lehreErreicht.size === LEHRE_ZIELE.length) {
        lehreAbgeschlossen = true;
        stopLehre();

        lehreGame.classList.add('is-gone');
        setTimeout(() => {
            lehreGame.remove();
            introBox.classList.remove('pre-game');
        }, LEHRE_GAME_FADE);
    }
}

/**
 * Zeichnet einen Punkt des Einführungsspiels.
 *
 * @param {{x: number, y: number}} pos
 * @param {boolean} erreicht schon eingeloggt
 * @param {number} progress Fortschritt des Haltens, 0 wenn nicht gehalten
 */
function drawLehrePunkt(pos, erreicht, progress) {
    // Ein Puls nach außen, solange der Punkt noch aussteht: Er ruft, ohne dass
    // etwas dabeistehen müsste.
    if (!erreicht && progress === 0) {
        const phase = (Date.now() % 1500) / 1500;
        lctx.beginPath();
        lctx.arc(pos.x, pos.y, 14 + phase * 34, 0, Math.PI * 2);
        lctx.strokeStyle = `rgba(${ACCENT_RGB}, ${0.6 * (1 - phase)})`;
        lctx.lineWidth = 2 + 5 * (1 - phase);
        lctx.stroke();
    }

    // Beim Halten läuft der Ring von außen auf den Punkt zu – dieselbe
    // Aussage wie der graue Balken im Spiel, nur rund.
    if (progress > 0) {
        const aussen = LEHRE_RING_WEIT + (LEHRE_DOT - LEHRE_RING_WEIT) * progress;
        const strich = LEHRE_RING_STRICH + (LEHRE_DOT / 2 - LEHRE_RING_STRICH) * progress;

        lctx.beginPath();
        lctx.arc(pos.x, pos.y, (aussen - strich) / 2, 0, Math.PI * 2);
        lctx.strokeStyle = `rgba(${ACCENT_RGB}, ${0.45 + 0.55 * progress})`;
        lctx.lineWidth = strich;
        lctx.stroke();
    }

    lctx.save();
    if (erreicht) lctx.globalAlpha = 0.3;

    if (punktBild.complete) {
        lctx.drawImage(punktBild, pos.x - LEHRE_DOT / 2, pos.y - LEHRE_DOT / 2, LEHRE_DOT, LEHRE_DOT);
    } else {
        // Bis das Bild da ist, tut es der Punkt selbst.
        lctx.beginPath();
        lctx.arc(pos.x, pos.y, LEHRE_DOT / 2, 0, Math.PI * 2);
        lctx.fillStyle = `rgb(${ACCENT_RGB})`;
        lctx.fill();
    }

    lctx.restore();
}

function drawLehre() {
    lctx.clearRect(0, 0, lehreW, lehreH);

    LEHRE_ZIELE.forEach(ziel => {
        const erreicht = lehreErreicht.has(ziel.id);
        const progress = ziel.id === lehreHoldId ? lehreHoldProgress() : 0;
        drawLehrePunkt(lehrePos(ziel.gamma, ziel.beta), erreicht, progress);
    });

    // Der Zeiger: ein dunkler Punkt mit weichem Hof, wie in den Eintragspfaden.
    lctx.beginPath();
    lctx.arc(lehreCursorX, lehreCursorY, 16, 0, Math.PI * 2);
    lctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
    lctx.fill();

    lctx.beginPath();
    lctx.arc(lehreCursorX, lehreCursorY, 9, 0, Math.PI * 2);
    lctx.fillStyle = '#0f172a';
    lctx.fill();
}

function lehreLoop() {
    if (!isIntroVisible) { lehreFrame = null; return; }

    lehreCursorX += (lehreTargetX - lehreCursorX) * LEHRE_SMOOTHING;
    lehreCursorY += (lehreTargetY - lehreCursorY) * LEHRE_SMOOTHING;

    if (Math.abs(lehreTargetX - lehreCursorX) < 0.5) lehreCursorX = lehreTargetX;
    if (Math.abs(lehreTargetY - lehreCursorY) < 0.5) lehreCursorY = lehreTargetY;

    checkLehreZiele();
    drawLehre();

    lehreFrame = requestAnimationFrame(lehreLoop);
}

// Mit der Einführung endet auch die Übung. Die Zeichenfläche bleibt stehen,
// bis das Overlay abgeblendet ist – sie verschwindet mit ihm.
function stopLehre() {
    if (lehreFrame !== null) {
        cancelAnimationFrame(lehreFrame);
        lehreFrame = null;
    }
}

// Ohne gekoppeltes Smartphone folgt der Übungszeiger der Maus – zum Einrichten
// am Schreibtisch, nicht zur Bedienung. Hier läuft er direkt unter ihr, denn
// die Punkte liegen am Rand der Fläche und nicht auf der Strecke der Bubble.
intro.addEventListener('mousemove', (event) => {
    if (!isIntroVisible) return;
    if (connection.hasController()) return;
    // Nach dem Einführungsspiel ist die Zeichenfläche aus dem DOM – ohne
    // diese Wache läse `getBoundingClientRect()` an ihr nur noch Nullen.
    if (!lehreGame.isConnected) return;

    const rect = introCanvas.getBoundingClientRect();
    lehreTargetX = event.clientX - rect.left;
    lehreTargetY = event.clientY - rect.top;

    if (!lehreCursorPlaced) {
        lehreCursorX = lehreTargetX;
        lehreCursorY = lehreTargetY;
        lehreCursorPlaced = true;
    }
});

// Klick auf ein Ziel im Einführungsspiel: Cursor auf Mausposition snappen,
// dann sofort prüfen ob ein offenes Ziel darunter liegt. Ersetzt das Halten.
// Klick überspringt das Einführungsspiel bedingungslos – wie in Eintragspfade.
// .lehre-game hat pointer-events:none, deshalb liegt der Listener auf intro.
// Vor dem Abschluss: Einführungsspiel bedingungslos überspringen (wie Eintragspfade).
// Danach: Intro schließen, aber nur ohne Gerät.
intro.addEventListener('click', () => {
    if (!lehreAbgeschlossen) {
        LEHRE_ZIELE.forEach(z => lehreErreicht.add(z.id));
        finalizeLehreZiel(LEHRE_ZIELE[LEHRE_ZIELE.length - 1].id);
        return;
    }
    if (connection.hasController()) return;
    dismissIntro();
});

// Klick-Fallback für das Runden-Overlay: ersetzt das Schütteln, wenn kein
// Gerät verbunden ist. Im Überblick löst ein Klick nichts mehr aus — wie
// beim Schütteln, siehe oben.
stage.addEventListener('click', () => {
    if (connection.hasController()) return;
    if (calibration.isActive()) return;

    if (pendingSplashDismiss && Date.now() >= splashReadyAt) {
        const dismiss = pendingSplashDismiss;
        pendingSplashDismiss = null;
        shakeOutSplash(dismiss);
        return;
    }
});

window.addEventListener('resize', sizeLehreCanvas);

sizeLehreCanvas();
lehreCursorX = lehreTargetX = lehreW / 2;
lehreCursorY = lehreTargetY = lehreH / 2;

// Die Einführung wartet, bis die Kalibrierung durch ist. Sie liegt die ganze
// Zeit da und deckt mit ihrem weißen Grund das Spielfeld – zu sehen sind Text
// und Spiel aber erst jetzt.
// Der Grund: Die Kalibrierung hält sich anfangs unsichtbar, bis der
// Verbindungszustand gemeldet ist. In dieser Lücke blitzte die Einführung
// samt ihren Punkten auf und verschwand wieder unter dem Overlay.
function revealIntro() {
    intro.classList.remove('is-waiting');

    if (lehreFrame === null && isIntroVisible) {
        lehreFrame = requestAnimationFrame(lehreLoop);
    }
}
