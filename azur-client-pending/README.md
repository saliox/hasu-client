# ⏳ Azur Client — dépôt en attente (parking temporaire)

Ce dossier est **temporaire**. Il contient `azur-client.bundle` : une sauvegarde git
**complète** d'Azur Client (fork audité et rebrandé de Sol Client, GPL-3.0), en
attendant que le dépôt `saliox/azur-client` soit créé sur GitHub — la session Claude
n'a pas le droit de créer des dépôts.

Contenu du bundle : les 927 commits d'historique de Sol Client (attribution GPL
propre) + le commit « Azur Client 1.0.0 : fork audité de Sol Client, rebrandé et
assaini » sur la branche `claude/lunar-client-inspired-xk8j09`.

## Restaurer / pousser vers le vrai dépôt

```bash
git clone azur-client.bundle azur-client
cd azur-client
git remote set-url origin https://github.com/saliox/azur-client.git
git push -u origin claude/lunar-client-inspired-xk8j09
```

Une fois `saliox/azur-client` peuplé, **supprimer ce dossier** de hasu-client.
