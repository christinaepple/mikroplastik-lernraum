// ═══════════════════════════════════════════════════════════════════════════
//  Sucher (Controller / Smartphone) — durch das Handy in den Boden blicken
//
//  Das Handy ist hier nicht nur Sensor, sondern eigene Oberfläche: weißer
//  Himmel, ein Grid-Boden. Die Lage des Geräts ist die Blickrichtung — flach
//  gehalten schaut man auf den Boden, aufgerichtet zum großen Bildschirm.
//
//  ── Warum Quaternionen ────────────────────────────────────────────────────
//  Die Rohwerte alpha/beta/gamma sind Euler-Winkel (Z-X'-Y''). Diese Zerlegung
//  ist bei beta ≈ ±90° mehrdeutig — genau in der Haltung, in der man auf den
//  großen Bildschirm zielt: alpha und gamma tauschen sich dort gegenseitig aus
//  und springen. Wer aus diesen beiden Winkeln direkt eine Kamera baut, bekommt
//  dort Sprünge und ein Zittern, das sich nicht wegglätten lässt (Gimbal Lock).
//
//  Deshalb wird aus allen drei Winkeln zuerst die vollständige Drehung als
//  Quaternion gebaut. Die ist überall eindeutig und stetig — die Instabilität
//  einzelner Winkel hebt sich dabei gegenseitig auf. Geglättet wird per Slerp
//  über die Zeit (nicht pro Sensor-Ereignis), damit die Bewegung auf jedem
//  Gerät gleich läuft, egal wie schnell seine Sensoren feuern.
//
//  ── Ein Zeiger, zwei Bildschirme ──────────────────────────────────────────
//  Wie eine Maus zwischen zwei Monitoren ist der Sucher immer nur auf einem
//  Gerät. Der große Bildschirm ist ein Fenster im Raum (SCREEN_AZ_HALF ×
//  SCREEN_EL_*): zielt man hinein, springt der Zeiger hinüber und das Handy
//  tritt zurück; senkt man es wieder zum Boden, kommt er zurück.
// ═══════════════════════════════════════════════════════════════════════════

import { socket, registerAsController, createFrameSender } from './lib/socket.js';
import { requestSensorPermission, onOrientation, onShake } from './lib/device-sensors.js';
import { byId } from './lib/dom.js';
import { STATIONEN } from './lib/sucher-stationen.js';
import { createLongShake } from './lib/shake.js';
import {
    qMul, qAxis, qRotate, qSlerp, qFromDeviceOrientation, qFromAxes, headingOf,
} from './lib/quaternion.js';

// ====================================================================
// ANPASSBARE PARAMETER
// ====================================================================
// Kamerahöhe über dem Boden (Welteinheiten ~ Meter)
const CAM_HEIGHT = 1.4;

// Sichtfeld in Grad
const FOV = 72;

// Zeitkonstante der Lage-Glättung in Sekunden. Größer = ruhiger, aber träger.
// Zeitbasiert, damit die Bewegung unabhängig von der Sensorrate gleich läuft.
const ORIENT_TAU = 0.09;

// Der große Bildschirm als Fenster im Raum, von der Startblickrichtung aus:
// Azimut ±SCREEN_AZ_HALF, Höhe von SCREEN_EL_BOTTOM bis SCREEN_EL_TOP (Grad).
// SCREEN_EL_BOTTOM ist die Unterkante — beim Anheben wird sie zuerst
// überschritten, sie bestimmt also, wie früh (bei wie flachem Kippwinkel) der
// Handoff greift: tiefer = früher. Nicht zu tief, sonst gerät sie in den
// Blickbereich der hintersten Bodenbilder (~−47°) und der Zeiger springt schon
// beim Aufnehmen hinüber.
// Bewusst weit gefasst: Je größer das Fenster, desto mehr Kippen braucht dieselbe
// Cursor-Strecke — der Zeiger wird dadurch unempfindlicher und ruhiger. Die
// Unterkante bleibt bei −44 (Bodenbild-Grenze ~−47), die Spanne wächst nach oben.
const SCREEN_AZ_HALF = 55;
const SCREEN_EL_TOP = 42;
const SCREEN_EL_BOTTOM = -44;
// Hysterese des Übergangs, damit der Zeiger an der Kante nicht flackert.
const HANDOFF_MARGIN = 7;

// Aufnehmen: Fadenkreuz-Radius (Bildschirm-px) und Haltezeit. Die Haltezeit
// läuft nur, wenn das Gerät zur Ruhe gekommen ist — sonst füllte sich der Ring
// schon beim Hochziehen zum Bildschirm, weil das Bild dabei durchs Fadenkreuz
// wischt. GRAB_HOLD_MS folgt dem Wert der übrigen Stationen (HOLD_MS 900).
const RETICLE_GRAB_PX = 60;
const GRAB_HOLD_MS = 900;
const GRAB_MAX_SPEED_DPS = 45;

// Ruhe-Signal für den Laptop: so weit darf die Blickrichtung wandern, ohne dass
// das Halten von vorn beginnt. Großzügig — leichtes Wackeln soll nichts
// zurücksetzen. ARM_MOVE_DEG muss nach jeder Aktion erst wieder überschritten
// werden, ehe erneut gehalten werden kann.
const STEADY_DEG = 6;
const ARM_MOVE_DEG = 15;

// Suchbereich: nur der eigene Umkreis, kein Weg durch den Raum. Die Bodenbilder
// (sucher-stationen.js) müssen innerhalb liegen — der weiteste sitzt bei ~1,04.
const SEARCH_RADIUS = 1.4;
const GRID_RANGE = 2;    // von -2 bis +2
const GRID_STEP = 0.5;
const NEAR = 0.05;

// Breite eines liegenden Stationsbildes in Welteinheiten (Tiefe folgt dem
// Seitenverhältnis der Grafik — das Bild liegt flach auf dem Boden).
const PARTICLE_W = 0.45;

// Getragenes Bild: Abstand vor der Kamera in Metern. Daraus ergibt sich seine
// Größe auf dem Schirm ganz von selbst — es ist ein Ding im Raum, kein Symbol.
const CARRY_DIST = 1.05;
// Nachlauf ("Drag"): Trägheit gegen die Bewegung des Geräts, quer zur
// Blickachse in Metern. Unterhalb der Totzone passiert nichts — leichtes
// Wackeln lässt das Bild ruhig liegen.
const DRAG_DEAD_DPS = 14;    // Grad/s, ab hier zieht es
const DRAG_M_PER_DPS = 0.0015;
const DRAG_MAX_M = 0.12;
const CARRY_TAU = 0.18;      // Sekunden, mit denen das Bild nachzieht
// Nach dem Handoff hängt das getragene Bild nicht mehr kamerafest in der Mitte,
// sondern folgt als blasse Vorschau demselben Fensterpunkt wie der Cursor auf
// dem großen Bildschirm — so bewegt es sich dort wie hier. Blass, weil der Blick
// jetzt drüben liegt; dieselbe Zeitkonstante (CARRY_TAU) wie der Desktop.
const CARRY_PREVIEW_ALPHA = 0.22;
// Die Vorschau macht vor allem die Links/rechts-Bewegung mit — die Höhe nur
// gedämpft. Sonst rutschte sie beim Handoff von der Mitte an die untere
// Fensterkante (dort ist aim.y ≈ 1), was als Ruck nach unten störte. 0 = rein
// waagerecht auf halber Höhe, 1 = folgt der Höhe voll.
const CARRY_PREVIEW_Y_FACTOR = 0.2;
// So schnell richtet sich das Blatt beim Aufheben zum Zeiger auf. Aufrecht am
// Zeiger bleibt es beim Hochziehen ganz sichtbar — flach gehalten liefe es zur
// Kante zusammen und der Übergang auf den großen Bildschirm wäre ein Bruch.
const CARRY_TURN_TAU = 0.22;

// Fallen lassen (Schütteln): Papier, kein Stein. Geringe Endgeschwindigkeit,
// seitliches Pendeln und ein Kippen im selben Takt. Es fällt aus der Hand,
// also von dort, wo es gerade hängt — eine Starthöhe gibt es nicht.
const FALL_TERMINAL = 0.55;  // m/s Sinkgeschwindigkeit — ein Blatt sinkt, es stürzt nicht
const FALL_ACCEL = 3.2;      // m/s², bis die Endgeschwindigkeit erreicht ist
const FALL_SWAY_AMP = 0.7;   // m/s seitliches Pendeln
const FALL_SWAY_HZ = 1.15;
const FALL_TILT_DEG = 26;    // Kippwinkel im Pendeltakt
const FALL_ROT_DPS = 45;     // Grad/s Eigendrehung
// So lange braucht das aufrecht gehaltene Blatt, um sich im Fallen flach zu
// legen. Ein losgelassenes Blatt fällt nicht sofort flach — es kippt unterwegs.
const FALL_TURN_TAU = 0.3;

const ACCENT = 'rgb(253, 100, 88)';
// Rückseite der Blätter — vorerst schlicht grellgelb, ohne Motiv.
const BACK_COLOR = '#eaff00';

// Zurück zur Übersicht: langes Schütteln während einer laufenden Station. Wie
// auf der Landkarte (exitShake) eine deutlich längere Geste als die Schüttler
// innerhalb der Stationen — bewusst so lang, dass sie nicht versehentlich fällt.
const RETURN_SHAKE_WINDOW_MS = 2500;
const RETURN_SHAKE_COUNT = 8;
// Während des Schüttelns die Lage an die Station einfrieren: sonst überträgt
// sich das Rütteln auf ihr Bild. So lange nach dem letzten Schüttler bleibt sie
// eingefroren — knapp über dem Abstand zweier Schüttel-Ereignisse.
const SENSOR_FREEZE_MS = 400;
// ====================================================================

const canvas = byId('view');
const ctx = canvas.getContext('2d');
const startEl = byId('start');
const startBtn = byId('startBtn');
const errorMsg = byId('errorMsg');
const hint = byId('hint');
const stationWait = byId('stationWait');
const carryGuide = byId('carryGuide');
const returnProgress = byId('returnProgress');
const returnProgressFill = byId('returnProgressFill');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

let W = 0, H = 0, DPR = 1;

function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

/** Winkel auf -180..180 bringen. */
function normDeg(d) { return ((d + 180) % 360 + 360) % 360 - 180; }

/** Zeitbasierter Glättungsfaktor: unabhängig von der Bildrate. */
function smoothing(dt, tau) { return 1 - Math.exp(-dt / tau); }

/** Bildschirmdrehung des Geräts in Grad. */
function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
        return screen.orientation.angle;
    }
    return typeof window.orientation === 'number' ? window.orientation : 0;
}

/** Gerätelage (Grad) als Quaternion in Weltkoordinaten. */
function qFromDevice(alpha, beta, gamma) {
    return qFromDeviceOrientation(alpha, beta, gamma, screenAngle());
}

// ─────────────────────────────────────────────
// LAGE
// ─────────────────────────────────────────────
let sensorActive = false;
let qTarget = qFromDevice(0, 0, 0);   // zuletzt gemessen
let qCur = qTarget;                   // geglättet
let qHeading = { x: 0, y: 0, z: 0, w: 1 };   // dreht die Welt auf die Startrichtung
let headingSet = false;

// Kamerabasis aus qCur; project() erwartet Rechts, Oben und Blickrichtung.
let focal = 1;
let fwd = { x: 0, y: -1, z: 0 };
let right = { x: 1, y: 0, z: 0 };
let up = { x: 0, y: 0, z: -1 };

// Zielrichtung in Grad: Azimut um die eigene Achse, Höhe über dem Horizont.
let azDeg = 0;
let elDeg = -90;

// Drehgeschwindigkeit um die Kameraachsen (Grad/s, geglättet). Sie treibt den
// Nachlauf des getragenen Bildes und entscheidet, ob das Gerät ruhig genug für
// eine Haltegeste ist.
//
// Nicht aus der Änderung von Azimut/Höhe gerechnet: schaut man senkrecht nach
// unten — die Suchhaltung —, ist der Azimut unbestimmt und rauscht. Die
// Differenz zweier Quaternionen ist dagegen überall wohldefiniert.
let panVel = 0, tiltVel = 0;
let qWorldPrev = null;

function updateOrientation(dt) {
    qCur = qSlerp(qCur, qTarget, smoothing(dt, ORIENT_TAU));

    const q = qMul(qHeading, qCur);
    fwd = qRotate(q, 0, 0, -1);
    right = qRotate(q, 1, 0, 0);
    up = qRotate(q, 0, 1, 0);

    focal = (H / 2) / Math.tan((FOV * DEG) / 2);

    azDeg = Math.atan2(fwd.x, fwd.z) * RAD;
    elDeg = Math.asin(clamp(fwd.y, -1, 1)) * RAD;

    updateRates(q, dt);
}

function updateRates(q, dt) {
    if (!qWorldPrev || dt <= 0) { qWorldPrev = q; return; }

    // Kleine Drehung zwischen zwei Bildern: qd = q · konjugiert(qPrev). Für
    // kleine Winkel ist der Vektorteil die halbe Drehachse mal Winkel.
    const conj = { x: -qWorldPrev.x, y: -qWorldPrev.y, z: -qWorldPrev.z, w: qWorldPrev.w };
    const qd = qMul(q, conj);
    const s = ((qd.w < 0 ? -2 : 2) * RAD) / dt;   // kürzerer Bogen, Grad/s
    const wx = qd.x * s, wy = qd.y * s, wz = qd.z * s;

    const k = smoothing(dt, 0.1);
    panVel = lerp(panVel, wx * up.x + wy * up.y + wz * up.z, k);
    tiltVel = lerp(tiltVel, wx * right.x + wy * right.y + wz * right.z, k);

    qWorldPrev = q;
}

/** Wie schnell schwenkt der Blick gerade (Grad/s)? */
function viewSpeed() { return Math.hypot(panVel, tiltVel); }

// ─────────────────────────────────────────────
// PROJEKTION
// ─────────────────────────────────────────────
// Kamera steht bei (0, CAM_HEIGHT, 0) und blickt entlang fwd.

/** Weltpunkt in Kameraraum (cx rechts, cy oben, cz Tiefe). */
function camSpace(wx, wy, wz) {
    const vx = wx;
    const vy = wy - CAM_HEIGHT;
    const vz = wz;
    return {
        cx: vx * right.x + vy * right.y + vz * right.z,
        cy: vx * up.x + vy * up.y + vz * up.z,
        cz: vx * fwd.x + vy * fwd.y + vz * fwd.z,
    };
}

function project(c) {
    return { x: W / 2 + (c.cx / c.cz) * focal, y: H / 2 - (c.cy / c.cz) * focal };
}

/** Linie zwischen zwei Weltpunkten am Nahfeld beschneiden und zeichnen. */
function drawWorldLine(x0, y0, z0, x1, y1, z1) {
    let a = camSpace(x0, y0, z0);
    let b = camSpace(x1, y1, z1);

    if (a.cz <= NEAR && b.cz <= NEAR) return;

    if (a.cz < NEAR) a = clipToNear(a, b);
    else if (b.cz < NEAR) b = clipToNear(b, a);

    const pa = project(a);
    const pb = project(b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
}

function clipToNear(behind, front) {
    const t = (NEAR - behind.cz) / (front.cz - behind.cz);
    return {
        cx: lerp(behind.cx, front.cx, t),
        cy: lerp(behind.cy, front.cy, t),
        cz: NEAR,
    };
}

// ─────────────────────────────────────────────
// STATIONSBILDER AM BODEN
// ─────────────────────────────────────────────
const stationImgs = STATIONEN.map((s) => {
    const img = new Image();
    img.src = s.img;
    return img;
});

function imgReady(i) {
    const img = stationImgs[i];
    return img && img.complete && img.naturalWidth > 0;
}

// Schwarzweiß-Fassungen: alle Bilder liegen sichtbar am Boden, aber nur das
// nächste (currentIndex) ist farbig. Die übrigen werden entsättigt gezeichnet —
// einmal in ein Offscreen-Canvas umgerechnet, dann als Bildquelle wie das
// Original. Die Transparenz bleibt dabei erhalten, das Motiv bleibt freigestellt.
const stationGray = [];
function graySource(i) {
    if (stationGray[i]) return stationGray[i];
    if (!imgReady(i)) return null;
    try {
        const img = stationImgs[i];
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const data = g.getImageData(0, 0, c.width, c.height);
        const p = data.data;
        for (let k = 0; k < p.length; k += 4) {
            // Wahrgenommene Helligkeit; Alpha (k+3) bleibt unberührt.
            const l = (p[k] * 0.299 + p[k + 1] * 0.587 + p[k + 2] * 0.114) | 0;
            p[k] = p[k + 1] = p[k + 2] = l;
        }
        g.putImageData(data, 0, 0);
        stationGray[i] = c;
        return c;
    } catch (e) {
        return null;   // z. B. ohne 2D-Kontext — dann fällt es auf Farbe zurück
    }
}

// Das nächste noch offene Bild: nur dieses ist farbig und aufnehmbar. Rückt nach
// jeder abgeschlossenen Station eins weiter.
let currentIndex = 0;

// ⚠️ NUR ZUM TESTEN: Hebt die feste Reihenfolge auf — alle Bilder sind farbig und
// aufnehmbar, in beliebiger Reihenfolge. Für den echten Ablauf wieder auf false.
const FREE_ORDER = true;

const particles = [];
let grabbed = null;      // aufgenommenes Bild
let grabHoldStart = 0;
let grabHoldTarget = null;
let grabCandidate = null;

/** Legt das Bild der Station `i` an ihrem Fundort auf den Boden. */
function spawnStation(i) {
    const s = STATIONEN[i];
    if (!s) return false;

    // `deg` zählt im Uhrzeigersinn, also nach rechts — dieselbe Richtung, in
    // die auch der Zeiger läuft. In der Weltbasis heißt das ein negativer Winkel.
    const a = -s.fund.deg * DEG;
    particles.push({
        index: i,
        x: Math.sin(a) * s.fund.dist,
        y: 0,
        z: Math.cos(a) * s.fund.dist,
        // Tatsächliche Lage im Raum als Drehung. Liegend zeigt sie auf die
        // Weltachsen, getragen auf die der Kamera; dazwischen wird per Slerp
        // gedreht. Es liegt mit dem Motiv nach oben und radial nach außen
        // gedreht — dreht man sich zu ihm hin, liest es sich also richtig herum
        // und muss beim Aufheben weder umgedreht noch weit gedreht werden.
        q: flatQ(a, 0),
        rot: a,        // Drehung um die Hochachse (Ziel beim Fallen)
        tilt: 0,       // Neigung im Pendeltakt (Ziel beim Fallen)
        falling: false,
        vy: 0,
        phase: 0,
        swayX: 0,
        swayZ: 0,
        rotSpeed: 0,
        gone: false,
    });
    return true;
}

// Alle Bilder liegen von Anfang an am Boden.
STATIONEN.forEach((_, i) => spawnStation(i));

/**
 * Fallendes Papier.
 *
 * Ein Blatt fällt nicht wie ein Stein: Es erreicht sofort eine geringe
 * Endgeschwindigkeit, pendelt dabei zur Seite und kippt im Takt dieses Pendelns
 * — es rutscht abwechselnd über die eine und die andere Kante ab. Genau diese
 * Kopplung von Seitwärtsdrift und Neigung macht die Bewegung als Papier
 * erkennbar; ein reiner Fall mit Drehung sähe aus wie ein fallendes Brett.
 */
function updateFalling(dt) {
    for (const pt of particles) {
        if (!pt.falling) continue;

        pt.vy = Math.min(pt.vy + FALL_ACCEL * dt, FALL_TERMINAL);
        pt.y -= pt.vy * dt;

        pt.phase += FALL_SWAY_HZ * Math.PI * 2 * dt;
        const sway = Math.sin(pt.phase);
        pt.x += pt.swayX * sway * FALL_SWAY_AMP * dt;
        pt.z += pt.swayZ * sway * FALL_SWAY_AMP * dt;
        pt.tilt = FALL_TILT_DEG * DEG * sway;
        pt.rot += pt.rotSpeed * dt;

        // Aus der Hand kommt es aufrecht; es kippt erst über, während es fällt.
        // Genau das tut ein Blatt, das man loslässt — es fällt nicht sofort
        // flach, es legt sich unterwegs hin.
        pt.q = qSlerp(pt.q, flatQ(pt.rot, pt.tilt), smoothing(dt, FALL_TURN_TAU));

        if (pt.y > 0) continue;

        // Angekommen: flach hinlegen, die Drehung bleibt — es liegt schief da,
        // wie hingefallenes Papier eben liegt.
        pt.y = 0;
        pt.tilt = 0;
        pt.falling = false;
        pt.q = flatQ(pt.rot, 0);

        // Nicht aus dem Suchbereich hinausrutschen, sonst wäre es unauffindbar.
        const d = Math.hypot(pt.x, pt.z);
        const maxD = SEARCH_RADIUS * 0.85;
        if (d > maxD) {
            pt.x *= maxD / d;
            pt.z *= maxD / d;
        }
    }
}

let mode = 'sucher';   // 'sucher' | 'station'
const sendSensorData = createFrameSender('sensorData');
const sendAim = createFrameSender('customAction');

// Zurück-zur-Übersicht-Geste (nur während einer Station).
const returnShake = createLongShake({ windowMs: RETURN_SHAKE_WINDOW_MS, count: RETURN_SHAKE_COUNT });
let lastStationShakeAt = 0;

// ─────────────────────────────────────────────
// ZEIGER-ÜBERGABE
// ─────────────────────────────────────────────
// Der Zeiger ist entweder hier oder drüben. Mit Hysterese, damit er an der
// Kante des Bildschirm-Fensters nicht hin und her springt.
let onScreen = false;

function updateHandoff() {
    const slack = onScreen ? HANDOFF_MARGIN : 0;
    const inside = Math.abs(azDeg) <= SCREEN_AZ_HALF + slack
        && elDeg <= SCREEN_EL_TOP + slack
        && elDeg >= SCREEN_EL_BOTTOM - slack;

    if (inside === onScreen) return;
    onScreen = inside;

    // Beim Wechsel beginnt das Halten von vorn.
    disarm();
}

/**
 * Zielpunkt auf dem großen Bildschirm, 0..1.
 *
 * Das Minus vor azDeg ist nicht kosmetisch: In der Weltbasis sinkt der Azimut,
 * wenn man sich nach rechts dreht. Ohne die Umkehr liefe der Zeiger seitenver-
 * kehrt. So gilt hier dieselbe Richtung wie in den übrigen Stationen, wo ein
 * positives Gamma „rechts" heißt (siehe eintragspfade.js: dGamma < 0 → Links).
 */
function aimPoint() {
    return {
        x: clamp((SCREEN_AZ_HALF - azDeg) / (2 * SCREEN_AZ_HALF), 0, 1),
        y: clamp((SCREEN_EL_TOP - elDeg) / (SCREEN_EL_TOP - SCREEN_EL_BOTTOM), 0, 1),
    };
}

// ─────────────────────────────────────────────
// RUHE-SIGNAL FÜR DEN LAPTOP
// ─────────────────────────────────────────────
// Der Laptop misst die Haltezeit, das Handy meldet nur, ob die Blickrichtung
// gerade ruht. Gemessen wird an der geglätteten Richtung, nicht an Rohwerten —
// leichtes Wackeln fällt damit schon vor der Auswertung weg.
let armed = false;
let armAz = 0, armEl = 0;
let steadyAz = 0, steadyEl = 0;

function disarm() {
    armed = false;
    armAz = azDeg; armEl = elDeg;
    steadyAz = azDeg; steadyEl = elDeg;
}

function updateSteady() {
    if (!armed) {
        const away = Math.abs(normDeg(azDeg - armAz)) > ARM_MOVE_DEG
            || Math.abs(elDeg - armEl) > ARM_MOVE_DEG;
        if (!away) return false;
        armed = true;
        steadyAz = azDeg; steadyEl = elDeg;
    }

    const moved = Math.abs(normDeg(azDeg - steadyAz)) > STEADY_DEG
        || Math.abs(elDeg - steadyEl) > STEADY_DEG;
    if (moved) {
        steadyAz = azDeg; steadyEl = elDeg;
        return false;
    }
    return true;
}

// ─────────────────────────────────────────────
// GETRAGENES BILD (Nachlauf)
// ─────────────────────────────────────────────
// Das getragene Bild ist kein Aufkleber auf dem Schirm, sondern dasselbe
// Objekt im Raum wie vorher am Boden — nur eben in der Hand, ein Stück vor der
// Kamera. Das ist der Grund, warum Aufnehmen und Fallenlassen ohne jeden Sprung
// laufen: Beim Aufheben gleitet es aus seiner Lage am Boden in die Hand, beim
// Loslassen hört die Hand einfach auf, es zu halten — Ort, Größe und Neigung
// stimmen in dem Moment schon.
let carryOffX = 0, carryOffY = 0;   // Nachlauf in Metern, quer zur Blickachse

// Vorschau nach dem Handoff: Bildschirmlage (px), die dem Fensterpunkt folgt.
let previewX = 0, previewY = 0, previewActive = false;

/**
 * Führt die Vorschau des getragenen Bildes nach dem Handoff nach.
 *
 * Auf den Fensterpunkt (aim) gesetzt, folgt sie genau dem Cursor auf dem großen
 * Bildschirm — beide bewegen sich dadurch gleich. Beim Handoff beginnt sie in
 * der Bildmitte, wo das getragene Bild eben noch hing, und gleitet von dort zur
 * Zielstelle; so springt beim Wechsel nichts.
 */
function updatePreview(dt, aim) {
    if (!(grabbed && onScreen)) { previewActive = false; return; }

    const tx = aim.x * W;
    // Die Höhe nur gedämpft um die Mitte, damit nichts nach unten wegrutscht.
    const ty = H / 2 + (aim.y - 0.5) * H * CARRY_PREVIEW_Y_FACTOR;
    if (!previewActive) {
        previewX = W / 2;
        previewY = H / 2;
        previewActive = true;
    }
    const k = smoothing(dt, CARRY_TAU);
    previewX = lerp(previewX, tx, k);
    previewY = lerp(previewY, ty, k);
}

/** Die blasse Vorschau des getragenen Bildes an ihrer Bildschirmlage. */
function drawCarriedPreview() {
    const idx = grabbed.index;
    // Größe wie zuvor im 3D-Raum bei CARRY_DIST — so springt beim Wechsel auch
    // die Größe nicht, nur die Deckkraft nimmt ab.
    const w = (PARTICLE_W / CARRY_DIST) * focal;
    const img = imgReady(idx) ? stationImgs[idx] : null;
    const h = img ? w * (img.naturalHeight / img.naturalWidth) : w;

    ctx.globalAlpha = CARRY_PREVIEW_ALPHA;
    if (img) {
        ctx.drawImage(img, previewX - w / 2, previewY - h / 2, w, h);
    } else {
        ctx.beginPath();
        ctx.arc(previewX, previewY, w / 2, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/** Totzone: kleine Bewegungen zählen gar nicht. */
function deadzone(v, dead) {
    if (v > dead) return v - dead;
    if (v < -dead) return v + dead;
    return 0;
}

function updateCarry(dt) {
    // Das Bild klebt starr am Zeiger: exakt vor der Kamera, kein Nachlauf.
    // Ruhig bleibt es durch die ohnehin geglättete Kamera-Basis (right/up/fwd).
    carryOffX = 0;
    carryOffY = 0;
    grabbed.x = fwd.x * CARRY_DIST;
    grabbed.y = CAM_HEIGHT + fwd.y * CARRY_DIST;
    grabbed.z = fwd.z * CARRY_DIST;

    // Dem Zeiger zugewandt (Breite entlang der Rechts-, Höhe entlang der
    // Hochachse der Kamera), ohne Dreh-Nachlauf.
    grabbed.q = qFromAxes(right, up);

    // Die Fall-Lage von hier aus fortschreiben, damit sie beim Loslassen passt.
    const ux = qRotate(grabbed.q, 1, 0, 0);
    grabbed.tilt = 0;
    grabbed.rot = Math.atan2(-ux.z, ux.x);
}

// ─────────────────────────────────────────────
// ZEICHNEN
// ─────────────────────────────────────────────
let lastFrame = 0;

function render(now) {
    requestAnimationFrame(render);

    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0.016;
    lastFrame = now;

    if (mode !== 'sucher') { setCarryGuide(false); return; }

    // Vor dem ersten Sensorwert steht die Blickrichtung noch nicht fest: die
    // Welt läge in der Ausgangslage und spränge beim ersten Wert an ihren Platz.
    // Lieber einen Moment leer bleiben, als das Bild kurz falsch zu zeigen.
    if (!headingSet) {
        setCarryGuide(false);
        ctx.clearRect(0, 0, W, H);
        return;
    }

    updateOrientation(dt);
    updateHandoff();
    updateFalling(dt);
    if (grabbed) updateCarry(dt);

    // Signifier fürs Handoff: leuchtet, solange ein Bild getragen und noch nicht
    // hinübergegeben wurde — dann ist das Hochkippen die nächste Handlung.
    setCarryGuide(!!grabbed && !onScreen);

    // Der Laptop bekommt Zielpunkt, Traglast und Ruhe-Signal — er führt daraus
    // den Cursor und misst die Haltezeit.
    const aim = aimPoint();
    if (grabbed) updatePreview(dt, aim);
    sendAim({
        type: 'sucherAim',
        x: aim.x,
        y: aim.y,
        onScreen,
        carrying: grabbed ? grabbed.index : -1,
        steady: onScreen ? updateSteady() : false,
    });

    ctx.clearRect(0, 0, W, H);

    // Ist der Zeiger drüben, tritt die Bodenansicht zurück.
    ctx.globalAlpha = onScreen ? 0.18 : 1;

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
    for (let i = -GRID_RANGE; i <= GRID_RANGE + 1e-6; i += GRID_STEP) {
        drawWorldLine(i, 0, -GRID_RANGE, i, 0, GRID_RANGE);
        drawWorldLine(-GRID_RANGE, 0, i, GRID_RANGE, 0, i);
    }

    // Alle Bilder, hinten zuerst — das getragene ist einfach das nächste und
    // landet dadurch von selbst obenauf.
    const drawable = [];
    for (const pt of particles) {
        if (pt.gone) continue;
        // Nach dem Handoff kommt das getragene Bild als Vorschau-Overlay, nicht
        // mehr kamerafest in der Mitte.
        if (onScreen && pt === grabbed) continue;
        const quad = floorQuad(pt);
        if (quad) drawable.push({ pt, quad });
    }
    drawable.sort((a, b) => b.quad.cz - a.quad.cz);

    updateGrab(drawable);

    for (const d of drawable) {
        drawFloorPiece(d.pt);
        if (d.pt === grabCandidate) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = ACCENT;
            ctx.beginPath();
            ctx.arc(d.quad.c.x, d.quad.c.y, d.quad.reach + 10, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    ctx.globalAlpha = 1;

    // Der Sucher ist immer nur auf einem Gerät. Am Boden das Fadenkreuz (das
    // getragene Bild liegt darunter); nach dem Handoff bleibt hier die blasse
    // Vorschau, die dem Bild auf dem großen Bildschirm folgt.
    if (!onScreen) drawReticle();
    else if (grabbed) drawCarriedPreview();
}

/** Halbe Tiefe des liegenden Bildes (die Breite steht in PARTICLE_W). */
function halfDepth(index) {
    const img = imgReady(index) ? stationImgs[index] : null;
    return (PARTICLE_W / 2) * (img ? img.naturalHeight / img.naturalWidth : 1);
}

/**
 * Die beiden Kantenrichtungen eines Bildes als Einheitsvektoren.
 *
 * Ein liegendes Bild hat rot = tilt = 0 und damit die Weltachsen X und Z. Ein
 * fallendes dreht sich um die Hochachse (rot) und kippt um die eigene
 * Breitenachse (tilt) — daraus entsteht das Taumeln von Papier.
 */
function pieceAxes(pt) {
    return { ux: qRotate(pt.q, 1, 0, 0), uz: qRotate(pt.q, 0, 0, 1) };
}

/**
 * Die Lage, die ein liegendes oder fallendes Bild anstrebt: waagerecht, um die
 * Hochachse gedreht (rot) und im Pendeltakt gekippt (tilt).
 */
function flatQ(rot, tilt) {
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // Die Breitenachse zeigt nach −X, damit die Vorderseite nach oben schaut
    // (die Normale ist ux × uz). Mit +X läge das Blatt mit dem Motiv im Boden
    // und müsste sich beim Aufheben erst umdrehen.
    return qFromAxes(
        { x: -cr, y: 0, z: sr },
        { x: sr * ct, y: st, z: cr * ct },
    );
}

/**
 * Die Rückseite: eine glatte Fläche in Grellgelb.
 *
 * Als Vieleck durch die vier projizierten Ecken — anders als beim Motiv braucht
 * es hier keine Streifen, denn eine Gerade im Raum bleibt in der Projektion
 * eine Gerade. Die Form stimmt also exakt.
 */
function drawPieceBack(pt, ux, uz) {
    const hw = PARTICLE_W / 2;
    const hh = halfDepth(pt.index);

    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => camSpace(
        pt.x + a * ux.x * hw + b * uz.x * hh,
        pt.y + a * ux.y * hw + b * uz.y * hh,
        pt.z + a * ux.z * hw + b * uz.z * hh,
    ));
    if (corners.some((c) => c.cz <= NEAR)) return;

    ctx.beginPath();
    corners.forEach((c, i) => {
        const p = project(c);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = BACK_COLOR;
    ctx.fill();
}

/** Normale der Vorderseite — auf welche Seite des Blattes schaut man? */
function pieceNormal(ux, uz) {
    return {
        x: ux.y * uz.z - ux.z * uz.y,
        y: ux.z * uz.x - ux.x * uz.z,
        z: ux.x * uz.y - ux.y * uz.x,
    };
}

/** Lage und Größe des liegenden Bildes auf dem Schirm — fürs Sortieren und Zielen. */
function floorQuad(pt) {
    const hw = PARTICLE_W / 2;
    const hh = halfDepth(pt.index);
    const { ux, uz } = pieceAxes(pt);

    const c = camSpace(pt.x, pt.y, pt.z);
    const ex = camSpace(pt.x + ux.x * hw, pt.y + ux.y * hw, pt.z + ux.z * hw);
    const ez = camSpace(pt.x + uz.x * hh, pt.y + uz.y * hh, pt.z + uz.z * hh);
    if (c.cz <= NEAR || ex.cz <= NEAR || ez.cz <= NEAR) return null;

    const pc = project(c);
    const px = project(ex);
    const pz = project(ez);

    return {
        c: pc,
        cz: c.cz,
        reach: Math.max(
            Math.hypot(px.x - pc.x, px.y - pc.y),
            Math.hypot(pz.x - pc.x, pz.y - pc.y),
        ),
    };
}

/**
 * Das Bild flach auf den Boden legen.
 *
 * Canvas kann nur affin zeichnen, echte Perspektive also nicht in einem Zug.
 * Für eine Fläche auf dem Boden gilt aber: bei gleicher Tiefe ist die Abbildung
 * exakt linear in der Breite — die Verkürzung steckt allein in der Tiefe.
 * Deshalb wird das Bild in schmale Streifen gleicher Tiefe zerlegt; jeder
 * einzelne ist dann praktisch verzerrungsfrei affin, und zusammen ergeben sie
 * die richtige Perspektive. Vorverzerren (Photoshop) hilft hier nicht: die
 * Verzerrung ändert sich mit jeder Kopfbewegung.
 *
 * Die Streifen überlappen minimal (STRIP_OVERLAP), sonst blitzen zwischen
 * ihnen Haarlinien des Untergrunds durch.
 */
const FLOOR_STRIPS = 14;
const STRIP_OVERLAP = 1.04;

function drawFloorPiece(pt) {
    const index = pt.index;

    // Sieht man auf die Rückseite, ist da kein Motiv, sondern schlicht Farbe.
    // Ohne das erschiene beim Taumeln dasselbe Bild spiegelverkehrt — als wäre
    // das Blatt durchsichtig.
    const { ux, uz } = pieceAxes(pt);
    const n = pieceNormal(ux, uz);
    if (n.x * fwd.x + n.y * fwd.y + n.z * fwd.z >= 0) {
        drawPieceBack(pt, ux, uz);
        return;
    }

    if (!imgReady(index)) {
        const quad = floorQuad(pt);
        if (!quad) return;
        ctx.beginPath();
        ctx.arc(quad.c.x, quad.c.y, quad.reach, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.fill();
        return;
    }

    // Nur das nächste Bild farbig; die übrigen entsättigt. Ist die
    // Graustufen-Fassung noch nicht fertig, notfalls farbig statt gar nicht.
    const img = stationImgs[index];
    const src = (FREE_ORDER || index === currentIndex) ? img : (graySource(index) || img);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const hw = PARTICLE_W / 2;
    const hh = halfDepth(index);

    // Ein Punkt der Bildfläche: a quer (−1..1), b längs (−1 nah .. 1 fern).
    const at = (a, b) => camSpace(
        pt.x + a * ux.x * hw + b * uz.x * hh,
        pt.y + a * ux.y * hw + b * uz.y * hh,
        pt.z + a * ux.z * hw + b * uz.z * hh,
    );

    for (let i = 0; i < FLOOR_STRIPS; i++) {
        const v0 = i / FLOOR_STRIPS;
        const v1 = (i + 1) / FLOOR_STRIPS;
        // Bildoberkante liegt hinten: v = 0 ist die ferne Kante.
        const far = 1 - 2 * v0;
        const near = 1 - 2 * v1;

        const a0 = at(-1, far), b0 = at(1, far);
        const a1 = at(-1, near), b1 = at(1, near);
        if (a0.cz <= NEAR || b0.cz <= NEAR || a1.cz <= NEAR || b1.cz <= NEAR) continue;

        const p00 = project(a0), p10 = project(b0);
        const p01 = project(a1), p11 = project(b1);

        // Ursprung auf der fernen Kante, Tiefenachse exakt zur nahen Kante,
        // Breite als Mittel beider Kanten (der Rest des Fehlers ist sub-pixel).
        const ox = (p00.x + p10.x) / 2, oy = (p00.y + p10.y) / 2;
        const nx = (p01.x + p11.x) / 2, ny = (p01.y + p11.y) / 2;
        const ux = ((p10.x - p00.x) + (p11.x - p01.x)) / 4;
        const uy = ((p10.y - p00.y) + (p11.y - p01.y)) / 4;

        ctx.save();
        ctx.transform(ux, uy, nx - ox, ny - oy, ox, oy);
        ctx.drawImage(src, 0, v0 * ih, iw, (v1 - v0) * ih, -1, 0, 2, STRIP_OVERLAP);
        ctx.restore();
    }
}

/** Aufnehmen: ein Bild lange genug ruhig im Fadenkreuz halten. */
function updateGrab(drawable) {
    grabCandidate = null;

    if (grabbed || onScreen) { resetGrabHold(); return; }

    // Erst zur Ruhe kommen. Ohne diese Bedingung lief die Haltezeit schon,
    // während das Bild beim Hochziehen bloß durchs Fadenkreuz wischte.
    if (viewSpeed() > GRAB_MAX_SPEED_DPS) { resetGrabHold(); return; }

    let best = Infinity;
    for (const d of drawable) {
        // Nur das nächste Bild ist aufnehmbar; die schwarzweißen liegen fest.
        if (!FREE_ORDER && d.pt.index !== currentIndex) continue;
        // Was noch fällt, lässt sich nicht aus der Luft greifen.
        if (d.pt.falling) continue;
        const reach = Math.max(RETICLE_GRAB_PX, d.quad.reach);
        const dist = Math.hypot(d.quad.c.x - W / 2, d.quad.c.y - H / 2);
        if (dist < reach && dist < best) { best = dist; grabCandidate = d.pt; }
    }

    if (!grabCandidate) { resetGrabHold(); return; }

    // Wie in den übrigen Stationen (setHoldTarget): die Haltezeit beginnt neu,
    // sobald ein anderes Ziel im Fadenkreuz liegt.
    if (grabHoldTarget !== grabCandidate) {
        grabHoldTarget = grabCandidate;
        grabHoldStart = performance.now();
    }
    if (performance.now() - grabHoldStart < GRAB_HOLD_MS) return;

    grabbed = grabCandidate;
    grabCandidate = null;
    resetGrabHold();
    // Kein Umsetzen nötig: Es liegt bereits an seinem Platz und gleitet von
    // dort in die Hand (updateCarry).
    carryOffX = 0;
    carryOffY = 0;
    disarm();
}

function resetGrabHold() {
    grabHoldStart = 0;
    grabHoldTarget = null;
}

// Hand-Cursor: offen im freien Zustand (bereit zu greifen), geschlossen sobald
// ein Keyvisual gegriffen ist.
const cursorDropImg = new Image();
cursorDropImg.src = '/img/interactionen/einstieg/cursor_drop.png';
const cursorDragImg = new Image();
cursorDragImg.src = '/img/interactionen/einstieg/cursor_drag.png';
const CURSOR_IMG_W = 64;

function drawReticle() {
    const cx = W / 2, cy = H / 2;

    // Gegriffen: geschlossene Hand (drag), sonst offene Hand (drop).
    const img = grabbed ? cursorDragImg : cursorDropImg;
    if (img.complete && img.naturalWidth) {
        const w = CURSOR_IMG_W;
        const h = w * (img.naturalHeight / img.naturalWidth);
        ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    }

    // Halte-Fortschritt beim Aufnehmen, als Ring um die Hand.
    if (grabCandidate) {
        const p = clamp((performance.now() - grabHoldStart) / GRAB_HOLD_MS, 0, 1);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, CURSOR_IMG_W * 0.6, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        ctx.stroke();
    }
}


// ─────────────────────────────────────────────
// HINWEISZEILE
// ─────────────────────────────────────────────
let hintTimer = 0;
function showHint(text, ms) {
    hint.textContent = text;
    hint.style.opacity = '1';
    clearTimeout(hintTimer);
    if (ms) hintTimer = setTimeout(() => { hint.style.opacity = '0'; }, ms);
}

// Schein + Text an der oberen Kante fürs Handoff. Nur umschalten, wenn sich der
// Zustand ändert. Beim Ausblenden wird das Element nach der Blende per display:none
// ganz aus dem Render-Baum genommen — nur so verschwindet auf iOS die
// Verlaufs-Ebene restlos (opacity/visibility allein lassen einen Balken stehen).
let carryGuideOn = false;
let carryGuideHideTimer = 0;
function setCarryGuide(on) {
    if (on === carryGuideOn) return;
    carryGuideOn = on;

    if (on) {
        clearTimeout(carryGuideHideTimer);
        carryGuide.style.display = 'flex';
        void carryGuide.offsetWidth;   // Reflow, damit die Einblende-Transition greift
        carryGuide.classList.add('is-on');
    } else {
        carryGuide.classList.remove('is-on');
        carryGuideHideTimer = setTimeout(() => { carryGuide.style.display = 'none'; }, 400);
    }
}

// ─────────────────────────────────────────────
// SENSORIK
// ─────────────────────────────────────────────
function startSensors() {
    sensorActive = true;

    onOrientation((raw) => {
        if (!sensorActive) return;
        const alpha = raw.alpha ?? 0;
        const beta = raw.beta ?? 0;
        const gamma = raw.gamma ?? 0;

        // Läuft eine Station, ist das Handy nur noch ihr Controller.
        if (mode === 'station') {
            // Während des Zurück-Schüttelns die Lage einfrieren, damit sich das
            // Rütteln nicht auf das Bild der Station überträgt (sonst wackelt es
            // sichtbar). Die Geste ist so von der Lage-Steuerung getrennt.
            if (Date.now() - lastStationShakeAt < SENSOR_FREEZE_MS) return;
            sendSensorData({ alpha: raw.alpha, beta: raw.beta, gamma: raw.gamma });
            return;
        }

        const q = qFromDevice(alpha, beta, gamma);

        // Die Welt einmal auf die Startblickrichtung drehen, damit die Bilder
        // relativ zu einem selbst liegen und nicht nach Himmelsrichtung.
        if (!headingSet) {
            headingSet = true;
            qHeading = qAxis(0, 1, 0, -headingOf(q));
            qCur = q;
            const first = qMul(qHeading, q);
            const f = qRotate(first, 0, 0, -1);
            azDeg = Math.atan2(f.x, f.z) * RAD;
            elDeg = Math.asin(clamp(f.y, -1, 1)) * RAD;
            disarm();
        }

        qTarget = q;
    });

    // Schütteln: während einer Station führt langes Schütteln zurück zur
    // Übersicht; am Boden lässt es ein getragenes Bild wieder fallen.
    onShake((s) => {
        if (mode === 'station') {
            // Die Station bekommt das Schütteln weiter (für ihre eigenen Gesten).
            // Bricht das lange Schütteln die Station ab, wird ohnehin verworfen,
            // was sie in diesem Moment daraus macht.
            socket.volatile.emit('shake', { intensity: s.intensity });
            lastStationShakeAt = Date.now();

            if (returnShake.register()) {
                returnToSucher();
            } else {
                // Fortschritt direkt hier auf dem Handy zeigen — dort, wo
                // geschüttelt wird, statt auf dem großen Bildschirm.
                showReturnProgress(returnShake.share());
            }
            return;
        }
        if (grabbed) release();
    });

    showHint('Dreh dich auf der Stelle und suche den Boden um dich herum ab', 5000);
}

/** Lässt das getragene Bild wirklich fallen — es taumelt zu Boden. */
function release() {
    const pt = grabbed;
    grabbed = null;
    resetGrabHold();
    disarm();
    if (!pt) return;

    // Kein Umsetzen: Das Bild ist schon ein Ding im Raum und hängt genau dort,
    // wo es zu sehen ist. Die Hand hört bloß auf, es zu halten — Ort, Größe und
    // Neigung stimmen in diesem Moment bereits.
    pt.vy = 0;
    pt.falling = true;

    // Der Pendeltakt beginnt bei null, damit Neigung und Seitwärtsdrift bei
    // null anfangen und nicht im ersten Bild aufspringen. Verschieden wird
    // jeder Fall trotzdem: Pendelrichtung und Drehsinn sind zufällig.
    pt.phase = 0;
    const a = Math.random() * Math.PI * 2;
    pt.swayX = Math.cos(a);
    pt.swayZ = Math.sin(a);
    pt.rotSpeed = (Math.random() < 0.5 ? -1 : 1) * FALL_ROT_DPS * DEG;

    showHint('Bild fällt zu Boden', 2500);
}

/**
 * Langes Schütteln bricht eine laufende Station ab und kehrt zur Übersicht
 * zurück. Der Laptop schließt daraufhin den Stationsrahmen; die Station gilt
 * nicht als durchgespielt und bleibt später erneut betretbar.
 */
function returnToSucher() {
    socket.emit('customAction', { type: 'sucherReturn' });
    exitStationToSucher();
    showHint('Zurück zur Übersicht', 2500);
}

/** Zurück in den Sucher-Modus (Boden), ohne selbst eine Meldung zu senden. */
function exitStationToSucher() {
    returnShake.reset();
    mode = 'sucher';
    setStationWait(false);
    lastFrame = 0;
    disarm();
}

// Zustandswechsel der Ansicht — und mit ihm die Farbe der Leisten oben/unten.
// Ohne viewport-fit=cover zeigen die Safe-Area-Streifen die body-Farbe; die
// Safari-Toolbar folgt dem theme-color-Meta. Beide hier zusammen mitgeführt,
// damit die Ränder bei jedem Wechsel zuverlässig mitfärben.
function setChromeColor(hex) {
    // Die Safe-Area-Streifen zeigen den Hintergrund des Wurzelelements (html),
    // nicht den von body — deshalb beide setzen. theme-color färbt die Safari-Leiste.
    document.documentElement.style.background = hex;
    document.body.style.background = hex;
    if (themeColorMeta) themeColorMeta.setAttribute('content', hex);
}

/** Stations-Warteansicht zeigen/verbergen. Die Ansicht ist weiß wie die Übersicht,
 * daher bleiben auch die Ränder weiß. */
function setStationWait(show) {
    stationWait.hidden = !show;
    setChromeColor('#ffffff');
    // Beim Betreten leer, beim Verlassen weg.
    hideReturnProgress();
}

// Fortschritt des Zurück-Schüttelns auf dem Handy. Er erscheint mit dem Schütteln
// und verschwindet von selbst, wenn keine weiteren Schüttler mehr kommen — dann
// war die Geste abgebrochen.
let returnProgressTimer = 0;
function showReturnProgress(share) {
    if (share <= 0) { hideReturnProgress(); return; }
    returnProgress.classList.add('is-on');
    returnProgressFill.style.width = (Math.min(share, 1) * 100) + '%';
    clearTimeout(returnProgressTimer);
    returnProgressTimer = setTimeout(hideReturnProgress, 700);
}

function hideReturnProgress() {
    clearTimeout(returnProgressTimer);
    returnProgress.classList.remove('is-on');
    returnProgressFill.style.width = '0%';
}

// ─────────────────────────────────────────────
// SITZUNG (Pairing + Rehydrate)
// ─────────────────────────────────────────────
// Die id steckt im QR-Code, mit dem diese Seite geöffnet wurde, und bleibt beim
// Reload in der URL erhalten — kein localStorage nötig. Beigetreten wird erst
// beim Start (wie die globale Controller-Anmeldung), damit der QR am Desktop
// stehen bleibt, bis der Sucher wirklich läuft.
const sessionId = new URLSearchParams(location.search).get('session');
let started = false;

function joinSession() {
    if (sessionId) socket.emit('sucherJoin', { id: sessionId });
}
socket.on('connect', () => { if (started) joinSession(); });

// Den Ablauf-Stand vom Server übernehmen: welches Bild dran ist, welche schon
// abgelegt (und damit vom Boden verschwunden) sind, und ob gerade eine Station
// läuft. So macht ein Reload dort weiter, wo es war.
socket.on('sucherJoined', (data) => {
    const state = data && data.state;
    if (!state) return;

    currentIndex = state.currentIndex;
    const goneSet = new Set(state.placed.map((p) => p.index));
    for (const pt of particles) pt.gone = goneSet.has(pt.index);

    grabbed = null;
    resetGrabHold();
    disarm();
    returnShake.reset();

    if (state.phase === 'station') {
        mode = 'station';
        setStationWait(true);
    } else {
        mode = 'sucher';
        setStationWait(false);
    }
});

// ─────────────────────────────────────────────
// MELDUNGEN VOM LAPTOP
// ─────────────────────────────────────────────
socket.on('customAction', (data) => {
    if (!data) return;

    if (data.type === 'sucherPlaced' && grabbed) {
        // Das Bild ist auf der Collage abgelegt — vom Boden verschwindet es.
        // Weitergerückt wird erst, wenn die Station durchlaufen ist (sucherAdvance).
        grabbed.gone = true;
        grabbed = null;
        disarm();
        return;
    }

    if (data.type === 'sucherEnter') {
        mode = 'station';
        returnShake.reset();
        setStationWait(true);
        hint.style.opacity = '0';
        return;
    }

    // Der Laptop beendet eine Wiederholung: zurück auf den Boden, ohne dass der
    // Ablauf weiterrückt (das käme als sucherAdvance).
    if (data.type === 'sucherReturn' && mode === 'station') {
        exitStationToSucher();
        showHint('Zurück zur Übersicht', 2500);
        return;
    }

    if (data.type === 'sucherAdvance' && mode === 'station') {
        mode = 'sucher';
        setStationWait(false);
        lastFrame = 0;
        disarm();
        returnShake.reset();

        // Die Station ist durch: das nächste Bild wird farbig und aufnehmbar.
        currentIndex += 1;
        showHint(currentIndex < STATIONEN.length
            ? 'Weiter suchen — das nächste Bild ist jetzt farbig'
            : 'Geschafft — alle Bilder gesammelt', 4000);
    }
});

// ─────────────────────────────────────────────
// START (iOS-Freigabe aus der Nutzergeste)
// ─────────────────────────────────────────────
const FAILURE = {
    unsupported: 'DeviceOrientation wird nicht unterstützt.',
    denied: 'Zugriff verweigert.',
    'insecure-context': '🔒 HTTPS erforderlich für Sensor-Zugriff auf iOS.',
};

startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    errorMsg.style.display = 'none';

    const result = await requestSensorPermission();
    if (!result.granted) {
        errorMsg.textContent = FAILURE[result.reason] || 'Fehler: ' + (result.error && result.error.message);
        errorMsg.style.display = 'block';
        startBtn.disabled = false;
        return;
    }

    startEl.style.display = 'none';
    started = true;
    // Global anmelden (für die eingebettete Station, die sensorData/controllerStatus
    // global erwartet) und der Sucher-Sitzung beitreten (Pairing + Rehydrate).
    registerAsController();
    joinSession();
    startSensors();
});

// ── Init ──
requestAnimationFrame(render);
