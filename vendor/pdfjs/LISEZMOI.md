# PDF.js

Lecteur de PDF de Mozilla, celui de Firefox. Il sert au Journal à lire les PDF déposés ou liés
(nombre de pages, signets, texte), sur l'appareil, sans rien envoyer.

- Version : 4.10.38 (paquet npm `pdfjs-dist`, dossier `legacy/build`, qui fonctionne aussi sur les navigateurs un peu anciens)
- Licence : Apache 2.0 (fichier `LICENSE`)
- Source : https://github.com/mozilla/pdf.js

Ces deux fichiers ne sont chargés que lorsqu'un PDF est ouvert. Leur contenu n'est pas modifié : ils sont
seulement renommés de `.mjs` en `.js` (`pdf.min.js`, `pdf.worker.min.js`), pour que tout hébergeur les serve
comme du JavaScript.
Pour mettre à jour : remplacer ces deux fichiers par `legacy/build/pdf.min.mjs` et
`legacy/build/pdf.worker.min.mjs` d'une version plus récente du paquet (en les renommant de même), puis
relancer les tests (`node tests/e2e.cjs`).

Empreintes SHA-256 :
44ec6f011027ee77791386b66c14876a5fc29e20bf0433c07c6726fff7212b72  pdf.min.js
bd88805178a26c729db8c0107a5b630cb900ec070f4d8c7529a3e45530afd41d  pdf.worker.min.js
