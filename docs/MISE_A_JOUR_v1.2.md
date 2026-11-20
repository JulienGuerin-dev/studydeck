# Mettre à jour vers la v1.2

⚠️ **Les deux appareils (PC et iPhone) doivent être mis à jour avant de resynchroniser** : le modèle de données a changé (étapes d'apprentissage, types de matières) et une synchronisation entre deux versions différentes est refusée avec un message clair.

## 0. Avant tout : sauvegardes
Sur le PC **et** sur l'iPhone : *Paramètres → Sauvegarde → Créer une sauvegarde*. Gardez les deux fichiers.

## 1. PC
1. Fermez StudyDeck.
2. Supprimez l'ancien dossier `StudyDeck` (vos données sont dans `%APPDATA%\StudyDeck`, elles ne sont pas touchées).
3. Extrayez `StudyDeck-Windows-v1.2.zip` et lancez `StudyDeck.exe` (si vous utilisez les raccourcis : relancez `Installer-StudyDeck.ps1`).
4. Au premier lancement, **vos cartes et votre historique sont conservés** ; l'étape de chaque carte est recalculée automatiquement à partir de l'historique (l'ancien système SM-2 est remplacé). Toutes vos matières sont en type « Apprentissage ».

## 2. GitHub (pour l'iPhone)
1. Extrayez `StudyDeck-code-source-v1.2.zip`.
2. Sur la page de votre dépôt : **Add file → Upload files**, glissez le contenu du dossier `studydeck` extrait (sans `node_modules`, `dist`, `release`), puis **Commit changes**. Le fichier `.github/workflows/deploy.yml` n'a pas changé : inutile de le renvoyer.
3. Onglet **Actions** : attendez que « Déploiement GitHub Pages » devienne vert (≈ 2 min).

## 3. iPhone
1. Connecté à Internet, ouvrez **StudyDeck depuis l'icône de l'écran d'accueil**, laissez-le charger quelques secondes, puis fermez-le complètement (balayage vers le haut) et rouvrez-le : la nouvelle version est active (la page d'accueil montre les créatures et « Révision » propose « ← Carte précédente »).
2. Si l'ancienne version persiste : réessayez une fois en ayant du réseau. Dernier recours : supprimer l'icône puis réinstaller — **faites d'abord la sauvegarde** (étape 0), car cela efface les données locales de l'iPhone ; restaurez-la ensuite.

## 4. Resynchroniser
Paramètres → Synchronisation → « Afficher le code » sur le PC, etc. Les types de matières, emojis et étapes se synchronisent.

## À savoir
- Si une ancienne synchronisation par fichier (`.studysync` de la v1.1) traîne, elle sera refusée : recréez-en un.
- Le test de connexion (« Tester la connexion seulement ») reste disponible.
