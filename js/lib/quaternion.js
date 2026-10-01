// ═══════════════════════════════════════════════════════════════════════════
//  Quaternionen für die Gerätelage
//
//  Die Rohwerte alpha/beta/gamma des Browsers sind Euler-Winkel (Z-X'-Y'').
//  Diese Zerlegung ist bei beta ≈ ±90° mehrdeutig: alpha und gamma tauschen
//  sich dort gegenseitig aus und springen — der bekannte Gimbal Lock. Wer aus
//  zwei dieser Winkel direkt eine Kamera baut, bekommt in dieser Haltung
//  Sprünge und ein Zittern, das sich nicht wegglätten lässt.
//
//  Die Drehung als Ganzes ist dagegen überall eindeutig und stetig: Die
//  Instabilität der einzelnen Winkel hebt sich auf, sobald man alle drei
//  gemeinsam in ein Quaternion umrechnet. Deshalb geht hier alles über
//  Quaternionen — inklusive der Glättung (Slerp), die dadurch nie springt.
//
//  Konvention wie üblich (x, y, z, w), Welt mit +Y nach oben, Blickrichtung
//  entlang −Z.
// ═══════════════════════════════════════════════════════════════════════════

const DEG = Math.PI / 180;

/** Produkt zweier Drehungen: erst b, dann a. */
export function qMul(a, b) {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

export function qNorm(q) {
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Drehung um eine (normierte) Achse. */
export function qAxis(ax, ay, az, rad) {
    const h = rad / 2, s = Math.sin(h);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
}

/** Euler-Winkel in der Reihenfolge YXZ — so meldet der Browser die Gerätelage. */
export function qFromEulerYXZ(x, y, z) {
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    return {
        x: s1 * c2 * c3 + c1 * s2 * s3,
        y: c1 * s2 * c3 - s1 * c2 * s3,
        z: c1 * c2 * s3 - s1 * s2 * c3,
        w: c1 * c2 * c3 + s1 * s2 * s3,
    };
}

/** Einen Vektor mit dem Quaternion drehen. */
export function qRotate(q, vx, vy, vz) {
    const ix = q.w * vx + q.y * vz - q.z * vy;
    const iy = q.w * vy + q.z * vx - q.x * vz;
    const iz = q.w * vz + q.x * vy - q.y * vx;
    const iw = -q.x * vx - q.y * vy - q.z * vz;
    return {
        x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
        y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
        z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    };
}

/**
 * Kugelige Interpolation über den kürzeren Weg.
 *
 * Der eigentliche Gewinn: Egal wie weit zwei Lagen auseinanderliegen, dazwischen
 * liegt immer ein stetiger Weg. Eine Glättung über Winkel kann dagegen an der
 * ±180°-Grenze oder im Gimbal Lock springen.
 */
export function qSlerp(a, b, t) {
    let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;

    // q und −q meinen dieselbe Drehung; so wird stets der kürzere Bogen genommen.
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }

    // Fast deckungsgleich: linear reicht und vermeidet die Division durch sin(0).
    if (cos > 0.9995) {
        return qNorm({
            x: a.x + (bx - a.x) * t,
            y: a.y + (by - a.y) * t,
            z: a.z + (bz - a.z) * t,
            w: a.w + (bw - a.w) * t,
        });
    }

    const theta = Math.acos(cos);
    const s = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / s;
    const wb = Math.sin(t * theta) / s;
    return {
        x: a.x * wa + bx * wb,
        y: a.y * wa + by * wb,
        z: a.z * wa + bz * wb,
        w: a.w * wa + bw * wb,
    };
}

// Blick aus der Rückseite des Geräts: ein flach gehaltenes Handy schaut nach
// unten auf den Boden. Ohne diese Drehung schaute die Kamera durch das Display
// nach oben.
const Q_BACK = qAxis(-1, 0, 0, Math.PI / 2);

/**
 * Gerätelage als Drehung in Weltkoordinaten.
 *
 * @param {number} alpha Kompassdrehung in Grad
 * @param {number} beta  Kippen vor/zurück in Grad
 * @param {number} gamma Neigen zur Seite in Grad
 * @param {number} screenDeg Bildschirmdrehung (screen.orientation.angle)
 */
export function qFromDeviceOrientation(alpha, beta, gamma, screenDeg = 0) {
    const q = qFromEulerYXZ(beta * DEG, alpha * DEG, -gamma * DEG);
    const withBack = qMul(q, Q_BACK);
    return qNorm(qMul(withBack, qAxis(0, 0, 1, -screenDeg * DEG)));
}

/**
 * Die Drehung, die ein Objekt in die gegebene Lage bringt.
 *
 * `ux` und `uz` müssen senkrecht aufeinander stehen und normiert sein; die
 * dritte Achse ergibt sich daraus. Gebraucht wird das, um eine Lage in ein
 * Quaternion zu übersetzen und dann per Slerp dorthin zu drehen — zwei
 * Richtungsvektoren einzeln zu überblenden würde bei gegenläufigen Lagen durch
 * den Nullpunkt laufen und umschnappen.
 */
export function qFromAxes(ux, uz) {
    // Rechtshändige Basis vervollständigen: Y = Z × X
    const uy = {
        x: uz.y * ux.z - uz.z * ux.y,
        y: uz.z * ux.x - uz.x * ux.z,
        z: uz.x * ux.y - uz.y * ux.x,
    };

    const m00 = ux.x, m10 = ux.y, m20 = ux.z;
    const m01 = uy.x, m11 = uy.y, m21 = uy.z;
    const m02 = uz.x, m12 = uz.y, m22 = uz.z;
    const tr = m00 + m11 + m22;

    // Der jeweils größte Nenner wird gewählt, damit die Wurzel nicht gegen null
    // geht — sonst verlöre das Ergebnis bei halben Drehungen seine Genauigkeit.
    if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        return { x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s, w: 0.25 * s };
    }
    if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        return { x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s, w: (m21 - m12) / s };
    }
    if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        return { x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s, w: (m02 - m20) / s };
    }
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return { x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s, w: (m10 - m01) / s };
}

/**
 * Blickrichtung als Kompasswinkel (Radiant, um die Welt-Y-Achse).
 *
 * Bei flach gehaltenem Gerät zeigt die Blickachse senkrecht nach unten und
 * taugt nicht als Richtung. Dann trägt die Hochachse des Geräts die Richtung —
 * und zwar genau die, in die der Blick beim Aufrichten wandert. So bleibt der
 * Wert in jeder Haltung brauchbar.
 */
export function headingOf(q) {
    const f = qRotate(q, 0, 0, -1);
    const u = qRotate(q, 0, 1, 0);
    return Math.hypot(f.x, f.z) >= Math.hypot(u.x, u.z)
        ? Math.atan2(f.x, f.z)
        : Math.atan2(u.x, u.z);
}
