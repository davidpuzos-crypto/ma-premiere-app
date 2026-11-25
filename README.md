# Le Journal de Bord

Application web (PWA) de suivi de rédaction de thèse et de mémoire : https://lejournaldebord.org

## Ce que fait l'application

- **Plan** : chapitres, sous-sections, objectifs de pages, modèles de plan, glisser-déposer.
- **Journal du quotidien** : bouton « J'ai écrit », objectif du jour, série, pages de la semaine, calendrier de régularité, notes et humeur.
- **Échéance** : date de dépôt, marge de relecture, jours d'écriture, rythme à tenir, statut (dans les temps ou en retard), rétroplanning par chapitre.
- **Statuts de relecture** : chez la direction (avec compteur de jours et mail de relance), à corriger, validé.
- **Synchro avec Word** : lecture locale du `.docx` (rien n'est envoyé), détection des Titre 1 / Titre 2, notes de bas de page comprises, calibrage sur la pagination de Word.
- **Agenda** : fichier `.ics` (séances d'écriture avec rappel, dépôt, échéances des chapitres) et liens Google Agenda.
- **Partage** : image Instagram en post carré ou en story, partage natif sur mobile.
- **Bilan imprimable** pour le comité de suivi (CSI) ou un rendez-vous avec la direction.
- **Hors ligne et multi-appareils** : cache Firestore persistant et synchronisation en temps réel.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de la page, modales, modèle de l'image de partage |
| `style.css` | Styles (variables de couleurs en tête de fichier) |
| `app.js` | Application : Firebase, synchronisation, interface |
| `core.js` | Logique pure et testée : dates, série, rythme, échéance, rétroplanning |
| `docx.js` | Lecture des fichiers Word dans le navigateur |
| `ics.js` | Génération des fichiers agenda |
| `sw.js` | Service worker (réseau d'abord, cache en secours) |
| `tests/core.test.mjs` | Tests de `core.js` : `node tests/core.test.mjs` |

## Données (Firestore)

Un document par utilisateur : `users/{uid}/thesis/main`.

Champs historiques : `chapters`, `startDate`, `milestones`, `documentTitle`, `updatedAt`.
Champs ajoutés en v2 : `version`, `deadline`, `marginDays`, `writingDays`, `dailyGoal`, `introLast`,
`sessionTime`, `sessionMinutes`, `activity` (pages écrites par jour), `journal` (notes par jour),
`trackedSince`, `lastDocImport`, `lastSeenAt`, `appVersion`, `clientId`.

Les écritures se font en mode `merge` : l'historique d'un appareil n'efface jamais celui d'un autre.

### Règles de sécurité recommandées

Dans la console Firebase, Firestore, onglet Règles :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Publier une nouvelle version

1. Augmenter `VERSION` dans `sw.js` **et** `APP_VERSION` dans `app.js` (même valeur).
2. Si un nouveau fichier est ajouté, l'ajouter à `ASSETS_TO_CACHE` dans `sw.js`.
3. Pousser sur `main`.

Le service worker sert toujours la dernière version en ligne ; la copie en cache ne sert que hors ligne ou si le réseau est très lent.
