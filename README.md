# Hasu Client

Un client Minecraft léger pour **1.8.9 (Forge)**, dans l'esprit de Lunar ou Badlion.
Il rend le jeu plus lisible et plus fluide — et il ne triche pas.

Il y a deux morceaux :

- **Le launcher** — l'appli Windows qui te connecte avec ton compte Microsoft et lance le jeu en un clic.
- **Le client** — le mod Forge qui ajoute les HUD, l'interface et les optimisations une fois en partie.

> **Version actuelle : 1.57.0**

---

## Pourquoi tu ne risques rien

Hasu Client ne contient que du visuel, du confort et de la performance. Rien n'automatise le combat,
rien n'est envoyé au serveur. C'est exactement pour cette raison que Lunar et Badlion sont autorisés
sur des réseaux comme Hypixel.

**Ce qu'il y a dedans :** les HUD, le ClickGUI et ses thèmes, le fullbright, le boost FPS, le
toggle-sprint, le réglage du FOV, l'éditeur de HUD.

**Ce qu'il n'y aura jamais :** reach, hitbox modifiées, auto-clicker, killaura, anti-knockback,
ESP ou X-ray.

Compatible OptiFine — il est détecté automatiquement, mais pas fourni.

---

## Le launcher

- **Connexion Microsoft officielle.** Le flux Xbox Live / Minecraft classique. Tes identifiants ne
  passent jamais par nous, seulement un jeton de session — chiffré sur ta machine.
- **Un seul bouton.** « Jouer » lance Minecraft, Forge et le client. Aucun dossier ni profil à toucher.
- **Pas de Java à installer.** Le launcher embarque le sien.
- **Mises à jour automatiques.** Il vérifie au démarrage, télécharge, contrôle l'empreinte SHA-256,
  installe. Tu n'as rien à faire.
- **Mode hors-ligne de secours.** Si la connexion Microsoft échoue, un bouton « Jouer en hors-ligne »
  te laisse quand même entrer en jeu.
- **Console intégrée.** Les logs de la partie défilent en direct — pratique quand quelque chose cloche.

Deux formats au téléchargement : **`HasuLauncher-Setup.exe`** (installation classique, se met à jour
tout seul) ou **`HasuLauncher-portable.zip`** (clé USB, PC sans droits admin). Windows 64 bits.

---

## En jeu

**Les HUD** sont tous déplaçables avec l'éditeur intégré : keystrokes (ZQSD + clics), CPS, FPS, ping,
durabilité de l'armure, effets de potion en cours, coordonnées, compteur de combo.

**Le ClickGUI** range les modules par catégorie — HUD, joueur, visuel, performance. Chaque module a ses
réglages dépliables et son raccourci clavier. Trois thèmes : sombre, minimal, ou ta propre palette.

**Les modules** : toggle-sprint et FOV changer côté joueur, fullbright côté visuel, FPS boost côté
performance.

| Touche | Ce que ça fait |
|---|---|
| Maj droite | Ouvrir le ClickGUI |
| Ctrl droite | Ouvrir l'éditeur de HUD |
| Clic gauche sur un module | L'activer ou le couper |
| Clic droit sur un module | Déplier ses réglages |
| Survoler un module + une touche | Lui assigner ce raccourci |

Tout est sauvegardé tout seul : modules actifs, raccourcis, position des HUD, thème.

---

## Ce qu'il te faut

Minecraft Java **1.8.9 avec Forge**, un **compte Microsoft officiel** (les comptes crackés ne
fonctionnent pas), et Windows 64 bits pour le launcher.

---

## Questions fréquentes

**Je peux me faire bannir ?**
Non. Le client n'envoie rien au serveur et ne touche à aucune interaction de combat. Même catégorie
que Lunar et Badlion.

**Je dois installer Java ou Forge à la main ?**
Non, le launcher s'occupe de tout.

**Et les mises à jour ?**
Automatiques, avec vérification de l'empreinte SHA-256 avant installation.

**La connexion Microsoft plante, je fais quoi ?**
Le bouton « Jouer en hors-ligne » apparaît, tu peux lancer le jeu quand même.

---

Projet en bêta, développé activement. Les retours sont les bienvenus.

*Hasu Client n'est affilié ni à Mojang, ni à Microsoft, ni à Lunar Client, ni à Badlion Client.*
