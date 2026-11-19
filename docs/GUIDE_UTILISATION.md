# Guide d'utilisation

## Organisation
**Bibliothèque** : créez des matières (« + Matière »), des sous-dossiers à l'infini, des cartes. Chaque dossier propose : + Carte, + Sous-dossier, Réviser, Renommer, Déplacer, Exporter, Supprimer (avec confirmation indiquant le nombre d'éléments touchés). La recherche porte sur recto, verso, noms de matières/dossiers, avec filtres (à réviser, difficiles, jamais révisées, dossier).

## Éditeur de cartes
Recto et verso s'éditent séparément, avec aperçu en direct. Barre d'outils : gras, italique, titre, listes, tableau, formule (`$…$`), formule centrée (`$$…$$`), code, image (aussi par Ctrl+V). Ctrl+Entrée enregistre. Les images sont réduites à 1600 px max.

## Révision
- **Dues** : cartes jamais révisées + cartes dont la date de révision est arrivée. **Libre** : toutes les cartes du périmètre (sous-dossiers inclus).
- Ordre aléatoire. Le verso est masqué (Espace/Entrée pour l'afficher), puis **Correct** (→) ou **Incorrect** (←).
- Une carte correcte sort de la session. Une carte incorrecte est reprise une fois toutes les cartes vues, jusqu'à ce qu'elle soit réussie.
- Chaque réponse est enregistrée immédiatement : fermer l'application en cours de session ne fait rien perdre.
- Bilan final : cartes, tentatives, correctes, incorrectes, taux, durée.

## Répétition espacée (SM-2)
Correct = note 4, Incorrect = note 1. Seule la **première présentation** d'une carte dans une session compte pour la planification ; les reprises immédiates sont enregistrées mais n'influencent pas l'intervalle.
Réussite : 1 jour, puis 6 jours, puis intervalle × facilité (2,5 au départ). Échec : retour à 1 jour et baisse de la facilité (minimum 1,3). Une carte revue dans la journée est due à partir de minuit du jour prévu.

## Règles de classement (statistiques)
- **Maîtrisée** : 3 dernières premières présentations correctes **et** intervalle ≥ 21 jours.
- **En difficulté** : ≥ 3 tentatives et taux de réussite < 60 % (reprises comprises).
- **À réviser** : jamais révisée, ou date de prochaine révision atteinte.
Les statistiques de dossier/matière incluent tous les sous-dossiers.

## Sauvegarde / restauration
*Paramètres → Sauvegarde* : fichier `.studybackup` complet (cartes, images, historique). Vérification d'intégrité (somme SHA-256, compteurs, images) avant toute restauration ; la restauration remplace la bibliothèque après confirmation et crée d'abord une copie de sécurité automatique. Conservez vos sauvegardes sur un support externe.

## Raccourcis
Espace/Entrée : afficher la réponse · → : correct · ← : incorrect · Échap : fermer une fenêtre · Ctrl+Entrée : enregistrer une carte.
