# Deploy — Sucher (Render)

Dieses Verzeichnis wird von `scripts/build-deploy.sh` erzeugt — nicht von Hand
bearbeiten (außer dieser DEPLOY.md). Es enthält nur den Sucher, die 8 Inhalts-
Stationen und die nötige Logik (Node + Socket.IO).

## Erneuern nach Änderungen an src/
    ./scripts/build-deploy.sh
    cd deploy && git add -A && git commit -m "update" && git push

## Auf Render
New → Web Service → dieses Repo → Language: Node, Build: `npm install`,
Start: `node server.js`, Instance: Starter, Region: Frankfurt.
Die QR-Adresse nimmt der Server automatisch aus dem Host-Header.
