# 🧬 Généalogie du code (fork de Sol Client)

Azur Client vit **officiellement ici**, dans le dépôt `hasu-client`, dossier
`azur-client/`. C'est un fork GPL-3.0 de
[Sol Client](https://github.com/Sol-Client/Client) (© TheKodeToad and
Contributors) — voir [NOTICE.md](NOTICE.md) pour l'avis de modification.

`history.bundle` conserve l'**historique git complet d'origine** (927 commits de
Sol Client + les commits de transformation en Azur Client), que l'historique de
hasu-client ne porte pas. Pour l'explorer, ou pour promouvoir un jour Azur Client
dans son propre dépôt avec sa généalogie :

```bash
git clone history.bundle azur-client-histoire
cd azur-client-histoire && git log --oneline
```

La CI qui compile ce dossier est à la racine du dépôt :
`.github/workflows/azur-client-build.yml` (build à chaque push) et
`azur-client-release.yml` (publication des releases `azur-client-v*`).
