# Sicherheit und Datenschutz

## Anmeldung und Sitzungen

- **Passwörter:** scrypt (N = 2¹⁵, r = 8, p = 3, 16 Byte Salt), Mindestlänge 10 Zeichen, keine Passwörter, die den Teil der E-Mail-Adresse vor dem @ enthalten. Parameter werden bei späteren Erhöhungen beim nächsten Login automatisch nachgezogen.
- **Sitzungen:** 256-Bit-Zufallstoken, in der Datenbank nur als SHA-256-Hash. Cookie `__Host-nalpia_sid` mit `HttpOnly`, `Secure`, `SameSite=Lax`. Gleitende Laufzeit (Standard 14 Tage, `SESSION_DAYS`), absolut max. 90 Tage. Passwortänderung und Aktivierung der 2FA melden alle anderen Geräte ab, Deaktivieren eines Kontos beendet alle Sitzungen sofort.
- **Brute-Force-Schutz:** Sperre für 15 Minuten nach 5 Fehlversuchen pro Konto, Limit pro IP. Das gilt auch für jede erneute Passwortabfrage innerhalb des Intranets (Passwort ändern, 2FA einrichten/abschalten, Bestätigungen). Bekannte und unbekannte Adressen verhalten sich identisch (keine Konto-Erkennung über Fehlermeldungen).
- **Zwei-Faktor-Anmeldung (TOTP):** kompatibel mit allen gängigen Authenticator-Apps. Secret AES-256-GCM-verschlüsselt. Jeder Code ist nur **einmal** gültig (ein mitgelesener Code lässt sich nicht wiederverwenden). 8 Wiederherstellungscodes, nur als HMAC mit Server-Schlüssel gespeichert und atomar einmalig verbraucht. Admins können 2FA für alle verpflichtend machen; dann sind alle Fach-Funktionen gesperrt, bis die Person 2FA eingerichtet hat (serverseitig durchgesetzt).
- **Einladungen/Reset:** einmalige Links (7 Tage bzw. 24 Stunden), nur als Hash gespeichert; neue Links entwerten ältere, ein Link funktioniert genau einmal. Passwortänderung entwertet alle offenen Links. Der Link für die erste Admin-Person steht produktiv **nicht** in den Logs.

## Admin-Rechte: begrenzt und nachvollziehbar

Admins verwalten Zugänge, haben aber **keinen Weg in fremde Postfächer**:

- **Erneute Bestätigung:** Reset-Links für aktive Konten, 2FA-Reset, Rollen- und Statusänderungen, neue Admins und die 2FA-Pflicht verlangen eine frische Bestätigung mit Passwort **und** 2FA-Code (gültig 10 Minuten). Wer selbst keine 2FA hat, kann diese Aktionen nicht ausführen.
- **Reset trennt das Postfach:** Wird ein Passwort über einen Link neu gesetzt oder die 2FA durch einen Admin zurückgesetzt, trennt das Intranet die Zoho-Verbindung und widerruft das Token. Wer das Konto danach nutzt, muss sich bei Zoho mit dem Postfach-Passwort neu anmelden – ein Admin, der einen Reset-Link selbst einlöst, sieht also keine Mails.
- **Kein heimlicher Reset:** Mit eingerichtetem SMTP gehen Reset-Links ausschließlich an die betroffene Person, nicht an den Admin. Die Person wird zusätzlich in-App (und bei 2FA-Reset per E-Mail) informiert.
- **Deaktivieren** beendet alle Sitzungen, entwertet offene Links und trennt das Postfach.

## Schutz der Anwendung

- **CSRF:** Zustandsändernde Anfragen brauchen einen eigenen Header, Herkunftsprüfung (`Origin`, `Sec-Fetch-Site`) und `SameSite`-Cookies.
- **Header:** strikte Content-Security-Policy (keine fremden Skripte, kein Inline-JavaScript), `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, restriktive `Permissions-Policy`.
- **Eingaben:** alle API-Eingaben werden mit Zod validiert, Anfragen sind auf 1 MB begrenzt, SQL ausschließlich über Prepared Statements.
- **Inhalte:** Beiträge werden als Markdown ohne HTML gerendert. Links nur `http(s)`, `mailto`, `tel` und interne Pfade.
- **E-Mails anzeigen:** E-Mail-HTML wird mit DOMPurify bereinigt und in einem Sandbox-iframe **ohne Skriptausführung** dargestellt, zusätzlich mit einer eigenen Content-Security-Policy (`default-src 'none'`). Externe Bilder (Tracking-Pixel) sind standardmäßig blockiert und werden nur auf Klick geladen. Links öffnen in neuem Tab ohne Referrer.
- **OAuth-Fehler:** Der Zoho-Rückruf gibt nur feste Fehlercodes an die Oberfläche weiter, keinen frei formulierten Text.
- **Konfiguration:** Der Demo-Modus (öffentlich bekannte Demo-Passwörter) lässt sich produktiv nicht starten; produktiv sind `https://` und ein `APP_SECRET` mit mindestens 32 Zeichen Pflicht.

## Investoren, Partner und Profilfotos

- Investoren-, Partner- und Kontaktdaten sehen alle angemeldeten Mitarbeitenden (gemeinsames CRM). Das CRM-Paket mit den echten Kontakten liegt nicht im Code-Repository, sondern nur in der Datenbank und den Backups. Löschen dürfen nur die zuständige Person, wer den Eintrag angelegt hat, oder Admins; jede Löschung wird protokolliert.
- **CSV-Export** wird mit Anzahl der Zeilen protokolliert. Werte, die mit `=`, `+`, `-` oder `@` beginnen, werden im Export entschärft, damit Excel sie nicht als Formel ausführt (CSV-Injection).
- **CSV-Import** zeigt zuerst eine Vorschau und schreibt erst nach Bestätigung, in einer Transaktion.
- **Profilfotos** werden im Browser auf 384 × 384 Pixel zugeschnitten und verkleinert, auf dem Server nur als JPG/PNG/WebP angenommen (Prüfung anhand des Dateiinhalts, max. 400 KB) und in der Datenbank gespeichert – sie sind damit Teil der normalen Backups. Ausgeliefert werden sie nur an angemeldete Personen, mit `nosniff` und eigener Sandbox-CSP. Beim Ausscheiden einer Person das Foto in der Verwaltung entfernen (DSGVO).

## Postfach: jede Person sieht nur ihr eigenes

- Jede Person verbindet ihr Zoho-Postfach selbst per OAuth. Es gibt **keinen** Endpunkt, der eine fremde Person oder ein fremdes Konto adressiert. Alle Postfach-Anfragen laufen mit dem Token der angemeldeten Person, auch bei Admins.
- Beim Verbinden muss die Adresse des Zoho-Postfachs zur Intranet-Adresse passen (`ZOHO_ENFORCE_EMAIL_MATCH=true`), sonst wird der Zugriff verworfen und das Token bei Zoho widerrufen.
- Refresh- und Access-Tokens liegen **AES-256-GCM-verschlüsselt** in der Datenbank (Schlüssel aus `APP_SECRET`). Der vom Zoho-Rückruf gelieferte Accounts-Server wird gegen die Liste der offiziellen Zoho-Rechenzentren geprüft.
- **Mail-Inhalte werden nicht gespeichert.** Sie werden bei Bedarf live von Zoho geladen. Ausnahme: Was eine Person bewusst „im Kontaktverlauf speichert“, liegt danach im CRM und ist für das Team sichtbar.
- Trennen löscht die Verbindung und widerruft das Token bei Zoho. Das passiert automatisch auch bei Passwort-Reset, 2FA-Reset durch Admins und beim Deaktivieren eines Kontos.

## KI-Funktionen (Claude)

- KI-Entwürfe im Postfach werden **nie automatisch gesendet**. Senden ist immer eine bewusste Aktion der Person (mit 4 Sekunden „Rückgängig“). Platzhalter in eckigen Klammern lösen vor dem Senden eine Warnung aus.
- Für einen Entwurf oder eine Zusammenfassung wird der Text der jeweiligen E-Mail an die Anthropic API übertragen. Anthropic verwendet API-Daten standardmäßig nicht zum Training. Für den Produktivbetrieb den **Auftragsverarbeitungsvertrag (DPA)** mit Anthropic abschließen und im Verzeichnis der Verarbeitungstätigkeiten aufnehmen.
- Der Assistent sieht nur CRM-, Aufgaben-, News- und Teamdaten, keine einzelnen Mails, und kann nichts senden.
- Kontingente pro Person und Stunde (`AI_HOURLY_LIMIT`, `ASSISTANT_HOURLY_LIMIT`, `TRANSLATE_HOURLY_LIMIT`).

## Fundraising-Agent

- **Prüfmodus ist Standard:** Erstmails, Follow-ups und Antworten warten als Entwurf, bis eine Person auf „Senden“ klickt. Der Wechsel in den **Autopilot** ist Admins vorbehalten, wird bestätigt und protokolliert. Ein manueller Lauf („Jetzt Entwürfe erzeugen“, „Alles ausführen“, CLI) sendet im Prüfmodus nie.
- Im Autopilot sendet der Agent nur im Sendefenster, bis zum Tageslimit und bis zur Obergrenze offener Threads; Antworten auf Fragen und Einwände warten immer auf eine Person. Ein Entwurf ohne belegten persönlichen Absatz wird nie gesendet.
- Gesendet wird ausschließlich über das verbundene Zoho-Postfach des eingestellten Postfach-Inhabers mit dessen OAuth-Token – es gibt keinen Agent-eigenen Mailzugang. Trennt die Person ihr Postfach, steht der Agent still.
- Investor-Mails (eingehend) gehen zur Klassifizierung und für den Antwortentwurf an die Anthropic API; für die Recherche nutzt das Modell das Web-Search-Tool der API mit dem Namen des Investors (öffentliche Quellen). Inhalte eingehender Mails sind für das Modell Daten, keine Anweisungen.
- Entwürfe, gesendete Mails, klassifizierte Antworten und Läufe liegen in der Datenbank (Backups). Jeder Versand steht im Audit-Protokoll (Empfängerdomain, keine Inhalte).

## Protokollierung

Das Audit-Protokoll (Verwaltung → Protokoll) erfasst Anmeldungen und Fehlversuche, Bestätigungen, Passwort- und 2FA-Änderungen, Einladungen, Rollen- und Statusänderungen, Postfach-Verbindungen (inkl. Grund einer Trennung), das Laden von Anhängen, die Nutzung der KI-Funktionen, das Löschen von Aufgaben, Beiträgen, Kontakten und Meilensteinen sowie den Versand von Mails (nur Anzahl der Empfänger und deren Domains, **keine Betreffzeilen oder Inhalte**).

Das Protokoll ist **manipulationserkennbar**: Jeder Eintrag ist per SHA-256 mit dem vorherigen verkettet. Nachträglich geänderte oder gelöschte Einträge zeigt

```bash
docker compose exec intranet node dist/server/cli.js verify-audit
```

an (z. B. monatlich oder vor einer Prüfung).

## Datenschutz-Checkliste für den Produktivstart

- [ ] Hosting in der EU (z. B. Hetzner Deutschland), AV-Vertrag mit dem Hoster
- [ ] AV-Verträge mit Zoho (besteht für Zoho Mail meist schon) und Anthropic
- [ ] Eintrag ins Verzeichnis der Verarbeitungstätigkeiten (Intranet, Mitarbeiterdaten, CRM-Kontakte)
- [ ] Kurze Information an die Mitarbeitenden (Kurzanleitung unter docs/BENUTZUNG.md)
- [ ] 2FA-Pflicht aktivieren
- [ ] Tägliche, verschlüsselte Backups außer Haus (docs/SETUP.md, Abschnitt 7)
- [ ] Code-Repository privat stellen oder keine personenbezogenen Daten einchecken (`data/` ist ausgeschlossen)
- [ ] Compliance-Abstimmung: Aufbewahrung, Kommunikation mit Investoren, Nutzung der KI-Entwürfe und des Agenten
