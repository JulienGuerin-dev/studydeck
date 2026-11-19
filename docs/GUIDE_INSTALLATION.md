# Installation sur Windows (Acer)

## Méthode simple (sans installation)
1. Décompressez `StudyDeck-Windows.zip` (clic droit → *Extraire tout…*) dans un dossier de votre choix.
2. Ouvrez le dossier `StudyDeck` et double-cliquez sur **`StudyDeck.exe`**.
   Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » (l'application n'est pas signée numériquement) : cliquez sur **Informations complémentaires → Exécuter quand même**.

## Méthode « vrai logiciel » (raccourcis Bureau + menu Démarrer)
Dans le dossier extrait, faites un clic droit sur **`Installer-StudyDeck.ps1` → Exécuter avec PowerShell**. Le script copie l'application dans `%LOCALAPPDATA%\StudyDeck` et crée les raccourcis. Désinstallation : supprimez ce dossier et les raccourcis.

## Où sont mes données ?
Dans le profil de l'application (`%APPDATA%\StudyDeck`). Elles survivent aux mises à jour. **Faites des sauvegardes** (Paramètres → Sauvegarde).

## Générer un installateur classique (.exe d'installation)
Sur un PC Windows avec Node.js : dans le dossier du code source, `npm install` puis `npm run dist:installer`. Les fichiers apparaissent dans `release/`.
(Le paquet fourni a été compilé depuis Linux, où la création d'un installateur NSIS n'est pas possible sans Wine.)

## Reconstruire depuis les sources
`npm install` · `npm test` · `npm start` (lancer) · `npm run dist` (paquet zip Windows).
