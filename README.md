# StudyDeck — flashcards personnelles avec répétition espacée

Application de bureau (Windows) hors ligne, sans compte ni cloud. Données locales (IndexedDB).
Pile : Electron · React · TypeScript · Vite · Dexie · KaTeX · marked + DOMPurify · fflate · Vitest.

## Utiliser
Voir `docs/GUIDE_INSTALLATION.md` (PC), `docs/GUIDE_IPHONE_GITHUB.md` (iPhone), `docs/SYNCHRONISATION_WIFI.md`, puis `docs/GUIDE_UTILISATION.md`.

## Développer
```
npm install
npm test            # 62 tests automatisés
npm run dev         # interface seule dans le navigateur
npm start           # build + application Electron
npm run dist        # paquet Windows (zip) dans release/
npm run dist:installer   # (sous Windows) installateur NSIS + version portable
```

## Architecture (src/)
- `db/` types, base Dexie (10 tables), hachage SHA-256
- `domain/` dossiers, cartes, médias, intégrité (cycles, orphelins, réparation)
- `review/` SM-2, planification recalculée depuis les événements, logique pure de session, service
- `stats/` agrégation par carte / dossier / matière
- `exchange/` format .studydeck, sauvegarde, ZIP, consigne IA
- `sync/` moteur de synchronisation à trois voies (indépendant du transport)
- `platform/` accès fichiers (Electron ou navigateur) ; `ui/` interface
- `electron/` fenêtre, protocole `app://`, boîtes de dialogue, sauvegardes automatiques

## Évolutivité
Le code de l'interface fonctionne tel quel dans un navigateur (PWA iPhone à venir) : seul `platform/files.ts` change de comportement. Un nouveau transport de synchronisation (Wi-Fi) se branche sur `sync/engine.ts` sans le modifier. La planification est dérivée des événements : passer à FSRS ne demande que de remplacer `review/sm2.ts`.
