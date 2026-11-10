// Client de référence des salles de jeu Masano (Colyseus 0.16), en Dart pur (dart:io), pour l'appli Flutter.
//
// Il fait exactement ce que fait colyseus.js sur le site :
//   1. réservation d'une place en HTTP : POST /matchmake/<méthode>/<salle> (JSON) ;
//   2. connexion WebSocket à ws(s)://<hôte>/<processId>/<roomId>?sessionId=… ;
//   3. le serveur envoie JOIN_ROOM (10) avec le jeton de reconnexion, le client répond par l'octet 10 ;
//   4. ensuite, messages binaires : [13][type en MessagePack str][valeur en MessagePack].
// Les salles Masano n'ont pas d'état Colyseus (schema) : tout passe par des messages, surtout « vue ».
// Testé contre le serveur par docs/api/dart/bin/essai.dart (voir docs/api/temps-reel.md).
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'msgpack.dart';

/// Codes du protocole Colyseus 0.16 (premier octet de chaque message WebSocket).
class Protocole {
  static const joinRoom = 10;
  static const error = 11;
  static const leaveRoom = 12;
  static const roomData = 13;
  static const roomState = 14;
  static const roomStatePatch = 15;
  static const roomDataBytes = 17;
}

/// Refus du serveur (matchmaking ou entrée dans la salle) : code Colyseus et message en français à afficher.
class ErreurSalle implements Exception {
  final int code;
  final String message;
  ErreurSalle(this.code, this.message);
  @override
  String toString() => message;
}

/// Un message reçu de la salle : type (« vue », « erreur », « solde »…) et valeur décodée.
class MessageSalle {
  final String type;
  final Object? valeur;
  MessageSalle(this.type, this.valeur);
}

class MasanoServeur {
  /// Adresse du serveur, par exemple https://kopo-serveur.onrender.com
  final Uri adresse;
  final HttpClient _http = HttpClient();

  MasanoServeur(String adresse) : adresse = Uri.parse(adresse.replaceAll(RegExp(r'/+$'), ''));

  Future<Salle> creer(String salle, Map<String, Object?> options) => _matchmake('create', salle, options);
  Future<Salle> rejoindre(String salle, Map<String, Object?> options) => _matchmake('join', salle, options);
  Future<Salle> rejoindreOuCreer(String salle, Map<String, Object?> options) => _matchmake('joinOrCreate', salle, options);
  Future<Salle> rejoindreParId(String roomId, Map<String, Object?> options) => _matchmake('joinById', roomId, options);

  /// Revenir dans la salle après une coupure (dans les 2 minutes), avec Salle.jetonReconnexion (« roomId:jeton »).
  Future<Salle> reconnecter(String jetonReconnexion) {
    final i = jetonReconnexion.indexOf(':');
    if (i <= 0) throw ArgumentError('Jeton de reconnexion invalide (roomId:jeton).');
    final roomId = jetonReconnexion.substring(0, i), jeton = jetonReconnexion.substring(i + 1);
    return _matchmake('reconnect', roomId, {'reconnectionToken': jeton}, jetonReconnexion: jeton);
  }

  /// Reprendre sa place avec le code de la table (appli fermée, jeton de reconnexion perdu ou expiré).
  /// [jeton] : le jeton Masano du joueur. Renvoie null si le joueur n'est pas assis à cette table.
  Future<Salle?> reprendre(String jeton, String code) async {
    final r = await _post(adresse.resolve('/api/v1/reprendre'), {'code': code}, jeton: jeton);
    if (r.statut == 404) return null;
    if (r.statut != 200) throw ErreurSalle(r.statut, (r.json is Map ? (r.json as Map)['erreur'] : null)?.toString() ?? 'Erreur du serveur.');
    return consommerReservation(r.json as Map<String, Object?>);
  }

  Future<Salle> _matchmake(String methode, String salle, Map<String, Object?> options, {String? jetonReconnexion}) async {
    final r = await _post(adresse.resolve('/matchmake/$methode/$salle'), options);
    final j = r.json;
    if (j is! Map) throw ErreurSalle(r.statut, 'Réponse inattendue du serveur.');
    // Le matchmaking répond toujours 200 : une erreur est { code, error }.
    if (j['error'] != null) throw ErreurSalle((j['code'] as num?)?.toInt() ?? 0, j['error'].toString());
    return consommerReservation(j.cast<String, Object?>(), jetonReconnexion: jetonReconnexion);
  }

  /// Utilise une réservation de place (réponse du matchmaking ou de POST /api/v1/reprendre).
  Future<Salle> consommerReservation(Map<String, Object?> reservation, {String? jetonReconnexion}) {
    final room = (reservation['room'] as Map).cast<String, Object?>();
    final sessionId = reservation['sessionId'].toString();
    final adressePublique = room['publicAddress'] as String?;
    final securise = adresse.scheme == 'https';
    final hote = adressePublique ?? '${adresse.host}${adresse.hasPort ? ':${adresse.port}' : ''}';
    final requete = {'sessionId': sessionId, if (jetonReconnexion != null) 'reconnectionToken': jetonReconnexion};
    final url = Uri.parse('${securise ? 'wss' : 'ws'}://$hote/${room['processId']}/${room['roomId']}').replace(queryParameters: requete);
    return Salle._connecter(url, room['name'].toString(), room['roomId'].toString(), sessionId);
  }

  Future<({int statut, Object? json})> _post(Uri url, Map<String, Object?> corps, {String? jeton}) async {
    final req = await _http.postUrl(url);
    req.headers.contentType = ContentType.json;
    req.headers.set('accept', 'application/json');
    if (jeton != null) req.headers.set('authorization', 'Bearer $jeton');
    req.write(jsonEncode(corps));
    final res = await req.close();
    final texte = await res.transform(utf8.decoder).join();
    Object? json;
    try { json = texte.isEmpty ? null : jsonDecode(texte); } catch (_) {}
    return (statut: res.statusCode, json: json);
  }

  void fermer() => _http.close(force: true);
}

class Salle {
  final String nom;
  final String roomId;
  final String sessionId;
  final WebSocket _ws;
  final _messages = StreamController<MessageSalle>.broadcast();
  final _fermee = Completer<int>();
  /// « roomId:jeton », à garder pour MasanoServeur.reconnecter() après une coupure.
  late final String jetonReconnexion;

  Salle._(this.nom, this.roomId, this.sessionId, this._ws);

  /// Tous les messages du serveur. Pensez à écouter « vue » avant tout, puis à envoyer « sync ».
  Stream<MessageSalle> get messages => _messages.stream;
  /// Les messages d'un seul type.
  Stream<Object?> sur(String type) => messages.where((m) => m.type == type).map((m) => m.valeur);
  /// Code de fermeture WebSocket (1000/4000 : départ voulu ; 4001 : exclu ; 4002 : erreur ; autre : coupure).
  Future<int> get fermee => _fermee.future;

  static Future<Salle> _connecter(Uri url, String nom, String roomId, String sessionId) async {
    final ws = await WebSocket.connect(url.toString());
    final salle = Salle._(nom, roomId, sessionId, ws);
    final entree = Completer<Salle>();
    ws.listen((donnees) {
      if (donnees is! List<int>) return;
      final o = donnees is Uint8List ? donnees : Uint8List.fromList(donnees);
      if (o.isEmpty) return;
      switch (o[0]) {
        case Protocole.joinRoom:
          // [10][n][jeton de reconnexion][m][sérialiseur][poignée de main] : on répond par l'octet 10.
          var p = 1;
          final n = o[p++];
          final jeton = utf8.decode(o.sublist(p, p + n));
          salle.jetonReconnexion = '$roomId:$jeton';
          ws.add(Uint8List.fromList([Protocole.joinRoom]));
          if (!entree.isCompleted) entree.complete(salle);
        case Protocole.error:
          final d = MsgPackDecodeur(o, 1);
          final code = (d.lire() as num?)?.toInt() ?? 0;
          final message = (d.fini ? '' : d.lire())?.toString() ?? '';
          if (!entree.isCompleted) entree.completeError(ErreurSalle(code, message));
        case Protocole.roomData:
          final d = MsgPackDecodeur(o, 1);
          final type = d.lire().toString();
          salle._messages.add(MessageSalle(type, d.fini ? null : d.lire()));
        case Protocole.roomDataBytes:
          final d = MsgPackDecodeur(o, 1);
          final type = d.lire().toString();
          salle._messages.add(MessageSalle(type, Uint8List.sublistView(o, d.position)));
        default:
          break; // pas d'état Colyseus dans les salles Masano (14, 15)
      }
    }, onDone: () {
      final code = ws.closeCode ?? 1006;
      if (!entree.isCompleted) entree.completeError(ErreurSalle(code, 'Connexion à la salle refusée.'));
      if (!salle._fermee.isCompleted) salle._fermee.complete(code);
      salle._messages.close();
    }, onError: (_) {});
    return entree.future;
  }

  /// Envoie un message à la salle : type (« action », « lancer », « reaction »…) et valeur facultative.
  void envoyer(String type, [Object? valeur]) {
    final e = MsgPackEncodeur();
    e.texte(type);
    final tete = e.octets;
    final corps = valeur == null ? Uint8List(0) : msgpackEncoder(valeur);
    _ws.add(Uint8List.fromList([Protocole.roomData, ...tete, ...corps]));
  }

  /// Quitter la salle volontairement (le serveur compte un abandon si la partie est commencée).
  Future<int> quitter() async {
    if (!_fermee.isCompleted) {
      try { _ws.add(Uint8List.fromList([Protocole.leaveRoom])); } catch (_) {}
    }
    return fermee.timeout(const Duration(seconds: 5), onTimeout: () async { await _ws.close(1000); return 1000; });
  }

  /// Couper sans quitter (simule une coupure réseau : la place est gardée 2 minutes).
  Future<void> couper() => _ws.close(4999);
}
