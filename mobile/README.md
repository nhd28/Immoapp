# Immo-Pipeline als native App (iOS & Android)

Die App ist eine native Hülle ([Capacitor](https://capacitorjs.com)) um die gehostete Immo-Pipeline.
Sie lädt die Oberfläche direkt von eurem Server: Daten sind immer synchron, und Änderungen am
Web-Frontend sind sofort in der App – ein neues App-Update ist nur bei Änderungen in `mobile/` nötig.

Native Extras: eigenes App-Icon & Splashscreen, Vollbild ohne Browserleiste, Fotos direkt mit der
Kamera aufnehmen, PDFs/Exposés im System-Viewer öffnen, Offline-Hinweis.

## 0. Voraussetzung: Server online

Die Web-App muss per HTTPS erreichbar sein (siehe Haupt-README, Abschnitt „Hosting“), mit gesetztem
`APP_PASSWORD`. Dann in GitHub unter **Settings → Secrets and variables → Actions → Variables**
die Variable `IMMO_SERVER_URL` anlegen, z. B. `https://immo.example.com`.

> Das Repository ist öffentlich: Die Server-Adresse ist damit sichtbar. Geschützt ist die App durch
> das Passwort. Signierschlüssel gehören ausschließlich in **Secrets**, nie ins Repo.

## Android

Jeder Push, der `mobile/` ändert, baut automatisch eine APK (Workflow **Android-App bauen**,
manuell startbar unter *Actions → Run workflow*). Die APK liegt danach im Lauf unter **Artifacts**.

Installation: APK aufs Handy schicken (z. B. per Mail/Messenger) → öffnen → „Installation aus
unbekannten Quellen“ erlauben.

**Empfohlen – fester Signierschlüssel**, damit Updates einfach drüber installiert werden können
(ohne ist es eine Debug-Version; vor einem Update muss die alte App gelöscht werden – Daten gehen
nicht verloren, die liegen auf dem Server):

```bash
keytool -genkeypair -v -keystore immo-release.jks -alias immo -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 immo-release.jks   # macOS: base64 -i immo-release.jks
```

Als Secrets anlegen: `ANDROID_KEYSTORE_BASE64` (Ausgabe von base64), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` (= `immo`), optional `ANDROID_KEY_PASSWORD`. Die `.jks`-Datei sicher aufbewahren!

## iOS (TestFlight) – ohne eigenen Mac

Der Workflow **iOS-App zu TestFlight hochladen** baut die App auf einem Mac von GitHub, signiert sie
automatisch und lädt sie zu TestFlight hoch.

Einmalig einrichten:

1. **Apple Developer Program** beitreten (99 €/Jahr): https://developer.apple.com/programs/
2. **Team-ID** notieren: developer.apple.com → Account → Membership details → Secret `APPLE_TEAM_ID`.
3. **API-Schlüssel**: App Store Connect → Benutzer und Zugriff → Integrationen → App Store Connect API →
   Schlüssel mit Rolle **Admin** erzeugen. Secrets: `APPSTORE_API_KEY_ID` (Schlüssel-ID),
   `APPSTORE_API_ISSUER_ID` (Issuer-ID oben auf der Seite), `APPSTORE_API_KEY_P8` (kompletter Inhalt der
   `.p8`-Datei inkl. `-----BEGIN…`-Zeilen).
4. Workflow einmal starten – dabei wird die Bundle-ID `com.nhd28.immopipeline` registriert. Falls der
   Upload meldet, dass die App fehlt: In App Store Connect → Apps → **+ Neue App** mit genau dieser
   Bundle-ID anlegen und den Workflow erneut starten.
5. **Matthias einladen**: App Store Connect → Benutzer und Zugriff → Matthias als Benutzer hinzufügen
   (Rolle z. B. „Marketing“), dann in der App unter **TestFlight → Interne Tests** eine Gruppe mit ihm
   anlegen. Er installiert die App über die TestFlight-App aus dem App Store.

TestFlight-Builds laufen nach 90 Tagen ab – dann einfach den Workflow erneut starten.

## Lokal entwickeln

```bash
cd mobile
npm install
IMMO_SERVER_URL=https://immo.example.com npx cap sync
npx cap open android   # Android Studio
npx cap open ios       # Xcode (nur auf dem Mac)
```

Zum Testen gegen den lokalen Server: `IMMO_SERVER_URL=http://<IP-deines-Rechners>:3000`.
Icon/Splash ändern: Bilder in `mobile/assets/` ersetzen, dann `npm run assets`.
