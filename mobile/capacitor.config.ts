import type { CapacitorConfig } from '@capacitor/cli';

// Die App lädt die gehostete Immo-Pipeline direkt vom Server. So sehen du und Matthias
// immer dieselben Daten, und Änderungen am Web-Frontend landen ohne neues App-Update in der App.
// Beim Bauen setzen: IMMO_SERVER_URL=https://deine-immo-app.example.com npx cap sync
const serverUrl = process.env.IMMO_SERVER_URL?.replace(/\/+$/, '');

const config: CapacitorConfig = {
  appId: process.env.IMMO_APP_ID || 'com.nhd28.immopipeline',
  appName: 'Immo-Pipeline',
  webDir: 'www',
  server: serverUrl
    ? { url: serverUrl, cleartext: serverUrl.startsWith('http://'), errorPath: 'offline.html' }
    : undefined,
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#0f766e', showSpinner: false },
    StatusBar: { overlaysWebView: false, backgroundColor: '#0f766e', style: 'DARK' },
  },
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: false },
};

export default config;
