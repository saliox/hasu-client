# 📥 Installer Azur Client

Azur Client se joue en **Minecraft 1.8.9**. Trois façons de l'installer, de la plus
simple à la plus manuelle. Dans tous les cas, récupère d'abord le dernier
[**release**](https://github.com/saliox/azur-client/releases/latest) :

| Fichier | Pour quel launcher |
|---|---|
| `azur-client-prism-launcher-<version>.zip` | **Prism Launcher / MultiMC** (recommandé) |
| `azur-client-mojang-launcher-<version>.zip` | Launcher **Minecraft officiel** |
| `wrapper-<version>.jar` | Usage avancé (classpath manuel) |

## 🟦 Prism Launcher / MultiMC (recommandé)

1. Télécharge `azur-client-prism-launcher-<version>.zip` (ne le décompresse pas).
2. Dans Prism/MultiMC : **Ajouter une instance → Importer** (ou glisse le zip sur la
   fenêtre).
3. Lance l'instance : Minecraft 1.8.9 + Azur Client démarrent, **OptiFine est
   téléchargé automatiquement** au premier lancement.

## 🟩 Launcher Minecraft officiel

1. Télécharge `azur-client-mojang-launcher-<version>.zip`.
2. Décompresse-le **dans ton dossier `.minecraft`** (`%APPDATA%\.minecraft` sous
   Windows) : il ajoute un dossier dans `versions/` et le jar dans `libraries/`.
3. Ouvre le launcher → **Configurations** → nouvelle configuration avec la version
   « Azur Client <version> » → **Jouer**.

## 🛠️ Depuis les sources

```bash
git clone https://github.com/saliox/azur-client.git
cd azur-client
./gradlew dist        # JDK 17 requis — sorties dans build/dist/
```

## ❓ Dépannage

- **Écran noir / crash au démarrage** : vérifie que l'instance utilise bien
  **Java 8** pour 1.8.9 (Prism le propose tout seul) — le *wrapper* lui-même est
  lancé par le launcher avec le Java qu'il choisit.
- **Pas d'OptiFine** : le premier lancement doit pouvoir accéder à optifine.net ;
  relance une fois le téléchargement terminé.
- **En jeu** : appuie sur **Échap → Mods** (ou la touche configurée) pour ouvrir
  l'interface d'Azur Client.

Un souci ? [Ouvre une issue](https://github.com/saliox/azur-client/issues/new/choose).
