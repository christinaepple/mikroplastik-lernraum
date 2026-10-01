// ═══════════════════════════════════════════════════════════════════════════
//  Eintragspfade (Inhalte) — vier Bildecken durch Neigen und Kippen wählen
//  Die Teilbilder liegen deckungsgleich übereinander und ergeben zusammen ein
//  Gesamtbild; die Mitte gehört zu keiner Auswahl. Die gewählte Ecke zeigt
//  statt ihres Grundbilds ihr Overlay, die übrigen bleiben stehen.
//
//  Gehandelt wird auf gehaltene Haltungen, nicht auf Bewegungen: Wer eine Ecke
//  hält, rastet in sie ein – dann bleibt nur noch ihr Overlay stehen und der
//  Text dazu erscheint. Wer das Gerät wieder gerade hält, kommt ebenso zurück.
//  Beide Wege dauern gleich lang und zeigen denselben Fortschritt; das Halten
//  trennt so das Umsehen vom Nachlesen, ohne dafür eine weitere Bewegung zu
//  verlangen (dieselbe Geste wie im Quiz, js/interactions/neigen.js).
//
//  Das Spiel zum Weg eines Objekts steht als eigene Station daneben:
//  interactions/inhalte/eintragspfade-2.html
// ═══════════════════════════════════════════════════════════════════════════

import { socket, shareCalibration } from '../../lib/socket.js';
import { initConnectionBadge } from '../../lib/connection.js';
import { Baseline, clamp, createJumpFilter } from '../../lib/angles.js';
import { reportCompletion } from '../../lib/completion.js';
import { createLongShake } from '../../lib/shake.js';
import { initCalibration } from '../../lib/calibration.js';
import { byId } from '../../lib/dom.js';

const calBtn = byId('calBtn');
const stage = byId('stage');
const idle = byId('idle');

const areas = {
    obenLinks: byId('areaObenLinks'),
    obenRechts: byId('areaObenRechts'),
    untenLinks: byId('areaUntenLinks'),
    untenRechts: byId('areaUntenRechts')
};

// Neigung, ab der ein Bereich ausgewählt ist – für jede Achse getrennt.
//
// Die Werte stammen aus dem Quiz (js/interactions/neigen.js) und sind bewusst
// verschieden: Zur Seite neigt man das Gerät weit, nach vorn kippt man es nur
// wenig. Eine gemeinsame Schwelle für beides macht genau das Kippen zäh.
const SELECT_GAMMA = 22;
const SELECT_BETA = 16;

// Anteil der Schwelle, bis zu dem eine getroffene Auswahl stehen bleibt. Ohne
// diesen Abstand flackert sie an der Schwelle bei jeder kleinen Handbewegung.
const RELEASE_RATIO = 0.65;

// Ab wo eine Haltung als „gerade“ gilt – ebenfalls als Anteil der Schwellen,
// aber auf beide Achsen zugleich bezogen.
//
// Bei 0,85 sind das rund 19° zur Seite und 14° beim Kippen — großzügig, und
// zwar mit Absicht: Der Balken soll kurz nachdem die Collage wieder
// durchscheint anlaufen, nicht erst in der letzten Handbreit. Das Ausblenden
// des Textes hat die Bewegung dann ohnehin schon angekündigt, und wer nicht
// zurückwill, sieht den Balken früh genug, um wieder wegzukippen.
const CENTER_RATIO = 0.85;

// Ab welcher Annäherung an die Waagerechte die Collage wieder hereinkommt.
//
// Der Verlauf beginnt bei der vollen Eckenneigung und ist erst deutlich
// jenseits des Balkenstarts ausgereizt. Beides ist bewusst entkoppelt: Wäre
// das Ende des Verlaufs zugleich der Start des Balkens, käme die Collage
// vollständig zurück, bevor überhaupt etwas läuft — man sähe die Vorschau
// nicht mehr als Vorschau.
const PREVIEW_FROM = 1;
const PREVIEW_TO = 0.5;

// Wie weit die Collage allein durch die Neigung zurückkommt. Der Rest gehört
// dem Halten – und zwar der größere Teil: Das Zusammensetzen des Gesamtbilds
// ist die Rückmeldung auf das Halten, nicht bloß dessen Zugabe. Läge die
// Vorschau höher, bliebe fürs Halten kaum sichtbare Veränderung übrig.
const PREVIEW_MAX = 0.45;

// Und ab wo sie wieder aufhört zu gelten. Ohne diesen Abstand fällt die
// Haltung beim ruhigen Geradehalten dauernd über die Grenze und zurück –
// jedes Mal beginnt das Halten von vorn, und der Balken kommt über seinen
// Vorlauf nie hinaus. Man hält dann gerade und sieht trotzdem nichts.
//
// Mit dem großzügigeren Einstieg wandert auch dieser Wert mit: Abbrechen soll
// eine Neigung, die erkennbar wieder wegführt, nicht schon das Nachgeben der
// Hand.
const CENTER_RELEASE_RATIO = 1;

// ── Hinweis bei Inaktivität ────────────────────────────────────────────────
// Nur für den Fall, dass jemand im geöffneten Text nicht weiterweiß. Er
// erscheint erst, wenn eine Weile keine Bewegung mehr ankommt, und
// verschwindet mit der ersten wieder.
//
// Die Wartezeit ist deutlich länger als im Modul „3 Bereiche“ (dort 8 s):
// Hier wird gelesen, und wer liest, hält das Gerät ruhig. Ein früher Hinweis
// wäre keine Hilfe, sondern eine Unterstellung.
const IDLE_DELAY = 25000;

// Grad, ab denen eine Lageänderung als Bewegung zählt. Der Sensorstrom läuft
// auch beim ruhig gehaltenen Gerät weiter, die Ereignisse allein sagen also
// nichts; das Rauschen liegt deutlich unter dieser Schwelle.
const IDLE_MOTION = 4;

// Halten bis zum Einrasten. Der Fade beginnt direkt beim Erreichen einer Ecke,
// damit die Auswahl sofort eine sichtbare Rückmeldung gibt.
const HOLD_DELAY = 500;
const HOLD_DURATION = 1000;

// Wartezeit, bis die Schüttelbewegung abgeklungen ist – erst danach wird der
// Nullpunkt neu gesetzt.
const SETTLE_DELAY = 600;


// Der Nullpunkt entsteht beim ersten Sensorwert; die Kopfzeile setzt ihn neu.
const gammaBase = new Baseline({ wrap: false });
const betaBase = new Baseline({ wrap: false });

// Gegen die Sprünge beim Neigen zur Seite: Nahe der Senkrechten schlägt der
// Rohwert von gamma um, und die Auswahl sprang dann in die gegenüberliegende
// Ecke. Solche Werte werden verworfen, statt sie als Bewegung zu nehmen.
const gammaJump = createJumpFilter();
const betaJump = createJumpFilter();

// Kurze Sperre nach dem Laden: Wer die Station durch Kippen betritt, bringt
// diese Bewegung noch mit – sie soll nicht sofort als Auswahl gelten und vor
// allem nicht den Nullpunkt auf die Kippbewegung setzen.
const READY_DELAY = 500;
let inputReady = false;
setTimeout(() => { inputReady = true; }, READY_DELAY);

// Ausgewertet wird nicht die Bewegung, sondern die gehaltene Haltung: eine
// der vier Ecken oder die Mitte. Beide führen über dasselbe Halten weiter –
// die Ecke in den Text hinein, die Mitte wieder heraus.
let pose = null;             // 'mitte', Name einer Ecke oder null (noch keine)
let shownArea = null;        // hervorgehobene Ecke
let focusedArea = null;      // Ecke, deren Text offen ist

const seen = new Set();      // welche Bereiche schon eingerastet waren
let isReported = false;

let holdTimeout = null;      // Vorlauf, bevor der Fortschritt überhaupt läuft
let holdFrame = null;
let holdStart = null;
let isReturnHold = false;    // laeuft gerade das Halten zurueck zur Uebersicht

let idleTimer = null;
let lastAngles = null;       // letzte Lage, die als Bewegung gezählt hat
let shownReturn = 0;         // wie weit die Collage gerade zurückgeholt ist

const connection = initConnectionBadge();

function calibrate() {
    gammaBase.reset(); // der nächste Sensorwert setzt den Nullpunkt neu
    betaBase.reset();
    gammaJump.reset(); // sonst gälte die neue Haltung selbst als Sprung
    betaJump.reset();
    calBtn.style.backgroundColor = '#f1f5f9';
    calBtn.textContent = '✅ Kalibriert';
    setTimeout(() => {
        calBtn.style.backgroundColor = '';
        calBtn.textContent = 'Mitte kalibrieren';
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

// Die Kalibrierung steht vor der Station: Sie hängt sich in die Bühne, bittet
// ohne Controller um die Verbindung und setzt die Mitte, sobald das Gerät einen
// Moment still liegt. Solange sie läuft, bleibt das Neigen wirkungslos.
const calibration = initCalibration({
    onCalibrate: calibrateEverywhere,
    onDone: showLehre,
    parent: byId('stage') // in der Bühne, damit die Kopfzeile erreichbar bleibt
});


socket.on('sensorData', (data) => {
    // Während der Sperre gar nichts auswerten – auch die Nullpunkte werden
    // erst danach gesetzt, also aus einer ruhigen Haltung heraus.
    if (!inputReady) return;

    // Vor allem anderen steht die Kalibrierung.
    if (calibration.isActive()) return;

    const gamma = data.gamma !== null ? data.gamma : 0;
    const beta = data.beta !== null ? data.beta : 0;

    // Sprünge des Lagesensors verwerfen, bevor sie irgendwo ankommen – sonst
    // schlägt die Auswahl schon beim weiten Neigen zur Seite in die andere
    // Ecke um, und der Inaktivitäts-Hinweis zählte den Sprung als Bewegung.
    if (gammaJump.check(gamma) || betaJump.check(beta)) return;

    // Vor dem Inhalt steht das Einführungsspiel: Dasselbe Neigen führt dort
    // einen Übungszeiger in die vier Ecken.
    if (isLehreVisible) {
        moveLehreCursor(gammaBase.delta(gamma), betaBase.delta(beta));
        return;
    }

    // Solange die Tafel steht, wird gelesen, nicht ausgewählt.
    if (isIntroVisible) return;

    noteMotion(beta, gamma);

    evaluateSelection(gammaBase.delta(gamma), betaBase.delta(beta));
});



// Bewegung heißt Lageänderung, nicht eingehendes Ereignis.
function noteMotion(beta, gamma) {
    if (lastAngles
        && Math.abs(beta - lastAngles.beta) < IDLE_MOTION
        && Math.abs(gamma - lastAngles.gamma) < IDLE_MOTION) {
        return;
    }

    lastAngles = { beta, gamma };
    resetIdle();
}

// Blendet den Hinweis aus und stellt die Uhr zurück. Sie läuft nur, solange
// ein Text offen ist – sonst gibt es nichts zu erklären.
function resetIdle() {
    idle.classList.remove('is-visible');
    clearTimeout(idleTimer);
    if (!focusedArea) return;

    idleTimer = setTimeout(() => idle.classList.add('is-visible'), IDLE_DELAY);
}

/**
 * In welche Ecke das Gerät zeigt. Die seitliche Neigung entscheidet über
 * links/rechts, das Kippen über oben/unten – von sich weg (beta wird kleiner)
 * ist oben, zu sich hin unten.
 */
function areaFor(dGamma, dBeta) {
    const level = dBeta < 0 ? 'oben' : 'unten';
    const side = dGamma < 0 ? 'Links' : 'Rechts';
    return level + side;
}

function evaluateSelection(dGamma, dBeta) {
    // Beide Achsen werden an ihrer eigenen Schwelle gemessen: Zur Seite neigt
    // man das Gerät weit, nach vorn oder hinten kippt man es nur wenig.
    const ratioSide = Math.abs(dGamma) / SELECT_GAMMA;
    const ratioLevel = Math.abs(dBeta) / SELECT_BETA;

    // Für eine Ecke müssen beide Achsen ausschlagen – deshalb die kleinere
    // der beiden. Eine reine Seitwärtsneigung liegt zwischen zwei Ecken, und
    // welche davon gälte, entschiede dann das Rauschen der Ruhelage.
    const reach = Math.min(ratioSide, ratioLevel);
    const rest = Math.max(ratioSide, ratioLevel);
    const corner = areaFor(dGamma, dBeta);

    showReturn(rest);

    if (reach >= 1) {
        setPose(corner);
        return;
    }

    // „Gerade“ heißt: beide Achsen nahe der Ruhelage. Entscheidend ist hier
    // die größere der beiden – wer das Gerät kräftig zur Seite neigt, hält es
    // nicht gerade, auch wenn die andere Achse ruhig liegt. Genau daran lag
    // es, dass der Rückweg schon bei schräg gehaltenem Gerät ansprang.
    if (rest < CENTER_RATIO) {
        setPose('mitte');
        return;
    }

    // Beide Haltungen überstehen ein bisschen Wackeln, sonst käme keine von
    // ihnen je bis zum Ende: die angefangene Ecke ein kurzes Abrutschen, das
    // Geradehalten die Unruhe der Hand.
    if (pose === corner && reach >= RELEASE_RATIO) return;
    if (pose === 'mitte' && rest < CENTER_RELEASE_RATIO) return;

    // Alles andere ist keine Haltung, sondern nur die Hand. Was offen ist,
    // bleibt offen – ein laufender Fortschritt hört hier aber auf.
    setPose(null);
}

/**
 * Übernimmt eine neue Haltung und setzt an, was aus ihr folgen kann.
 *
 * Gehandelt wird nie sofort: Jede Haltung muss erst gehalten werden. Das
 * gilt in beide Richtungen – die Ecke führt in den Text hinein, die Mitte
 * wieder heraus.
 */
function setPose(next) {
    if (next === pose) return;
    pose = next;

    // Jeder Haltungswechsel verwirft den laufenden Fortschritt, sonst zählte
    // die Zeit der vorigen Haltung weiter.
    stopHold();

    // Keine der beiden Haltungen: Der Fortschritt ist damit schon abgebrochen,
    // sonst ändert sich nichts. Der offene Text bleibt stehen – das ist der
    // Zustand, in dem gelesen wird.
    if (next === null) return;

    if (next === 'mitte') {
        // Ohne offenen Text verschwindet die Hervorhebung sofort – hier ist
        // nichts zu bestätigen. Ist einer offen, führt das Geradehalten
        // wieder heraus.
        if (focusedArea) startHold();
        else showArea(null);
    } else {
        // Eine andere Ecke verlässt den offenen Text: Wer dorthin neigt, will
        // nicht zurück, sondern weiter.
        if (focusedArea && focusedArea !== next) clearFocus();

        showArea(next);
        if (focusedArea !== next) startHold();
    }
}

/**
 * Holt die Collage anteilig zurück, während sich das Gerät der Waagerechten
 * nähert — aber nur, solange ein Text offen ist.
 *
 * Gesetzt wird eine CSS-Variable statt einzelner Deckkräfte: Welche Ebenen
 * daran hängen, entscheidet das Stylesheet, und die Regel dafür steht dort
 * ohnehin schon.
 */
function showReturn(rest) {
    // Sobald das Halten läuft, gehört der Wert ihm: Die Vorschau friert dort
    // ein, wo sie steht, und von da an setzt der Fortschritt das Bild zusammen.
    // Ohne das schriebe der Sensorstrom bei jeder Regung dazwischen.
    if (isReturnHold) return;

    const naehe = focusedArea
        ? clamp((PREVIEW_FROM - rest) / (PREVIEW_FROM - PREVIEW_TO), 0, 1)
        : 0;

    setZurueck(naehe * PREVIEW_MAX);
}

/**
 * Schreibt, wie weit das Gesamtbild zurück ist – von 0 (nur der Text) bis 1
 * (die Collage steht wieder).
 *
 * An dieser einen Zahl hängt die ganze Rückkehr: Die Collage blendet mit ihr
 * herein, Umriss und Text blenden gegenläufig weg (siehe die Regeln zu
 * `--zurueck` im Stil). Deshalb braucht das Zurückgehen keine eigene Anzeige –
 * die Bewegung selbst ist die Rückmeldung, und es ist nur eine.
 */
function setZurueck(wert) {
    // Der Sensorstrom läuft mit rund 60 Ereignissen je Sekunde; ohne diese
    // Schwelle schriebe jedes davon in den Stil, auch im Stillstand.
    if (Math.abs(wert - shownReturn) < 0.01) return;

    shownReturn = wert;
    stage.style.setProperty('--zurueck', wert.toFixed(3));
}

function showArea(area) {
    if (area === shownArea) return;

    shownArea = area;
    Object.entries(areas).forEach(([name, el]) => {
        el.classList.toggle('is-active', name === area);
    });
}

// ── Halten ─────────────────────────────────────────────────────────────────

function startHold() {
    // Nur die Auswahl blendet sofort über. Das Geradehalten behält seinen
    // Vorlauf, damit die Übersicht beim Lesen nicht versehentlich zurückgeht.
    if (pose === 'mitte') holdTimeout = setTimeout(beginHold, HOLD_DELAY);
    else beginHold();
}

function beginHold() {
    holdStart = Date.now();

    if (pose === 'mitte') {
        isReturnHold = true;
    } else {
        setHoldFade(0);
    }

    holdFrame = requestAnimationFrame(tickHold);
}

/** Blendet das Bild einer Ecke mit dem Haltefortschritt in ihren Sketch. */
function setHoldFade(progress) {
    if (!pose || pose === 'mitte' || !areas[pose]) return;
    areas[pose].style.setProperty('--selection-progress', progress.toFixed(3));
}

/** Nimmt eine abgebrochene Auswahlvorschau zurück. */
function clearHoldFade() {
    Object.values(areas).forEach((area) => {
        area.style.removeProperty('--selection-progress');
    });
}


// Der Fortschritt läuft in einer eigenen Frame-Schleife und nicht im
// Sensorstrom: Der kommt ungleichmäßig an, der Ring liefe entsprechend
// ruckelig – und beim ruhig gehaltenen Gerät bliebe er ganz stehen.
function tickHold() {
    const linearProgress = clamp((Date.now() - holdStart) / HOLD_DURATION, 0, 1);
    // Nur der Auswahl-Fade reagiert am Anfang etwas schneller, ohne den
    // Zeitpunkt des Einrastens vorzuziehen. Der Rückweg bleibt unverändert.
    const progress = pose === 'mitte'
        ? linearProgress
        : 1 - Math.pow(1 - linearProgress, 1.35);

    // Zurück zur Übersicht: Das Halten setzt das Gesamtbild zusammen und trägt
    // zugleich den Text hinaus – beides an derselben Zahl.
    if (pose === 'mitte') setZurueck(PREVIEW_MAX + (1 - PREVIEW_MAX) * progress);
    else setHoldFade(progress);

    if (progress < 1) {
        holdFrame = requestAnimationFrame(tickHold);
        return;
    }

    finishHold();
}

// Die gehaltene Haltung ist bestätigt: Aus einer Ecke wird ihr Text, aus der
// Mitte der Weg zurück zum Gesamtbild.
function finishHold() {
    holdFrame = null;
    isReturnHold = false;

    if (pose === 'mitte') {
        clearFocus();
        showArea(null);
    } else {
        setHoldFade(1);
        focusedArea = pose;
        stage.classList.add('is-focused');
        markSeen(pose);
    }

    // Ab hier kann ein Hinweis fällig werden – oder eben nicht mehr.
    resetIdle();
}

// Bricht nur den Fortschritt ab; was bereits offen ist, bleibt es.
function stopHold() {
    clearTimeout(holdTimeout);
    holdTimeout = null;

    if (holdFrame) cancelAnimationFrame(holdFrame);
    holdFrame = null;

    // Abgebrochen: Die Vorschau gehört wieder der Neigung und findet mit dem
    // nächsten Sensorwert von selbst zurück.
    isReturnHold = false;
    clearHoldFade();
}

function clearFocus() {
    focusedArea = null;
    stage.classList.remove('is-focused');
    showReturn(PREVIEW_FROM); // ohne offenen Text ergibt das null
    resetIdle();
}

// ── Klick-Fallback ──────────────────────────────────────────────────────────
// Öffnet den Text einer Ecke unmittelbar – der Klick nimmt den Weg über das
// Halten nicht und wechselt aus einem offenen Text direkt in den nächsten.
function openArea(name) {
    if (!areas[name]) return;
    stopHold();
    pose = name;
    showArea(name);
    setHoldFade(1);
    focusedArea = name;
    stage.classList.add('is-focused');
    setZurueck(0);
    markSeen(name);
    resetIdle();
}

// Zurück zur Übersicht, wie am Ende des Geradehaltens.
function returnToOverview() {
    stopHold();
    pose = 'mitte';
    clearFocus();
    showArea(null);
}

// ── Abschluss ──────────────────────────────────────────────────────────────

// Gesehen hat einen Pfad, wer seinen Text offen hatte – das bloße Anstreifen
// im Vorbeineigen zählt dafür nicht.
function markSeen(area) {
    seen.add(area);
    if (seen.size < Object.keys(areas).length || isReported) return;

    isReported = true;
    reportCompletion({ label: 'Alle vier Eintragspfade gesehen' });
}


// ═══════════════════════════════════════════════════════════════════════════
//  Einführungsspiel — die Geste einmal ausführen, bevor der Inhalt kommt
//
//  Es steht zwischen Kalibrierung und Station und verlangt genau das, worum es
//  hier später geht: in jede der vier Ecken neigen. Wer das getan hat, hat die
//  Bedienung verstanden, ohne dass sie erklärt werden müsste.
//
//  Die Punkte liegen nicht irgendwo in den Ecken, sondern genau auf den
//  Neigungen, bei denen die Auswahl später auslöst (SELECT_GAMMA/SELECT_BETA).
//  Das Üben trifft damit dieselbe Bewegung, die danach zählt.
// ═══════════════════════════════════════════════════════════════════════════

const lehre = byId('lehre');
const lehreCanvas = byId('lehreCanvas');
const lctx = lehreCanvas.getContext('2d');
const lehreText = byId('lehreText');

const LEHRE_RANGE_X = SELECT_GAMMA;
const LEHRE_RANGE_Y = SELECT_BETA;

const LEHRE_PAD = 92;

// Wackeln, und Zeiger zieht Neigung nur gedämpft nach
const LEHRE_DEAD_ZONE = 2.5;
const LEHRE_SMOOTHING = 0.08;
const LEHRE_DOT = 46;

const LEHRE_RING_WEIT = 150;   // Außendurchmesser am Anfang
const LEHRE_RING_STRICH = 3;   // und seine Strichstärke dort

// Pause nach Erfolg
const LEHRE_HOLD = 900;
const LEHRE_FADE = 600;

const LEHRE_ECKEN = [
    { id: 'obenLinks', gamma: -SELECT_GAMMA, beta: -SELECT_BETA },
    { id: 'obenRechts', gamma: SELECT_GAMMA, beta: -SELECT_BETA },
    { id: 'untenRechts', gamma: SELECT_GAMMA, beta: SELECT_BETA },
    { id: 'untenLinks', gamma: -SELECT_GAMMA, beta: SELECT_BETA }
];

// Mitte halten
const LEHRE_MITTE = { id: 'mitte', gamma: 0, beta: 0 };

const LEHRE_TEXT_ECKEN = 'neige in jede Ecke und halte sie kurz';
const LEHRE_TEXT_MITTE = 'gehe in die Mitte, um fortzufahren';

const punktBild = new Image();
punktBild.src = '/img/interactionen/eintragspfade/punkt.png';

let isLehreVisible = true;

// Tafel zwischen Übung und Inhalt: Sie steht erst nach dem Einführungsspiel
// und geht durch Schütteln weg – dieselbe Sprache wie in den anderen
// Stationen.
const intro = byId('intro');
const introShake = createLongShake();
let isIntroVisible = false;
let lehreW = 0;
let lehreH = 0;
let lehreTargetX = 0;
let lehreTargetY = 0;
let lehreCursorX = 0;
let lehreCursorY = 0;
let lehreCursorPlaced = false;
let lehreFrame = null;
const lehreErreicht = new Set();

// Welche Ecke gerade gehalten wird und seit wann
// gleiche Zeiten wie in der Station (HOLD_DELAY, HOLD_DURATION) 
let lehreHoldId = null;
let lehreHoldStart = 0;
let lehreFertig = false;

function sizeLehreCanvas() {
    const rect = lehreCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    lehreW = rect.width;
    lehreH = rect.height;
    lehreCanvas.width = rect.width * dpr;
    lehreCanvas.height = rect.height * dpr;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Rechnet eine Neigung in einen Punkt auf der Fläche um. */
function lehrePos(gamma, beta) {
    const g = clamp(gamma, -LEHRE_RANGE_X, LEHRE_RANGE_X);
    const b = clamp(beta, -LEHRE_RANGE_Y, LEHRE_RANGE_Y);

    return {
        x: LEHRE_PAD + ((g + LEHRE_RANGE_X) / (2 * LEHRE_RANGE_X)) * (lehreW - 2 * LEHRE_PAD),
        y: LEHRE_PAD + ((b + LEHRE_RANGE_Y) / (2 * LEHRE_RANGE_Y)) * (lehreH - 2 * LEHRE_PAD)
    };
}


function lehreEntzerrt(wert, bereich) {
    const betrag = Math.abs(wert);
    if (betrag <= LEHRE_DEAD_ZONE) return 0;

    const gedehnt = (betrag - LEHRE_DEAD_ZONE) / (bereich - LEHRE_DEAD_ZONE) * bereich;
    return Math.sign(wert) * gedehnt;
}

function moveLehreCursor(dGamma, dBeta) {
    const ziel = lehrePos(
        lehreEntzerrt(dGamma, LEHRE_RANGE_X),
        lehreEntzerrt(dBeta, LEHRE_RANGE_Y)
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

function lehreTilt() {
    if (!lehreW || !lehreH) return { gamma: 0, beta: 0 };

    const breite = lehreW - 2 * LEHRE_PAD;
    const hoehe = lehreH - 2 * LEHRE_PAD;

    return {
        gamma: ((lehreCursorX - LEHRE_PAD) / breite) * 2 * LEHRE_RANGE_X - LEHRE_RANGE_X,
        beta: ((lehreCursorY - LEHRE_PAD) / hoehe) * 2 * LEHRE_RANGE_Y - LEHRE_RANGE_Y
    };
}


function lehreIstBeiMitte() {
    return lehreErreicht.size === LEHRE_ECKEN.length;
}

/**
 * Das Ziel, in dem die Neigung gerade steht – eine offene Ecke, die Mitte, oder
 * null.
 *
 * Geprüft wird mit denselben Regeln wie in der Station (`evaluateSelection`):
 * Für eine Ecke müssen beide Achsen ihre Schwelle erreichen, und die kleinere
 * von beiden entscheidet; für die Mitte muss die größere unter CENTER_RATIO
 * liegen. Ein Abstand in Bildpunkten täte das nicht – ein Kreis um den Punkt
 * ragt zur Mitte hin über die Schwellen hinaus, und die Übung löste dadurch
 * früher aus als der Inhalt danach.
 */
function lehreZielUnterZeiger() {
    const { gamma, beta } = lehreTilt();
    const ratioSide = Math.abs(gamma) / SELECT_GAMMA;
    const ratioLevel = Math.abs(beta) / SELECT_BETA;

    if (lehreIstBeiMitte()) {
        const rest = Math.max(ratioSide, ratioLevel);
        const schwelle = lehreHoldId === 'mitte' ? CENTER_RELEASE_RATIO : CENTER_RATIO;
        return rest < schwelle ? LEHRE_MITTE : null;
    }

    const ecke = LEHRE_ECKEN.find(e => e.id === areaFor(gamma, beta));
    if (!ecke || lehreErreicht.has(ecke.id)) return null;

    const reach = Math.min(ratioSide, ratioLevel);

    // Eine angefangene Ecke übersteht ein bisschen Wackeln
    const schwelle = ecke.id === lehreHoldId ? RELEASE_RATIO : 1;
    return reach >= schwelle ? ecke : null;
}


function lehreHoldProgress() {
    if (!lehreHoldId) return 0;

    const seither = Date.now() - lehreHoldStart - HOLD_DELAY;
    return clamp(seither / HOLD_DURATION, 0, 1);
}

function checkLehreEcken() {
    if (lehreFertig) return;

    const ziel = lehreZielUnterZeiger();

    // Halten beginnt von vorn
    if (!ziel) {
        lehreHoldId = null;
        return;
    }

    if (ziel.id !== lehreHoldId) {
        lehreHoldId = ziel.id;
        lehreHoldStart = Date.now();
        return;
    }

    if (lehreHoldProgress() < 1) return;

    // Eingeloggt.
    lehreHoldId = null;

    if (ziel.id === 'mitte') {
        lehreFertig = true;
        setTimeout(endLehre, LEHRE_HOLD);
        return;
    }

    lehreErreicht.add(ziel.id);
    if (lehreIstBeiMitte()) lehreText.textContent = LEHRE_TEXT_MITTE;
}

/**
 * Zeichnet einen Punkt des Einführungsspiels – Ecke wie Mitte, damit beide
 * dieselbe Sprache sprechen.
 *
 * @param {{x: number, y: number}} pos
 * @param {boolean} erreicht schon eingeloggt
 * @param {number} progress Fortschritt des Haltens, 0 wenn nicht gehalten
 */
function drawLehrePunkt(pos, erreicht, progress) {
    if (!erreicht && progress === 0) {
        const phase = (Date.now() % 1500) / 1500;
        lctx.beginPath();
        lctx.arc(pos.x, pos.y, 14 + phase * 34, 0, Math.PI * 2);
        lctx.strokeStyle = `rgba(252, 101, 91, ${0.6 * (1 - phase)})`;
        lctx.lineWidth = 2 + 5 * (1 - phase);
        lctx.stroke();
    }

    if (progress > 0) {
        const aussen = LEHRE_RING_WEIT + (LEHRE_DOT - LEHRE_RING_WEIT) * progress;
        const strich = LEHRE_RING_STRICH + (LEHRE_DOT / 2 - LEHRE_RING_STRICH) * progress;

        lctx.beginPath();
        lctx.arc(pos.x, pos.y, (aussen - strich) / 2, 0, Math.PI * 2);
        lctx.strokeStyle = `rgba(252, 101, 91, ${0.45 + 0.55 * progress})`;
        lctx.lineWidth = strich;
        lctx.stroke();
    }

    lctx.save();
    if (erreicht) lctx.globalAlpha = 0.3;

    if (punktBild.complete) {
        lctx.drawImage(punktBild, pos.x - LEHRE_DOT / 2, pos.y - LEHRE_DOT / 2, LEHRE_DOT, LEHRE_DOT);
    } else {
        lctx.beginPath();
        lctx.arc(pos.x, pos.y, LEHRE_DOT / 2, 0, Math.PI * 2);
        lctx.fillStyle = '#fc655b';
        lctx.fill();
    }

    lctx.restore();
}

function drawLehre() {
    lctx.clearRect(0, 0, lehreW, lehreH);

    LEHRE_ECKEN.forEach(ecke => {
        const erreicht = lehreErreicht.has(ecke.id);
        const progress = ecke.id === lehreHoldId ? lehreHoldProgress() : 0;
        drawLehrePunkt(lehrePos(ecke.gamma, ecke.beta), erreicht, progress);
    });

    // Die Mitte kommt erst dazu, wenn alle Ecken gewesen sind – vorher wäre sie
    // ein Ziel, das noch nichts bedeutet.
    if (lehreIstBeiMitte()) {
        const progress = lehreHoldId === 'mitte' ? lehreHoldProgress() : 0;
        drawLehrePunkt(lehrePos(0, 0), lehreFertig, progress);
    }

    // Der Zeiger: ein schwarzer Punkt mit weichem Hof, wie im Einführungsspiel
    // der zweiten Station.
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
    if (!isLehreVisible) { lehreFrame = null; return; }

    lehreCursorX += (lehreTargetX - lehreCursorX) * LEHRE_SMOOTHING;
    lehreCursorY += (lehreTargetY - lehreCursorY) * LEHRE_SMOOTHING;

    if (Math.abs(lehreTargetX - lehreCursorX) < 0.5) lehreCursorX = lehreTargetX;
    if (Math.abs(lehreTargetY - lehreCursorY) < 0.5) lehreCursorY = lehreTargetY;

    checkLehreEcken();
    drawLehre();

    lehreFrame = requestAnimationFrame(lehreLoop);
}

function endLehre() {
    if (!isLehreVisible) return;

    lehre.classList.add('is-gone');

    // Erst wenn abgeblendet ist, tritt die Tafel an ihre Stelle. Die Station
    // nimmt die Neigung weiterhin nicht entgegen – erst nach der Tafel.
    setTimeout(() => {
        isLehreVisible = false;
        lehre.remove();
        showIntro();
    }, LEHRE_FADE);
}

function showLehre() {
    lehre.classList.add('is-shown');
}

function showIntro() {
    isIntroVisible = true;
    intro.classList.remove('is-gone');
}

function dismissIntro() {
    if (!isIntroVisible) return;

    isIntroVisible = false;
    // Erst jetzt darf die Collage unter dem ausblendenden Intro erscheinen.
    stage.classList.remove('is-covered');
    intro.classList.add('is-gone');

    // Nach dem Schütteln liegt das Gerät neu in der Hand: Der Nullpunkt wird
    // erst gesetzt, wenn die Bewegung abgeklungen ist.
    setTimeout(() => {
        gammaBase.reset();
        betaBase.reset();
        gammaJump.reset();
        betaJump.reset();
        resetIdle();
    }, SETTLE_DELAY);
}

socket.on('shake', () => {
    if (!inputReady || calibration.isActive()) return;
    if (!isIntroVisible) return;

    if (introShake.register()) dismissIntro();
});

// Ein Klick führt an Übung und Tafel vorbei – ohne Rücksicht darauf, ob ein
// Gerät gekoppelt ist. Beim Einrichten hängt oft eines dran, und dann wäre
// gerade der Weg zum Inhalt versperrt. An der Station gibt es keine Maus.
lehre.addEventListener('click', () => {
    if (isLehreVisible) endLehre();
});

intro.addEventListener('click', dismissIntro);

// Ohne gekoppeltes Smartphone lassen sich die vier Bereiche auch anklicken:
// Ein Klick in eine Ecke öffnet ihren Text, ein Klick in dieselbe Ecke führt
// zurück zur Übersicht, ein Klick in eine andere wechselt direkt hinüber. Nur
// fürs Einrichten am Desktop – hängt ein Controller dran, wird geneigt. Klicks
// auf eine Quellenmarke bleiben hier aus (die stoppt die Propagation selbst),
// Übung und Tafel haben ihre eigenen Klick-Handler.
stage.addEventListener('click', (event) => {
    if (connection.hasController()) return;
    if (stage.classList.contains('is-covered')) return;
    if (isLehreVisible || isIntroVisible) return;
    if (event.target.closest('.lehre') || event.target.closest('.intro')) return;

    const rect = stage.getBoundingClientRect();
    const side = event.clientX - rect.left < rect.width / 2 ? 'Links' : 'Rechts';
    const level = event.clientY - rect.top < rect.height / 2 ? 'oben' : 'unten';
    const name = level + side;

    if (focusedArea === name) returnToOverview();
    else openArea(name);
});


// Ohne gekoppeltes Smartphone folgt der Zeiger der Maus
lehre.addEventListener('mousemove', (event) => {
    if (connection.hasController()) return;

    const rect = lehreCanvas.getBoundingClientRect();
    lehreTargetX = event.clientX - rect.left;
    lehreTargetY = event.clientY - rect.top;

    if (!lehreCursorPlaced) {
        lehreCursorX = lehreTargetX;
        lehreCursorY = lehreTargetY;
        lehreCursorPlaced = true;
    }
});

window.addEventListener('resize', sizeLehreCanvas);
lehreText.textContent = LEHRE_TEXT_ECKEN;
sizeLehreCanvas();
lehreCursorX = lehreW / 2;
lehreCursorY = lehreH / 2;
lehreTargetX = lehreW / 2;
lehreTargetY = lehreH / 2;
lehreFrame = requestAnimationFrame(lehreLoop);
