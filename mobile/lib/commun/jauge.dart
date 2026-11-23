// Le Fleuve : la jauge des étoiles en direct (fleuve.md, « Les étoiles en direct »), comme sur le site
// (src/source.html, jaugeFleuve). Le serveur envoie l'avancée de l'étape à chaque changement :
// { score, prog, val, etat (en_cours, danger, ok, rate), texte, seuils }. Ici, ce qui a changé depuis la
// précédente : points gagnés, étoiles allumées, objectif réussi, en danger ou raté.

class EffetJauge {
  final int id;
  final int? plus; // points gagnés
  final String plusLabel; // « qualifié 2e », « victoire »
  final List<int> etoiles; // étoiles qui s'allument (1 = objectif, 2, 3)
  final String? bulle, ton; // ton : null (or), bien, alerte, echec
  final bool secoue;
  final int score0; // score d'avant (la barre glisse jusqu'au nouveau)
  final double val0; // avancée d'avant
  const EffetJauge({required this.id, this.plus, this.plusLabel = '', this.etoiles = const [], this.bulle, this.ton, this.secoue = false, required this.score0, required this.val0});
  bool get visible => plus != null || bulle != null;
}

int _n(Object? x) => x is num ? x.toInt() : int.tryParse('$x') ?? 0;
double _d(Object? x) => x is num ? x.toDouble() : double.tryParse('$x') ?? 0;

/// Ce que tu viens de faire, d'après la table : « qualifié 2e », « victoire ».
String raisonJauge(Map? v) {
  if (v == null) return '';
  if (v['etat'] == 'finPartie' && v['vainqueur'] == v['moi']) return 'victoire';
  final m = v['manche'];
  if (m is! Map || m['qualifies'] is! List) return '';
  final r = (m['qualifies'] as List).indexWhere((q) => q is Map && q['joueur'] == v['moi']);
  return r < 0 ? '' : r == 0 ? 'qualifié 1er' : 'qualifié ${r + 1}e';
}

/// L'effet à jouer quand la jauge passe de [a] à [d]. type : type d'objectif de l'étape (ramasser, pioche…).
EffetJauge? effetJauge(Map? a, Map d, String? type, Map? vue, int id) {
  if (a == null) return null;
  final sl = (d['seuils'] as Map?) ?? const {};
  final deux = _n(sl['deux']), trois = _n(sl['trois']);
  final score = _n(d['score']), scoreA = _n(a['score']);
  final etat = '${d['etat']}', etatA = '${a['etat']}';
  final etoiles = <int>[];
  if (etat != 'rate') {
    if (deux > 0 && scoreA < deux && score >= deux) etoiles.add(2);
    if (trois > 0 && scoreA < trois && score >= trois) etoiles.add(3);
  }
  if (etat == 'ok' && etatA != 'ok') etoiles.insert(0, 1);
  final n = 1 + (deux > 0 && score >= deux ? 1 : 0) + (trois > 0 && score >= trois ? 1 : 0);
  String? bulle, ton;
  var secoue = false;
  if (etat == 'rate' && etatA != 'rate') { bulle = "Objectif raté : plus d'étoile possible"; ton = 'echec'; secoue = true; }
  else if (etat == 'ok' && etatA != 'ok') { bulle = '${'★' * n} Objectif réussi !'; ton = 'bien'; }
  else if (etoiles.contains(3)) { bulle = '★★★ 3e étoile !'; }
  else if (etoiles.contains(2)) { bulle = '★★ 2e étoile !'; }
  else if (etat == 'danger' && etatA != 'danger') {
    bulle = type == 'ramasser' ? 'Attention : plus le droit de ramasser' : type == 'pioche' ? 'Attention : plus le droit de piocher' : "Attention : l'objectif est en danger";
    ton = 'alerte';
  } else if (d['prog'] != a['prog'] && _d(d['val']) > _d(a['val']) && etat == 'en_cours') { bulle = '✓ ${d['prog']}'; ton = 'bien'; }
  final val0 = etatA == 'rate' ? 0.0 : etatA == 'ok' ? 1.0 : _d(a['val']);
  return EffetJauge(id: id, plus: score > scoreA ? score - scoreA : null, plusLabel: score > scoreA ? raisonJauge(vue) : '', etoiles: etoiles, bulle: bulle, ton: ton, secoue: secoue, score0: scoreA, val0: val0);
}
