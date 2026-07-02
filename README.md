# 🐦‍⬛ Hasu Client

**Hasu Client** est un client Minecraft **léger et 100 % légitime** pour **Minecraft 1.8.9 (Forge)**,
dans l'esprit de **Lunar Client** et **Badlion Client**. Il se concentre sur le confort de jeu, la
lisibilité en PvP et les performances — **sans aucune triche**.

Le produit se compose de **deux parties** :

- **🚀 Hasu Launcher** — l'application de bureau (Windows) qui te connecte avec ton compte Microsoft,
  se met à jour toute seule et lance le jeu en un clic.
- **🎮 Le client en jeu** — le mod Forge 1.8.9 qui ajoute les HUDs, l'interface (ClickGUI), les thèmes
  et les optimisations une fois en partie.

> **Version actuelle : 1.12.0**

---

## ✨ La philosophie : légitime par conception

Hasu Client ne contient **que** des éléments visuels, de confort ou de performance. **Rien** n'automatise
le combat ou les déplacements, et **rien** n'est envoyé au serveur — exactement pour la même raison que
Lunar Client et Badlion Client sont autorisés sur des réseaux comme Hypixel.

| ✅ Inclus (fair-play) | ❌ Volontairement absent (hors périmètre) |
|---|---|
| HUDs (infos à l'écran) | Reach / modification de portée |
| ClickGUI & thèmes | Modification des hitbox |
| Fullbright (voir dans le noir) | Auto-clicker |
| Boost FPS | KillAura / aim-assist |
| Toggle-sprint, réglage du FOV | Velocity / anti-knockback |
| Éditeur de HUD | ESP / X-ray / révélation d'infos cachées |

**Compatible OptiFine** (détecté, non fourni).

---

## 🚀 Hasu Launcher (l'application de bureau)

Une application moderne au design épuré (thème sombre) qui gère tout ce qu'il faut avant la partie :

- **Connexion Microsoft officielle** — authentification Xbox Live / Minecraft par le flux officiel
  Microsoft. Tes identifiants ne transitent jamais par nous ; seul un jeton de session est utilisé.
- **Mode hors-ligne de secours** — en cas d'erreur côté Microsoft, un bouton **« Jouer en hors-ligne »**
  te laisse quand même lancer le jeu.
- **Bouton « Jouer » unique** — lance Minecraft **1.8.9 + Forge + le client** automatiquement, sans
  manipulation de dossiers ni de profils.
- **Mise à jour automatique** — le launcher vérifie la dernière version au démarrage, télécharge la mise
  à jour et la **vérifie par empreinte SHA-256** avant installation. Toujours à jour, sans effort.
- **Console de jeu intégrée** — les logs de la partie s'affichent en direct dans le launcher (pratique
  pour comprendre un souci).
- **Aucun Java à installer** — le launcher est livré avec son propre environnement d'exécution intégré.
- **Session mémorisée en sécurité** — ton compte et tes préférences sont conservés localement, le jeton
  de connexion étant **chiffré** sur ta machine.

### Formats de distribution

| Livrable | Pour qui |
|---|---|
| **HasuLauncher-Setup.exe** | Installateur classique (raccourci bureau + menu Démarrer, se met à jour tout seul) |
| **HasuLauncher-portable.zip** | Version portable, sans installation (clé USB, PC sans droits admin) |

*(Windows 64 bits. Icône dédiée, JRE embarqué.)*

---

## 🎮 Le client en jeu (le mod)

Une fois en partie, Hasu Client ajoute une couche d'interface et d'affichage soignée.

### HUDs (informations à l'écran)
Déplaçables librement grâce à l'éditeur intégré :

- **Keystrokes** — visualisation des touches (ZQSD + clics)
- **CPS** — clics par seconde
- **FPS** — images par seconde
- **Ping** — latence au serveur
- **Armor** — durabilité de l'armure et de l'objet en main
- **Potions** — effets actifs et leur durée
- **Coordinates** — position (X / Y / Z)
- **Combo** — nombre de coups enchaînés en combat

### Interface (ClickGUI)
- Panneaux par **catégorie** (HUD / Joueur / Visuel / Performance), déplaçables
- Réglages **en ligne** pour chaque module (interrupteurs, valeurs, modes)
- **Raccourcis clavier** personnalisables par module
- **Thèmes** : Sombre, Minimal, ou Personnalisé (palette au choix)

### Modules
- **Joueur** — *Toggle-Sprint* (sprint permanent), *FOV Changer* (champ de vision)
- **Visuel** — *Fullbright* (luminosité maximale, voir dans le noir)
- **Performance** — *FPS Boost* (rendu allégé pour plus d'images/seconde)

### Commandes
| Touche | Action |
|---|---|
| **Maj droite** (Right Shift) | Ouvrir le ClickGUI |
| **Ctrl droite** (Right Ctrl) | Ouvrir l'éditeur de HUD (glisser-déposer les éléments) |
| Clic gauche *(dans le ClickGUI)* | Activer / désactiver un module |
| Clic droit sur un module | Déplier ses réglages |
| Survoler un module + une touche | Assigner ce raccourci au module |

Tous les réglages (modules actifs, raccourcis, position des HUD, thème) sont **sauvegardés
automatiquement** et retrouvés à la prochaine session.

---

## 🧩 Compatibilité & prérequis

- **Jeu** : Minecraft Java Edition **1.8.9** avec **Forge**.
- **Compte** : un **compte Microsoft / Minecraft officiel** (les comptes crackés ne sont pas pris en charge).
- **Système** : Windows 64 bits pour le launcher.
- **OptiFine 1.8.9** : compatible, peut cohabiter avec le client.

---

## ❓ FAQ

**Est-ce que je peux me faire bannir avec Hasu Client ?**
Non. Le client n'envoie rien au serveur et ne modifie aucune interaction de combat. Il est dans la même
catégorie que Lunar/Badlion : ce sont des améliorations visuelles et de performance, autorisées.

**Faut-il installer Java ou Forge à la main ?**
Non. Le launcher embarque son propre environnement d'exécution et se charge de lancer Minecraft + Forge +
le client pour toi.

**Comment se font les mises à jour ?**
Automatiquement : le launcher détecte la dernière version, la télécharge et vérifie son intégrité
(SHA-256) avant de l'installer.

**Que se passe-t-il si la connexion Microsoft échoue ?**
Un bouton **« Jouer en hors-ligne »** apparaît pour te permettre de lancer le jeu malgré tout.

---

## 📌 Statut

Projet en **bêta**, activement développé. Les retours et suggestions sont les bienvenus.

*Hasu Client n'est pas affilié à Mojang, Microsoft, Lunar Client ni Badlion Client.*
