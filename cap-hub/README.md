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

- **🎨 Ta cape, partout — pas seulement OptiFine.** Importe un PNG (ou choisis une cape
  intégrée) et Cap Hub l'affiche sur ton personnage via **plusieurs canaux de capes** :
  **OptiFine** (vanilla+OptiFine, Forge+OptiFine, Lunar, Feather…) **et** les mods de
  capes en HTTPS comme **MinecraftCapes**. Aucun client à modifier.
- **👥 Vous vous voyez entre vous.** Tous les joueurs Cap Hub partagent un **registre
  commun** : leurs capes s'affichent chez toi, la tienne s'affiche chez eux — sur
  **tous les serveurs**, en même temps que les capes OptiFine officielles des autres.
- **🔎 Aperçu animé dans l'app.** Vois ta cape **onduler** (effet drapeau) sans lancer
  Minecraft ; les capes **animées** (images empilées, ex. 64×64) défilent toutes seules.
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

Chaque système de capes va chercher la cape d'un joueur sur **son** service. Cap Hub
**redirige ces services vers un proxy local** (via le fichier `hosts`, bloc balisé —
rien d'autre n'est touché) et répond à leur place, sur **plusieurs canaux** :

| Canal | Protocole | Requête | Certificat requis |
|---|---|---|---|
| **OptiFine** | HTTP :80 | `GET s.optifine.net/capes/<pseudo>.png` → PNG | non |
| **MinecraftCapes** (mod) | HTTPS :443 | `GET api.minecraftcapes.net/profile/<uuid>` → JSON | **oui** (CA Cap Hub) |
| **LabyMod** *(expérimental)* | HTTPS :443 | `GET dl.labymod.net/capes/<uuid>` → PNG | **oui** (CA Cap Hub) |

Pour **chaque** canal, le proxy résout dans le même ordre :

1. **ton** pseudo → **ta** cape active (locale) ;
2. un joueur du **registre Cap Hub** → sa cape (cache) ;
3. **n'importe qui d'autre** → **relais transparent** vers le vrai service (IP résolue
   en DNS-over-HTTPS), pour que les capes officielles **et le skin** des autres
   continuent de s'afficher.

### Le certificat Cap Hub (canaux HTTPS)

OptiFine passe en **HTTP clair** : rien à installer. Les mods de capes modernes passent
en **HTTPS** — pour répondre à leur place, le proxy présente un certificat signé par une
**autorité locale Cap Hub**. Comme **Minecraft est en Java**, il n'utilise pas le magasin
de Windows mais son **propre truststore** (`cacerts`, un par runtime Java). Cap Hub :

- **génère** cette CA localement (jamais partagée) ;
- **détecte** les runtimes Java des launchers et y **importe** la CA (`keytool`) ;
- l'ajoute aussi au magasin **utilisateur** de Windows (clients non-Java).

Tout est **opt-in** (onglet *Canaux*) et **réversible** (bouton *Retirer*). Un canal HTTPS
n'est **redirigé que si la CA existe**, pour ne jamais casser le mod d'un joueur.

> Résultat : tes capes et celles de la commu Cap Hub s'affichent sur **plusieurs types de
> clients**, **sans casser** l'affichage de personne. Rien n'est envoyé aux serveurs de
> jeu — c'est purement visuel, côté client.

---

## 🚀 Utilisation

```bash
npm install
npm start          # lance l'app (Windows)
```

1. **Mes capes** → *Importer un PNG* (64×32 ou multiples HD, ou 46×22 OptiFine) puis
   *Utiliser*. Dix capes sont déjà fournies.
2. **Réglages** → renseigne **ton pseudo Minecraft**.
3. *(facultatif)* **Canaux** → active **MinecraftCapes** et clique *Installer le
   certificat* pour que tes capes s'affichent aussi hors OptiFine.
4. Clique **⚡ Appliquer Cap Hub** (une fenêtre admin s'affiche la première fois pour
   la redirection `hosts`). Relance/rejoins un monde : ta cape apparaît.
5. Au prochain lancement de Minecraft, Cap Hub **te le propose tout seul**.

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
- **CA locale, opt-in, réversible** : la CA Cap Hub est **générée sur ta machine**
  (jamais partagée, jamais téléchargée), sa clé privée reste locale, et elle ne signe
  que des certificats pour les domaines de capes redirigés. *Canaux → Retirer* la
  désinstalle des truststores (Windows + Java). Elle ne sert **que** l'affichage des
  capes ; aucun autre trafic n'est intercepté.

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
  main.js                processus principal : câble proxy + hosts + CA + registre + watcher + update
  preload.cjs            pont IPC verrouillé
  renderer/              UI (index.html, style.css, app.js, preview.js) — onglets Capes/Joueurs/Canaux/État/Réglages
  src/
    proxy.js             proxy multi-canaux (HTTP :80 + HTTPS :443, own > registre > relais)
    providers.js         registre des fournisseurs de capes (OptiFine, MinecraftCapes, extensible)
    ca.js                CA locale (node-forge) + certificats par domaine + install truststore Java/Windows
    idmap.js             résolution pseudo <-> UUID (API Mojang, cache)
    capegeom.js          géométrie de cape (devant, images animées) — partagée avec la preview
    hosts.js             redirection dynamique des domaines -> 127.0.0.1 (bloc balisé, UAC)
    watcher.js           détection du lancement de Minecraft (tout client)
    registry.js          registre partagé GitHub (lecture raw + publication API)
    capes.js             bibliothèque locale + validation + capes intégrées
    store.js             réglages + canaux activés + token chiffré (safeStorage)
    updater.js           auto-update SHA-256
    png.js               encodeur PNG / lecture de taille (zéro dépendance)
  registry/              registre public servi en raw (capes.json + capes/*.png)
  scripts/               make-icon.mjs, publish-update.mjs, test.mjs
```

### Ajouter un canal de capes

Un fournisseur = un objet dans `src/providers.js` : `hosts`, `scheme`, `parse(url)` →
`{ key, keyType }`, et `render({ capePng, upstream })` → réponse. L'ajouter au tableau
`PROVIDERS` suffit ; le proxy, la redirection `hosts` et l'UI le prennent en compte
automatiquement.

## 🧪 Tests

```bash
npm install --omit=dev   # installe node-forge (sans Electron)
npm test                 # 31 tests : capes, fournisseurs, géométrie, CA/TLS réel, proxy multi-canaux
```
