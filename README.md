# Le Journal de Bord

Application web (PWA) de suivi de rédaction de thèse et de mémoire : https://lejournaldebord.org

Parti pris : peu de fonctions, mais soignées, et toutes sous les yeux. Le bureau d'un·e doctorant·e : la thèse en rayon (un livre par chapitre, qui se surligne à mesure qu'on écrit), une saisie en un geste, et un peu d'humour pour tenir.

## Ce que fait l'application

**Ma thèse**

- **Le bandeau** : où j'en suis (avancement en pourcentage, pages rédigées, grade du moment et pages restantes avant le suivant), quand j'aurai fini (« À ce rythme, dernière page le… », en grand, avec une phrase du jour selon la situation, puis le dépôt en éphéméride, son compte à rebours et le verdict : dans les temps ou en retard, et de combien), et à quelle vitesse (la vélocité en pages par semaine, sa tendance sur quatre semaines, le record, le rythme à tenir, une barre par semaine, et ce que rapporte une page écrite aujourd'hui). « Comment c'est calculé » donne la règle avec les chiffres du moment. Sur téléphone, la vélocité passe sous la carte « Aujourd'hui ».
- **Aujourd'hui** : objectif du jour calculé d'après le dépôt, bouton « +1 page » (ou « Synchroniser » quand un document est lié), pages de la semaine jour par jour, série de jours d'écriture, prochaine séance prévue.
- **La thèse en rayon** : un livre par chapitre, d'autant plus épais que le chapitre est long, surligné à hauteur de ce qui est écrit. La plante pousse avec la série ; après dix jours sans une page, une araignée s'installe.
- **Le plan** : chapitres et sous-sections, boutons − et + sur chaque partie, échéance proposée par chapitre, statut de relecture (chez la direction, à corriger, validé) avec mail de relance.
- **Synchro avec le document** : Word (`.docx`), LibreOffice (`.odt`), PDF (LaTeX, Overleaf, Pages, n'importe quel logiciel), Google Docs et Dropbox (par un lien de partage), LaTeX (`.tex`, plusieurs fichiers ou projet `.zip`), RTF, Typst, Markdown et ses cousins, texte simple, ou texte collé. Tout est lu sur l'appareil, rien n'est envoyé. Le Journal repère à quel niveau de titre sont les chapitres (titre de thèse en « Titre 1 », thèse en parties…), reconnaît les titres à leur mise en forme quand le document n'a pas de styles, propose le plan, et retient les choix faits pour ce document : les fois suivantes, un geste suffit. Les pages sont celles du document (voir « Compter les pages ») et vont au jour où le fichier a été enregistré. Un document pour tout le manuscrit, ou un par chapitre (« Ajouter un chapitre », ou plusieurs fichiers déposés ensemble) ; on peut à tout moment en changer, refaire le plan à partir de lui, ou l'oublier. Sur Chrome et Edge, un fichier reste lié et se relit tout seul, sans même quitter la fenêtre ; un document lié par son lien se relit tout seul partout, téléphone compris. L'historique des synchros montre ce que chacune a changé, partie par partie, et la dernière s'annule d'un clic. Application installée : « Partager » vers le Journal depuis le téléphone, « Ouvrir avec » sur ordinateur.
- **Journal** : calendrier de régularité, notes du jour, et les journées de thèse sans pages (terrain, lectures, colloque, formation…), qui comptent dans la série. Un joker par semaine pour souffler sans la casser. Un défi de la semaine, vérifié tout seul, que l'on peut refuser d'une croix.
- **Périodes sans rédaction** (terrain, colloque, congés…) : pendant ces périodes, le rythme à tenir se recalcule sur les autres jours, la vélocité ne baisse pas, la fin estimée recule d'autant, et la série ne casse pas.
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
| `core.js` | Logique pure et testée : dates, série, vélocité et pronostic, échéance, plan collé |
| `outline.js` | Du document au plan : niveau de titre des chapitres, parties, lecture du LaTeX et du Markdown (pur et testé) |
| `humour.js` | Textes : notes du jour, dictionnaire du doctorant, grades, phrases du pronostic, bingo, pseudonymes |
| `visuals.js` | Dessins générés à partir des données : étagère, plante, barres de la semaine et de la vélocité (pur et testé) |
| `promo.js` | La promo : fiches, classement, fil, encouragements |
| `docx.js` | Lecture des documents dans le navigateur : Word (texte, titres et mise en page), LibreOffice, PDF, RTF, projets en plusieurs fichiers, HTML du presse-papiers, texte |
| `pages.js` | La pagination d'un document : chasse des polices, découpe en lignes, remplissage des pages, repères de Word, sauts de page de LibreOffice, PDF de Google Docs (pur et testé) |
| `zip.js` | Ouverture des archives (`.docx`, `.odt`, projets zippés) avec le décompresseur du navigateur, sans bibliothèque (pur et testé) |
| `pdfread.js`, `pdfdoc.js` | Lecture d'un PDF (PDF.js, chargé à la demande), puis du texte au plan : signets, titres balisés, mise en forme (`pdfdoc.js` est pur et testé) |
| `links.js` | Les liens de partage : Google Docs, Dropbox, lien direct ; ceux qui ne peuvent pas être lus sont reconnus et expliqués (pur et testé) |
| `formats.js` | Les autres formats : RTF, Typst, Org, AsciiDoc, reStructuredText, projets LaTeX et Typst en plusieurs fichiers (pur et testé) |
| `vendor/pdfjs/` | PDF.js 4.10.38 (licence Apache 2.0), hébergé ici, chargé seulement quand on dépose un PDF |
| `ics.js` | Génération des fichiers agenda |
| `sw.js` | Service worker (réseau d'abord, cache en secours ; reçoit aussi les documents envoyés par « Partager ») |
| `manifest.json` | Application installable : raccourci, « Partager » (`share_target`) et « Ouvrir avec » (`file_handlers`) |
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
| Word | fichier `.docx` | styles Titre 1 à 9, niveaux hiérarchiques, notes, tableaux, images ; sans styles, les titres sont repérés à leur mise en forme (gras, corps, numérotation) | pagination enregistrée par Word (exacte) |
| LibreOffice | fichier `.odt` ou `.fodt` | titres, notes, tableaux ; titres sans styles | sauts de page enregistrés par LibreOffice (exacte) ; sinon nombre de pages du fichier |
| PDF | fichier `.pdf` (LaTeX, Overleaf, Typst, Pages, Word, tout logiciel) | plan lu dans les signets, sinon dans les titres balisés, sinon d'après la mise en forme ; en-têtes et pieds de page écartés | les pages du PDF (exactes) |
| Google Docs | lien de partage, ou téléchargement en `.docx` | titres, notes, tableaux, images | PDF de Google Docs (exacte) si le document est lié ; mise en page simulée s'il est téléchargé |
| Dropbox, lien direct | lien de partage du fichier | selon le format du fichier | selon le format du fichier |
| LaTeX | fichier `.tex`, plusieurs fichiers, projet `.zip` (Overleaf), ou texte collé | `\part`, `\chapter`, `\section`… ; `\input` et `\include` suivis ; commentaires, formules et citations non comptés | densité courante, à corriger une fois (ou déposer le PDF) |
| RTF | fichier `.rtf` | titres par leur style ou leur mise en forme | nombre de pages du fichier, sinon densité |
| Typst, Markdown, Quarto, R Markdown, Org, AsciiDoc, reStructuredText, texte | fichier ou texte collé | titres de chaque syntaxe, lignes « Chapitre 1 », « Partie II », « Introduction », « Conclusion » | densité courante, à corriger une fois |
| Word en ligne, Notion… | copier-coller | titres du presse-papiers (h1 à h6), listes, tableaux | densité courante, à corriger une fois |

Non lus, avec un message qui dit quoi faire : ancien Word `.doc`, Pages, Scrivener, EPUB (exporter en `.docx` ou en PDF), images, tableurs, présentations, archives chiffrées, PDF protégé par un mot de passe. Liens OneDrive, SharePoint, Overleaf et fichiers de Google Drive qui ne sont pas des Google Docs : ils ne peuvent pas être lus depuis un navigateur, le message propose une autre voie.

### Compter les pages

Le nombre de pages n'est pas dans le texte : il dépend de la mise en page. Une moyenne de « mots par page » se trompe facilement de 30 à 50 % (un document en Arial 11 à interligne 1,15 contient presque deux fois plus de texte par page qu'un autre en Times 12 à interligne double). Le Journal prend donc les pages à la meilleure source disponible (`pages.js`) :

1. **La pagination réelle.** Un PDF a ses pages. Word laisse dans le fichier un repère à chaque début de page tel qu'il l'a affiché : on les compte, et l'on sait sur quelle page tombe chaque titre. LibreOffice enregistre de même ses sauts de page. Pour un Google Doc lié, le navigateur télécharge aussi le document en PDF : ses signets donnent la page et la hauteur exactes de chaque titre.
2. **Sinon, une simulation de la mise en page**, lue dans le fichier : format et marges, en-têtes, police et corps de chaque passage (avec la chasse réelle des caractères des polices courantes), interligne, espacements, retraits, lignes veuves et orphelines, titres solidaires, sauts de page, notes de bas de page, images, tableaux, colonnes. Les règles propres à chaque logiciel sont suivies (Google Docs calcule ses interlignes autrement pour les documents créés avant fin 2020).
3. **Sans mise en page à lire** (texte collé, LaTeX, Markdown) : 2 700 signes par page, ce que contient une page de thèse en Times 12, interligne 1,5, marges de 2,5 cm.

Dans tous les cas l'aperçu dit d'où vient le nombre, et un champ « Ce document fait N pages » permet de le corriger : la correction est retenue pour ce document. Les pages de chaque partie sont l'écart entre les positions de deux titres ; elles sont arrondies ensemble, de sorte que leur somme reste le nombre de pages du document.

Le journal du jour, lui, suit les mots : changer d'interligne ou insérer un saut de page déplace la pagination sans que rien n'ait été écrit.

Mesuré sur des documents dont la vraie pagination est connue :

- trente documents simulés (cinq Google Docs et leur PDF, vingt-cinq documents rendus par LibreOffice en Times, Arial, Calibri, Cambria et Courier, de l'interligne simple au double, avec notes, tableaux et images) : nombre de pages exact pour vingt-huit, 2 % d'écart pour les deux autres (les plus chargés en images) ;
- vingt thèses réelles en PDF (archive ouverte HAL) : nombre de pages exact pour toutes, mots à 1 % près, plan retrouvé par les signets, les titres balisés ou la mise en forme ;
- quatorze documents LibreOffice : total exact pour tous, titres situés à 0,05 page près ;
- cinq modèles de thèse d'universités, enregistrés par Word : total exact par les repères pour tous. Privés de leurs repères (comme un document exporté par un autre logiciel), trois sont exacts à la simulation, un a une page de trop sur vingt-trois, et le dernier, dont chaque chapitre remplit exactement sa page avant un saut de page, en a trois de trop sur dix-sept.

Deux enseignements de ces modèles réels, suivis dans `pages.js`. Word ne laisse pas de repère à l'intérieur d'une table des matières, ni sur une page sans texte : quand le nombre de pages qu'il a enregistré dépasse de peu celui des repères, on le suit, et les pages manquantes sont rendues là où le contenu déborde sur ce qui ne peut pas porter de repère (les titres retombent alors sur les numéros de sa propre table des matières). Et une section qui commence après un saut de page et un paragraphe vide ne laisse pas de page blanche.

Limite connue : un Google Doc créé avant fin 2020 et simplement téléchargé en `.docx` peut être compté avec un écart (4 % en Arial, jusqu'à 15 % avec une police haute comme Open Sans), parce que le fichier ne dit pas laquelle des deux règles d'interligne de Google s'applique. Le lier par son lien donne la pagination exacte ; sinon, corriger le nombre de pages une fois suffit.

### Lier un document par son lien

Un document partagé en « Tous les utilisateurs disposant du lien » peut être téléchargé par le navigateur sans compte ni serveur intermédiaire (`https://docs.google.com/document/d/…/export?format=docx`, `pdf` ou `txt`). Le Journal garde l'identifiant du document avec le compte (le lien suit donc la personne sur tous ses appareils) et une signature de son texte : à chaque synchro, il télécharge d'abord le texte seul, et ne relit le fichier et le PDF que si quelque chose a changé. Un document non partagé donne un message qui explique le réglage à changer ; qui préfère ne pas partager son document le télécharge en `.docx` et le dépose.

Un fichier Dropbox partagé par lien se lit de la même façon : le Journal remplace l'hôte du lien par celui du téléchargement (`dl.dropboxusercontent.com`, qui accepte la lecture depuis une page web) et garde la clé du lien. Avant de relire le fichier, il n'en demande que l'en-tête (taille, date) : rien n'est téléchargé tant qu'il n'a pas changé, et un gros PDF est lu par morceaux. Le lien est gardé avec le compte, puisqu'il faut pouvoir relire le fichier depuis un autre appareil. Tout autre lien direct en `https` vers un fichier fonctionne si son hébergeur autorise la lecture depuis une page web (GitHub, par exemple). OneDrive, SharePoint, Overleaf et les fichiers de Google Drive qui ne sont pas des Google Docs ne le permettent pas : le lien est reconnu, et le message dit quoi faire à la place.

### Le pronostic : « à ce rythme, dernière page le… »

La date dépend de ce qu'on appelle le rythme (`pace` et `forecast` dans `core.js`). Sur des rédactions simulées (irrégulières, avec semaines blanches, accélérations et changements de régime), une simple moyenne des quatre dernières semaines est ce qui prédit le moins bien, et ce qui fait le plus bouger la date d'un jour à l'autre. Le Journal prend donc :

- une moyenne où chaque jour pèse moitié moins que huit semaines plus tard : les dernières semaines comptent le plus, les anciennes s'effacent en douceur ;
- sans les périodes sans rédaction, qui ne comptent ni en pages ni en jours et repoussent la fin d'autant ;
- avec, pour point de départ, le rythme d'avant le suivi (pages déjà écrites depuis la date de début), qui s'efface à mesure que le suivi prend le relais ;
- et une mémoire qui s'allonge quand on écrit peu (jusqu'à trente-deux semaines de demi-vie, pour garder une trentaine de pages en mémoire) : chez qui écrit moins d'une page par semaine, une seule page déplaçait sinon la date de plusieurs mois. Sur les mêmes simulations, les à-coups de la date sont divisés par deux sans perte de justesse.

La vélocité affichée est ce rythme, en pages par semaine ; la tendance le compare à ce qu'il était quatre semaines plus tôt (à partir de six semaines de suivi). « Ce que rapporte une page » est l'écart entre la date affichée et celle qu'on aurait avec une page de plus, ou sans les pages du jour : c'est exactement ce dont la date bouge à l'écran. Tant que le rythme repose sur peu de pages (moins de quatre semaines de suivi ou d'une douzaine de pages en mémoire), ce gain n'est pas chiffré. « Comment c'est calculé » le dit en clair, avec une marge d'un tiers de l'horizon : sur les simulations, la moitié des fins réelles tombent à moins de cette distance de la date annoncée.

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

Champs du journal : `chapters`, `startDate`, `milestones`, `documentTitle`, `updatedAt` (historiques), puis `version`, `deadline`, `deadlineMonth` (seul le mois est visé), `marginDays`, `writingDays`, `dailyGoal`, `introLast`, `sessionTime`, `sessionMinutes`, `slots` (horaire propre à un jour, une liste d'objets `{ d, t, m }`), `alarmMin`, `meetWeeks`, `pauses` (périodes sans rédaction), `defis`, `activity` (pages par jour), `journal` (entrées par jour : pages, note, et genre `k` pour une journée de terrain, de lectures… ou un joker ; ce genre est aussi écrit dans `s`, précédé d'un tilde, parce que les versions d'avant la 4.1 gardent `s` mais effacent `k` quand elles réenregistrent le journal), `trackedSince`, `docFiles`, `docIgnore`, `syncLog` (les vingt dernières synchros : document, jour, pages portées au journal, mots, écart par partie), `lastSeenAt`, `appVersion`, `clientId`.

Une fiche de `docFiles` décrit un document synchronisé : nom, date, mots suivis, mots par page de ce document, portée (tout le manuscrit ou un chapitre), niveau de titre des chapitres, et depuis la 4.1 la source de ses pages (`src`), son nombre de pages, la correction éventuelle (`k`), l'identifiant du Google Doc lié (`gdoc`) ou l'adresse du fichier lié (`url`, toujours en `https`), et la signature de son contenu (`sig`). Jamais le texte.

Firestore refuse un tableau placé directement dans un tableau : toute liste enregistrée est donc une liste de valeurs simples ou d'objets (en 4.1.0, l'horaire propre à un jour était envoyé en tableau de tableaux, ce qui faisait refuser l'enregistrement ; la 5.0 corrige la forme et reprend, depuis la copie locale, ce qui n'avait pas pu être enregistré).

Les écritures du journal se font en mode `merge` : l'historique d'un appareil n'efface jamais celui d'un autre. Les rares gestes qui retirent une entrée (oublier un document, annuler) réécrivent le journal en entier.

Sur l'appareil (stockage local du navigateur) : quelques réglages (dernière partie travaillée, grille de bingo cochée, annonces déjà vues), une copie de secours du journal et, sur Chrome et Edge, le lien vers les fichiers choisis. Un document reçu par « Partager » est gardé dans le cache du navigateur le temps d'être lu, puis effacé. « Supprimer mon compte » efface le tout.

## Tester

```bash
node tests/core.test.mjs
```

Logique pure (dates, série, vélocité et pronostic, périodes sans rédaction, joker, défi de la semaine, plan collé, découpage d'un document en chapitres, titres sans styles, pagination, archives, PDF, liens de partage, autres formats, phrases du pronostic, dessins de l'étagère, de la semaine et de la vélocité). Aucune dépendance.

```bash
node tests/e2e.cjs
```

Quarante scénarios dans un vrai navigateur (Playwright) : inscription, plan, « +1 page », étagère, pronostic et vélocité (ordinateur et téléphone), synchro du document (pages lues dans le fichier, niveaux de titre, titres sans styles, plan refait, chapitre ajouté, nombre de pages corrigé, document oublié, historique et annulation, LibreOffice, PDF, LaTeX, projets en plusieurs fichiers, RTF, copier-coller), fichier lié relu en continu et pages portées au bon jour, Google Doc et Dropbox liés (leurs adresses y sont simulées), « Ouvrir avec » et « Partager » (avec le vrai service worker), journée de terrain, joker, période sans rédaction, défi de la semaine, agenda (créneaux par jour, Google Agenda, fichier `.ics`), période visée, téléphone (onglets, menu), hors ligne, mise à jour entre deux versions, sécurité des données, annonce de mise à jour, promo fermée puis ouverte, lien de fiche, bingo, confidentialité et suppression du compte, accessibilité de base (dont le contraste de tous les textes visibles). Firebase y est remplacé par des bouchons (`tests/stubs`) : aucun compte créé, aucune donnée réelle touchée. Le bouchon de la base refuse ce que la vraie bibliothèque refuse avant tout envoi (un tableau dans un tableau, une fonction), pour qu'une forme de données invalide échoue en test et non en ligne. Pour un seul scénario : `ONLY="Promo ouverte" node tests/e2e.cjs`.

Les documents de `tests/fixtures` ont une mise en page de thèse (Times New Roman 12, interligne 1,5) ; le nombre de pages attendu dans les tests est celui que LibreOffice leur donne.

```bash
cd tests && npm install && npm run rules
```

Les règles de `firestore.rules` face au vrai moteur de règles, sur l'émulateur local de Firestore (Java requis). Si les tests de navigateur ont tourné juste avant, les écritures réellement faites par l'application y sont rejouées.

## Vidéos pour les réseaux sociaux

```bash
node tests/videos/video-1.cjs
```

```bash
node tests/videos/video-2.cjs
```

Chacune fabrique, image par image (façon stop motion, 8 images par seconde), une vidéo verticale de 1080 × 1920 pour les Reels, TikTok et les Stories : le site filmé sur un téléphone avec un compte de démonstration fictif et la base simulée des tests, des légendes sur un papillon adhésif, puis l'adresse du site. La première montre le dépôt de la thèse (chapitres retrouvés, pages comptées, étagère) ; la seconde, sur fond sombre, part de la question du repas de famille (« Et ta thèse, ça avance ? ») et y répond au dessert. Le résultat, avec une image de couverture, va dans `tests/.tmp/videos/`. Il faut Playwright et ffmpeg. Relancée après une mise à jour, elle montre la nouvelle version du site.

La thèse de démonstration (`tests/videos/these-demo.docx`, « Les ponts suspendus en France au XIXe siècle ») est fictive ; `these-demo.py` la refait. La scène où sont composées les images est `tests/videos/scene.html` ; les outils communs (captures, composition, encodage) sont dans `tests/videos/commun.cjs`, et chaque vidéo n'est plus qu'un scénario.

## Publier une nouvelle version

1. Augmenter la version aux trois endroits, avec la même valeur : `VERSION` dans `sw.js`, `APP_VERSION` dans `app.js`, `data-app-version` en tête de `index.html`. Un test vérifie qu'elles concordent.
2. Pour annoncer la mise à jour à la connexion : augmenter `WHATSNEW_VER` dans `app.js` et adapter le texte de la fenêtre `whatsNewModal` dans `index.html`. Les nouveaux comptes ne la voient pas.
3. Si un fichier est ajouté, l'ajouter à `ASSETS_TO_CACHE` dans `sw.js` ; si c'est un module, l'ajouter aussi aux deux listes de fichiers à redemander (en bas de `index.html` et en haut de `app.js`) et aux `modulepreload` de `index.html`.
4. Fusionner dans `main`, puis fusionner `main` dans la branche que GitHub Pages publie (`claude/thesis-tracker-spa-Dx6nk`, celle qui contient le fichier `CNAME`). Le site est à jour une minute plus tard.

Le service worker sert toujours la dernière version en ligne ; la copie en cache ne sert que hors ligne ou si le réseau est très lent. Si, pendant une mise à jour, la page et son script se retrouvent de deux versions différentes, l'application s'en aperçoit, redemande ses fichiers et se recharge toute seule.

## Dépendances externes

- Firebase 10.8.1 (connexion et base de données), chargé depuis `gstatic.com`.
- SortableJS 1.15.6 (glisser-déposer), version figée et contenu vérifié par le navigateur.
- html2canvas, chargé seulement au moment de préparer une image à partager, version figée et contenu vérifié.
- JSZip, seulement sur un navigateur ancien qui ne sait pas décompresser seul (les autres ouvrent Word et LibreOffice avec `zip.js`, donc aussi hors ligne).
- PDF.js n'est pas une dépendance externe : il est hébergé avec le site (`vendor/pdfjs/`, empreintes dans son `LISEZMOI.md`).

Aucune publicité, aucun outil d'analyse tiers, aucune police demandée à un serveur tiers.
