# Jedi Schatten

Node.js, keine Abhängigkeiten. Start: `node server.js` (Port aus `PORT`).

## Render
1. Alle Dateien dieses Ordners in das GitHub-Repo, direkt in die Wurzel (Dockerfile, server.js, package.json, public/ ...).
2. Render -> New -> Web Service -> Repo wählen.
3. Language/Runtime: **Node**, Build Command: leer oder `npm install`, Start Command: `node server.js`.
   (Alternativ Docker: das mitgelieferte Dockerfile wird dann gefunden.)
4. Optional unter Environment: `OWNER_PASSWORD` = dein eigenes Passwort (überschreibt das Standardpasswort).

## Login
Haupt-Owner: Benutzer `owner`. Passwort ändern unter "Konto".
Rollen: Schatten (nur lesen) < Phantom (Personen, Berichte, Operationen starten) < Spektral Rat (alle Inhalte inkl. Karte, Operationen verwalten) < Schatten Leitung (zusätzlich Konten verwalten).
Schatten-Leitungs-Konten legt nur das Haupt-Owner-Konto an und verwaltet sie auch allein.

## Neue Konten
Beim Anlegen erzeugt die Seite ein Passwort (einmalig sichtbar, mit Kopieren-Knopf). Bei der ersten Anmeldung muss der Nutzer ein eigenes wählen: mindestens 5 Zeichen mit Buchstaben und Zahlen. "Neues Passwort erzeugen" in der Kontenliste setzt ein Konto zurück.

## Dauerhafter Speicher (wichtig)
Render Free hat ein flüchtiges Dateisystem und schläft nach ca. 15 Minuten ohne Besuch ein. Beim nächsten Start sind alle Änderungen weg.
Kostenlose Lösung: Upstash Redis (upstash.com, Konto ohne Kreditkarte).
1. Upstash -> Create Database (Redis), Region EU -> Reiter "REST API".
2. Die Werte "UPSTASH_REDIS_REST_URL" und "UPSTASH_REDIS_REST_TOKEN" in Render unter Environment eintragen.
3. Speichern, Render startet neu. Im Log steht "Dauerspeicher aktiv", unter Konto "Speicher: dauerhaft".
Alternative: bezahlte Persistent Disk und `DATA_DIR` auf deren Pfad setzen.

## Berichte
Berichte, Orders und Dokumente schreibt man selbst (ab Phantom). Geheimhaltung: Offen = alle, Intern = ab Phantom, Vertraulich und Geheim = ab Spektral Rat.
Eigene Berichte bearbeiten/löschen; fremde nur Spektral Rat und Schatten Leitung.

## Operationen
Starten ab Phantom (Name und Einsatzgebiet frei wählbar). Umbenennen, vorantreiben, abbrechen, archivieren: ab Spektral Rat.

## Anpassung (ab Spektral Rat)
Unter "Konto" lassen sich Ränge, Labels (Status: Republik, KUS, Neutral, Dunkle Machtpräsenz, mit Farbe und "Bedrohung"-Markierung) und Berichtsarten ändern. Umbenennen zieht alle bestehenden Einträge mit. Entfernen geht nur, wenn nichts mehr damit verknüpft ist.

## Notfall (UMBRA)
Spektral Rat und Schatten Leitung können das Notfallprotokoll auslösen und beenden. Solange es aktiv ist, sind alle Konten unterhalb des Spektral Rats gesperrt (Sperrbildschirm, der Server liefert keine Daten). Die Seite öffnet sich bei Ende von selbst wieder.
