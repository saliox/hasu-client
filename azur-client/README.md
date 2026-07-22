<div align="center">

<img src="src/main/resources/assets/sol_client/textures/gui/icon.png" width="96" alt="Azur Client" />

# 💠 Azur Client

**Client Minecraft 1.8.9 open source, dans l'esprit de Lunar Client — 100 % fair-play.**

![minecraft](https://img.shields.io/badge/Minecraft-1.8.9-3ba55d)
![license](https://img.shields.io/badge/license-GPL--3.0-blue)
![base](https://img.shields.io/badge/base-Sol%20Client%20(audit%C3%A9)-8a2be2)

</div>

---

## ✨ C'est quoi ?

Azur Client est un client Minecraft **1.8.9** complet : HUDs configurables, réglages de
confort PvP, intégrations (OptiFine, ReplayMod, EntityCulling, Hypixel, Discord Rich
Presence, Quickplay…), le tout **open source (GPL-3.0)** et **sans aucune triche** —
uniquement du visuel, du confort et de la performance, pour la même raison que Lunar
Client et Badlion sont autorisés sur les grands serveurs.

## 🧬 Origine et audit

Azur Client est un **fork de [Sol Client](https://github.com/Sol-Client/Client)**
(GPL-3.0, archivé en juillet 2023), choisi comme base après un **audit de sécurité
complet** du code (~34 000 lignes de Java) : aucun code malveillant, aucune
exfiltration de données, binaires embarqués vérifiés (les sources C des natives sont
incluses dans le dépôt).

Changements par rapport à Sol Client :

- 🏷️ **Rebranding complet** en Azur Client (nom, logos, textes, distributions).
- 🔇 **Backend « amis en ligne » désactivé par défaut** — l'ancien serveur perso de
  l'auteur d'origine est mort ; l'option `broadcastOnline` est maintenant **opt-in**
  et le mod est inerte sans backend configuré
  (`-Dio.github.solclient.client.api=<url>` pour en brancher un).
- 🔄 **Vérification de mise à jour** via le manifeste `release.json` du dépôt (releases `azur-client-v*` de hasu-client).
- 🧾 Crédits et licence GPL-3.0 conservés (© TheKodeToad and contributors).

## 🚀 Installer / builder

**Joueurs** : suis le guide [INSTALL.md](INSTALL.md) (Prism/MultiMC en 3 clics, ou launcher officiel).


Prérequis : **JDK 17**.

```bash
./gradlew dist       # construit build/dist/ (jar + packs launcher)
./gradlew runClient  # lance le client en dev
```

Le build produit aussi des **packs d'import** pour Prism Launcher / MultiMC et le
launcher officiel Minecraft (voir `build/dist/`).

> ⚠️ OptiFine étant closed source, il est téléchargé automatiquement depuis
> optifine.net au premier lancement (mécanisme hérité de Sol Client).

## 🔧 Identifiants à personnaliser (hérités de Sol Client)

Deux services tiers utilisent encore les identifiants d'origine — fonctionnels,
mais à remplacer pour une identité 100 % Azur :

| Service | Effet actuel | Quoi faire |
|---|---|---|
| **Discord Rich Presence** | Le nom affiché sur les profils vient de l'app Discord de Sol Client | Créer une app « Azur Client » sur [discord.com/developers](https://discord.com/developers/applications) et mettre son ID dans l'option « ID d'application Discord » du mod (ou `-Dio.github.solclient.client.discord_app=<id>`) |
| **Upload imgur** | Les captures partent via le client-ID anonyme de Sol Client (quota partagé) | Créer un client-ID sur [api.imgur.com](https://api.imgur.com/oauth2/addclient) et le fournir via `-Dio.github.solclient.client.imgur_app=<id>` |

## 🛡️ Fair-play par conception

| ✅ Inclus | ❌ Volontairement absent |
|---|---|
| HUDs (FPS, CPS, keystrokes, armure…) | Reach / hitbox |
| Réglages PvP (FOV, toggle-sprint, zoom) | Auto-clicker |
| Fullbright, optimisations FPS | KillAura / aim-assist |
| ReplayMod, screenshots imgur | Velocity / anti-KB |
| Discord Rich Presence, Quickplay | ESP / X-ray |

## 📜 Licence

GPL-3.0 — voir [LICENSE](LICENSE). Basé sur Sol Client,
© 2021-2023 TheKodeToad and Contributors. Azur Client © 2026 saliox.
