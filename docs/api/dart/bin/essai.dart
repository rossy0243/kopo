// Essai du client de référence contre un serveur Masano lancé en mode test :
//   node server/tests/client-dart.js        (démarre le serveur, puis lance ce fichier)
// ou, avec un serveur déjà lancé (KOPO_TESTS=1) :
//   dart run docs/api/dart/bin/essai.dart http://localhost:2567
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../lib/masano_salle.dart';

late String adresse;

Future<Map<String, dynamic>> api(String methode, String chemin, {Object? corps, String? jeton}) async {
  final c = HttpClient();
  final req = await c.openUrl(methode, Uri.parse('$adresse/api/v1$chemin'));
  req.headers.contentType = ContentType.json;
  req.headers.set('x-masano-client', 'android/1.0.0');
  if (jeton != null) req.headers.set('authorization', 'Bearer $jeton');
  if (corps != null) req.write(jsonEncode(corps));
  final res = await req.close();
  final t = await res.transform(utf8.decoder).join();
  c.close();
  return {'statut': res.statusCode, 'json': t.isEmpty ? null : jsonDecode(t)};
}

void verifier(bool ok, String quoi) {
  if (!ok) throw StateError('ÉCHEC : $quoi');
  print('  ✓ $quoi');
}

/// Joue la première action permise à chaque vue jusqu'à la fin de la partie ; renvoie la dernière vue.
Future<Map> jouerJusquAuBout(Salle s, {bool lancer = false}) async {
  final fin = Completer<Map>();
  s.sur('erreur').listen((_) {});
  s.sur('vue').listen((v) {
    final vue = v as Map;
    if (vue['etat'] == 'finPartie' && !fin.isCompleted) fin.complete(vue);
    final manche = vue['manche'] as Map?;
    final actions = (manche?['actions'] as List?) ?? const [];
    if (vue['etat'] == 'manche' && actions.isNotEmpty) {
      Timer(const Duration(milliseconds: 5), () => s.envoyer('action', {'action': actions.first}));
    }
  });
  s.envoyer('sync');
  if (lancer) s.envoyer('lancer');
  return fin.future.timeout(const Duration(seconds: 60));
}

Future<void> main(List<String> args) async {
  adresse = args.isNotEmpty ? args.first : 'http://localhost:2567';
  final serveur = MasanoServeur(adresse);

  final config = await api('GET', '/config');
  verifier(config['statut'] == 200 && (config['json'] as Map)['liens'] != null, 'GET /api/v1/config');
  final a = (await api('POST', '/invite', corps: {'pseudo': 'DartA'}))['json'] as Map;
  final b = (await api('POST', '/invite', corps: {'pseudo': 'DartB'}))['json'] as Map;
  final ja = a['jeton'] as String, jb = b['jeton'] as String;
  verifier(ja.isNotEmpty && jb.isNotEmpty, 'comptes invités créés');

  // 1. Entraînement Kopo contre 1 robot, joué jusqu'au bout.
  final solo = await serveur.creer('entrainement', {'jeton': ja, 'jeu': 'kopo', 'robots': 1, 'rapide': true});
  verifier(solo.jetonReconnexion.startsWith('${solo.roomId}:'), 'entrée dans une salle d\'entraînement (JOIN_ROOM)');
  final premiere = solo.sur('vue').first;
  final finSolo = jouerJusquAuBout(solo, lancer: true);
  final v0 = await premiere as Map;
  verifier((v0['joueurs'] as List).length == 2 && v0['moi'] == (a['compte'] as Map)['id'], 'vue reçue en MessagePack (2 joueurs, moi = mon compte)');
  final vf = await finSolo;
  verifier(vf['vainqueur'] != null, 'partie d\'entraînement Kopo jouée jusqu\'au bout');
  await solo.quitter();

  // 2. Inter (8) : coupure réseau, puis retour avec le jeton de reconnexion, puis avec le code de la table.
  final i8 = await serveur.creer('entrainement', {'jeton': ja, 'jeu': 'inter8', 'robots': 2, 'mode': 'delire', 'lancer': true});
  final vi = i8.sur('vue').first;
  i8.envoyer('sync');
  final vue8 = await vi as Map;
  verifier(vue8['jeu'] == 'inter8' && vue8['mode'] == 'delire', 'entraînement Inter (8) en mode Délire');
  final code = vue8['code'] as String;
  await i8.couper();
  await Future.delayed(const Duration(milliseconds: 300));
  final retour = await serveur.reconnecter(i8.jetonReconnexion);
  final vr = retour.sur('vue').first;
  retour.envoyer('sync');
  verifier(((await vr) as Map)['code'] == code, 'reconnexion avec le jeton de reconnexion');
  await retour.couper();
  await Future.delayed(const Duration(milliseconds: 300));
  final repris = await serveur.reprendre(ja, code);
  verifier(repris != null, 'reprise de la place avec le code de la table (POST /api/v1/reprendre)');
  final vp = repris!.sur('vue').first;
  repris.envoyer('sync');
  verifier(((await vp) as Map)['code'] == code, 'vue reçue après la reprise');
  await repris.quitter();

  // 3. Refus : quelqu'un d'autre n'entre pas dans une salle d'entraînement.
  final autre = await serveur.creer('entrainement', {'jeton': ja, 'robots': 1});
  try {
    await serveur.rejoindreParId(autre.roomId, {'jeton': jb});
    verifier(false, 'refus attendu');
  } on ErreurSalle catch (e) {
    verifier(e.code > 0 && e.message.isNotEmpty, 'refus du serveur reçu en ErreurSalle (code ${e.code} : « ${e.message} »)');
  }
  await autre.quitter();

  // 4. Table entre amis par code : A crée, B trouve le jeu avec GET /salles/{code}, rejoint, partie jouée.
  final hote = await serveur.creer('kopo', {'jeton': ja, 'code': 'DART', 'rapide': true});
  final s = await api('GET', '/salles/DART');
  verifier(s['statut'] == 200 && (s['json'] as Map)['salle'] == 'kopo', 'GET /api/v1/salles/DART');
  final invite = await serveur.rejoindre((s['json'] as Map)['salle'] as String, {'jeton': jb, 'code': 'DART'});
  final soldes = <Object?>[];
  invite.sur('solde').listen(soldes.add);
  final fa = jouerJusquAuBout(hote), fb = jouerJusquAuBout(invite);
  await Future.delayed(const Duration(milliseconds: 200));
  hote.envoyer('reaction', {'emoji': 'GG !'});
  final reaction = await invite.sur('reaction').first.timeout(const Duration(seconds: 5)) as Map;
  verifier(reaction['emoji'] == 'GG !', 'chat : message rapide relayé à la table');
  hote.envoyer('lancer');
  await Future.wait([fa, fb]);
  await Future.delayed(const Duration(milliseconds: 600));
  verifier(soldes.isNotEmpty, 'partie entre amis jouée, solde reçu en fin de partie');
  await hote.quitter();
  await invite.quitter();

  serveur.fermer();
  print('Client Dart : tout est bon.');
  exit(0);
}
