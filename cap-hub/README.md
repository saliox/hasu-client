<div align="center">

# 🎽 Cap Hub

**Des capes Minecraft personnalisées sur *tous* les clients — et visibles entre joueurs sur les serveurs.**

![platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows)
![built with](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron)
![auto update](https://img.shields.io/badge/auto--update-yes-3ba55d)
![no server](https://img.shields.io/badge/backend-100%25%20GitHub-6e5494?logo=github)

</div>

---

## ✨ Ce que ça fait

- **🎨 Ta cape, partout.** Importe un PNG (ou choisis une cape intégrée) et Cap Hub
  l'affiche sur ton personnage dans **n'importe quel client compatible OptiFine** :
  vanilla+OptiFine, Forge+OptiFine, Lunar, Feather… Aucun mod à installer, aucun
  client à modifier.
- **👥 Vous vous voyez entre vous.** Tous les joueurs Cap Hub partagent un **registre
  commun** : leurs capes s'affichent chez toi, la tienne s'affiche chez eux — sur
  **tous les serveurs**, en même temps que les capes OptiFine officielles des autres.
- **🚀 Détection automatique.** Cap Hub surveille le lancement de Minecraft (launcher
  officiel, Lunar, Badlion, Prism, MultiMC, Hasu Launcher, `java`/`javaw`…) et te
  **propose d'appliquer** tes capes en **un clic** au bon moment.
- **☁️ 100 % GitHub, aucun serveur, aucune IP.** Lecture des capes en
  `raw.githubusercontent.com`, publication via l'API GitHub. Même philosophie que
  Hasu Client / Snipe Hub.
- **🔄 Auto-update signé.** Chaque mise à jour est vérifiée par **SHA-256** avant
  installation (Releases GitHub publiques).

---

## ⚙️ Comment ça marche

Les clients Minecraft qui gèrent les capes OptiFine vont chercher la cape d'un joueur
à l'adresse `http://s.optifine.net/capes/<pseudo>.png`. Cap Hub :

1. **redirige** `s.optifine.net` vers `127.0.0.1` (une ligne ajoutée au fichier
   `hosts`, dans un bloc balisé — rien d'autre n'est touché) ;
2. lance un **petit proxy local** sur le port 80 qui répond à ces requêtes :
   - **ton** pseudo → **ta** cape active (locale) ;
   - un joueur du **registre Cap Hub** → sa cape (mise en cache) ;
   - **n'importe qui d'autre** → **relais transparent** vers le vrai serveur OptiFine
     (résolu en DNS-over-HTTPS), pour que les capes officielles continuent de s'afficher.

> Résultat : tu vois tes capes et celles de la commu Cap Hub, **sans casser** l'affichage
> des capes OptiFine de tout le monde. Rien n'est envoyé aux serveurs de jeu — c'est
> purement visuel, côté client, exactement comme une cape OptiFine.

---

## 🚀 Utilisation

```bash
npm install
npm start          # lance l'app (Windows)
```

1. **Mes capes** → *Importer un PNG* (64×32 ou multiples HD, ou 46×22 OptiFine) puis
   *Utiliser*. Dix capes sont déjà fournies.
2. **Réglages** → renseigne **ton pseudo Minecraft**.
3. Clique **⚡ Appliquer Cap Hub** (une fenêtre admin s'affiche la première fois pour
   la redirection `hosts`). Relance/rejoins un monde : ta cape apparaît.
4. Au prochain lancement de Minecraft, Cap Hub **te le propose tout seul**.

### Se voir entre joueurs

- **Réglages** → colle un **token GitHub** *fine-grained* avec la portée
  `contents:write` sur le dépôt du registre (chiffré au repos).
- **Joueurs** → **☁️ Publier ma cape**. Ton pseudo apparaît dans le registre commun ;
  les autres joueurs Cap Hub te voient au rafraîchissement suivant.
- Sans token, tu peux quand même appliquer et voir les capes déjà publiées.

---

## 🔒 Sécurité & respect des règles

- **Purement cosmétique & côté client.** Cap Hub n'automatise rien, n'envoie rien aux
  serveurs de jeu, ne lit aucune donnée cachée — c'est une cape, au même titre
  qu'OptiFine. Il ne modifie aucun fichier de jeu ni aucun client.
- **Renderer verrouillé.** `contextIsolation`, `sandbox`, `nodeIntegration:false`,
  **CSP stricte** (`default-src 'none'`), navigation externe bloquée.
- **Token chiffré** via Electron `safeStorage` (DPAPI). Il ne sert qu'à publier **ta**
  cape sur **ton** pseudo.
- **hosts réversible** : le bloc Cap Hub est délimité par des marqueurs ; *État →
  Redirection → Retirer* le supprime proprement.

---

## 🛠️ Build & release

```bash
npm run icon               # (re)génère build/icon.png + .ico (pur Node)
npm run dist               # installeur NSIS + portable (dist/)
npm run publish:update     # SHA-256 + Release GitHub + maj cap-hub/version.json
```

Auto-update : manifeste `cap-hub/version.json` (lu en raw sur `saliox/hasu-client`),
installeur vérifié par SHA-256. Aucun serveur, aucune IP.

---

## 📁 Structure

```
cap-hub/
  main.js                processus principal : câble proxy + hosts + registre + watcher + update
  preload.cjs            pont IPC verrouillé
  renderer/              UI (index.html, style.css, app.js)
  src/
    proxy.js             proxy local de capes (own > registre > relais OptiFine)
    hosts.js             redirection s.optifine.net -> 127.0.0.1 (bloc balisé, UAC)
    watcher.js           détection du lancement de Minecraft (tout client)
    registry.js          registre partagé GitHub (lecture raw + publication API)
    capes.js             bibliothèque locale + validation + capes intégrées
    store.js             réglages + token chiffré (safeStorage)
    updater.js           auto-update SHA-256
    png.js               encodeur PNG / lecture de taille (zéro dépendance)
  registry/              registre public servi en raw (capes.json + capes/*.png)
  scripts/               make-icon.mjs, publish-update.mjs
```
