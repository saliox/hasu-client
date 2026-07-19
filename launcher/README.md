<div align="center">

# 🚀 Hasu Launcher

**Le launcher du Hasu Client — Minecraft 1.8.9 + Forge en un clic, dans l'esprit de Lunar Client.**

![platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows)
![built with](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron)
![auto update](https://img.shields.io/badge/auto--update-SHA--256-3ba55d)
![fair play](https://img.shields.io/badge/fair--play-100%25-3ba55d)

</div>

---

## ✨ Ce que ça fait

- **▶️ Un seul bouton « JOUER »** — télécharge et lance **Minecraft 1.8.9 + Forge**
  automatiquement : version, bibliothèques, natives, assets… tout est vérifié par
  **empreinte SHA-1** (les empreintes officielles Mojang) et mis en cache — le
  2ᵉ lancement est instantané.
- **🔐 Connexion Microsoft officielle** — flux *device code* (un code à saisir sur
  microsoft.com/link) : tes identifiants ne transitent **jamais** par le launcher,
  seuls des jetons sont utilisés, **chiffrés au repos** (DPAPI) comme dans Cap Hub.
- **🌐 Mode hors-ligne** — pas de compte ou Microsoft en panne ? Un bouton
  **« Jouer en hors-ligne »** lance le jeu en solo avec ton pseudo (UUID dérivé comme
  le ferait un serveur vanilla).
- **☕ Aucun Java à installer** — le launcher télécharge le **JRE officiel Mojang**
  (`jre-legacy`, le même que le launcher vanilla) et le vérifie fichier par fichier.
- **🖥️ Console de jeu intégrée** — les logs de la partie en direct dans le launcher.
- **📁 Dossier de jeu isolé** — Hasu joue dans son propre dossier : ton `.minecraft`
  officiel n'est **jamais** touché.
- **⚡ JVM optimisée** — réglages G1 éprouvés pour limiter les à-coups de GC en 1.8.9,
  mémoire réglable par curseur.
- **🎨 6 thèmes d'interface** — Nuit, Clair, Cyber, Sang, Océan, Forêt (les mêmes que
  Cap Hub).
- **🔄 Auto-update signé** — manifeste `launcher/version.json` lu sur GitHub,
  installeur vérifié par **SHA-256**, et qui ne peut venir **que** des Releases de ce
  dépôt.

## 🛡️ Fair-play par conception

Comme Lunar Client et Badlion : uniquement du **visuel, du confort et de la
performance**. Rien n'automatise le combat ou les déplacements, rien n'est envoyé au
serveur. Voir le [README principal](../README.md) pour la philosophie complète.

## 🛠️ Build from source

```bash
npm install
npm run icon   # génère build/icon.png + .ico (pur Node, zéro dépendance)
npm test       # tests unitaires (logique pure, sans réseau)
npm start      # lancer en dev
npm run dist   # installeur NSIS + portable (dist/)
```

La release se publie via l'onglet **Actions** → *Hasu Launcher — build & release*
(runner Windows, tag `launcher-v<version>`, mise à jour automatique de
`launcher/version.json`).

## 🧱 Architecture

| Fichier | Rôle |
|---|---|
| `main.js` | Processus principal Electron (fenêtre verrouillée, IPC) |
| `src/msauth.js` | Microsoft → Xbox Live → XSTS → Minecraft (device code) |
| `src/mojang.js` | Manifeste des versions, bibliothèques (règles par OS), assets |
| `src/forge.js` | Forge 1.8.9 : universal jar + version.json embarqué + fusion |
| `src/java.js` | JRE officiel Mojang (`jre-legacy`) téléchargé et vérifié |
| `src/launch.js` | Préparation complète + spawn de la JVM + logs |
| `src/download.js` | Téléchargements parallèles, SHA-1, retries, cache |
| `src/zip.js` | Lecteur ZIP maison (natives, version.json de Forge) — anti zip-slip |
| `src/store.js` | Réglages atomiques + session chiffrée (safeStorage) |
| `src/updater.js` | Auto-update signé SHA-256 |
| `renderer/` | Interface (sidebar façon Lunar, CSP stricte, sandbox) |

---

<div align="center">
<sub>Made with Electron · l'API officielle Mojang · a lot of tea 🍵</sub>
</div>
