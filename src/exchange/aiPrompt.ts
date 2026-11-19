/** Consigne à donner à une IA pour qu'elle génère un fichier d'import valide. */
export const AI_PROMPT = `Tu dois produire un fichier JSON de cartes mémoire (flashcards) au format « studydeck », à partir du cours que je te fournis.

RÈGLES DE FORMAT
- Réponds uniquement avec un bloc JSON valide (UTF-8), sans commentaire.
- Structure :
{
  "format": "studydeck",
  "version": 1,
  "name": "Nom du cours",
  "folders": [
    {
      "name": "Nom du dossier",
      "cards": [ { "front": "Question", "back": "Réponse" } ],
      "folders": [ { "name": "Sous-dossier", "cards": [ ... ], "folders": [ ... ] } ]
    }
  ],
  "cards": [ { "front": "...", "back": "..." } ]
}
- "folders" et "cards" sont facultatifs à chaque niveau ; la profondeur des dossiers est libre.
- "front" (recto) et "back" (verso) sont obligatoires, non vides, en Markdown.
- Formules mathématiques en LaTeX : $...$ dans le texte, $$...$$ pour une formule centrée. N'oublie pas de doubler les antislashs dans le JSON (\\\\frac, \\\\int…).
- Markdown autorisé : **gras**, *italique*, titres (##), listes (- et 1.), tableaux (| a | b |), blocs de code (\`\`\`).
- Une carte = une seule notion. Recto : question précise. Verso : réponse complète (définition, énoncé, conditions, exemple).

Organise les cartes par matière > chapitre > notion avec des dossiers imbriqués.`

export const EXAMPLE_DECK = {
  format: 'studydeck',
  version: 1,
  name: 'Exemple — Mathématiques',
  folders: [
    {
      name: 'Analyse',
      folders: [
        {
          name: 'Dérivées',
          cards: [
            { front: 'Définir la dérivée de $f$ en $a$.', back: "$$f'(a)=\\lim_{h\\to 0}\\frac{f(a+h)-f(a)}{h}$$\n\nLe nombre dérivé est la pente de la tangente à la courbe en $a$." },
            { front: 'Dérivées usuelles', back: '| $f(x)$ | $f\'(x)$ |\n| --- | --- |\n| $x^n$ | $n x^{n-1}$ |\n| $e^x$ | $e^x$ |\n| $\\ln x$ | $\\frac{1}{x}$ |' },
          ],
        },
        { name: 'Suites', cards: [{ front: 'Quand une suite $(u_n)$ est-elle de Cauchy ?', back: "$\\forall \\varepsilon>0,\\ \\exists N,\\ \\forall p,q\\ge N,\\ |u_p-u_q|<\\varepsilon$" }] },
      ],
    },
    { name: 'Algèbre', cards: [{ front: "Énoncer le théorème de Pythagore.", back: "Dans un triangle rectangle d'hypoténuse $c$ : $a^2+b^2=c^2$." }] },
  ],
  cards: [],
}
