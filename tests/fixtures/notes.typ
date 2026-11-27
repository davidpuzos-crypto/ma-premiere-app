// Some definitions presupposed by pandoc's typst output.
#let blockquote(body) = [
  #set text( size: 0.92em )
  #block(inset: (left: 1.5em, top: 0.2em, bottom: 0.2em))[#body]
]

#let horizontalrule = [
  #line(start: (25%,0%), end: (75%,0%))
]

#let endnote(num, contents) = [
  #stack(dir: ltr, spacing: 3pt, super[#num], contents)
]
#show terms: it => {
  it.children
    .map(child => [
      #strong[#child.term]
      #block(inset: (left: 1.5em, top: -0.4em))[#child.description]
      ])
    .join()
}

#let conf(
  title: none,
  authors: none,
  date: none,
  abstract: none,
  cols: 1,
  margin: (x: 1.25in, y: 1.25in),
  paper: "us-letter",
  lang: "en",
  region: "US",
  font: (),
  fontsize: 11pt,
  sectionnumbering: none,
  doc,
) = {
  set page(
    paper: paper,
    margin: margin,
    numbering: "1",
  )
  set par(justify: true)
  set text(lang: lang,
           region: region,
           font: font,
           size: fontsize)
  set heading(numbering: sectionnumbering)

  if title != none {
    align(center)[#block(inset: 2em)[
      #text(weight: "bold", size: 1.5em)[#title]
    ]]
  }

  if authors != none {
    let count = authors.len()
    let ncols = calc.min(count, 3)
    grid(
      columns: (1fr,) * ncols,
      row-gutter: 1.5em,
      ..authors.map(author =>
          align(center)[
            #author.name \
            #author.affiliation \
            #author.email
          ]
      )
    )
  }

  if date != none {
    align(center)[#block(inset: 1em)[
      #date
    ]]
  }

  if abstract != none {
    block(inset: 2em)[
    #text(weight: "semibold")[Abstract] #h(1em) #abstract
    ]
  }

  if cols == 1 {
    doc
  } else {
    columns(cols, doc)
  }
}
#show: doc => conf(
  title: [Les ponts suspendus en France au XIXe siècle],
  authors: (
    ( name: [Camille Durand],
      affiliation: [],
      email: [] ),
    ),
  cols: 1,
  doc,
)


= Introduction générale
<introduction-générale>
Les ponts suspendus apparaissent en France au début du dix-neuvième
siècle. Les ingénieurs hésitent entre le fer et la pierre#footnote[Voir
Navier, #emph[Rapport et mémoire sur les ponts suspendus], 1823.].

= Chapitre 1 : État de l’art
<chapitre-1-état-de-lart>
Un court paragraphe d’ouverture pour le premier chapitre, avec
#strong[du gras] et #emph[de l’italique].

== 1.1 Contexte général
<contexte-général>
Marc Seguin lance à Tournon le premier grand pont à câbles de fil de
fer. Chaque ouvrage est soumis à une épreuve de charge.

- premier élément de liste
- second élément de liste

== 1.2 Travaux existants
<travaux-existants>
Les archives départementales conservent les devis, les plans et les
procès-verbaux d’épreuve.

#align(center)[#table(
  columns: 2,
  align: (col, row) => (auto,auto,).at(col),
  inset: 6pt,
  [Ouvrage], [Année],
  [Tournon],
  [1825],
)
]

= Chapitre 2 : Méthodologie
<chapitre-2-méthodologie>
La méthode retenue combine dépouillement sériel et étude de cas
approfondie.

=== Un détail de méthode
<un-détail-de-méthode>
Un sous-sous-titre et son paragraphe.

= Conclusion générale
<conclusion-générale>
Les résultats montrent une diffusion rapide le long des grands fleuves.
