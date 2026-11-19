# Format d'échange `.studydeck` (version 1)

Format destiné à l'import de cartes (notamment générées par une IA). Il est **indépendant** du stockage interne de l'application.

## Deux formes acceptées
1. **Fichier JSON simple** (`.json` ou `.studydeck`) — pour des cartes sans image.
2. **Archive ZIP** (`.studydeck`) contenant :
   - `deck.json` (à la racine) ;
   - `media/` : images référencées par le texte (png, jpg, jpeg, gif, webp, svg).

## Structure de `deck.json`
```json
{
  "format": "studydeck",
  "version": 1,
  "name": "Nom du paquet (facultatif)",
  "folders": [
    {
      "name": "Analyse",
      "cards": [ { "front": "Question", "back": "Réponse" } ],
      "folders": [ { "name": "Suites", "cards": [], "folders": [] } ]
    }
  ],
  "cards": [ { "front": "Carte sans dossier", "back": "…" } ]
}
```
| Champ | Obligatoire | Règle |
|---|---|---|
| `format` | oui | exactement `"studydeck"` |
| `version` | oui | `1` |
| `name` | non | nom proposé pour le dossier créé à l'import |
| `folders[]` | non | liste de dossiers, **profondeur libre** (max 50 niveaux) |
| `folders[].name` | oui | texte non vide |
| `cards[]` | non | à la racine ou dans un dossier |
| `cards[].front` / `.back` | oui | texte Markdown non vide (≤ 200 000 caractères) |

Au moins une carte doit exister dans le fichier (20 000 cartes maximum).

## Contenu des cartes (Markdown + LaTeX)
- Gras `**…**`, italique `*…*`, titres `## …`, listes `- …` et `1. …`, tableaux `| a | b |`, blocs de code ``` ``` ```.
- Formules : `$…$` dans le texte, `$$…$$` centré (aussi `\( … \)` et `\[ … \]`). Dans le JSON, **doublez les antislashs** : `"$\\frac{a}{b}$"`.
- Images : `![légende](media/schema.png)` avec le fichier dans l'archive sous `media/schema.png`. Un chemin `media/…` absent de l'archive provoque une erreur claire à l'import.
- Les schémas, diagrammes et illustrations sont intégrés sous forme d'images (SVG accepté).
- HTML brut : assaini automatiquement (scripts et attributs dangereux supprimés).

## Validation à l'import
Lisibilité du fichier, version/format, présence de `front`/`back`, noms de dossiers, images présentes et de format reconnu. Les messages d'erreur indiquent la carte ou le dossier fautif. Aucune détection de doublons n'est effectuée (volontairement).

## Consigne prête à l'emploi pour une IA
Disponible dans l'application : **Paramètres → Importer → « Faire générer un fichier par une IA »**.
Un exemple complet est fourni : `examples/exemple.studydeck` (avec image) et `examples/exemple.json`.
