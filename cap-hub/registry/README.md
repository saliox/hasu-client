# Registre partagé Cap Hub

Ce dossier est le **registre public** des capes Cap Hub, servi tel quel via
`raw.githubusercontent.com` — aucun serveur, aucune base de données.

```
registry/
  capes.json        index : { format, players: { "<pseudo_minecraft>": { cape, updated } } }
  capes/<pseudo>.png les PNG de capes publiés par les joueurs
```

- **Lecture** : l'app récupère `capes.json` puis chaque `capes/<pseudo>.png` à la
  demande, avec cache disque. C'est ce qui permet à tous les joueurs Cap Hub de se
  voir entre eux sur n'importe quel serveur.
- **Écriture** : l'app publie via l'API GitHub *contents* avec un token
  fine-grained (`contents:write`). Le pseudo est normalisé en minuscules ; le PNG
  doit être une cape valide (64×32 / multiples, ou 46×22 OptiFine).

Les pseudos sont ceux du compte Minecraft. Ne publie que **ta** cape sur **ton**
pseudo.
