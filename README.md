# Schatten Datenbank

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
Unter "Konto" lassen sich Ränge, Labels (Zugehörigkeit: Republik, KUS, Neutral, Dunkle Machtpräsenz, mit Farbe und "Bedrohung"-Markierung) und Berichtsarten ändern. Umbenennen zieht alle bestehenden Einträge mit. Entfernen geht nur, wenn nichts mehr damit verknüpft ist.

## Notfall (UMBRA)
Spektral Rat und Schatten Leitung können das Notfallprotokoll auslösen und beenden. Solange es aktiv ist, sind alle Konten unterhalb des Spektral Rats gesperrt (Sperrbildschirm, der Server liefert keine Daten). Die Seite öffnet sich bei Ende von selbst wieder.

## Akten bei Personen
Im Personen-Register zeigt jede Person unten ihre Akten (neueste oben). Jede Akte hat Titel und freien Text. Anlegen ab dem Recht „Schreiben“; eigene Akten bearbeiten/löschen, fremde nur mit „Verwalten“.

## Gruppen und Rechte (Schatten Leitung)
Unter „Konto“ → „Gruppen und Rechte“ legt die Schatten Leitung pro Gruppe einzeln fest: Personen, Akten, Berichte (inkl. Anhänge), Operationen starten, Operationen steuern, Karte, Fremde Inhalte ändern, Anpassung, Notfall, Offen lesen, Intern lesen, Vertraulich lesen, Logs. Mit „Offen lesen“ legst du fest, wer Berichte der Stufe „Offen“ sehen darf (bestehende Gruppen behalten es zunächst). Alte Rechte „Schreiben“/„Verwalten“ werden beim ersten Start automatisch auf die passenden Einzelrechte umgestellt. Neue Gruppen lassen sich dort anlegen und danach Konten zuweisen. Grundgruppen bleiben bestehen, die Schatten Leitung hat immer alle Rechte. Eine Gruppe lässt sich nur entfernen, wenn kein Konto sie mehr nutzt.

## Sichtbarkeit nach Gruppen
Personen, Akten (bei Personen) und Operationen haben ein Feld „Sichtbar für“. Standard: alle Gruppen. Wählt man „Alle Gruppen“ ab, sehen nur die angehakten Gruppen den Eintrag; die anderen sehen ihn gar nicht (der Server liefert ihn nicht aus). Die Schatten Leitung sieht immer alles. Bei Operationen ändert man die Sichtbarkeit über den Knopf „Sichtbarkeit“ (ab Verwalten). Wird eine Gruppe gelöscht, bleiben ihre Einträge eingeschränkt (dann nur Schatten Leitung).

## Kontonamen und Schatten ID
Namen dürfen Leerzeichen und Großbuchstaben enthalten (z. B. „Nario Zeyscho“). Bei der Anmeldung ist die Schreibweise egal. Jedes Konto bekommt automatisch eine Schatten ID (z. B. SD-4821), die Schatten Leitung kann sie unter „Konto“ ändern. Beim Namen lässt sich nachträglich nur die Groß-/Kleinschreibung ändern.

## Farben
Labels können Weiß, Hellgrau, Silber, Mittelgrau, Rot, Dunkelrot, Orange, Gelb, Grün, Dunkelgrün, Hellblau, Blau, Dunkelblau, Lila oder Pink sein.

## Anhänge an Berichten
Jeder Bericht hat unten „Anhänge“ (Titel + freier Text, wie die Akten bei Personen), jeweils mit eigener Sichtbarkeit nach Gruppen. Hinzufügen mit dem Recht „Berichte“, fremde Anhänge ändern mit „Fremde Inhalte“.

## Logs
Menüpunkt „Logs“ (Recht „Logs“, standardmäßig nur Schatten Leitung): zeigt, wer wann was gemacht hat (Anmeldungen inkl. Fehlversuche, Personen, Akten, Berichte, Anhänge, Operationen, Karte, Anpassung, Notfall, Rechte, Konten). Gespeichert werden die letzten 3000 Aktionen. Filter: Suche, Konto, Bereich (z. B. Personen, Berichte, Konten), Aktion, Zeitraum (von/bis, Heute, 7 Tage, 30 Tage) und „Nur kritische“ (Fehlversuche, Löschungen, Notfall).

## Sortierung im Personenregister
Standard ist „Rang“: in der Reihenfolge der Ränge unter „Anpassung“ (oben = zuerst, mit ▲ ▼ verschiebbar), innerhalb eines Rangs das neueste zuletzt.

## Personen beschreiben
Jede Akte hat zusätzlich zu Name und Rang die Felder Spezies und Aussehen sowie beliebig viele eigene Felder (Bezeichnung + Beschreibung, bis 20, z. B. Herkunft, Waffen, Fähigkeiten). Sie stehen im Formular „Akte anlegen/bearbeiten“, erscheinen in der Detailansicht, die Spezies ist auch über die Suche findbar. Änderungen daran stehen im Log.

## Zugehörigkeit und Beschattung
Im Personenregister heißt das frühere „Status“ jetzt „Zugehörigkeit“. „Kontakt aufnehmen“ gibt es nicht mehr. Beschattete Personen sind sichtbar: rotes Label „● Beschattet“ und roter Balken in der Liste, Banner in der Detailansicht.

## Rechte „Konten“ und „Gruppen“
Unter „Gruppen und Rechte“ gibt es zwei neue Rechte. „Konten“: Konten anlegen, Gruppe zuweisen, Passwort zurücksetzen, löschen. „Gruppen“: Gruppen und ihre Rechte verwalten. Standardmäßig hat sie nur die Schatten Leitung. Wer sie ohne Schatten Leitung bekommt, kann keine Rechte erhöhen: Es lassen sich nur Gruppen vergeben, deren Rechte man selbst hat, nur eigene Rechte an Gruppen vergeben oder entziehen, und Konten oder Gruppen mit höheren Rechten, das eigene Konto sowie Schatten-Leitungs-Konten bleiben tabu. Schatten-Leitungs-Konten legt weiterhin nur das Haupt-Owner-Konto an.

## Temporäre Konten
Beim Anlegen eines Kontos (Recht „Konten“) lässt sich unter „Konto-Dauer“ eine Befristung wählen (1 Stunde bis 30 Tage oder ein eigenes Datum mit Uhrzeit). Nach Ablauf ist das Konto sofort gesperrt: bestehende Sitzungen enden, die Anmeldung zeigt „Konto abgelaufen“. Das Konto bleibt in der Liste (mit Label „abgelaufen“) und seine Einträge und Logs bleiben erhalten. In der Kontenliste lässt sich die Gültigkeit jederzeit verlängern oder auf „Unbefristet“ setzen, oder das Konto löschen. Schatten-Leitungs-Konten sind nicht befristbar. Das Anlegen, Verlängern und Entfristen steht im Log.
