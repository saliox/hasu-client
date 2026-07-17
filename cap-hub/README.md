<div align="center">

# 🎽 Cap Hub

**Des capes Minecraft personnalisées, visibles entre joueurs — sans rien installer d'invasif.**

![platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows)
![built with](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron)
![auto update](https://img.shields.io/badge/auto--update-yes-3ba55d)
![no server](https://img.shields.io/badge/backend-100%25%20GitHub-6e5494?logo=github)
![no MITM](https://img.shields.io/badge/TLS-aucune%20interception-3ba55d)

</div>

---

## ✨ Ce que ça fait

- **🎨 Ta cape sur ton perso.** Importe un **PNG** (jusqu'en **4K**), un **GIF** (cape
  **animée**) ou n'importe quelle image (recadrée), ou choisis parmi **62 capes
  intégrées** — Cap Hub l'affiche sur ton personnage dans **tous les clients compatibles
  OptiFine** : vanilla+OptiFine, Forge+OptiFine, Lunar, Feather… Aucun client à modifier.
  *(Les capes animées défilent dans l'aperçu 3D ; en jeu via OptiFine, la 1ʳᵉ image est
  affichée — OptiFine n'anime pas les capes.)*
- **✨ Créateur de capes.** Compose ta propre cape dans l'app : motifs (uni, dégradé,
  rayures, damier, diagonales), **éditeur pixel par pixel** (pinceau/gomme/remplir,
  **annuler/rétablir** `Ctrl+Z`/`Ctrl+Y`, **pipette**, **mode miroir** pour les capes
  symétriques, souris/tactile/stylet), ou **depuis n'importe quelle image** (recadrée :
  remplir/contenir/étirer) — **aperçu 3D en direct**, puis ajoute-la à ta bibliothèque.
- **🗂️ Bibliothèque en dossiers.** Range tes capes par **catégorie** (auto pour les
  intégrées : Unis / Dégradés / Motifs, éditables), importe **plusieurs PNG d'un coup**,
  mets-les en **favori** (★), **renomme**-les, et retrouve-les par **recherche**, **dossier**
  et **tri**.
- **👥 Vous vous voyez entre vous.** Tous les joueurs Cap Hub partagent un **registre
  commun** : leurs capes s'affichent chez toi, la tienne s'affiche chez eux — sur
  **tous les serveurs**, en même temps que les capes OptiFine officielles des autres.
  Dans l'onglet **Joueurs**, chaque joueur a sa **vignette** et un clic affiche sa cape
  en **3D**.
- **🔁 Exporter / dupliquer.** Sauvegarde n'importe quelle cape en **PNG** (⬇) ou
  **duplique**-la (⧉) pour partir d'une base et la modifier.
- **🎖️ Tes capes officielles Mojang.** Connecte **ton** compte Minecraft (**Microsoft**
  en device-code comme le launcher, ou **token** direct) et **active/masque** tes capes
  officielles (Migrator, MineCon, Vanilla…) via l'**API officielle** Mojang — visibles
  partout, **sans OptiFine ni redirection**. Ta session est **chiffrée** au repos ; Cap Hub
  ne gère que **ton** compte, jamais celui d'un tiers.
- **🧊 Aperçu 3D dans l'app.** Vois ta cape en **3D** — tissu qui ondule, rotation douce
  et éclairage — sans lancer Minecraft ; les capes **animées** (images empilées, ex.
  64×64) défilent toutes seules.
- **🎨 6 thèmes d'interface.** Nuit, Clair, Cyber, Sang, Océan, Forêt (Réglages).
- **🩺 Auto-diagnostic.** Un bouton *Tester ma configuration* (onglet **État**) vérifie
  toute la chaîne — proxy, redirection `hosts`, pseudo, cape active — et fait une **vraie
  requête à travers le proxy** pour confirmer que ta cape est bien servie, avec un rapport
  étape par étape. Fini le « pourquoi ma cape ne s'affiche pas ? ».
- **🚀 Détection automatique.** Cap Hub surveille le lancement de Minecraft (launcher
  officiel, Lunar, Badlion, Prism, MultiMC, Hasu Launcher, `java`/`javaw`…) et te
  **propose d'appliquer** ta cape en **un clic** au bon moment.
- **🫥 Assistant en arrière-plan.** Fermer la fenêtre **réduit dans la barre système**
  (menu : Ouvrir / Appliquer / Quitter) pour que la détection tourne en continu, et une
  option **« Démarrer avec Windows »** (discrètement, dans le tray) rend l'app toujours
  prête à te proposer ta cape quand tu lances Minecraft.
- **☁️ 100 % GitHub, aucun serveur, aucune IP.** Lecture des capes en
  `raw.githubusercontent.com`, publication via l'API GitHub. Même philosophie que
  Hasu Client / Snipe Hub.
- **🔄 Auto-update signé.** Chaque mise à jour est vérifiée par **SHA-256** avant
  installation (Releases GitHub publiques).

---

## ⚙️ Comment ça marche

Les clients compatibles OptiFine vont chercher la cape d'un joueur à l'adresse
`http://s.optifine.net/capes/<pseudo>.png` — en **HTTP clair**. Cap Hub :

1. **redirige** `s.optifine.net` vers `127.0.0.1` (une ligne ajoutée au fichier `hosts`,
   dans un bloc balisé — rien d'autre n'est touché) ;
2. lance un **petit proxy local** sur le port 80 qui répond à ces requêtes :
   - **ton** pseudo → **ta** cape active (locale) ;
   - un joueur du **registre Cap Hub** → sa cape (mise en cache) ;
   - **n'importe qui d'autre** → **relais transparent** vers le vrai serveur OptiFine
     (IP résolue en DNS-over-HTTPS), pour que les capes officielles continuent de s'afficher.

> Résultat : tu vois tes capes et celles de la commu Cap Hub, **sans casser** l'affichage
> des capes OptiFine de tout le monde. Rien n'est envoyé aux serveurs de jeu — c'est
> purement visuel, côté client, exactement comme une cape OptiFine.

---

## 🔒 Pourquoi OptiFine seulement (choix de sécurité)

D'autres systèmes de capes (mods HTTPS) existent, mais les servir imposerait
d'**intercepter du HTTPS**, donc d'installer une **autorité de certification racine** dans
le magasin de confiance de la machine **et du runtime Java** du jeu. C'est puissant, mais
ça revient à embarquer un outil d'interception TLS : si la clé de la CA fuit, elle
devient une clé passe-partout pour **tout** le trafic chiffré de la machine.

**Cap Hub refuse ce compromis.** Il reste sur le **seul canal OptiFine**, en **HTTP clair** :

- **aucune autorité de certification**, aucune clé racine sur ta machine ;
- **aucun magasin de confiance** (Windows ou Java) modifié ;
- **aucune interception TLS** : le proxy ne parle que HTTP, uniquement sur `127.0.0.1` ;
- la seule modification système est **une ligne dans `hosts`** (`s.optifine.net`),
  réversible depuis *État → Redirection → Retirer*.

C'est la même mécanique, sûre et éprouvée, que celle des capes OptiFine.

---

## 🚀 Utilisation

```bash
npm install
npm start          # lance l'app (Windows)
```

1. **Mes capes** → *Importer* un **PNG** (64×32 → HD/4K), un **GIF** (cape animée) ou
   une image, puis *Utiliser*. **62 capes** sont déjà fournies ; favoris (★), renommage,
   recherche/tri/dossiers. Ou **Créateur** → compose la tienne.
2. **Réglages** → renseigne **ton pseudo Minecraft**, choisis ton **thème**.
3. Clique **⚡ Appliquer Cap Hub** (une fenêtre admin s'affiche la première fois pour
   la redirection `hosts`). Relance/rejoins un monde : ta cape apparaît.
4. Au prochain lancement de Minecraft, Cap Hub **te le propose tout seul**.

### Se voir entre joueurs

- **Réglages** → colle un **token GitHub** *fine-grained* avec la portée
  `contents:write` sur le dépôt du registre (chiffré au repos).
- **Joueurs** → **☁️ Publier ma cape**. Ton pseudo apparaît dans le registre commun ;
  les autres joueurs Cap Hub te voient au rafraîchissement suivant.
- Sans token, tu peux quand même appliquer et voir les capes déjà publiées.

### Gérer tes capes officielles (compte Minecraft)

- **Réglages → Compte Minecraft officiel** → colle ton **Azure Client ID** (public,
  non secret — **le même que Hasu Client**). Requis pour la connexion Microsoft ; la
  connexion par token n'en a pas besoin.
- **Compte officiel** → **🔐 Se connecter avec Microsoft** (une page Microsoft s'ouvre,
  tu saisis le code affiché — aucun mot de passe demandé par Cap Hub) **ou** colle un
  **access token** Minecraft.
- Tes **capes officielles Mojang** s'affichent avec leur **vraie texture** (récupérée
  côté app, hors CSP) et un **aperçu 3D** de la cape active : clique pour **activer** l'une
  d'elles ou **masquer** ta cape. Le changement est appliqué **côté Mojang** immédiatement
  (API officielle `api.minecraftservices.com`), visible sur tous les serveurs sans OptiFine.
- **Ponts entre les deux systèmes** : **➕ ajoute** une cape officielle à ta bibliothèque
  (utilisable via OptiFine, le créateur et l'aperçu), et **🎽 réutilise** le pseudo du
  compte connecté comme pseudo Cap Hub en un clic. Le **code Microsoft** est copiable
  (📋), et la session est **rafraîchie automatiquement** à l'ouverture de l'app.
- Ta session (tokens) est **chiffrée** au repos via `safeStorage` (DPAPI). Cap Hub agit
  uniquement sur **ton** compte.

---

## 🔒 Sécurité & respect des règles

- **Purement cosmétique & côté client.** Cap Hub n'automatise rien, n'envoie rien aux
  serveurs de jeu, ne lit aucune donnée cachée — c'est une cape, au même titre
  qu'OptiFine. Il ne modifie aucun fichier de jeu ni aucun client.
- **Aucune interception TLS.** Pas de CA, pas de certificat, pas de magasin de confiance
  touché (voir « Pourquoi OptiFine seulement »).
- **Renderer verrouillé.** `contextIsolation`, `sandbox`, `nodeIntegration:false`,
  **CSP stricte** (`default-src 'none'`), navigation externe bloquée.
- **Token chiffré** via Electron `safeStorage` (DPAPI). Il ne sert qu'à publier **ta**
  cape sur **ton** pseudo.
- **hosts réversible** : le bloc Cap Hub est délimité par des marqueurs ; *État →
  Redirection → Retirer* le supprime proprement.

---

## 🛠️ Build & release

```bash
npm install               # dépendances de build (Electron) — sur ton PC Windows
npm run icon              # (re)génère build/icon.png + .ico (pur Node)
npm test                  # 93 tests : capes (animées/HD + anti-traversée), PNG (décodeur borné), registre (fusion sûre + anti-traversée), réglages (écriture atomique), OptiFine, géométrie, proxy HTTP, détection Minecraft (anti faux-positifs), auto-update (URL restreinte), compte Minecraft officiel (auth + texture anti-SSRF)
npm run dist              # → dist/Cap Hub Setup <version>.exe (NSIS) + Cap Hub <version> portable.exe
npm run publish:update    # SHA-256 + Release GitHub + maj cap-hub/version.json
```

**Installeur** : NSIS (assistant classique, choix du dossier, raccourcis Bureau + menu
Démarrer, lancement à la fin) — exactement comme Hasu Panel / Snipe Hub — plus une
version **portable**. L'`.exe` se construit sous **Windows** (`npm run dist`).

### Sans PC Windows : build automatique (GitHub Actions)

Pas de machine Windows ? Onglet **Actions** du dépôt → **« Cap Hub — build & release »**
→ *Run workflow*. Le CI (runner `windows-latest`) installe, teste, construit
l'installeur NSIS + portable, **publie la Release** (`cap-hub-v<version>`) et met à jour
`cap-hub/version.json` pour armer l'auto-update. L'installeur est aussi dispo en artefact
téléchargeable du run. Déclenchement **manuel uniquement** (aucun impact sur les releases
du launcher).

Auto-update : manifeste `cap-hub/version.json` (lu en raw sur `saliox/hasu-client`),
installeur vérifié par SHA-256. Aucun serveur, aucune IP. **Zéro dépendance runtime.**

---

## 📁 Structure

```
cap-hub/
  main.js                processus principal : câble proxy + hosts + registre + watcher + update
  preload.cjs            pont IPC verrouillé
  renderer/              UI (index.html, style.css, app.js, preview.js) — onglets Capes/Créateur/Compte officiel/Joueurs/État/Réglages
  src/
    proxy.js             proxy local de capes (HTTP :80, own > registre > relais OptiFine)
    providers.js         fournisseur OptiFine (parse/render)
    capegeom.js          géométrie de cape (devant, images animées) — partagée avec l'aperçu
    hosts.js             redirection s.optifine.net -> 127.0.0.1 (bloc balisé, UAC)
    watcher.js           détection du lancement de Minecraft (tout client)
    registry.js          registre partagé GitHub (lecture raw + publication API)
    capes.js             bibliothèque locale + validation + capes intégrées
    mcaccount.js         compte Minecraft officiel (MS device-code/token) + capes Mojang (API officielle)
    store.js             réglages + token chiffré + session Minecraft chiffrée (safeStorage)
    updater.js           auto-update SHA-256
    png.js               encodeur PNG / lecture de taille (zéro dépendance)
  registry/              registre public servi en raw (capes.json + capes/*.png)
  scripts/               make-icon.mjs, publish-update.mjs, test.mjs
```
