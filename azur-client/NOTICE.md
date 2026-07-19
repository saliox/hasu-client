# Avis de modification (GPL-3.0)

Azur Client est une version modifiée de **Sol Client**
(https://github.com/Sol-Client/Client), © 2021-2023 TheKodeToad and Contributors,
distribuée sous licence GNU GPL v3 (voir [LICENSE](LICENSE)).

Modifications apportées par Azur Client (© 2026 saliox), à partir du commit
`3cd5d60` (branche `develop`, 2 juillet 2023) :

- Rebranding complet en « Azur Client » : constantes, user-agent, titre de fenêtre,
  écran À propos, messages, fichiers de langue, logos et wordmark, noms des
  distributions (Prism/MultiMC, launcher officiel).
- Désactivation par défaut du backend « amis en ligne » (l'endpoint d'origine
  n'existe plus) ; backend configurable par propriété système ; option
  `broadcastOnline` désormais désactivée par défaut.
- Vérification de mise à jour pointée sur `saliox/azur-client`.
- Identifiants d'applications tierces (Discord Rich Presence, imgur) rendus
  configurables par propriétés système.
- Traduction française complétée (parité avec l'anglais).
- Workflows GitHub Actions modernisés (actions v4, release via
  softprops/action-gh-release).

L'historique git complet est conservé et fait foi du détail des modifications.
