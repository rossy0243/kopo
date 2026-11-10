// Salles de jeu Masano (Colyseus 0.16), en Dart, pour Android, iOS et le web.
// Repris du client de référence docs/api/dart/lib/masano_salle.dart, avec http et web_socket_channel
// (qui marchent aussi dans un navigateur) à la place de dart:io.
//   1. réservation d'une place en HTTP : POST /matchmake/<méthode>/<salle> ;
//   2. WebSocket ws(s)://<hôte>/<processId>/<roomId>?sessionId=… ;
//   3. JOIN_ROOM (10) avec le jeton de reconnexion, on répond par l'octet 10 ;
//   4. messages : [13][type MessagePack][valeur MessagePack]. Pas d'état Colyseus : tout passe par « vue ».
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import 'msgpack.dart';

class Protocole {
  static const joinRoom = 10;
  static const error = 11;
  static const leaveRoom = 12;
  static const roomData = 13;
  static const roomDataBytes = 17;
}

/// Refus du serveur : code Colyseus et message en français à afficher tel quel.
class ErreurSalle implements Exception {
  final int code;
  final String message;
  ErreurSalle(this.code, this.message);
  @override
  String toString() => message;
}

class MessageSalle {
  final String type;
  final Object? valeur;
  MessageSalle(this.type, this.valeur);
}

class MasanoServeur {
  final Uri adresse;
  final Map<String, String> entetes;
  MasanoServeur(String adresse, {this.entetes = const {}}) : adresse = Uri.parse(adresse.replaceAll(RegExp(r'/+$'), ''));

  Future<Salle> creer(String salle, Map<String, Object?> options) => _matchmake('create', salle, options);
  Future<Salle> rejoindre(String salle, Map<String, Object?> options) => _matchmake('join', salle, options);
  Future<Salle> rejoindreOuCreer(String salle, Map<String, Object?> options) => _matchmake('joinOrCreate', salle, options);
  Future<Salle> rejoindreParId(String roomId, Map<String, Object?> options) => _matchmake('joinById', roomId, options);

  /// Revenir après une coupure (2 minutes), avec Salle.jetonReconnexion (« roomId:jeton »).
  Future<Salle> reconnecter(String jetonReconnexion) {
    final i = jetonReconnexion.indexOf(':');
    if (i <= 0) throw ErreurSalle(0, 'Jeton de reconnexion invalide.');
    final roomId = jetonReconnexion.substring(0, i), jeton = jetonReconnexion.substring(i + 1);
    return _matchmake('reconnect', roomId, {'reconnectionToken': jeton}, jetonReconnexion: jeton);
  }

  /// Reprendre sa place avec le code (appli fermée, jeton perdu). null si on n'est pas assis à cette table.
  Future<Salle?> reprendre(String jeton, String code) async {
    final r = await _post(adresse.resolve('/api/v1/reprendre'), {'code': code}, jeton: jeton);
    if (r.statut == 404 || r.statut == 0) return null;
    if (r.statut != 200) return null;
    return consommerReservation((r.json as Map).cast<String, Object?>());
  }

  Future<Salle> _matchmake(String methode, String salle, Map<String, Object?> options, {String? jetonReconnexion}) async {
    final r = await _post(adresse.resolve('/matchmake/$methode/$salle'), options);
    final j = r.json;
    if (r.statut == 0) throw ErreurSalle(0, 'Pas de connexion au serveur. Vérifie ton réseau et réessaie.');
    if (j is! Map) throw ErreurSalle(r.statut, r.statut >= 502 ? 'Le serveur redémarre. Réessaie dans une minute.' : 'Réponse inattendue du serveur.');
    if (j['error'] != null) throw ErreurSalle((j['code'] as num?)?.toInt() ?? 0, j['error'].toString());
    return consommerReservation(j.cast<String, Object?>(), jetonReconnexion: jetonReconnexion);
  }

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
    try {
      final res = await http
          .post(url, headers: {'content-type': 'application/json', 'accept': 'application/json', ...entetes, if (jeton != null) 'authorization': 'Bearer $jeton'}, body: jsonEncode(corps))
          .timeout(const Duration(seconds: 70)); // l'hébergeur gratuit endort le serveur : le réveil prend jusqu'à une minute
      Object? json;
      try { json = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes)); } catch (_) {}
      return (statut: res.statusCode, json: json);
    } catch (_) {
      return (statut: 0, json: null);
    }
  }
}

class Salle {
  final String nom;
  final String roomId;
  final String sessionId;
  final WebSocketChannel _ws;
  final _messages = StreamController<MessageSalle>.broadcast();
  final _fermee = Completer<int>();
  StreamSubscription? _abonnement;
  late final String jetonReconnexion;

  Salle._(this.nom, this.roomId, this.sessionId, this._ws);

  Stream<MessageSalle> get messages => _messages.stream;
  Stream<Object?> sur(String type) => messages.where((m) => m.type == type).map((m) => m.valeur);
  /// Code de fermeture (1000 : départ voulu ; 4000 : ouverte ailleurs ; 4001 : exclu ; autre : coupure).
  Future<int> get fermee => _fermee.future;
  bool get estFermee => _fermee.isCompleted;

  static Future<Salle> _connecter(Uri url, String nom, String roomId, String sessionId) async {
    final ws = WebSocketChannel.connect(url);
    final salle = Salle._(nom, roomId, sessionId, ws);
    final entree = Completer<Salle>();
    salle._abonnement = ws.stream.listen((donnees) {
      final Uint8List o;
      if (donnees is Uint8List) {
        o = donnees;
      } else if (donnees is List<int>) {
        o = Uint8List.fromList(donnees);
      } else if (donnees is ByteBuffer) {
        o = donnees.asUint8List();
      } else {
        return;
      }
      if (o.isEmpty) return;
      switch (o[0]) {
        case Protocole.joinRoom:
          var p = 1;
          final n = o[p++];
          final jeton = utf8.decode(o.sublist(p, p + n));
          salle.jetonReconnexion = '$roomId:$jeton';
          ws.sink.add(Uint8List.fromList([Protocole.joinRoom]));
          if (!entree.isCompleted) entree.complete(salle);
        case Protocole.error:
          final d = MsgPackDecodeur(o, 1);
          final code = (d.lire() as num?)?.toInt() ?? 0;
          final message = (d.fini ? '' : d.lire())?.toString() ?? '';
          if (!entree.isCompleted) entree.completeError(ErreurSalle(code, message));
        case Protocole.roomData:
          final d = MsgPackDecodeur(o, 1);
          final type = d.lire().toString();
          if (!salle._messages.isClosed) salle._messages.add(MessageSalle(type, d.fini ? null : d.lire()));
        default:
          break;
      }
    }, onDone: () {
      final code = ws.closeCode ?? 1006;
      if (!entree.isCompleted) entree.completeError(ErreurSalle(code, 'Connexion à la salle refusée.'));
      if (!salle._fermee.isCompleted) salle._fermee.complete(code);
      salle._messages.close();
    }, onError: (_) {}, cancelOnError: false);
    return entree.future.timeout(const Duration(seconds: 30), onTimeout: () {
      try { ws.sink.close(); } catch (_) {}
      throw ErreurSalle(0, 'La salle ne répond pas. Réessaie.');
    });
  }

  void envoyer(String type, [Object? valeur]) {
    if (_fermee.isCompleted) return;
    final e = MsgPackEncodeur();
    e.texte(type);
    final tete = e.octets;
    final corps = valeur == null ? Uint8List(0) : msgpackEncoder(valeur);
    try { _ws.sink.add(Uint8List.fromList([Protocole.roomData, ...tete, ...corps])); } catch (_) {}
  }

  /// Quitter volontairement (un abandon si la partie est commencée).
  Future<int> quitter() async {
    if (!_fermee.isCompleted) {
      try { _ws.sink.add(Uint8List.fromList([Protocole.leaveRoom])); } catch (_) {}
    }
    return fermee.timeout(const Duration(seconds: 4), onTimeout: () async {
      try { await _ws.sink.close(1000); } catch (_) {}
      return 1000;
    });
  }

  void abandonner() {
    try { _ws.sink.close(1000); } catch (_) {}
    _abonnement?.cancel();
  }
}
