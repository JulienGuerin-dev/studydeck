# Guide d'utilisation

## Organisation
**Bibliothèque** : créez des matières (« + Matière »), des sous-dossiers à l'infini, des cartes. Chaque dossier propose : + Carte, + Sous-dossier, Réviser, Renommer, Déplacer, Exporter, Supprimer (avec confirmation indiquant le nombre d'éléments touchés). La recherche porte sur recto, verso, noms de matières/dossiers, avec filtres (à réviser, difficiles, jamais révisées, dossier).

## Éditeur de cartes
Recto et verso s'éditent séparément, avec aperçu en direct. Barre d'outils : gras, italique, titre, listes, tableau, formule (`$…$`), formule centrée (`$$…$$`), code, image (aussi par Ctrl+V). Ctrl+Entrée enregistre. Les images sont réduites à 1600 px max.

## Types de matières
Chaque **matière** (dossier racine) a un type, modifiable à tout moment (Bibliothèque → liste « Type », ou ✎ sur l'accueil) :
- **Apprentissage** : cycle de 6 étapes, planification et statistiques (type par défaut).
- **Loisir** : cartes simplement consultées, sans réussite/échec, sans planification.
- **Archive** : matière terminée, comportement identique au Loisir, rangée dans « Archives » (en bas de la bibliothèque, masquée sur l'accueil). Une matière passe **automatiquement** en archive quand toutes ses cartes ont réussi les 6 étapes.
Repasser une matière en **Apprentissage** demande l'étape où vous vous situez : toutes ses cartes sont placées à cette étape. L'étape d'une carte se corrige aussi à la main (fiche de la carte → « Étape d'apprentissage »).

## Les 6 étapes
Une carte neuve est à l'**étape 1** (à réviser dès sa création). Chaque réussite la fait monter ; le délai est compté depuis la révision réelle :
| Étape | Délai avant la révision |
|---|---|
| 1 | immédiate (création, 1re révision) |
| 2 | 2 jours après l'étape 1 |
| 3 | 4 jours après l'étape 2 |
| 4 | 7 jours après l'étape 3 |
| 5 | 2 semaines après l'étape 4 |
| 6 | 1 mois après l'étape 5 |
Réussir l'étape 6 = **carte terminée**.
- **Échec** : la carte reste à la même étape et revient après le délai de cette étape. **Deuxième échec consécutif** à la même étape : elle descend d'une étape (jamais sous la 1). Un échec isolé est donc pardonné.
- **Retard** : jamais pénalisé. Étape 1 non révisée pendant 2 jours : reste à l'étape 1. Étape 2 non révisée pendant 2 semaines : une réussite la fait passer à l'étape 3.
- **Révision libre** : une carte révisée avant son échéance est enregistrée dans les statistiques mais ne change pas d'étape.
- Les délais sont définis dans `src/review/levels.ts` (`DELAY_DAYS`). L'étape étant recalculée depuis l'historique, les modifier plus tard ne perd rien.

## Révision
- **Dues** : cartes des matières en apprentissage, jamais révisées ou dont l'échéance est arrivée. **Libre** : toutes les cartes du périmètre (Loisir/Archive consultées sans notation).
- Ordre aléatoire. Le verso est masqué (Espace/Entrée), puis **Correct** (→) ou **Incorrect** (←) ; sur téléphone : glisser la carte à droite/gauche.
- Une carte correcte sort de la session. Une carte incorrecte est reprise à la fin, jusqu'à ce qu'elle soit réussie (la reprise immédiate n'influence pas l'étape : seule la première présentation compte).
- **← Carte précédente** (touche Z) annule la dernière réponse autant de fois que nécessaire. L'historique n'est jamais effacé : une annulation est enregistrée et ignorée par les statistiques.
- **Modifier** ouvre l'éditeur sur la carte en cours ; **Supprimer** la retire de la bibliothèque.
- Chaque réponse est enregistrée immédiatement : fermer l'application en cours de session ne fait rien perdre.

## Statistiques
Par carte, dossier (sous-dossiers inclus), matière, avec l'historique des sessions et un tableau **par étape** : révisions, réussites, taux, nombre moyen d'essais pour réussir l'étape, retard moyen. Un bilan indique si le délai avant l'étape semble **trop long** (< 75 % de réussite), **bien réglé** ou **pouvant être espacé** (> 92 %), à partir de 15 révisions par étape. Seules comptent les réponses données quand la carte était due.
- **Terminée** : 6 étapes réussies (ou matière archivée). **Difficile** : ≥ 3 tentatives et < 60 % de réussite.

## Accueil
Chaque matière est une créature vivante : sa taille suit le nombre de cartes, son humeur l'état de la révision (endormie : rien à réviser ; agitée : beaucoup de cartes dues ; sereine : Loisir). Touchez-la pour voir ses chapitres ; ✎ personnalise l'emoji sur sa tête, sa couleur et son type. Un interrupteur « Créatures / Liste » est disponible.

## Sauvegarde / restauration
*Paramètres → Sauvegarde* : fichier `.studybackup` complet (cartes, images, historique). Vérification d'intégrité (somme SHA-256, compteurs, images) avant toute restauration ; la restauration remplace la bibliothèque après confirmation et crée d'abord une copie de sécurité automatique. Conservez vos sauvegardes sur un support externe.

## Raccourcis
Espace/Entrée : afficher la réponse · → : correct · ← : incorrect · Z : carte précédente · Échap : fermer une fenêtre · Ctrl+Entrée : enregistrer une carte.
