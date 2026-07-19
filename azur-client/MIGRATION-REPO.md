# 📦 Ce dossier = Azur Client en entier (hébergement provisoire)

Ce dossier contient **l'intégralité du code source d'Azur Client** (fork complet de
Sol Client, GPL-3.0) : les 424 fichiers Java, les ressources, le build Gradle, la CI.
Il vit provisoirement dans le dépôt `hasu-client` tant que le dépôt dédié
`saliox/azur-client` n'existe pas — la session Claude n'a pas le droit de créer des
dépôts GitHub.

`history.bundle` contient en plus **tout l'historique git** (927 commits de
Sol Client + les commits Azur) pour que le futur dépôt parte avec une vraie
généalogie (attribution GPL propre).

## Promouvoir vers le dépôt dédié (dès qu'il existe)

```bash
git clone history.bundle azur-client
cd azur-client
git remote set-url origin https://github.com/saliox/azur-client.git
git push -u origin claude/lunar-client-inspired-xk8j09
```

Puis supprimer ce dossier `azur-client/` de hasu-client.

## Builder directement depuis ce dossier

```bash
cd azur-client
./gradlew dist   # JDK 17 requis
```

> Note : la CI de hasu-client ne builde pas ce dossier (workflows séparés) ; la CI
> d'Azur Client (`.github/workflows/build.yml` de ce dossier) s'activera dans le
> dépôt dédié.
