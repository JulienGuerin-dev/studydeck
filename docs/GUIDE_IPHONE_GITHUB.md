# Mettre StudyDeck sur l'iPhone (GitHub Pages)

GitHub héberge **uniquement le code** de l'application (comme un site vide). Vos cartes, images et statistiques restent dans l'iPhone et dans le PC ; elles ne passent jamais par GitHub.

## A. Publier (une seule fois)
1. Dépôt `JulienGuerin-dev/studydeck` en **Public** (obligatoire pour Pages gratuit).
2. **Settings → Pages → Source : GitHub Actions**.
3. Ajoutez le fichier de publication : sur la page du dépôt, **Add file → Create new file**. Dans le nom, tapez exactement `.github/workflows/deploy.yml` (les « / » créent les dossiers), collez le contenu du fichier `deploy.yml` fourni dans ce paquet, puis **Commit changes**.
4. Déposez aussi les fichiers modifiés de cette version (voir « Mettre à jour le dépôt » ci-dessous).
5. Onglet **Actions** : un travail « Déploiement GitHub Pages » démarre (≈ 2 minutes). Quand il est vert, l'adresse est :
   **https://julienguerin-dev.github.io/studydeck/**
   Si le travail est rouge, ouvrez-le et envoyez-moi le message d'erreur.

## B. Mettre à jour le dépôt
Le plus simple : **Add file → Upload files**, glissez-y TOUT le contenu du dossier extrait de `StudyDeck-code-source.zip` (sauf `node_modules`, `dist`, `release`), « Commit changes ». GitHub remplace les fichiers modifiés. Chaque dépôt de fichiers relance la publication automatiquement.

## C. Installer sur l'iPhone
1. Dans **Safari** (pas Chrome), ouvrez l'adresse ci-dessus. Attendez que l'écran d'accueil de StudyDeck s'affiche (le chargement initial met l'application en cache).
2. Bouton **Partager** (carré avec flèche) → **Sur l'écran d'accueil** → Ajouter.
3. **Ouvrez toujours StudyDeck depuis l'icône de l'écran d'accueil**, jamais depuis Safari : ce sont deux espaces de stockage différents. Installez AVANT de créer des cartes.
4. Coupez le Wi-Fi/4G et rouvrez l'icône : l'application doit fonctionner hors ligne.
5. Faites une sauvegarde de temps en temps (Paramètres → Sauvegarde → partager vers Fichiers / AirDrop / clé).

## D. Mises à jour
Après une mise à jour du dépôt, rouvrez l'application connectée à Internet ; la nouvelle version est téléchargée en arrière-plan et s'applique à la fermeture/réouverture suivante. Vos données ne sont pas touchées.

## Limites iOS à connaître
- Les « copies de sécurité automatiques » avant synchronisation n'existent que sur PC (iOS ne permet pas d'écrire des fichiers en arrière-plan). Sur iPhone, faites une sauvegarde manuelle avant une grosse synchronisation.
- Enregistrer un fichier passe par la feuille de partage (« Enregistrer dans Fichiers »). Si iOS ajoute « .zip » au nom, l'import l'accepte quand même.
