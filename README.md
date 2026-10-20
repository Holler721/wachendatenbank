# Jedi Shadow Network

Node.js, keine Abhängigkeiten. Start: `node server.js` (Port aus `PORT`).

## Render
1. Alle Dateien dieses Ordners in das GitHub-Repo, direkt in die Wurzel (Dockerfile, server.js, package.json, public/ ...).
2. Render -> New -> Web Service -> Repo wählen.
3. Language/Runtime: **Node**, Build Command: leer oder `npm install`, Start Command: `node server.js`.
   (Alternativ Docker: das mitgelieferte Dockerfile wird dann gefunden.)
4. Optional unter Environment: `OWNER_PASSWORD` = dein eigenes Passwort (überschreibt das Standardpasswort).

## Login
Benutzer: `owner`. Passwort ändern unter "Konto".
Rollen: Betrachter < Agent (Personen) < Editor (Karte) < Owner (Konten).

## Wichtig
Render Free hat ein flüchtiges Dateisystem: angelegte Konten, Personen und Karten-Änderungen gehen bei Neustart/Deploy verloren.
Der Owner bleibt bestehen. Für Dauerhaftigkeit: Persistent Disk und `DATA_DIR` darauf setzen.
