const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// Port: gehostet gibt die Plattform ihn über die Umgebung vor; lokal 3000.
const PORT = process.env.PORT || 3000;

// MIME-Types für korrekte Content-Type Header
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
};

// Request-Handler (wird für HTTP und HTTPS genutzt)
function handleRequest(req, res) {
    if (req.url === '/api/config') {
        const protocol = server instanceof https.Server ? 'https' : 'http';
        let localIp = 'localhost';

        // VPN-Tunnel (utun/tun/ppp/tap) liefern selbst eine nicht-interne IPv4-
        // Adresse, sind vom Handy im selben WLAN aber nicht erreichbar — das
        // innere `break` verließ zudem nur die innere Schleife, sodass am Ende
        // ohnehin die letzte gefundene Adresse gewann statt der ersten. Daher
        // zuerst eine echte LAN-Adresse suchen, nur ohne Treffer auf den Tunnel
        // zurückfallen.
        const nets = require('os').networkInterfaces();
        let tunnelIp = null;
        outer:
        for (const [name, iface] of Object.entries(nets)) {
            if (/^(utun|tun|tap|ppp)/.test(name)) {
                for (const net of iface) {
                    if (net.family === 'IPv4' && !net.internal && !tunnelIp) tunnelIp = net.address;
                }
                continue;
            }
            for (const net of iface) {
                if (net.family === 'IPv4' && !net.internal) {
                    localIp = net.address;
                    break outer;
                }
            }
        }
        if (localIp === 'localhost' && tunnelIp) localIp = tunnelIp;

        // Origin für den QR-Code:
        //  1. ausdrücklich gesetzt (PUBLIC_ORIGIN) – z. B. eigene Domain,
        //  2. hinter einem Proxy gehostet (Render & Co. setzen x-forwarded-*):
        //     die öffentliche Adresse aus den Headern,
        //  3. lokal: die LAN-IP, damit das Handy im selben Netz den Rechner erreicht.
        const fwdProto = req.headers['x-forwarded-proto'];
        const fwdHost = req.headers['x-forwarded-host'] || req.headers.host;
        let origin;
        if (process.env.PUBLIC_ORIGIN) {
            origin = process.env.PUBLIC_ORIGIN;
        } else if (fwdProto && fwdHost) {
            origin = `${fwdProto}://${fwdHost}`;
        } else {
            origin = `${protocol}://${localIp}:${PORT}`;
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ip: localIp, port: PORT, protocol, origin }));
        return;
    }

    // Query-String und Anker abschneiden, bevor die Datei aufgelöst wird — sonst
    // sucht der Server eine Datei namens „controller_sucher.html?session=…".
    const pathname = req.url.split('?')[0].split('#')[0];
    // Statische Dateien immer relativ zu diesem Skript auflösen (unabhängig vom Startverzeichnis)
    const urlPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(__dirname, urlPath);
    if (!filePath.startsWith(__dirname + path.sep)) {
        res.writeHead(404); res.end('Not found'); return;
    }

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// ── HTTPS-Server (für iOS Sensor-Zugriff zwingend erforderlich) ──
const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

let server;

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    // Selbst-signiertes Zertifikat vorhanden → HTTPS starten
    const sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
    };
    server = https.createServer(sslOptions, handleRequest);
    console.log('🔒 HTTPS-Modus aktiv');
} else {
    // Fallback auf HTTP (Sensoren funktionieren dann NICHT auf iOS!)
    server = http.createServer(handleRequest);
    console.warn('⚠️  Kein SSL-Zertifikat gefunden – HTTP-Modus (iOS-Sensoren werden NICHT funktionieren!)');
    console.warn('   Erstelle ein Zertifikat mit:');
    console.warn('   mkdir -p src/certs && openssl req -x509 -newkey rsa:2048 -keyout src/certs/key.pem -out src/certs/cert.pem -days 365 -nodes -subj "/CN=localhost"');
}

// WebSocket-Server
const io = new Server(server);

// Speicher für aktive Controller-Verbindungen
const activeControllers = new Set();

// ── Sucher-Sitzungen ───────────────────────────────────────────────────────
// Der Sucher ist das einzige Modul mit Serverzustand: pro Geräte-Paar ein Raum
// mit dem Ablauf-Stand. Damit laufen beliebig viele Paare getrennt (jedes in
// seinem Raum) und ein Reload — egal welcher Seite — holt sich den Stand zurück,
// statt bei null zu beginnen. Nur der Sucher nutzt `customAction`, deshalb lässt
// sich genau dieser Kanal in Räume legen, ohne die übrigen Module zu berühren;
// `sensorData`/`shake` bleiben global, weil die eingebettete Station sie über
// ihre eigene Verbindung global erwartet.
const sucherSessions = new Map();
const SUCHER_TTL_MS = 30 * 60 * 1000;   // verwaiste Sitzung nach 30 min verwerfen

function newSucherState() {
    // currentIndex: nächstes farbiges/aufnehmbares Bild. placed: die Collage.
    // phase: 'sucher' (Boden) oder 'station' (läuft am großen Bildschirm).
    return { currentIndex: 0, phase: 'sucher', activeIndex: -1, placed: [] };
}

function makeSessionId() {
    let id;
    do { id = Math.random().toString(36).slice(2, 8); } while (sucherSessions.has(id));
    return id;
}

function sucherRoom(id) { return 'sucher:' + id; }

function getSession(id, create) {
    let s = sucherSessions.get(id);
    if (!s && create) {
        s = newSucherState();
        s.hostId = null;
        s.controllerId = null;
        s.emptyTimer = null;
        sucherSessions.set(id, s);
    }
    return s;
}

/** Nur den Ablauf-Stand, ohne die internen Socket-Verweise. */
function publicState(s) {
    return { currentIndex: s.currentIndex, phase: s.phase, activeIndex: s.activeIndex, placed: s.placed };
}

/** Wer ist im Raum? Ersetzt controllerStatus für den Sucher, aber raum-lokal. */
function emitSucherStatus(id) {
    const s = sucherSessions.get(id);
    if (!s) return;
    io.to(sucherRoom(id)).emit('sucherStatus', { host: !!s.hostId, controller: !!s.controllerId });
}

/** Verwaiste Sitzung (beide Seiten weg) nach einer Frist verwerfen. */
function scheduleSucherGc(id) {
    const s = sucherSessions.get(id);
    if (!s) return;
    if (s.emptyTimer) clearTimeout(s.emptyTimer);
    if (s.hostId || s.controllerId) { s.emptyTimer = null; return; }
    s.emptyTimer = setTimeout(() => {
        const cur = sucherSessions.get(id);
        if (cur && !cur.hostId && !cur.controllerId) sucherSessions.delete(id);
    }, SUCHER_TTL_MS);
}

/** Ablauf-Stand aus den weitergeleiteten Desktop-Ereignissen fortschreiben. */
function applySucherState(s, data) {
    if (!data) return;
    if (data.type === 'sucherPlaced') {
        s.placed.push({ index: data.index, x: data.x, y: data.y, done: false });
    } else if (data.type === 'sucherReveal') {
        const p = s.placed.find((q) => q.index === data.index);
        if (p) p.revealed = true;
    } else if (data.type === 'sucherEnter') {
        s.phase = 'station';
        s.activeIndex = data.index;
    } else if (data.type === 'sucherAdvance') {
        const p = s.placed.find((q) => q.index === data.index);
        if (p) p.done = true;
        s.currentIndex = data.index + 1;
        s.phase = 'sucher';
        s.activeIndex = -1;
    } else if (data.type === 'sucherReturn') {
        // Abbruch per langem Schütteln: zurück aufs Blatt, aber die Station gilt
        // nicht als durchgespielt (currentIndex/placed bleiben unberührt).
        s.phase = 'sucher';
        s.activeIndex = -1;
    } else if (data.type === 'sucherResetAll') {
        // Reset-Button auf der Übersicht: der gesamte Ablauf beginnt von vorn.
        s.currentIndex = 0;
        s.phase = 'sucher';
        s.activeIndex = -1;
        s.placed = [];
    }
    // sucherAim / sucherReturnProgress u. a. sind flüchtig – nichts zu speichern.
}

io.on('connection', (socket) => {
    console.log('Gerät verbunden:', socket.id);

    // Neuen Client über aktuellen Controller-Status informieren
    socket.emit('controllerStatus', { connected: activeControllers.size > 0 });

    // Client als Controller registrieren
    socket.on('registerController', () => {
        socket.isController = true;
        activeControllers.add(socket.id);
        console.log('📱 Controller registriert:', socket.id);
        io.emit('controllerStatus', { connected: true });
    });

    // Sensordaten vom iPhone empfangen und weiterleiten
    socket.on('sensorData', (data) => {
        socket.broadcast.emit('sensorData', data);
    });

    // Schüttel-Events weiterleiten
    socket.on('shake', (data) => {
        socket.broadcast.emit('shake', data);
    });

    // Kalibrierung weiterleiten: Wer kalibriert, setzt die Ruhelage für alle
    // Geräte – der Controller und die angezeigte Interaktion sollen denselben
    // Nullpunkt kennen. Der Absender bekommt sein eigenes Event nicht zurück.
    socket.on('calibrate', () => {
        socket.broadcast.emit('calibrate');
    });

    // Wisch-/Swipe-Events weiterleiten (Hauptsteuerung weiter/zurück)
    socket.on('swipe', (data) => {
        socket.broadcast.emit('swipe', data);
    });

    // Folien-Wechsel-Feedback weiterleiten (Display → Controller)
    socket.on('slideChange', (data) => {
        socket.broadcast.emit('slideChange', data);
    });

    // ── Sucher: Sitzung beitreten ──────────────────────────────────────────
    // Desktop (host) bringt seine gemerkte id mit oder bekommt eine neue; das
    // Handy (controller) tritt der id aus dem QR-Code bei. Beide bekommen den
    // aktuellen Stand zurück und bauen sich daraus wieder auf (Rehydrate).
    function joinSucher(id, role) {
        const s = getSession(id, true);
        if (role === 'host') s.hostId = socket.id;
        else s.controllerId = socket.id;
        if (s.emptyTimer) { clearTimeout(s.emptyTimer); s.emptyTimer = null; }

        socket.sucherId = id;
        socket.sucherRole = role;
        socket.join(sucherRoom(id));
        socket.emit('sucherJoined', { id, role, state: publicState(s) });
        emitSucherStatus(id);
    }

    socket.on('sucherHost', (data) => {
        const id = (data && data.id && String(data.id).slice(0, 12)) || makeSessionId();
        joinSucher(id, 'host');
    });

    socket.on('sucherJoin', (data) => {
        if (!data || !data.id) return;
        joinSucher(String(data.id).slice(0, 12), 'controller');
    });

    // Custom Actions: für den Sucher raum-lokal (und der Stand wird
    // mitgeschrieben); ungebundene Absender laufen wie bisher global.
    socket.on('customAction', (data) => {
        const id = socket.sucherId;
        const s = id && sucherSessions.get(id);
        if (s) {
            applySucherState(s, data);
            socket.to(sucherRoom(id)).emit('customAction', data);
        } else {
            socket.broadcast.emit('customAction', data);
        }
    });

    socket.on('disconnect', () => {
        console.log('Gerät getrennt:', socket.id);
        if (socket.isController || activeControllers.has(socket.id)) {
            activeControllers.delete(socket.id);
            console.log('📱 Controller getrennt:', socket.id);
            io.emit('controllerStatus', { connected: activeControllers.size > 0 });
        }

        // Sucher: die Rolle freigeben, aber den Ablauf-Stand behalten — ein
        // Reload derselben Seite tritt kurz darauf wieder bei und rehydriert.
        const id = socket.sucherId;
        const s = id && sucherSessions.get(id);
        if (s) {
            if (s.hostId === socket.id) s.hostId = null;
            if (s.controllerId === socket.id) s.controllerId = null;
            emitSucherStatus(id);
            scheduleSucherGc(id);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    const protocol = server instanceof https.Server ? 'https' : 'http';
    console.log(`==================================================`);
    console.log(`🚀 Server läuft auf ${protocol}://localhost:${PORT}`);
    console.log(`🖥️  Auswahlseite (Desktop): ${protocol}://localhost:${PORT}/`);
    console.log(`📱 Bisheriger Controller:  ${protocol}://localhost:${PORT}/controller.html`);
    console.log(`📱 Neuer Controller:       ${protocol}://localhost:${PORT}/controller_new.html`);
    console.log(`==================================================`);

    // Lokale IP-Adresse anzeigen (für iPhone-Zugriff im selben Netzwerk)
    const nets = require('os').networkInterfaces();
    for (const iface of Object.values(nets)) {
        for (const net of iface) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`\n📱 Smartphone-Zugriff im Netzwerk:`);
                console.log(`   - Bisherig: ${protocol}://${net.address}:${PORT}/controller.html`);
                console.log(`   - Neu:      ${protocol}://${net.address}:${PORT}/controller_new.html`);
            }
        }
    }
});
