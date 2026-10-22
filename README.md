# Wächter Datenbank

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

## Ränge für Gruppen
Jede Gruppe hat in der Tabelle „Gruppen und Rechte“ einen Rang von 1 bis 10 (Standard: Schatten 1, Phantom 2, Spektral Rat 3, neue Gruppen 1). Die Schatten Leitung steht über allen Rängen und ist nicht eingeschränkt. Alle anderen mit den Rechten „Konten“ oder „Gruppen“ dürfen nur Gruppen und Konten mit niedrigerem Rang verwalten: Eine Rang-4-Gruppe kann keine Rang-5-Gruppe bearbeiten, und eine Rang-5-Gruppe auch keine andere Rang-5-Gruppe. Das gilt fürs Anlegen, Umbenennen, Rechte ändern, Rang ändern und Entfernen von Gruppen sowie fürs Anlegen, Zuweisen, Zurücksetzen und Löschen von Konten. Neue oder geänderte Gruppen müssen ebenfalls einen niedrigeren Rang als die eigene haben. Die Regel „nur Rechte vergeben, die man selbst hat“ gilt zusätzlich. Wichtig: Vorhandene eigene Gruppen mit Konten-/Gruppenrecht haben zunächst Rang 1 und können deshalb erst etwas verwalten, wenn die Schatten Leitung ihnen einen höheren Rang gibt.

## Sortierung der Gruppen und Konten sperren
Gruppen stehen überall (Tabelle, Auswahllisten) sortiert: zuerst die Schatten Leitung, dann nach Rang von hoch nach niedrig, bei gleichem Rang alphabetisch. Neu angelegte Gruppen rutschen nach dem Speichern an ihre Stelle.
Konten lassen sich in der Kontenliste mit „Sperren“ deaktivieren (Recht „Konten“, Rangregeln wie oben). Ein gesperrtes Konto ist sofort ausgeloggt und kann sich nicht anmelden („Konto gesperrt“), bleibt aber mit allen Einträgen bestehen. „Entsperren“ hebt es auf. Das eigene Konto und das Haupt-Owner-Konto lassen sich nicht sperren. Sperren und Entsperren stehen im Log.

## Jedi Ermittler
Die Schatten Leitung kann Konten zu „Jedi Ermittler“ machen (beim Anlegen unter „Jedi Ermittler“ oder in der Kontenliste mit „Jedi Ermittler“ / „Ermittler entziehen“; das Haupt-Owner-Konto kann sich selbst freigeben). Nur diese Konten sehen den Reiter „Jedi Ermittler“, auch die Schatten Leitung nicht ohne Freigabe. Der Server liefert die Daten ausschließlich an freigegebene Konten und nie über die normalen Datenabfragen aus. Dort tragen sie ein: Tarnidentitäten (Tarnname, Status, Einsatzort, Legende, Notiz), Informanten (Name, Zuverlässigkeit, Status, Quelle, Kontaktweg, Ort, Notiz) und Gespräche (Betreff, Zeitpunkt, Gesprächspartner, Tarnidentität, Informant, Ort, Protokoll). Alle Ermittler sehen alle Einträge; eigene Einträge bearbeitet und löscht man selbst, fremde nur mit dem Recht „Fremde Inhalte“. Im Log steht nur, dass ein Eintrag angelegt, geändert oder gelöscht wurde, nie der Inhalt. Wird die Freigabe entzogen, ist der Reiter sofort weg; die Einträge bleiben erhalten.

## RIS Kooperation
Neuer Reiter „RIS Kooperation“ mit zwei Bereichen: „Berichts Austausch Wachen“ (Berichte der Wächter an das RIS) und „Berichts Austausch RIS“ (Berichte des RIS an die Wachen). Beide Seiten lesen beide Bereiche, schreiben aber nur in ihren eigenen. Berichte haben Titel, optional ein Aktenzeichen und den Text. „Berichts Austausch RIS“ bearbeiten und löschen nur RIS-Konten (alle RIS-Konten, auch fremde Berichte), „Berichts Austausch Wachen“ nur Konten der Wächter-Seite mit dem Recht „RIS Kooperation“ (auch die Schatten Leitung). Die jeweils andere Seite liest nur.
- **RIS-Konten:** Beim Anlegen eines Kontos unter „Konto-Typ“ „RIS-Konto“ wählen (Recht „Konten“). Ein RIS-Konto sieht und erreicht nur den Reiter „RIS Kooperation“ (plus Passwort ändern unter „Konto“). Der Server lehnt alle anderen Abfragen für dieses Konto ab (Personen, Berichte, Karte, Logs, Ermittler …). Es schreibt nur in „Berichts Austausch RIS“.
- **Wächter-Seite:** Neues Gruppenrecht „RIS Kooperation“ (unter „Gruppen und Rechte“): die Gruppe sieht den Reiter und schreibt in „Berichts Austausch Wachen“. Die Schatten Leitung hat das Recht immer.
- Anlegen, Ändern und Löschen stehen im Log (mit Titel). Bei UMBRA sind auch RIS-Konten gesperrt.

## Name
Die Seite heißt jetzt „Wächter Datenbank“ (Titel, Kopf, Anmeldung, Fußzeile).

## Phasen der Operationen und Sortierung der Konten
Operationen durchlaufen feste Phasen: 0 % Planung, 25 % Mitglieder Sammlung, 50 % Briefing, 75 % Durchführung, 100 % Abgeschlossen. Neue Operationen starten bei „Planung“, der Knopf „Weiter: …“ (ab dem Recht „Op. steuern“) setzt die nächste Phase. Bei „Abgeschlossen“ lässt sich die Operation archivieren. Bereits vorhandene Operationen werden beim Start auf die nächstniedrigere Phase gesetzt. Die Phasenwechsel stehen im Log.
Die Kontenliste ist nach Rang sortiert: zuerst unantastbare Konten, dann das Haupt-Owner-Konto, dann nach Rang der Gruppe von hoch nach niedrig, bei gleichem Rang alphabetisch.

## Unantastbare Konten
Unantastbare Konten sind fest im Code (`UNTOUCHABLE` in `server.js`) hinterlegt, aktuell „Mace Windu“ mit der Schatten ID RV-0000 und der Gruppenbezeichnung „Jedi Ratsvorsitz“ (technisch die Rechte der Schatten Leitung, also alle Rechte; die Gruppe „Schatten Leitung“ selbst heißt weiterhin so). Das Konto steht normal in der Kontenliste unter „Konten“, mit dem Label „Unantastbar“ und ohne Bearbeiten-Knöpfe, immer ganz oben (noch vor dem Haupt-Owner-Konto). Es kann von niemandem geändert werden, auch nicht vom Haupt-Owner: kein Löschen, Sperren, Befristen, Gruppenwechsel, Passwort-Reset und keine Umbenennung (der Server lehnt das ab). Nur das Konto selbst ändert sein Passwort unter „Konto“. Beim ersten Login muss das Startpasswort ersetzt werden. Wird das Konto in den Daten gelöscht, gesperrt oder herabgestuft, stellt der nächste Start es wieder her. Notfall-Zugang bei vergessenem Passwort: In Render die Umgebungsvariable `UNTOUCHABLE_PASSWORD_MACE_WINDU` setzen (dann gilt dieses Passwort ohne erzwungene Änderung). Weitere Konten: in `server.js` zur Liste `UNTOUCHABLE` ergänzen (Passwort-Hash mit `node server.js --hash "passwort"`).

## Archiv
Neuer Reiter „Archiv“ (SR-AR) mit zwei Bereichen, zwischen denen man oben umschaltet; beide haben eine Suche und zeigen die Einträge als Karten.
- **Machtfähigkeiten:** Karte mit Icon oben, darunter Name, darunter die Beschreibung. Das Icon lädt man als Bild hoch (PNG, JPEG, WebP, GIF); die Seite verkleinert es automatisch auf höchstens 128×128 Pixel. „Icon entfernen“ nimmt es wieder weg. Name und Beschreibung sind frei schreibbar.
- **Aufgaben:** Karte mit dem Aufgabennamen als Kopfzeile und darunter der Aufgabenbeschreibung.
Lesen dürfen alle normalen Konten (RIS-Konten nicht). Eintragen, ändern und löschen geht mit dem neuen Gruppenrecht „Archiv“ (unter „Gruppen und Rechte“); eigene Einträge bearbeitet man selbst, fremde nur mit „Fremde Inhalte“. Standardmäßig haben das Recht Phantom, Spektral Rat und die Schatten Leitung; bestehende eigene Gruppen bekommen es, wenn sie das Recht „Personen“ haben. Höchstens 300 Einträge pro Bereich. Anlegen, Ändern und Löschen stehen im Log (Bereich „Archiv“).
