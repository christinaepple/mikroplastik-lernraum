// ═══════════════════════════════════════════════════════════════════════════
//  Produktionsabriss (Inhalte) — Zeitstrahl durch Drehen des Smartphones
//  vorspulen (Kopie des Zeitstrahl-Moduls aus dem Labor)
// ═══════════════════════════════════════════════════════════════════════════

import { socket } from '../../lib/socket.js';
import { initConnectionBadge } from '../../lib/connection.js';
import { wrapDeg180 } from '../../lib/angles.js';
import { createLongShake } from '../../lib/shake.js';
import { initCalibration } from '../../lib/calibration.js';
import { reportCompletion } from '../../lib/completion.js';
import { byId } from '../../lib/dom.js';

// UI-Elemente
const timelineFill = byId('timelineFill');

const barLeft = byId('barLeft');
const barMiddle = byId('barMiddle');
const barRight = byId('barRight');

const labelLeft = byId('labelLeft');
const labelMiddle = byId('labelMiddle');
const labelRight = byId('labelRight');

// Die Zahlen rechts neben dem Diagramm. Sie kommen nacheinander dazu und
// bleiben dann stehen: die Wachstumsrate mit dem letzten Balken, die heutige
// Produktion mit den ersten Objekten, die Verweildauer zuletzt.
const growth = byId('growth');
const current = byId('current');

// ====================================================================
// ANPASSBARE INTERAKTIONS-PARAMETER (HIER KANNST DU RUMSPIELEN!)
// ====================================================================
// ── Die Zeitachse ──────────────────────────────────────────────────────────
// Eine volle Umdrehung sind diese neunzig Jahre. Daraus folgt alles andere:
// wo ein Balken steht, wann er erscheint und wie weit die Linie dann gefüllt
// ist. Ein Jahr zu ändern heißt deshalb, hier eine Zahl zu ändern – Position,
// Beschriftung und Auslösewinkel ziehen mit.
const AXIS_START = 1950;
// Das Ende liegt hinter dem letzten Balken: Die Achse hört nicht mit der
// Gegenwart auf, und der freie Rest ist der Platz für den Blick nach vorn –
// weit genug, dass das fortgeschriebene Jahr (FUTURE_YEAR) noch auf der Linie
// liegt und nicht hinter ihrer Spitze.
const AXIS_END = 2050;

// Die drei Jahre, die das Diagramm zeigt. Die Abstände auf der Achse ergeben
// sich aus den Jahreszahlen selbst – sie stehen nicht in gleichen Dritteln.
const BAR_YEARS = [1976, 2002, 2024];

// Die zugehörigen Mengen in Mio t. Sie stehen gedreht im Balken.
// Die Balkenhöhen dazu stehen im CSS (.small-bar/.middle-bar/.large-bar) –
// dort, weil in sie auch der durchsichtige Rand der jeweiligen Zeichnung
// eingerechnet ist.
const BAR_VALUES = [50, 200, 430.9];

// ── Blick nach vorn ────────────────────────────────────────────────────────
// Keine Prognose, sondern eine Fortschreibung: dieselbe mittlere Wachstumsrate
// wie seit 1950, weiter gerechnet vom letzten Balken aus. Die Rate steht auch
// als erste Zahl rechts – beide kommen von hier, damit sie nicht auseinander-
// laufen.
const GROWTH_RATE = 0.086;
const FUTURE_YEAR = 2046;

// Anteil der Achse, den ein Jahr einnimmt (0 bis 1)
function axisShare(year) {
    return (year - AXIS_START) / (AXIS_END - AXIS_START);
}

// Drehwinkel, bei dem ein Jahr erreicht ist
function angleOf(year) {
    return axisShare(year) * 360;
}

// Winkel-Schwellenwerte für das Freischalten der Balken – aus den Jahren
const ANGLE_BAR_1 = angleOf(BAR_YEARS[0]);
const ANGLE_BAR_2 = angleOf(BAR_YEARS[1]);
const ANGLE_BAR_3 = angleOf(BAR_YEARS[2]);
// Eine Vierteldrehung hinter der vollen Umdrehung -> die Kennzahl rechts neben
// dem Diagramm. Sie steht für sich und kommt deshalb erst, wenn der letzte
// Balken schon da ist und die Linie am Ende steht.
const ANGLE_GROWTH = 450;

// ── Spielerei: der Bildschirm sprenkelt sich zu ────────────────────────────
// Wer danach weiterdreht, verteilt Objekte über die ganze Fläche – dieselben
// drei Zeichnungen, aus denen die Haufen im Diagramm bestehen. Je Schritt
// kommt eines dazu.
//
// Davor liegt eine Vierteldrehung, in der nichts passiert: Die Kennzahl soll
// einen Moment für sich stehen, bevor der Bildschirm zu wimmeln anfängt.
// Diese Pause ist auch die Stelle, an der man aufhören kann, ohne etwas
// abzubrechen.
const SPRINKLE_PAUSE = 90;
const ANGLE_SPRINKLE = ANGLE_GROWTH + SPRINKLE_PAUSE;
const SPRINKLE_BASE = '/img/interactionen/produktionsabriss';
const SPRINKLE_FILES = ['1.png', '2.png', '3.png'];
// Der Schritt ist klein gehalten, weil es viele Objekte sind: Bei 12° wären
// für die volle Fläche über drei Umdrehungen nötig. So bleibt es bei gut zwei,
// die Objekte kommen dafür in doppeltem Tempo.
const SPRINKLE_STEP = 6;       // Grad je weiterem Objekt
// Die Plätze sind ein Raster, damit sich die Fläche gleichmäßig füllt und
// nichts verklumpt; gewackelt wird innerhalb der Zelle. Am Rand ragen die
// Objekte über die Fläche hinaus und werden dort beschnitten – gerade das
// lässt den Bildschirm übersät wirken statt bepunktet.
const SPRINKLE_COLUMNS = 8;
const SPRINKLE_ROWS = 7;
const SPRINKLE_JITTER = 0.9;   // Anteil der Zelle, um den ein Platz wandert
// Die Haufen sind schmal (ein Sechstel ihrer Höhe breit) – zu schmal, um von
// der äußersten Spaltenmitte aus seitlich noch bis an den Rand zu reichen.
// Das Raster deshalb etwas über 0..1 hinausstrecken (von der Mitte aus
// skaliert, innere Zellen rücken kaum, äußere spürbar weiter an bzw. über
// den Rand).
const SPRINKLE_OVERSCAN = 1.2;
const SPRINKLE_TILT = 45;      // Grad, um die ein Objekt gedreht liegt
// Die Objekte sind ein Vielfaches ihrer Rasterzelle groß: Jedes reicht weit in
// die Nachbarzellen hinein, sodass sich am Ende alles überlagert und nur noch
// einzelne weiße Stellen bleiben. Zusammen bringen die 56 Objekte das gut
// Vierfache der Bildschirmfläche mit – das ist das Maß, das aus Streuung eine
// Fläche macht.
const SPRINKLE_SIZE = [32, 52]; // Höhe in vh, von … bis
const SPRINKLE_TOTAL = SPRINKLE_COLUMNS * SPRINKLE_ROWS;
// Winkel, bei dem das letzte Objekt liegt
const ANGLE_FULL = ANGLE_SPRINKLE + (SPRINKLE_TOTAL - 1) * SPRINKLE_STEP;

// ====================================================================

// Die gefüllte Linie ist der Zeiger auf der Achse, nicht ein Fortschrittsbalken
// der Drehung. Seit Achse und Drehung dieselbe Skala haben, ist das eine
// Gerade: Ein Grad ist ein Vierteljahr, die Kante der Füllung steht immer auf
// dem Jahr, das gerade erreicht ist – und damit von selbst genau unter dem
// Balken, der in diesem Moment erscheint. Weiter als bis zum Ende der Linie
// (AXIS_END) geht es nicht.
function fillPercentFor(rotation) {
    return Math.min(100, (rotation / 360) * 100);
}

// Balken und Jahreszahl stehen an der Stelle ihres Jahres. Beide bekommen sie
// von hier, damit sie nicht auseinanderlaufen können; die Menge im Balken
// kommt gleich mit.
function placeBars() {
    const barSections = document.querySelectorAll('.bar-section');
    const labelSections = document.querySelectorAll('.label-section');
    const values = document.querySelectorAll('.bar-value');
    const labels = [labelLeft, labelMiddle, labelRight];

    BAR_YEARS.forEach((year, index) => {
        const left = `${(axisShare(year) * 100).toFixed(2)}%`;
        barSections[index].style.left = left;
        labelSections[index].style.left = left;
        labels[index].src = `/img/interactionen/produktionsabriss/${year}.png`;
        labels[index].alt = String(year);
        values[index].textContent = BAR_VALUES[index].toLocaleString('de-DE');
    });
}

// Die Wachstumsrate steht fest; sie wird einmal geschrieben.
byId('growthRate').textContent = `${(GROWTH_RATE * 100).toLocaleString('de-DE')} %`;

const futureValue = byId('futureValue');
const futureYear = byId('futureYear');

// Die Fortschreibung läuft mit dem Zusprenkeln mit: Solange sich der Bildschirm
// füllt, zählen Jahr und Menge hoch – beim ersten Objekt steht der letzte Balken,
// beim letzten steht FUTURE_YEAR. Beide Bewegungen erzählen dasselbe, deshalb
// teilen sie sich auch dieselbe Strecke.
// Gerechnet wird über das Zwischenjahr, nicht über den Endwert mal Anteil: Der
// Anstieg ist exponentiell, eine gerade Zählung von 431 auf 2.646 läge in der
// Mitte weit daneben.
function updateFuture(rotation) {
    const lastYear = BAR_YEARS[BAR_YEARS.length - 1];
    const lastValue = BAR_VALUES[BAR_VALUES.length - 1];

    const span = ANGLE_FULL - ANGLE_SPRINKLE;
    const share = Math.max(0, Math.min(1, (rotation - ANGLE_SPRINKLE) / span));
    const years = share * (FUTURE_YEAR - lastYear);
    const value = lastValue * Math.pow(1 + GROWTH_RATE, years);

    futureValue.textContent = `${Math.round(value).toLocaleString('de-DE')} Mio t`;
    futureYear.textContent = String(Math.round(lastYear + years));
}

placeBars();
updateFuture(0);

// Schüttel-Reset (wie in schuetteln-anzahl): vier Shakes in zwei Sekunden
const longShake = createLongShake({ windowMs: 2000, count: 4 });

let lastBeta = null;
let cumulativeRotation = 0;

let isLeftUnlocked = false;
let isMiddleUnlocked = false;
let isRightUnlocked = false;
let isGrowthShown = false;

let isIntroVisible = true;
const intro = byId('intro');

// Die beiden Spalten der Bühne. Sie warten hinter den Overlays und werden
// später auch für die Maske der Sprenkel vermessen.
const diagramCol = document.querySelector('.diagram-col');
const side = document.querySelector('.side');

function dismissIntro() {
    isIntroVisible = false;
    intro.classList.add('is-gone');

    // Die Bühne kommt erst jetzt zum Vorschein: Sie steht im Markup und wäre
    // sonst in jeder Lücke zwischen zwei Schichten zu sehen.
    diagramCol.classList.remove('is-waiting');
    side.classList.remove('is-waiting');
}

// ── Einführungsspiel ───────────────────────────────────────────────────────
// Zwei Schritte, bevor irgendetwas Inhaltliches zu sehen ist: einmal ganz
// herumdrehen, dann wieder zurück. Der zweite Schritt ist kein Zierrat – er
// zeigt, dass die Drehung in beide Richtungen zählt, und genau davon lebt die
// Station später, wenn man einen Balken durch Zurückdrehen wieder verliert.
//
// Das Telefon in der Mitte dreht sich eins zu eins mit dem Gerät. Es erklärt
// die Achse besser als jede Beschreibung: Wer um die falsche Achse dreht,
// sieht, dass sich nichts rührt.
const TUTORIAL_TURN = 360;   // Drehung je Schritt
const TUTORIAL_SLACK = 20;   // Toleranz, ab der der Rückweg als geschafft gilt

const tutorial = byId('tutorial');

// Beide Schritte stehen von Anfang an nebeneinander; das Skript schaltet nur
// weiter, welcher von beiden der aktive ist.
// Beschriftung und Anweisung stehen als Text unter jedem Rad im Markup; das
// Skript kennt nur noch die Teile, die es bewegt.
const wheels = [
    { box: byId('wheelOne'), fill: byId('wheelFillOne'), phone: byId('phoneOne') },
    { box: byId('wheelTwo'), fill: byId('wheelFillTwo'), phone: byId('phoneTwo') }
];

let isTutorialActive = true;
let tutorialStepIndex = 0;   // 0 = hindrehen, 1 = zurückdrehen
let tutorialRotation = 0;
let tutorialLastBeta = null;

// Der Ring wird über sein Strichmuster gefüllt. Sein Umfang zählt dank
// `pathLength` als hundert Einheiten – der Versatz ist damit schlicht der noch
// fehlende Anteil, und der Radius spielt keine Rolle mehr.
//
// Begrenzt wird, bevor der Anteil in den Versatz geht: Ein negativer Wert
// schöbe das Strichmuster über einen ganzen Umlauf hinaus – der Ring finge
// dann von der anderen Seite wieder an, sich zu füllen. Wer in die falsche
// Richtung dreht, soll aber gar nichts füllen.
function setWheel(wheel, share) {
    const limited = Math.max(0, Math.min(1, share));
    wheel.fill.style.strokeDashoffset = String(100 * (1 - limited));
}

function updateTutorial(beta) {
    // Wie im Spiel: Der erste Wert setzt nur den Bezug, gezählt wird ab dem
    // zweiten.
    if (tutorialLastBeta === null) {
        tutorialLastBeta = beta;
        return;
    }

    const delta = wrapDeg180(beta - tutorialLastBeta);
    tutorialLastBeta = beta;
    turnTutorial(delta);
}

// Die Übung kennt nur noch die Drehung, nicht mehr, woher sie kommt – vom
// Sensor oder von der Maus.
function turnTutorial(delta) {
    tutorialRotation += delta;

    // Das Gerät auf dem Bildschirm macht mit, was das Gerät in der Hand macht –
    // aber nur das des laufenden Schritts.
    const wheel = wheels[tutorialStepIndex];
    // `rotateX` kippt bei positivem Wert die Oberkante vom Betrachter weg –
    // und `beta` wird kleiner, wenn genau das am Gerät passiert. Daher das
    // Minus: Es übersetzt den Sensor in die Anzeige, damit sich beides gleich
    // herum bewegt.
    wheel.phone.style.transform = `rotateX(${(-tutorialRotation).toFixed(1)}deg)`;

    const turned = Math.abs(tutorialRotation);

    // Gezählt wird mit Vorzeichen, nicht dem Betrag: Der Ring wächst nur in
    // der Richtung, nach der gefragt ist – links das Wegkippen, rechts das
    // Zurückdrehen. Wer andersherum dreht, füllt nichts und nimmt sogar
    // wieder weg, was schon da war.
    // Das Telefon dreht sich trotzdem mit, in jede Richtung. Es zeigt, was das
    // Gerät tut; der Ring zeigt, was davon zählt. Stünde es bei der falschen
    // Drehung still, sähe die Grafik kaputt aus statt streng.
    if (tutorialStepIndex === 0) {
        setWheel(wheel, -tutorialRotation / TUTORIAL_TURN);
        if (-tutorialRotation >= TUTORIAL_TURN) advanceTutorial();
        return;
    }

    // Auf die Null zu: Beim Weiterdrehen in die falsche Richtung wächst der
    // Betrag wieder, der Anteil wird negativ und der Ring bleibt leer.
    setWheel(wheel, 1 - (turned - TUTORIAL_SLACK) / TUTORIAL_TURN);
    if (turned <= TUTORIAL_SLACK) finishTutorial();
}

// Der erste Schritt ist geschafft: Sein Ring bleibt voll stehen, der zweite
// wird aktiv.
function advanceTutorial() {
    // Auf genau eine Umdrehung einrasten: Wer über das Ziel hinausdreht,
    // müsste sonst den Überschuss zusätzlich zurückdrehen. Minus, weil die
    // Drehung weg vom Betrachter die zählende Richtung ist.
    tutorialRotation = -TUTORIAL_TURN;
    setWheel(wheels[0], 1);
    wheels[0].box.classList.replace('is-active', 'is-done');

    tutorialStepIndex = 1;
    wheels[1].box.classList.add('is-active');
}

// Geschafft: Die Übung tritt ab, der Einführungstext kommt zum Vorschein.
function finishTutorial() {
    isTutorialActive = false;
    setWheel(wheels[1], 1);
    wheels[1].box.classList.replace('is-active', 'is-done');

    // Beides im selben Moment: Die Übung blendet ab, der Text darunter blendet
    // auf – so gibt es keinen Augenblick, in dem die leere Bühne zu sehen ist.
    setTimeout(() => {
        tutorial.classList.add('is-gone');
        intro.classList.remove('is-waiting');
    }, 900);
}

// Von vorn – auch nach dem Schütteln mitten in der Übung.
function resetTutorial() {
    tutorialStepIndex = 0;
    tutorialRotation = 0;
    tutorialLastBeta = null;

    wheels.forEach((wheel, index) => {
        setWheel(wheel, 0);
        wheel.phone.style.transform = 'rotateX(0deg)';
        wheel.box.classList.remove('is-done', 'is-active');
        if (index === 0) wheel.box.classList.add('is-active');
    });
}

resetTutorial();

// ── Die Objekte der Spielerei ──────────────────────────────────────────────

// Zufall, der bei jedem Aufruf derselbe ist: Die Objekte sollen an ihren
// Plätzen liegen bleiben, auch wenn zwischendurch zurückgedreht wird.
function noise(seed) {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
}

// Mischt eine Liste – bei gleichem `salt` immer gleich.
function shuffled(items, salt) {
    return items
        .map((item, index) => ({ item, key: noise(index * 91 + salt) }))
        .sort((a, b) => a.key - b.key)
        .map(entry => entry.item);
}

const stage = byId('stage');
const sprinkleLayer = byId('sprinkles');
const sprinkles = buildSprinkles();
let shownSprinkles = 0;
let isFinished = false;

// Alle Objekte werden einmal angelegt und danach nur noch ein- und
// ausgeblendet – nichts wird beim Drehen erzeugt oder entfernt.
function buildSprinkles() {
    const total = SPRINKLE_COLUMNS * SPRINKLE_ROWS;
    const items = [];

    for (let slot = 0; slot < total; slot++) {
        const col = slot % SPRINKLE_COLUMNS;
        const row = Math.floor(slot / SPRINKLE_COLUMNS);
        const seed = slot * 37 + 11;

        const xCell = (col + 0.5) / SPRINKLE_COLUMNS;
        const yCell = (row + 0.5) / SPRINKLE_ROWS;
        const x = 0.5 + (xCell - 0.5) * SPRINKLE_OVERSCAN + (noise(seed) - 0.5) * SPRINKLE_JITTER / SPRINKLE_COLUMNS;
        const y = 0.5 + (yCell - 0.5) * SPRINKLE_OVERSCAN + (noise(seed + 0.4) - 0.5) * SPRINKLE_JITTER / SPRINKLE_ROWS;
        const tilt = (noise(seed + 0.8) - 0.5) * 2 * SPRINKLE_TILT;
        const size = SPRINKLE_SIZE[0] + noise(seed + 1.2) * (SPRINKLE_SIZE[1] - SPRINKLE_SIZE[0]);
        const file = SPRINKLE_FILES[Math.floor(noise(seed + 1.6) * SPRINKLE_FILES.length) % SPRINKLE_FILES.length];

        const img = document.createElement('img');
        img.className = 'sprinkle';
        img.src = `${SPRINKLE_BASE}/${file}`;
        img.alt = '';
        img.style.left = `${(x * 100).toFixed(2)}%`;
        img.style.top = `${(y * 100).toFixed(2)}%`;
        img.style.height = `${size.toFixed(1)}vh`;
        img.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`);

        items.push(img);
    }

    // Zwei voneinander unabhängige Reihenfolgen, beide gegen das Raster
    // gemischt:
    // – in welcher das Objekt erscheint. Zelle für Zelle sähe aus wie eine
    //   Tabelle, die sich füllt.
    // – in welcher es liegt. Die Reihenfolge im Dokument entscheidet bei
    //   diesen Größen über jede Überlappung; käme sie aus dem Raster, läge
    //   der Stapel sauber nach Zeilen geordnet und das Durcheinander wäre
    //   keins.
    sprinkleLayer.replaceChildren(...shuffled(items, 3));
    return shuffled(items, 5);
}

// Zeigt die ersten `count` Objekte der Reihenfolge, blendet den Rest aus.
function showSprinkles(count) {
    const limited = Math.max(0, Math.min(count, sprinkles.length));
    if (limited === shownSprinkles) return;

    sprinkles.forEach((item, index) => {
        item.classList.toggle('visible', index < limited);
    });
    shownSprinkles = limited;

    // Mit dem ersten Objekt kommt die zweite Zahl dazu: Das Diagramm endet
    // 2019, die Objekte auf dem Bildschirm meinen aber heute.
    current.classList.toggle('visible', limited > 0);
}

// ── Wie weit die Objekte reichen ───────────────────────────────────────────
// Sie sollen über dem Diagramm liegen und vor der Kennzahl auslaufen. Wo die
// Grenze verläuft, lässt sich nicht in CSS ausdrücken: Diagramm und Kennzahl
// sind zusammen in der Bühne zentriert, ihre Kante hängt also von der
// Fensterbreite ab. Also gemessen und als Variable an die Bühne gegeben.
const FADE_GAP = 20;    // Abstand, den die Objekte vor der Kennzahl halten
const FADE_LENGTH = 190; // Länge des Übergangs von voll zu nichts

function updateSprinkleEdge() {
    const stageLeft = stage.getBoundingClientRect().left;
    const clear = side.getBoundingClientRect().left - stageLeft - FADE_GAP;

    stage.style.setProperty('--sprinkle-clear', `${Math.max(0, clear)}px`);
    stage.style.setProperty('--sprinkle-solid', `${Math.max(0, clear - FADE_LENGTH)}px`);
}

updateSprinkleEdge();
window.addEventListener('resize', updateSprinkleEdge);


// WebSocket-Verbindungen
const connection = initConnectionBadge({ onDisconnect: resetInteractiveState });

// ── Vor allem anderen: das Smartphone verbinden ────────────────────────────
// Dieselbe Aufforderung wie in den Eintragspfaden, aber nur ihre erste Hälfte:
// Die Station rechnet mit der Änderung des Winkels, nicht mit seinem Wert –
// ein Nullpunkt ist also nichts zu setzen, und `waitForStillness: false` lässt
// das Stillhalten weg. Sobald ein Gerät gekoppelt ist, geht das Overlay weg.
const gate = initCalibration({
    waitForStillness: false,
    // Erst wenn das Overlay weg ist, zeigt sich die Übung – sonst blitzt sie
    // im ersten Bild durch, bevor sich der Verbindungscheck darüberlegt.
    onDone: () => tutorial.classList.remove('is-waiting'),
});

// Empfange Sensordaten des Smartphone-Pitchs (Beta) und rechne kumulativ
socket.on('sensorData', (data) => {
    if (gate.isActive()) return;

    const beta = data.beta !== null ? data.beta : 0;

    // Erst die Übung, dann der Text, dann die Station – in dieser Reihenfolge
    // bekommt jede Phase die Drehung, und keine zwei auf einmal.
    if (isTutorialActive) {
        updateTutorial(beta);
        return;
    }

    if (isIntroVisible) return;

    if (lastBeta === null) {
        lastBeta = beta;
        return;
    }

    // Winkeländerung seit dem letzten Frame, über die -180°/180°-Grenze hinweg
    turnTimeline(wrapDeg180(beta - lastBeta));
    lastBeta = beta;
});

// Was aus einer Drehung folgt – gleich, ob sie vom Gerät kommt oder von der
// Maus. Gerechnet wird mit dem absoluten Drehwinkel: Die Richtung entscheidet
// nur, ob es vor oder zurück geht.
function turnTimeline(delta) {
    cumulativeRotation += delta;
    const absRot = Math.abs(cumulativeRotation);

    // Timeline-Achse bis unter den zuletzt erschienenen Balken füllen
    timelineFill.style.width = `${fillPercentFor(absRot)}%`;

    // 1. Stufe: Links freischalten bei ANGLE_BAR_1 (120°)
    if (absRot >= ANGLE_BAR_1 && !isLeftUnlocked) {
        isLeftUnlocked = true;
        barLeft.classList.add('visible');
        labelLeft.classList.add('visible');
    } else if (absRot < ANGLE_BAR_1 && isLeftUnlocked) {
        isLeftUnlocked = false;
        barLeft.classList.remove('visible');
        labelLeft.classList.remove('visible');
    }

    // 2. Stufe: Mitte freischalten bei ANGLE_BAR_2 (240°)
    if (absRot >= ANGLE_BAR_2 && !isMiddleUnlocked) {
        isMiddleUnlocked = true;
        barMiddle.classList.add('visible');
        labelMiddle.classList.add('visible');
    } else if (absRot < ANGLE_BAR_2 && isMiddleUnlocked) {
        isMiddleUnlocked = false;
        barMiddle.classList.remove('visible');
        labelMiddle.classList.remove('visible');
    }

    // 3. Stufe: Rechts freischalten bei ANGLE_BAR_3 (360°)
    if (absRot >= ANGLE_BAR_3 && !isRightUnlocked) {
        isRightUnlocked = true;
        barRight.classList.add('visible');
        labelRight.classList.add('visible');
    } else if (absRot < ANGLE_BAR_3 && isRightUnlocked) {
        isRightUnlocked = false;
        barRight.classList.remove('visible');
        labelRight.classList.remove('visible');
    }

    // 4. Stufe: Wer über die volle Umdrehung hinaus weiterdreht, bekommt die
    // Kennzahl.
    isGrowthShown = absRot >= ANGLE_GROWTH;
    growth.classList.toggle('visible', isGrowthShown);

    // 5. Stufe: Nach einer Pause sprenkelt jedes weitere Stück Drehung ein
    // Objekt auf den Bildschirm. Das erste liegt genau am Ende der Pause,
    // deshalb das +1.
    showSprinkles(Math.floor((absRot - ANGLE_SPRINKLE) / SPRINKLE_STEP) + 1);

    // Die Fortschreibung zählt über dieselbe Strecke hoch.
    updateFuture(absRot);

    // Mit der vollen Fläche ist die Station durch. Die Abschlussmeldung hängt
    // an diesem Punkt und nicht früher: Sie gibt in der Landkarte das
    // Weiterdrehen zur nächsten Station frei, und das darf nicht passieren,
    // solange es hier noch etwas zu holen gibt.
    if (shownSprinkles === sprinkles.length && !isFinished) {
        isFinished = true;
        reportCompletion({ label: 'Produktion bis 2024 durchgedreht' });
    }
}

// Reset-Funktion
function resetTimeline() {
    lastBeta = null;
    cumulativeRotation = 0;
    isLeftUnlocked = false;
    isMiddleUnlocked = false;
    isRightUnlocked = false;
    isGrowthShown = false;

    barLeft.classList.remove('visible');
    barMiddle.classList.remove('visible');
    barRight.classList.remove('visible');

    labelLeft.classList.remove('visible');
    labelMiddle.classList.remove('visible');
    labelRight.classList.remove('visible');

    growth.classList.remove('visible');

    // Der Bildschirm wird wieder leer – auch die Spielerei gehört zum
    // Fortschritt, den das Schütteln zurücknimmt.
    isFinished = false;
    showSprinkles(0);
    updateFuture(0);

    timelineFill.style.width = '0%';
}

// Lokaler Verbindungsverlust-Reset
function resetInteractiveState() {
    resetTimeline();
}

// ── Ohne gekoppeltes Gerät: die Maus ───────────────────────────────────────
// Am Schreibtisch gibt es keine Drehung und kein Schütteln – ein Klick in die
// Fläche übernimmt beides, wie in den Eintragspfaden. Die Abfrage auf
// `hasController` sorgt dafür, dass das im Betrieb nicht greift: Sobald ein
// Smartphone verbunden ist, passiert auf Klicks nichts mehr.
const MOUSE_TURN = 45; // Grad je Klick

stage.addEventListener('click', () => {
    if (connection.hasController()) return;

    if (isTutorialActive) {
        // Im ersten Schritt von sich weg, im zweiten auf die Null zu – also
        // erst minus, dann plus. Minus ist die Richtung, in die `beta` läuft,
        // wenn die Oberkante nach hinten geht; die Anzeige kippt dadurch beim
        // Klicken genauso wie beim Drehen des Geräts.
        turnTutorial(tutorialStepIndex === 0 ? -MOUSE_TURN : MOUSE_TURN);
        return;
    }

    if (isIntroVisible) {
        dismissIntro();
        return;
    }

    turnTimeline(MOUSE_TURN);
});

// Empfange Schüttel-Events: langes Schütteln beendet das Intro bzw. setzt zurück
socket.on('shake', () => {
    if (!longShake.register()) return;

    // Während der Übung setzt Schütteln sie zurück, statt sie zu überspringen:
    // Wer hier schüttelt, ist meist nicht fertig, sondern hat sich verheddert.
    if (isTutorialActive) {
        resetTutorial();
        return;
    }

    if (isIntroVisible) {
        dismissIntro();
        return;
    }

    // Fertig durchgedreht: das Schütteln gehört jetzt dem längeren Rückkehr-
    // Schütteln zur Übersicht (sucher.js/controller_sucher.js) — hier gibt es
    // nichts mehr zurückzusetzen, sonst verschwindet das fertige Bild genau
    // während man aktiv rausschüttelt.
    if (isFinished) return;

    resetTimeline();
});
