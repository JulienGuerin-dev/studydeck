# Synchronisation Wi-Fi directe PC ⇄ iPhone

## Principe
Connexion WebRTC chiffrée de bout en bout (DTLS) directement entre les deux appareils. Aucun serveur, aucun compte. L'appairage se fait sans Internet :
1. **PC** : Paramètres → Synchronisation → *Afficher le code* → un QR code et un code s'affichent.
2. **iPhone** : *Scanner le QR code* (caméra) — ou *Saisir le code*.
3. L'iPhone affiche un **code de réponse** (≈ 106 caractères, par groupes de 4). **Tapez-le sur le PC** (zone « Étape 2 »). Une somme de contrôle détecte toute faute de frappe ; majuscules/minuscules, tirets et confusions O/0, I/L/1 sont tolérés.
4. Les deux appareils échangent leurs données. Le **PC** affiche le résumé et les conflits éventuels, vous confirmez : la synchronisation s'applique sur les deux appareils. L'iPhone affiche le même résumé en lecture seule.

Le code contient les identifiants de connexion et l'empreinte du certificat de chaque appareil : seul l'appareil qui a scanné/saisi le code peut se connecter, et les données sont chiffrées.

## Réseaux
- **Partage de connexion de l'iPhone** (PC connecté à l'iPhone) : cas le plus fiable.
- **Wi-Fi de la maison** : fonctionne si la box n'isole pas les appareils entre eux (désactiver l'« isolation des clients » si besoin).
- **Wi-Fi public / école / hôtel** : l'isolation bloque presque toujours. Utilisez le partage de connexion.
- Garder la caméra active pendant le scan permet à Safari de donner sa vraie adresse (sinon masquée) : le scan est donc préférable à la saisie manuelle du code de départ.

## Test de connexion
Dans « Démarrer », choisissez **Tester la connexion seulement** : mesure l'aller-retour et transfère 200 Ko sans toucher aux données. Faites ce test en premier sur votre réseau.

## En cas d'échec
Le message indique la cause probable. Alternatives : partage de connexion, ou **synchronisation par fichier** (même moteur, même résultat).

## Sécurité et fiabilité
- Une seule personne décide (l'hôte) : les deux bibliothèques finissent identiques.
- Chaque bloc transféré est vérifié par SHA-256 ; les fichiers de synchronisation sont revérifiés avant utilisation.
- L'application est atomique sur chaque appareil. L'iPhone applique d'abord, puis le PC : si une coupure survient entre les deux, rien n'est perdu et une nouvelle synchronisation rétablit l'égalité.
- Rien n'est jamais écrasé sans choix : les versions écartées sont conservées et restaurables.
