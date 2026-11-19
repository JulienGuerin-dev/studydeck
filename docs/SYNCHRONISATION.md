# Synchronisation entre deux appareils

## État actuel
- **Moteur complet** (`src/sync/engine.ts`) : fusion bidirectionnelle, conflits, suppressions, historiques, images, atomicité.
- **Transport disponible : fichier `.studysync`** (secours prévu au cahier des charges).
- **Transport Wi-Fi direct (WebRTC, appairage QR + code)** : prévu avec la version iPhone. Il réutilisera exactement ce moteur ; seul le transport change.

## Procédure par fichier (PC ⇄ iPhone ou PC ⇄ PC)
1. Appareil A : *Paramètres → Synchronisation → Créer mon fichier de synchronisation*.
2. Transférez le fichier vers B (clé USB, messagerie, câble…).
3. Appareil B : *Importer le fichier de l'autre appareil* → lisez le résumé → résolvez les éventuels conflits → *Appliquer*.
4. Appareil B : *Créer ma réponse pour l'autre appareil* → importez-la sur A. Les deux bibliothèques sont alors identiques.

Avant chaque application, une **copie de sécurité automatique** est enregistrée (dossier `backups` des données de l'application). L'application est **atomique** : en cas d'erreur ou d'interruption, rien n'est modifié.

## Principe de fusion (trois voies, sans horloge)
Pour chaque dossier et chaque carte, on compare : ma version (L), celle de l'autre (R), la dernière version vue en commun côté moi (Bx) et côté lui (By, transmise dans le fichier).
- L = R : rien à faire.
- Seul l'autre a changé → je reçois sa version. Seul moi → je la garde (il la recevra à son import).
- Les deux ont changé → **conflit** : les deux versions sont affichées côte à côte, vous choisissez. La version écartée est conservée (*Versions écartées*, bouton *Restaurer cette version*).
- Suppression d'un côté + modification de l'autre → conflit (jamais de suppression silencieuse).
- Les suppressions sont des *tombstones* ; ils ne sont purgés définitivement que lorsque tous les appareils connus les ont confirmés.

## Statistiques
Les **événements de révision** (identifiant unique) sont fusionnés par union : aucun doublon, aucune perte. La planification SM-2 de chaque carte n'est jamais copiée : elle est **recalculée** en rejouant les événements, donc identique sur les deux appareils.

## Cas particuliers traités
Cycles de dossiers créés par deux déplacements concurrents, cartes ajoutées dans un dossier supprimé ailleurs (rattachées à « Récupéré »), même fichier importé deux fois (idempotent), fichier corrompu/modifié/propre à l'appareil (refusé), restauration d'une sauvegarde (les points de synchronisation sont réinitialisés : les écarts deviennent des conflits visibles).
