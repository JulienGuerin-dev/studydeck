# Tests réalisés et résultats

## Tests automatisés (`npm test`) : 50 / 50 réussis
| Domaine | Tests | Points vérifiés |
|---|---|---|
| SM-2 (`sm2.test`) | 5 | progression 1 j → 6 j → ×EF, échec, plancher 1,3, rejeu indépendant de l'ordre, ignorer les reprises |
| Session (`session.test`) | 4 | exemple exact du cahier des charges (A✓ B✗ C✓ D✗ E✓ → B✓ D✗ → D✓), toutes les cartes vues avant reprise, ordre aléatoire, fin de session |
| Bibliothèque / stats (`library.test`) | 10 | hiérarchie illimitée, déplacements, refus des cycles, identité de carte conservée, suppression en cascade, intégrité (détection + réparation), événements enregistrés, SM-2 persisté, stats cumulées par dossier/matière, règles « maîtrisée » et « difficile », cartes dues |
| Import/export/sauvegarde (`studydeck.test`) | 7 | JSON et ZIP, images conservées, hiérarchie, destination (existante / nouveau dossier / aplati), aperçu avec modification et retrait, messages d'erreur, aller-retour export→import, sauvegarde→restauration complète, refus d'une sauvegarde corrompue ou altérée |
| Rendu (`markdown.test`) | 5 | formules KaTeX (3 syntaxes), dollars non confondus, tableaux/listes/code, assainissement XSS, aperçus |
| Exemples (`examples.test`) | 3 | fichiers d'exemple livrés valides |
| **Synchronisation (`sync.test`)** | **16** | nouvelles cartes/dossiers dans les deux sens, idempotence, modification d'un côté, **conflit simultané** (deux versions, version écartée conservée et restaurable, choix propagé sans nouveau conflit), suppression propagée sans résurrection, suppression vs modification = conflit, **fusion des historiques sans double comptage**, images, cycle de dossiers, carte dans un dossier supprimé, **interruption = aucune modification**, fichier corrompu/altéré/propre, purge des tombstones après confirmation, après restauration |

## Test de fumée de l'application réelle (Electron sur écran virtuel Linux)
Lancement de l'application empaquetée (protocole `app://`, base IndexedDB persistante), puis, via l'interface : création d'une matière, d'une carte avec formules et tableau (aperçu KaTeX/tableau rendus), révision libre (recto visible, verso masqué, affichage au clavier, validation au clavier), bilan de session, page Statistiques. **Aucune erreur console.** Capture d'écran contrôlée visuellement.

## Non testé par moi (à valider sur vos appareils)
- Lancement de `StudyDeck.exe` sous **Windows** (le paquet est construit depuis Linux ; le même code Electron a été exécuté sous Linux). Premier lancement : SmartScreen peut demander « Exécuter quand même ».
- Synchronisation par fichier entre **deux vrais appareils** (le moteur est testé entre deux bases indépendantes simulées).
- Partie iPhone / PWA et synchronisation Wi-Fi : **pas encore développées** (étape suivante, après création du compte GitHub).

## Check-list de validation sur votre PC
1. Lancer StudyDeck.exe ; créer matière > dossier > sous-dossier ; créer une carte avec `$\frac{a}{b}$` et une image collée (Ctrl+V).
2. Importer `examples/exemple.studydeck` (aperçu, retirer une carte, importer).
3. Lancer une révision ; fermer brutalement l'application en cours de session ; rouvrir : les réponses données sont présentes dans Statistiques.
4. Créer une sauvegarde, supprimer une matière, restaurer la sauvegarde.
5. Fermer et rouvrir l'application hors connexion : les données sont toujours là.

---
# Mise à jour v1.1 — iPhone (PWA) et synchronisation Wi-Fi

## Tests automatisés : 62 / 62
Nouveaux : codec d'appairage (7 : aller-retour, mDNS, tolérance de saisie, détection de **toute** faute de frappe, reconstruction SDP, extraction d'un SDP réel), transmission (3 : blocs de 3 Mo vérifiés, coupure, délai d'attente), fusion simultanée avec un seul décideur (2).

## Tests dans l'application réelle (Electron, écran virtuel)
- **Synchronisation Wi-Fi de bout en bout** : deux instances isolées (stockages séparés) = deux appareils. Appairage par codes de 106 caractères (offre et réponse), vraie connexion WebRTC, échange, résumé, confirmation, application : les deux bibliothèques contiennent les 2 matières et 2 cartes, 0 erreur console.
- **PWA** : service worker activé, 68 fichiers en cache, rechargement **hors ligne** avec les données conservées, manifeste détecté, rendu à la taille d'un iPhone (390×844), glissement tactile → réponse « correcte » enregistrée.

## Non vérifié (à tester sur votre matériel)
- **Safari iOS réel** : comportement de WebRTC (adresses locales, partage de connexion), caméra/QR, installation sur l'écran d'accueil, partage de fichiers. Mon test WebRTC a été fait entre deux instances Chromium. Utilisez d'abord « Tester la connexion seulement ».
- Déploiement GitHub Pages (workflow non exécuté par moi).
- Gestes sur un vrai écran tactile (simulés par événements tactiles).

## Check-list iPhone
1. Pages publié ; ouvrir l'adresse dans Safari ; Partager → Sur l'écran d'accueil.
2. Mode avion + ouvrir l'icône : l'application s'ouvre.
3. Créer une carte avec formule ; réviser avec glissement droite/gauche ; essayer les boutons.
4. PC connecté au partage de connexion : PC « Afficher le code » (action : Tester la connexion) → iPhone « Scanner » → taper le code de réponse sur le PC → message « Connexion réussie ».
5. Refaire avec « Synchroniser » après avoir créé une carte sur chaque appareil ; provoquer un conflit (modifier la même carte des deux côtés).
6. Sauvegarde iPhone (partage → Fichiers) puis restauration.
