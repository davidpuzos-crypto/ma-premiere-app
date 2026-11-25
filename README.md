# Le Journal de Bord

Application web (PWA) de suivi de rédaction de thèse et de mémoire : https://lejournaldebord.org

Parti pris : peu de fonctions, mais soignées. Une page de thèse (du papier, de l'encre, une table des matières), une saisie en un geste, et un peu d'humour de doctorant·e pour tenir.

## Ce que fait l'application

**Ma thèse**

- **Page de titre** : avancement en pourcentage, pages rédigées, dépôt (une date précise ou seulement un mois visé), verdict (dans les temps ou en retard), fin estimée au rythme actuel.
- **Aujourd'hui** : objectif du jour calculé d'après le dépôt, série de jours d'écriture, bouton « +1 page ».
- **Table des matières** : chapitres et sous-sections, boutons − et + sur chaque partie, échéance proposée par chapitre, statut de relecture (chez la direction, à corriger, validé) avec mail de relance.
- **Synchro avec le document** : Word (`.docx`), LibreOffice (`.odt`), LaTeX (`.tex`), Markdown, texte simple, ou texte collé (le presse-papiers garde les titres de Google Docs et de Word). Tout est lu sur l'appareil, rien n'est envoyé. Le Journal repère à quel niveau de titre sont les chapitres (titre de thèse en « Titre 1 », thèse en parties…), propose le plan, et retient les choix faits pour ce document : les fois suivantes, un geste suffit. Un fichier pour tout le manuscrit ou un fichier par chapitre. Sur Chrome et Edge, le fichier reste lié et se relit tout seul ; ailleurs, un rappel discret apparaît quand la dernière synchro a plus d'une semaine.
- **Journal** : calendrier de régularité, notes du jour.
- **Agenda** : fichier `.ics` et liens Google Agenda. Séances d'écriture récurrentes, point d'étape hebdomadaire, dépôt (ou période visée, sur tout le mois), échéances des chapitres.
- **Bilan imprimable** pour le comité de suivi (CSI) ou la direction.
- **Hors ligne et multi-appareils** : cache local, synchronisation en temps réel.

**Entre doctorant·es**

- **Note de bas de page du jour** et **bingo de la semaine** : les mêmes pour tout le monde.
- **Images à partager** (post carré ou story) : avancement ou grille de bingo.
- **La promo** (facultative, sous pseudonyme) : classement de la semaine, fil de notes partagées, encouragements, fiche consultable par un lien. Elle reste invisible tant que les règles de sécurité ci-dessous ne sont pas publiées.

**Confidentialité et compte** : page d'explication, export, remise à zéro, suppression du compte.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de la page, fenêtres, modèles des images à partager |
| `style.css` | Styles (couleurs et polices en tête de fichier) |
| `app.js` | Application : connexion, synchronisation, interface |
| `core.js` | Logique pure et testée : dates, série, rythme, échéance, plan collé |
| `outline.js` | Du document au plan : niveau de titre des chapitres, parties, lecture du LaTeX et du Markdown (pur et testé) |
| `humour.js` | Textes : notes du jour, dictionnaire du doctorant, grades, bingo, pseudonymes |
| `promo.js` | La promo : fiches, classement, fil, encouragements |
| `docx.js` | Lecture des documents dans le navigateur : Word, LibreOffice, HTML du presse-papiers, texte |
| `ics.js` | Génération des fichiers agenda |
| `sw.js` | Service worker (réseau d'abord, cache en secours) |
| `fonts/` | Polices EB Garamond et Source Sans 3, hébergées ici (licence OFL, voir `fonts/OFL.txt`) |
| `firestore.rules` | Règles de sécurité de la base, à publier dans la console Firebase |
| `tests/` | Tests (voir plus bas). Rien dans ce dossier n'est chargé par le site |

## Formats de document

| Source | Comment | Ce qui est reconnu |
| --- | --- | --- |
| Word | fichier `.docx` | styles Titre 1 à 9, niveaux hiérarchiques, notes, tableaux, pagination de Word |
| LibreOffice | fichier `.odt` | titres (y compris ceux d'un document converti depuis Word), notes, tableaux, pagination |
| Google Docs, Word en ligne | copier-coller, ou téléchargement en `.docx` | titres du presse-papiers (h1 à h6), listes, tableaux |
| LaTeX | fichier `.tex` ou texte collé | `\part`, `\chapter`, `\section`… ; commentaires, formules et citations non comptés |
| Markdown, texte | fichier `.md`, `.txt` ou texte collé | titres `#`, lignes « Chapitre 1 », « Partie II », « Introduction », « Conclusion » |

Non lus, avec un message qui dit quoi faire : ancien Word `.doc`, RTF, Pages, PDF (enregistrer en `.docx`, ou coller le texte). Une connexion directe à Google Docs demanderait une autorisation Google propre à l'application : le copier-coller la remplace.

## Activer « La promo » (une fois, deux minutes)

1. Ouvrir la [console Firebase](https://console.firebase.google.com/), projet du Journal, **Firestore Database**, onglet **Règles**.
2. Remplacer tout le contenu par celui du fichier [`firestore.rules`](firestore.rules).
3. Cliquer sur **Publier**.

À leur prochaine ouverture, les utilisateurs voient apparaître l'onglet « La promo ». Rien d'autre à faire, et rien à redéployer.

Ces règles font aussi le ménage côté sécurité : le journal de chaque personne n'est lisible que depuis son compte, et tout ce qui n'est pas prévu est fermé.

### Ce que la promo montre, et ne montre pas

Une fiche contient : pseudonyme, discipline et année (facultatives), pourcentage d'avancement, pages de la semaine, série, calendrier de régularité des douze dernières semaines, et les notes que la personne choisit de partager (8 au plus, 240 caractères chacune).

Jamais : le nom, l'adresse email, le titre de la thèse, le plan, les notes privées. Les règles refusent tout autre champ.

### Modérer

- **Signalements** : le bouton « Signaler » d'un message crée un document dans la collection `reports` (auteur du signalement, fiche visée, texte). Ils se lisent dans la console Firebase, pas dans l'application.
- **Retirer une fiche** : supprimer le document `profiles/{identifiant}` dans la console.
- **Exclure quelqu'un** : créer un document dans la collection `banned`, avec pour identifiant celui de la fiche, puis supprimer la fiche. La personne garde son journal privé mais ne peut plus recréer de fiche.

## Données (Firestore)

| Emplacement | Contenu | Qui lit | Qui écrit |
| --- | --- | --- | --- |
| `users/{uid}/thesis/main` | Le journal : plan, pages, dates, notes | la personne | la personne |
| `profiles/{uid}` | La fiche publique de la promo | tout le monde par le lien, la liste pour les personnes connectées | la personne |
| `profiles/{uid}/cheers/{from}` | Un encouragement reçu | personnes connectées | celle qui encourage |
| `reports/{id}` | Un signalement | personne (console seulement) | personnes connectées |
| `banned/{uid}` | Exclusion de la promo | personne (console seulement) | personne (console seulement) |

Champs du journal : `chapters`, `startDate`, `milestones`, `documentTitle`, `updatedAt` (historiques), puis `version`, `deadline`, `deadlineMonth` (seul le mois est visé), `marginDays`, `writingDays`, `dailyGoal`, `introLast`, `sessionTime`, `sessionMinutes`, `activity` (pages par jour), `journal` (notes par jour), `trackedSince`, `docFiles`, `docIgnore`, `lastSeenAt`, `appVersion`, `clientId`.

Les écritures du journal se font en mode `merge` : l'historique d'un appareil n'efface jamais celui d'un autre.

Sur l'appareil (stockage local du navigateur) : quelques réglages (dernière partie travaillée, grille de bingo cochée, annonces déjà vues), une copie de secours du journal et, sur Chrome et Edge, le lien vers les fichiers Word. « Supprimer mon compte » efface le tout.

## Tester

```bash
node tests/core.test.mjs
```

Logique pure (dates, série, rythme, plan collé, découpage d'un document en chapitres). Aucune dépendance.

```bash
node tests/e2e.cjs
```

Vingt-huit scénarios dans un vrai navigateur (Playwright) : inscription, plan, « +1 page », synchro du document (niveaux de titre, plan refait, LibreOffice, LaTeX, copier-coller), période visée et agenda, mobile, sécurité des données, annonce de mise à jour, promo fermée puis ouverte, lien de fiche, bingo, suppression de compte, accessibilité de base, mise à jour à cheval sur deux versions. Firebase y est remplacé par des bouchons (`tests/stubs`) : aucun compte créé, aucune donnée réelle touchée. Pour un seul scénario : `ONLY="Promo ouverte" node tests/e2e.cjs`.

```bash
cd tests && npm install && npm run rules
```

Les règles de `firestore.rules` face au vrai moteur de règles, sur l'émulateur local de Firestore (Java requis). Si les tests de navigateur ont tourné juste avant, les écritures réellement faites par l'application y sont rejouées.

## Publier une nouvelle version

1. Augmenter la version aux trois endroits, avec la même valeur : `VERSION` dans `sw.js`, `APP_VERSION` dans `app.js`, `data-app-version` en tête de `index.html`. Un test vérifie qu'elles concordent.
2. Pour annoncer la mise à jour à la connexion : augmenter `WHATSNEW_VER` dans `app.js` et adapter le texte de la fenêtre `whatsNewModal` dans `index.html`. Les nouveaux comptes ne la voient pas.
3. Si un fichier est ajouté, l'ajouter à `ASSETS_TO_CACHE` dans `sw.js`.
4. Fusionner dans `main`, puis fusionner `main` dans la branche que GitHub Pages publie (`claude/thesis-tracker-spa-Dx6nk`, celle qui contient le fichier `CNAME`). Le site est à jour une minute plus tard.

Le service worker sert toujours la dernière version en ligne ; la copie en cache ne sert que hors ligne ou si le réseau est très lent. Si, pendant une mise à jour, la page et son script se retrouvent de deux versions différentes, l'application s'en aperçoit, redemande ses fichiers et se recharge toute seule.

## Dépendances externes

- Firebase 10.8.1 (connexion et base de données), chargé depuis `gstatic.com`.
- SortableJS 1.15.6 (glisser-déposer), version figée et contenu vérifié par le navigateur.
- JSZip et html2canvas, chargés seulement au moment de lire un fichier Word ou LibreOffice, ou de préparer une image, eux aussi vérifiés.

Aucune publicité, aucun outil d'analyse tiers, aucune police demandée à un serveur tiers.
