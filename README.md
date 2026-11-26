# Le Journal de Bord

Application web (PWA) de suivi de rédaction de thèse et de mémoire : https://lejournaldebord.org

Parti pris : peu de fonctions, mais soignées, et toutes sous les yeux. Le bureau d'un·e doctorant·e : la thèse en rayon (un livre par chapitre, qui se surligne à mesure qu'on écrit), une saisie en un geste, et un peu d'humour pour tenir.

## Ce que fait l'application

**Ma thèse**

- **Le bandeau** : avancement en pourcentage, pages rédigées, grade du moment et pages restantes avant le suivant ; le dépôt en éphéméride (une date précise ou seulement un mois visé) avec son compte à rebours, le verdict (dans les temps ou en retard), le rythme actuel, le rythme à tenir, la fin estimée.
- **Aujourd'hui** : objectif du jour calculé d'après le dépôt, bouton « +1 page » (ou « Synchroniser » quand un document est lié), pages de la semaine jour par jour, série de jours d'écriture, prochaine séance prévue.
- **La thèse en rayon** : un livre par chapitre, d'autant plus épais que le chapitre est long, surligné à hauteur de ce qui est écrit. La plante pousse avec la série ; après dix jours sans une page, une araignée s'installe.
- **Le plan** : chapitres et sous-sections, boutons − et + sur chaque partie, échéance proposée par chapitre, statut de relecture (chez la direction, à corriger, validé) avec mail de relance.
- **Synchro avec le document** : Word (`.docx`), LibreOffice (`.odt`), Google Docs (par son lien de partage), LaTeX (`.tex`), Markdown, texte simple, ou texte collé. Tout est lu sur l'appareil, rien n'est envoyé. Le Journal repère à quel niveau de titre sont les chapitres (titre de thèse en « Titre 1 », thèse en parties…), propose le plan, et retient les choix faits pour ce document : les fois suivantes, un geste suffit. Les pages sont celles du document (voir « Compter les pages »). Un document pour tout le manuscrit, ou un par chapitre (« Ajouter un chapitre ») ; on peut à tout moment en changer, refaire le plan à partir de lui, ou l'oublier. Sur Chrome et Edge, un fichier reste lié et se relit tout seul ; un Google Doc lié se relit tout seul partout, téléphone compris.
- **Journal** : calendrier de régularité, notes du jour, et les journées de thèse sans pages (terrain, lectures, colloque, formation…), qui comptent dans la série. Un joker par semaine pour souffler sans la casser. Un défi de la semaine, vérifié tout seul, que l'on peut refuser d'une croix.
- **Périodes sans rédaction** (terrain, colloque, congés…) : pendant ces périodes, le rythme à tenir se recalcule sur les autres jours, la fin estimée recule d'autant, et la série ne casse pas.
- **Agenda** : les créneaux d'écriture (un horaire commun, ou un par jour), avec rappel, envoyés vers Google Agenda (un lien prérempli par événement) ou dans un fichier `.ics` (Apple, Outlook). S'y ajoutent au choix le bilan de la semaine, un rappel pour envoyer ses pages à sa direction, le dépôt (ou la période visée, sur tout le mois) et les échéances des chapitres.
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
| `index.html` | Structure de la page, jeu d'icônes (en tête du `<body>`), fenêtres, modèles des images à partager |
| `style.css` | Styles : couleurs et polices en tête de fichier, puis un sommaire des sections |
| `app.js` | Application : connexion, synchronisation, interface |
| `core.js` | Logique pure et testée : dates, série, rythme, échéance, plan collé |
| `outline.js` | Du document au plan : niveau de titre des chapitres, parties, lecture du LaTeX et du Markdown (pur et testé) |
| `humour.js` | Textes : notes du jour, dictionnaire du doctorant, grades, bingo, pseudonymes |
| `visuals.js` | Dessins générés à partir des données : étagère, plante, barres de la semaine (pur et testé) |
| `promo.js` | La promo : fiches, classement, fil, encouragements |
| `docx.js` | Lecture des documents dans le navigateur : Word (texte, titres et mise en page), LibreOffice, HTML du presse-papiers, texte |
| `pages.js` | La pagination d'un document : chasse des polices, découpe en lignes, remplissage des pages, repères de Word, PDF de Google Docs (pur et testé) |
| `ics.js` | Génération des fichiers agenda |
| `sw.js` | Service worker (réseau d'abord, cache en secours) |
| `fonts/` | Polices Fraunces (titres, citations) et DM Sans (interface, chiffres), hébergées ici (licence OFL, voir `fonts/OFL.txt`) |
| `firestore.rules` | Règles de sécurité de la base, à publier dans la console Firebase |
| `tests/` | Tests (voir plus bas). Rien dans ce dossier n'est chargé par le site |

## Apparence

Tout se règle en tête de `style.css` : le papier et l'encre, le pétrole (structure, surfaces sombres), le safran (surligneur). Chaque couleur a un rôle et un seul :

- **safran** : l'avancement (jauges, livres de l'étagère) et le bouton principal ;
- **pétrole** : la structure, et les pages dans le temps (barres de la semaine, calendrier de régularité) ;
- **vert, terre cuite, bordeaux** : les états (dans les temps, en attente, en retard), toujours accompagnés d'une icône et de mots.

Les icônes sont dessinées dans `index.html` (`<symbol id="i-…">`) et s'emploient ainsi : `<svg class="ic"><use href="#i-home"/></svg>`. Sur ordinateur, les outils sont dans la barre latérale ; sur téléphone, dans le panneau ouvert par l'onglet « Menu ».

## Formats de document

| Source | Comment | Ce qui est reconnu | D'où viennent les pages |
| --- | --- | --- | --- |
| Word | fichier `.docx` | styles Titre 1 à 9, niveaux hiérarchiques, notes, tableaux, images | pagination enregistrée par Word (exacte) |
| Google Docs | lien de partage, ou téléchargement en `.docx` | titres, notes, tableaux, images | PDF de Google Docs (exacte) si le document est lié ; mise en page simulée s'il est téléchargé |
| LibreOffice | fichier `.odt`, ou `.docx` | titres (y compris ceux d'un document converti depuis Word), notes, tableaux | nombre de pages du fichier ; mise en page simulée pour un `.docx` |
| Word en ligne, Notion… | copier-coller | titres du presse-papiers (h1 à h6), listes, tableaux | densité courante, à corriger une fois |
| LaTeX | fichier `.tex` ou texte collé | `\part`, `\chapter`, `\section`… ; commentaires, formules et citations non comptés | densité courante, à corriger une fois |
| Markdown, texte | fichier `.md`, `.txt` ou texte collé | titres `#`, lignes « Chapitre 1 », « Partie II », « Introduction », « Conclusion » | densité courante, à corriger une fois |

Non lus, avec un message qui dit quoi faire : ancien Word `.doc`, RTF, Pages, PDF (enregistrer en `.docx`, ou coller le texte).

### Compter les pages

Le nombre de pages n'est pas dans le texte : il dépend de la mise en page. Une moyenne de « mots par page » se trompe facilement de 30 à 50 % (un document en Arial 11 à interligne 1,15 contient presque deux fois plus de texte par page qu'un autre en Times 12 à interligne double). Le Journal prend donc les pages à la meilleure source disponible (`pages.js`) :

1. **La pagination réelle.** Word laisse dans le fichier un repère à chaque début de page tel qu'il l'a affiché : on les compte, et l'on sait sur quelle page tombe chaque titre. Pour un Google Doc lié, le navigateur télécharge aussi le document en PDF : ses signets donnent la page et la hauteur exactes de chaque titre.
2. **Sinon, une simulation de la mise en page**, lue dans le fichier : format et marges, en-têtes, police et corps de chaque passage (avec la chasse réelle des caractères des polices courantes), interligne, espacements, retraits, lignes veuves et orphelines, titres solidaires, sauts de page, notes de bas de page, images, tableaux, colonnes. Les règles propres à chaque logiciel sont suivies (Google Docs calcule ses interlignes autrement pour les documents créés avant fin 2020).
3. **Sans mise en page à lire** (texte collé, LaTeX, Markdown) : 2 700 signes par page, ce que contient une page de thèse en Times 12, interligne 1,5, marges de 2,5 cm.

Dans tous les cas l'aperçu dit d'où vient le nombre, et un champ « Ce document fait N pages » permet de le corriger : la correction est retenue pour ce document. Les pages de chaque partie sont l'écart entre les positions de deux titres ; elles sont arrondies ensemble, de sorte que leur somme reste le nombre de pages du document.

Le journal du jour, lui, suit les mots : changer d'interligne ou insérer un saut de page déplace la pagination sans que rien n'ait été écrit.

Mesuré sur trente-deux documents dont la vraie pagination est connue (cinq Google Docs et leur PDF, vingt-cinq documents rendus par LibreOffice en Times, Arial, Calibri, Cambria et Courier, de l'interligne simple au double, avec notes, tableaux et images, et deux fichiers Word réels) : nombre de pages exact pour trente, 2 % d'écart pour les deux autres (les plus chargés en images).

Limite connue : un Google Doc créé avant fin 2020 et simplement téléchargé en `.docx` peut être compté avec un écart (4 % en Arial, jusqu'à 15 % avec une police haute comme Open Sans), parce que le fichier ne dit pas laquelle des deux règles d'interligne de Google s'applique. Le lier par son lien donne la pagination exacte ; sinon, corriger le nombre de pages une fois suffit.

### Lier un Google Doc

Un document partagé en « Tous les utilisateurs disposant du lien » peut être téléchargé par le navigateur sans compte ni serveur intermédiaire (`https://docs.google.com/document/d/…/export?format=docx`, `pdf` ou `txt`). Le Journal garde l'identifiant du document avec le compte (le lien suit donc la personne sur tous ses appareils) et une signature de son texte : à chaque synchro, il télécharge d'abord le texte seul, et ne relit le fichier et le PDF que si quelque chose a changé. Un document non partagé donne un message qui explique le réglage à changer ; qui préfère ne pas partager son document le télécharge en `.docx` et le dépose.

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

Champs du journal : `chapters`, `startDate`, `milestones`, `documentTitle`, `updatedAt` (historiques), puis `version`, `deadline`, `deadlineMonth` (seul le mois est visé), `marginDays`, `writingDays`, `dailyGoal`, `introLast`, `sessionTime`, `sessionMinutes`, `slots` (horaire propre à un jour), `alarmMin`, `meetWeeks`, `pauses` (périodes sans rédaction), `defis`, `activity` (pages par jour), `journal` (entrées par jour : pages, note, et genre `k` pour une journée de terrain, de lectures… ou un joker), `trackedSince`, `docFiles`, `docIgnore`, `lastSeenAt`, `appVersion`, `clientId`.

Une fiche de `docFiles` décrit un document synchronisé : nom, date, mots suivis, mots par page de ce document, portée (tout le manuscrit ou un chapitre), niveau de titre des chapitres, et depuis la 4.1 la source de ses pages (`src`), son nombre de pages, la correction éventuelle (`k`), l'identifiant du Google Doc lié (`gdoc`) et la signature de son texte (`sig`). Jamais le texte.

Les écritures du journal se font en mode `merge` : l'historique d'un appareil n'efface jamais celui d'un autre. Les rares gestes qui retirent une entrée (oublier un document, annuler) réécrivent le journal en entier.

Sur l'appareil (stockage local du navigateur) : quelques réglages (dernière partie travaillée, grille de bingo cochée, annonces déjà vues), une copie de secours du journal et, sur Chrome et Edge, le lien vers les fichiers Word. « Supprimer mon compte » efface le tout.

## Tester

```bash
node tests/core.test.mjs
```

Logique pure (dates, série, rythme, périodes sans rédaction, joker, défi de la semaine, plan collé, découpage d'un document en chapitres, pagination, lecture d'un PDF, dessins de l'étagère et de la semaine). Aucune dépendance.

```bash
node tests/e2e.cjs
```

Trente-deux scénarios dans un vrai navigateur (Playwright) : inscription, plan, « +1 page », étagère, synchro du document (pages lues dans le fichier, niveaux de titre, plan refait, chapitre ajouté, nombre de pages corrigé, document oublié, LibreOffice, LaTeX, copier-coller), Google Doc lié (les adresses de Google y sont simulées), journée de terrain, joker, période sans rédaction, défi de la semaine, agenda (créneaux par jour, Google Agenda, fichier `.ics`), période visée, téléphone (onglets, menu), sécurité des données, annonce de mise à jour, promo fermée puis ouverte, lien de fiche, bingo, suppression de compte, accessibilité de base (dont le contraste de tous les textes visibles), mise à jour à cheval sur deux versions. Firebase y est remplacé par des bouchons (`tests/stubs`) : aucun compte créé, aucune donnée réelle touchée. Pour un seul scénario : `ONLY="Promo ouverte" node tests/e2e.cjs`.

Les documents de `tests/fixtures` ont une mise en page de thèse (Times New Roman 12, interligne 1,5) ; le nombre de pages attendu dans les tests est celui que LibreOffice leur donne.

```bash
cd tests && npm install && npm run rules
```

Les règles de `firestore.rules` face au vrai moteur de règles, sur l'émulateur local de Firestore (Java requis). Si les tests de navigateur ont tourné juste avant, les écritures réellement faites par l'application y sont rejouées.

## Publier une nouvelle version

1. Augmenter la version aux trois endroits, avec la même valeur : `VERSION` dans `sw.js`, `APP_VERSION` dans `app.js`, `data-app-version` en tête de `index.html`. Un test vérifie qu'elles concordent.
2. Pour annoncer la mise à jour à la connexion : augmenter `WHATSNEW_VER` dans `app.js` et adapter le texte de la fenêtre `whatsNewModal` dans `index.html`. Les nouveaux comptes ne la voient pas.
3. Si un fichier est ajouté, l'ajouter à `ASSETS_TO_CACHE` dans `sw.js` ; si c'est un module, l'ajouter aussi aux deux listes de fichiers à redemander (en bas de `index.html` et en haut de `app.js`) et aux `modulepreload` de `index.html`.
4. Fusionner dans `main`, puis fusionner `main` dans la branche que GitHub Pages publie (`claude/thesis-tracker-spa-Dx6nk`, celle qui contient le fichier `CNAME`). Le site est à jour une minute plus tard.

Le service worker sert toujours la dernière version en ligne ; la copie en cache ne sert que hors ligne ou si le réseau est très lent. Si, pendant une mise à jour, la page et son script se retrouvent de deux versions différentes, l'application s'en aperçoit, redemande ses fichiers et se recharge toute seule.

## Dépendances externes

- Firebase 10.8.1 (connexion et base de données), chargé depuis `gstatic.com`.
- SortableJS 1.15.6 (glisser-déposer), version figée et contenu vérifié par le navigateur.
- JSZip et html2canvas, chargés seulement au moment de lire un fichier Word ou LibreOffice, ou de préparer une image, eux aussi vérifiés.

Aucune publicité, aucun outil d'analyse tiers, aucune police demandée à un serveur tiers.
