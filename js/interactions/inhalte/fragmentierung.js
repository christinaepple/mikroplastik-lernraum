// ═══════════════════════════════════════════════════════════════════════════
//  Fragmentierung (Inhalte) — Stop-Motion aus Einzelbildern
//
//  Statt der früheren Collage (Folie, Sonne, Traktor, Frost) läuft der
//  Inhalt jetzt als fertige Bildfolge: Jedes Bild in STORY_FRAMES ist bereits
//  ein Stop-Motion-Stand. Schütteln baut eine Belastung auf; ist sie voll,
//  blendet das nächste Bild ein und die Belastung beginnt wieder bei null.
//  Kein Delay, keine Zeitsteuerung – der Fortschritt kommt allein aus der
//  Geste.
// ═══════════════════════════════════════════════════════════════════════════

import { socket } from '../../lib/socket.js';
import { initConnectionBadge } from '../../lib/connection.js';
import { clamp } from '../../lib/angles.js';
import { initCalibration } from '../../lib/calibration.js';
import { byId } from '../../lib/dom.js';

const stage = byId('stage');
const storyImg = byId('storyFrame');
const decayLabels = byId('decayLabels');

// ====================================================================
// ANPASSBARE INTERAKTIONS-PARAMETER
// ====================================================================
// ── Schütteln → Belastung ──
// Ein Schütteln zählt, sobald die Belastung 1 erreicht (Schwelle steht fest
// in onShake(), s.u.). Wie schnell das geht, steuern diese drei Werte:
//
//   STRESS_BASE     Fixbetrag je Schütteln, unabhängig von der Stärke.
//   STRESS_BY_FORCE zusätzlich mal der Stärke (0 schwach – 1 kräftig).
//   STRESS_DECAY    Anteil, der pro Sekunde ohne neues Schütteln wieder
//                   abfällt – größer heißt, es verzeiht Pausen weniger.
//
// Wer kräftig schüttelt, kommt schneller zum nächsten Bild.
const STRESS_BASE = 0.25;
const STRESS_BY_FORCE = 0.08;

// Roher Intensitätsbereich des Sensors (vgl. js/interactions/schuetteln.js)
const RAW_MIN = 0.53;
const RAW_MAX = 1.0;

// Anteil der Belastung, der pro Sekunde wieder abfällt
const STRESS_DECAY = 0.2;

// ── Die Bildfolge ──
// Jeder Eintrag ein fertiges Stop-Motion-Bild. Reihenfolge = Ablauf.
// Platzierung und Größe stehen nicht hier, sondern in fragmentierung.html
// bei .story-frame (Anteile der Bühne: left/top/width) – dort justieren.
const STORY_FRAMES = [
    // 1.png zweimal: das erste Mal ohne Label (Ausgangszustand), erst beim
    // zweiten Mal steht das erste Label (s. DECAY_LABELS).
    '/img/interactionen/fragmentierung/partikelStory/1.png',
    '/img/interactionen/fragmentierung/partikelStory/1.png',
    '/img/interactionen/fragmentierung/partikelStory/2.png',
    '/img/interactionen/fragmentierung/partikelStory/3.png',
    '/img/interactionen/fragmentierung/partikelStory/4.png',
    '/img/interactionen/fragmentierung/partikelStory/5.png',
    '/img/interactionen/fragmentierung/partikelStory/6.png',
    '/img/interactionen/fragmentierung/partikelStory/7.png',
    '/img/interactionen/fragmentierung/partikelStory/8.png',
    '/img/interactionen/fragmentierung/partikelStory/9.png',
    '/img/interactionen/fragmentierung/partikelStory/10.png',
    '/img/interactionen/fragmentierung/partikelStory/11.png',
    '/img/interactionen/fragmentierung/partikelStory/12.png',
    '/img/interactionen/fragmentierung/partikelStory/13.png',
    '/img/interactionen/fragmentierung/partikelStory/14.png',
    '/img/interactionen/fragmentierung/partikelStory/15.png',
];

// Ein Label je Zerfallsprozess: Schlüssel ist der Index des Bildes (in
// STORY_FRAMES, das 1.png doppelt führt), bei dem er zu sehen ist. Die
// Labels stapeln sich links untereinander – Lage und Abstand stehen in
// fragmentierung.html bei .decay-labels.
//
// `icon` ist optional: erscheint frei auf der Bühne, solange sein Label
// sichtbar ist, und blendet mit ihm zusammen aus. `x`/`y` sind die obere
// linke Ecke, `width` die Breite, je als Anteil der Bühne; `flip: true`
// spiegelt waagerecht, `scale` (Standard 1) vergrößert/verkleinert zusätzlich
// von der Bildmitte aus, ohne `x`/`y`/`width` neu berechnen zu müssen.
const DECAY_LABELS = {
    1: { text: 'PE-Folie liegt auf den Feldern' },
    3: {
        text: 'UV-Strahlung bleicht die Folie und macht sie spröde, bis sie bricht',
        icon: { src: '/img/interactionen/fragmentierung/sonne.png', x: 0.8, y: 0.06, width: 0.14, scale: 1.3 },
    },
    7: {
        text: 'Pflug und Ernte zerreißen die Reste und mischen sie in den Boden',
        icon: { src: '/img/interactionen/fragmentierung/traktor.png', x: 0.20, y: 0.65, width: 0.2, flip: false, scale: 1 },
    },
    10: {
        text: 'Wasser sammelt sich in den Rissen, gefriert und sprengt die Stücke weiter',
        icon: { src: '/img/interactionen/fragmentierung/schneeflocken.png', x: 0.76, y: 0.7, width: 0.16, scale: 2.5 },
    },
    13: { text: 'Oxidation und Verwitterung zerkleinern die Partikel weiter' },
};

// Jedes Label verschwindet ein Bild vor dem nächsten – eine kurze Lücke ohne
// Label, statt direkt ins nächste überzublenden. Aus den Schlüsseln von
// DECAY_LABELS berechnet, damit hier nichts doppelt gepflegt werden muss.
const decayKeysSorted = Object.keys(DECAY_LABELS).map(Number).sort((a, b) => a - b);
const DECAY_HIDE_AT = new Set(decayKeysSorted.slice(1).map((k) => k - 1));
// ====================================================================

// ── Zustand ──────────────────────────────────────────────────────────────
let stress = 0;
let storyIndex = 0;
let finished = false;   // letztes Bild erreicht, alles steht still

const connection = initConnectionBadge();

/** Zeigt das i-te Bild der Bildfolge. */
function showFrame(i) {
    storyImg.src = STORY_FRAMES[i];
}

// Immer nur ein Label sichtbar: das neue blendet das vorherige (und sein
// Icon) aus. Erst ganz am Ende, mit dem letzten Schütteln, erscheinen alle
// zusammen – als Rückblick auf den ganzen Ablauf.
let currentDecayStep = null;   // { label, icon }

/** Baut Label und – falls vorhanden – Icon für einen Zerfallsprozess auf.
 *  Bleiben im DOM, aber unsichtbar, bis sie an der Reihe sind bzw.
 *  revealAllDecayLabels() sie am Ende zeigt. */
function addDecayStep(entry) {
    const label = document.createElement('div');
    label.className = 'decay-label';
    label.textContent = entry.text;
    decayLabels.appendChild(label);

    let icon = null;
    if (entry.icon) {
        icon = document.createElement('img');
        icon.className = 'decay-icon';
        icon.src = entry.icon.src;
        icon.alt = '';
        icon.style.left = `${entry.icon.x * 100}%`;
        icon.style.top = `${entry.icon.y * 100}%`;
        icon.style.width = `${entry.icon.width * 100}%`;
        const scale = entry.icon.scale || 1;
        icon.style.transform = `scaleX(${entry.icon.flip ? -scale : scale}) scaleY(${scale})`;
        stage.appendChild(icon);
    }

    return { label, icon };
}

function setDecayStepOn(step, on) {
    step.label.classList.toggle('is-on', on);
    if (step.icon) step.icon.classList.toggle('is-on', on);
}

/** Zeigt, falls vorhanden, Label (und Icon) für dieses Bild – und blendet das davor aus. */
function showDecayLabelFor(i) {
    const entry = DECAY_LABELS[i];
    if (!entry) return;
    if (currentDecayStep) setDecayStepOn(currentDecayStep, false);
    currentDecayStep = addDecayStep(entry);
    setDecayStepOn(currentDecayStep, true);
}

/** Alle bisher aufgetretenen Labels und Icons zusammen einblenden – der Rückblick am Ende. */
function revealAllDecayLabels() {
    decayLabels.querySelectorAll('.decay-label').forEach((el) => el.classList.add('is-on'));
    stage.querySelectorAll('.decay-icon').forEach((el) => el.classList.add('is-on'));
}

/** Ein Bild weiter – oder, am Ende der Folge, Schluss. */
function nextFrame() {
    storyIndex++;
    if (storyIndex >= STORY_FRAMES.length) {
        finished = true;
        revealAllDecayLabels();
        return;
    }
    showFrame(storyIndex);
    if (DECAY_HIDE_AT.has(storyIndex) && currentDecayStep) {
        setDecayStepOn(currentDecayStep, false);
        currentDecayStep = null;
    }
    showDecayLabelFor(storyIndex);
}

// ── Einführung: Schütteln lernen ───────────────────────────────────────────
// Auf weißem Grund lässt Schütteln Punkte regnen – alle gleich groß. Die
// Geste steuert den Vorgang, sie führt ihn nicht selbst aus: Wer schüttelt,
// treibt den Regen an; wer aufhört, lässt ihn versiegen; wer kräftiger
// schüttelt, macht ihn stärker. Dieselbe Rolle wie in der Station, wo das
// Schütteln die Bildfolge antreibt.
const introCover = byId('introCover');
const introRain = byId('introRain');

const RAIN_DOT_SIZE = 22;         // alle Punkte gleich groß (px)
// Der Regen läuft nicht aus dem Bild, sondern sammelt sich unten und
// stapelt sich – der Bildschirm füllt sich von unten.
const COL_W = RAIN_DOT_SIZE;      // Breite einer Stapelspalte
const STACK_STEP = 20;            // Höhengewinn je Punkt (etwas Überlappung)
const FILL_TARGET = 0.4;          // ab diesem Füllstand (Anteil der Höhe) startet die Station
// Zwei Punktreihen kürzer als der reine Anteil ergäbe – das Spiel ist damit
// eher am Ziel, unabhängig von der Bühnenhöhe.
const FILL_ROWS_LESS = 2;

// Wie viel ein Schütteln den Regen anfacht: BASE für jedes (klein, damit
// schwaches Schütteln spärlich bleibt), FORCE zusätzlich aus der Stärke
// (groß, damit kräftiges Schütteln deutlich mehr bringt). Der Pegel fällt
// pro Sekunde um DECAY – hört das Schütteln auf, versiegt der Regen.
const RAIN_PER_SHAKE_BASE = 0.1;
const RAIN_PER_SHAKE_FORCE = 0.9;
const RAIN_DECAY = 1.6;

// Regenmenge und Fallgeschwindigkeit bei vollem Pegel.
const RAIN_MAX_SPAWN = 190;       // Punkte je Sekunde – höher heißt schneller am Ziel
// Nichtlinear: Der Unterschied zwischen leichtem und starkem Schütteln soll
// vor allem an der Anzahl der Punkte ablesbar sein. Der Exponent drückt
// schwachen Regen nach unten (wenige Punkte) und lässt starken erst richtig
// dicht werden.
const RAIN_SPAWN_EXP = 1.9;
const RAIN_FALL_MIN = 260;        // px/s bei schwachem Regen
const RAIN_FALL_MAX = 560;        // px/s bei starkem – kräftiger heißt schneller

let stageRect = stage.getBoundingClientRect();

// Ablauf der Einführung: erst das Auffüll-Spiel, dann das Erklär-Overlay, das
// per Schütteln in den Inhalt führt.
let introPhase = 'game';   // 'game' | 'explain' | 'done'
const explainPanel = byId('explainPanel');
const introInstruction = document.querySelector('.intro-instruction');
let calibGate = null;      // Online/Offline-Abfrage vor der Einführung

// Wenn das Erklär-Overlay erscheint, wird noch geschüttelt (das hat es ja
// ausgelöst). Diese kurze Sperre schluckt diese Schüttler, damit nicht
// derselbe Schwung sofort „schütteln zum starten“ auslöst und den Text
// überspringt.
const EXPLAIN_ARM_MS = 900;
let explainReadyAt = 0;

// Dieselbe Sperre noch einmal am nächsten Übergang: Das Schütteln, das das
// Erklär-Overlay verlässt, ist noch im Gang, wenn der Inhalt beginnt – ohne
// Sperre zählte es sofort als erstes Schütteln dort und der erste Schritt
// würde übersprungen.
const CONTENT_ARM_MS = 900;
let contentReadyAt = 0;
let rainLevel = 0;
let rainDrops = [];
let rainSpawnAccum = 0;
let rainLastT = 0;
let colHeight = [];   // Höhe des Stapels je Spalte (px)
let cols = 0;

function spawnRainDot() {
    const el = document.createElement('img');
    el.className = 'rain-dot';
    el.src = '/img/interactionen/eintragspfade/punkt.png';
    el.alt = '';
    el.style.width = `${RAIN_DOT_SIZE}px`;
    el.style.height = `${RAIN_DOT_SIZE}px`;
    el.style.marginLeft = `${-RAIN_DOT_SIZE / 2}px`;
    el.style.marginTop = `${-RAIN_DOT_SIZE / 2}px`;
    introRain.appendChild(el);

    const col = Math.floor(Math.random() * cols);
    rainDrops.push({
        x: col * COL_W + COL_W / 2,
        y: -RAIN_DOT_SIZE,
        // Stärkerer Regen fällt schneller; etwas Streuung, damit die Tropfen
        // nicht im Gleichschritt fallen.
        vy: (RAIN_FALL_MIN + (RAIN_FALL_MAX - RAIN_FALL_MIN) * rainLevel) * (0.8 + Math.random() * 0.4),
        col,
        settled: false,
        el,
    });
}

// Eigene, ungedrosselte Schleife: Der Regen soll fließen, nicht ruckeln.
function rainLoop(now) {
    if (introPhase !== 'game') return;
    const dt = rainLastT ? Math.min(0.05, (now - rainLastT) / 1000) : 0;
    rainLastT = now;

    // Pegel fällt stetig – ohne neues Schütteln versiegt der Regen.
    rainLevel = Math.max(0, rainLevel - RAIN_DECAY * dt);

    // Neue Tropfen nach Pegel.
    rainSpawnAccum += RAIN_MAX_SPAWN * Math.pow(rainLevel, RAIN_SPAWN_EXP) * dt;
    while (rainSpawnAccum >= 1) {
        spawnRainDot();
        rainSpawnAccum -= 1;
    }

    // Fallen lassen und unten stapeln: Erreicht ein Punkt die Oberkante
    // seines Spaltenstapels, bleibt er liegen und hebt den Stapel.
    for (const d of rainDrops) {
        if (d.settled) continue;
        d.y += d.vy * dt;
        const surfaceY = stageRect.height - colHeight[d.col] - RAIN_DOT_SIZE / 2;
        if (d.y >= surfaceY) {
            d.y = surfaceY;
            d.settled = true;
            colHeight[d.col] += STACK_STEP;
        }
        d.el.style.transform = `translate(${d.x}px, ${d.y}px)`;
    }

    // Füllstand: der mittlere Stapel im Verhältnis zur Höhe. Ist der Schirm
    // weit genug gefüllt, beginnt die Station.
    let sum = 0;
    for (const h of colHeight) sum += h;
    if (sum / cols >= FILL_TARGET * stageRect.height - FILL_ROWS_LESS * STACK_STEP) {
        enterExplain();
        return;
    }

    requestAnimationFrame(rainLoop);
}

function startIntroRain() {
    // Jetzt erst die Anweisung zeigen – vorher lag die Verbindungs-Abfrage
    // darüber und sie hätte nur aufgeblitzt.
    introInstruction.style.opacity = '1';
    cols = Math.max(1, Math.floor(stageRect.width / COL_W));
    colHeight = new Array(cols).fill(0);
    requestAnimationFrame(rainLoop);
}

/** Ein Schütteln in der Einführung: facht den Regen an. */
function introShake(force) {
    rainLevel = Math.min(1, rainLevel + RAIN_PER_SHAKE_BASE + RAIN_PER_SHAKE_FORCE * force);
}

// Der Schirm ist voll: Das Auffüll-Spiel endet, das Erklär-Overlay tritt
// hervor (der Punktestapel bleibt als Grund dahinter stehen).
function enterExplain() {
    introPhase = 'explain';
    introCover.classList.add('is-explaining');   // blendet die Spiel-Anweisung aus
    introInstruction.style.opacity = '0';
    // Der Punktestapel tritt ab: Die Erklärbox steht dann auf weißem Grund,
    // wie in den übrigen Modulen – Spiel und Box sind getrennt.
    introRain.classList.add('is-gone');
    explainPanel.classList.add('is-on');
    explainReadyAt = Date.now() + EXPLAIN_ARM_MS;
}

// Schütteln im Erklär-Overlay führt in den eigentlichen Inhalt: Der Grund
// hebt sich, die Station ist da.
function dismissIntro() {
    if (introPhase === 'done') return;
    introPhase = 'done';
    contentReadyAt = Date.now() + CONTENT_ARM_MS;
    introCover.classList.add('is-gone');
    setTimeout(() => introCover.remove(), 600);
}

// ── Schütteln ────────────────────────────────────────────────────────────

// Ein Schütteln, aus dem Sensor oder – am Schreibtisch – aus einem Mausklick.
// `force` ist die Stärke, 0 (schwach) bis 1 (kräftig).
function onShake(force) {
    // Während die Verbindungs-Abfrage steht, bleibt alles ruhig.
    if (calibGate && calibGate.isActive()) return;

    // Einführung: Im Auffüll-Spiel treibt Schütteln den Punkteregen; im
    // Erklär-Overlay führt Schütteln weiter in den Inhalt.
    if (introPhase === 'game') {
        introShake(force);
        return;
    }
    if (introPhase === 'explain') {
        // Erst nach der kurzen Sperre zählt das Schütteln als „weiter“.
        if (Date.now() >= explainReadyAt) dismissIntro();
        return;
    }

    // Auch hier erst nach kurzer Pause: sonst reißt das Schütteln, das eben
    // noch das Erklär-Overlay verlassen hat, gleich den ersten Schritt mit.
    if (Date.now() < contentReadyAt) return;

    if (finished) return;

    stress = Math.min(1, stress + STRESS_BASE + STRESS_BY_FORCE * force);
    if (stress >= 1) {
        stress = 0;
        nextFrame();
    }
}

socket.on('shake', ({ intensity = RAW_MIN } = {}) => {
    onShake(clamp((intensity - RAW_MIN) / (RAW_MAX - RAW_MIN), 0, 1));
});

// ── Belastung: fällt stetig, ohne neues Schütteln ───────────────────────────
let lastT = 0;
function tick(now) {
    requestAnimationFrame(tick);
    const dt = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;
    stress = Math.max(0, stress - STRESS_DECAY * dt);
}
requestAnimationFrame(tick);

// ── Maus als Ausweichbedienung ─────────────────────────────────────────────
// Zum Prüfen am Schreibtisch, ohne jedes Mal ein Gerät zu verbinden – wie in
// den übrigen Stationen. Sie greift nur, solange kein Controller hängt; im
// Betrieb bleibt alles beim Schütteln.
let lastCursorControlled = null;

stage.addEventListener('click', () => {
    if (connection.hasController()) return;
    // Fallback fürs Testen: Im Auffüll-Spiel klickt man sonst mühsam den
    // Schirm voll – ein Klick springt hier direkt ans fertige Einführungsspiel.
    if (introPhase === 'game' && !(calibGate && calibGate.isActive())) {
        enterExplain();
        return;
    }
    if (introPhase === 'explain') {
        onShake(0.6);
        return;
    }

    // TEMP: Im Hauptteil springt ein Klick fürs Testen direkt zum nächsten
    // Bild, ohne über die Belastung zu gehen – so lässt sich die Bildfolge
    // schnell durchklicken. Entfernen bzw. durch `onShake(0.6)` ersetzen,
    // wenn nur noch am Gerät getestet wird.
    if (calibGate && calibGate.isActive()) return;
    if (finished) return;
    stress = 0;
    nextFrame();
});

// Der Zeiger ist im Kiosk verborgen (cursor: none); ohne Controller wird er
// gebraucht.
function mouseLoop() {
    const controlled = connection.hasController();
    if (controlled !== lastCursorControlled) {
        stage.style.cursor = controlled ? 'none' : 'default';
        lastCursorControlled = controlled;
    }
    requestAnimationFrame(mouseLoop);
}
requestAnimationFrame(mouseLoop);

// ── Start ────────────────────────────────────────────────────────────────
showFrame(0);
showDecayLabelFor(0);

// Vor der Einführung die Online/Offline-Abfrage aus der Kalibrierung – hier
// ohne Stillhalten, weil die Station keinen Nullpunkt braucht: nur die
// Aufforderung zu verbinden, die weggeht, sobald ein Gerät da ist. Ohne
// Controller führt ein Klick daran vorbei (Fallback fürs Testen). Erst
// danach beginnt das Auffüll-Spiel.
calibGate = initCalibration({
    parent: stage,
    waitForStillness: false,
    onDone: startIntroRain,
});
