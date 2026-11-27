# Thèse de démonstration (fictive) pour les vidéos : « Les ponts suspendus en France au XIXe siècle »
# python3 tests/videos/these-demo.py tests/videos/these-demo.docx   (python-docx requis ; le fichier produit est déjà dans le dépôt)
# Times New Roman 12, interligne 1,5, A4, marges 2,5 cm, titres en styles « Titre 1 » et « Titre 2 ».
import random, sys
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK

OUT = sys.argv[1]
rng = random.Random(7)
S = [
  "Le pont suspendu s'impose en France au cours des années 1820 comme une réponse économique au franchissement des grands fleuves.",
  "Les archives départementales conservent les devis, les procès-verbaux d'épreuve et la correspondance des ingénieurs ordinaires.",
  "La légèreté de l'ouvrage, longtemps présentée comme une qualité, devient après 1850 un motif d'inquiétude pour l'administration.",
  "Les concessionnaires se remboursent par le péage, ce qui pèse sur la conception même des tabliers et des haubans.",
  "Le fil de fer, plus résistant que la chaîne à poids égal, autorise des portées que l'on jugeait jusque-là impossibles.",
  "Les épreuves de charge, réalisées en présence du maire et de l'ingénieur, donnent lieu à de véritables fêtes locales.",
  "La presse régionale suit les chantiers avec attention, entre fierté municipale et craintes à peine dissimulées.",
  "Le corps des Ponts et Chaussées hésite longtemps entre la défiance technique et l'intérêt pour un procédé peu coûteux.",
  "Les sources montrent que les riverains participent activement aux débats sur l'emplacement des piles et des culées.",
  "La question de l'entretien, souvent négligée dans les cahiers des charges, revient avec insistance dans les rapports d'inspection.",
  "La comparaison avec les ponts anglais nourrit une abondante littérature technique, traduite et commentée en France.",
  "Les plans conservés révèlent des modifications successives, parfois décidées en cours de chantier sous la pression des délais.",
  "Le vent et les oscillations, mal compris à l'époque, deviennent un sujet central après plusieurs incidents sur la Loire.",
  "Cette recherche s'appuie sur un corpus de soixante-deux ouvrages construits entre 1824 et 1860.",
  "Les ingénieurs défendent leur méthode en invoquant l'expérience accumulée plutôt que des calculs encore incertains.",
  "Le rôle des entrepreneurs privés éclaire les relations nouvelles entre l'État, les communes et les capitaux.",
  "On mesure ici combien l'innovation technique dépend des règles juridiques qui encadrent les concessions.",
  "Les catastrophes, rares mais spectaculaires, transforment durablement la perception publique de ces ouvrages.",
  "La circulaire ministérielle qui suit l'accident impose des inspections régulières et un registre des réparations.",
  "Les dessins d'exécution témoignent d'une culture graphique propre aux bureaux d'études de la première moitié du siècle.",
]
TITRES = [
  ('Introduction générale', [], 3600),
  ('Chapitre 1 : Le fer et le fil', [('1.1 Des ponts de chaînes aux ponts de fil', 3000), ('1.2 Les ingénieurs et le calcul des câbles', 3300), ('1.3 Construire vite et à moindre coût', 3100)], 0),
  ('Chapitre 2 : Tournon, le premier pont suspendu', [('2.1 Les frères Seguin', 3900), ('2.2 Un chantier sur le Rhône', 4000)], 0),
  ('Chapitre 3 : Après Angers, le temps de la défiance', [('3.1 La catastrophe de la Basse-Chaîne', 3900)], 0),
  ('Conclusion générale', [], 250),
]
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
for side in ('left_margin', 'right_margin', 'top_margin', 'bottom_margin'):
    setattr(sec, side, Cm(2.5))
normal = doc.styles['Normal']
normal.font.name = 'Times New Roman'
normal.font.size = Pt(12)
normal.paragraph_format.line_spacing = 1.5
normal.paragraph_format.space_after = Pt(0)
normal.paragraph_format.first_line_indent = Cm(1.25)
normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
for name, size in (('Heading 1', 16), ('Heading 2', 13)):
    st = doc.styles[name]
    st.font.name = 'Times New Roman'
    st.font.size = Pt(size)
    st.paragraph_format.space_before = Pt(18)
    st.paragraph_format.space_after = Pt(12)

def words(n):
    out, count = [], 0
    while count < n:
        para = []
        for _ in range(rng.randint(3, 6)):
            s = rng.choice(S)
            para.append(s)
            count += len(s.split())
        out.append(' '.join(para))
    return out

# Page de titre (pages liminaires)
t = doc.add_paragraph()
t.alignment = WD_ALIGN_PARAGRAPH.CENTER
t.paragraph_format.first_line_indent = Cm(0)
t.paragraph_format.space_before = Pt(180)
r = t.add_run('Les ponts suspendus en France au XIXe siècle')
r.font.size = Pt(22)
r.bold = True
s2 = doc.add_paragraph('Thèse de doctorat en histoire')
s2.alignment = WD_ALIGN_PARAGRAPH.CENTER
s2.paragraph_format.first_line_indent = Cm(0)
s2.add_run().add_break(WD_BREAK.PAGE)

total = 0
for i, (titre, subs, n) in enumerate(TITRES):
    h = doc.add_heading(titre, level=1)
    if i:
        h.paragraph_format.page_break_before = True
    for p in words(n):
        doc.add_paragraph(p); total += len(p.split())
    for st, m in subs:
        doc.add_heading(st, level=2)
        for p in words(m):
            doc.add_paragraph(p); total += len(p.split())
# Bibliographie : écartée par défaut par le Journal
b = doc.add_heading('Bibliographie', level=1)
b.paragraph_format.page_break_before = True
for k in range(40):
    p = doc.add_paragraph(f'Auteur {k + 1}, « Les ouvrages d’art au XIXe siècle », Revue d’histoire des techniques, {1990 + k % 30}, p. {10 + k}.')
    p.paragraph_format.first_line_indent = Cm(0)
doc.core_properties.title = 'Les ponts suspendus en France au XIXe siècle'
doc.save(OUT)
print('mots du corps :', total)
