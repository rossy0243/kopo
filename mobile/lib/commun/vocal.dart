// Micro des abonnés Kopo+ : seuls les abonnés parlent et s'entendent, comme sur le site (src/source.html, « vocal »).
// La voix passe par un serveur LiveKit ; le serveur du jeu donne l'accès au salon vocal de la table seulement à un
// abonné assis (message « vocal »). Un non-abonné qui touche le micro voit l'invitation à s'abonner, avec les prix.
import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart' as lk;

import 'stock.dart';

class Vocal {
  /// Envoie un message à la salle (`vocal`, `micro`), rafraîchit l'écran, affiche une notification.
  final void Function(Map<String, dynamic> msg) envoyer;
  final void Function() maj;
  final void Function(String texte, String niveau) toast;
  /// Non-abonné : la fenêtre « Le micro en partie » avec les prix (fenetres/progres.dart).
  void Function(Map offre)? inviterAbonnement;
  /// Annonce « Nouveau : le micro en partie » (la même fenêtre, avec « Plus tard »).
  void Function()? annoncer;
  /// Joueur bloqué : on ne l'entend pas non plus.
  bool Function(String id)? bloque;
  /// « Couper le micro des autres » : le même réglage que dans les Paramètres (gardé sur le téléphone).
  void Function(bool coupe)? garderSonCoupe;
  Vocal({required this.envoyer, required this.maj, required this.toast});

  lk.Room? _salle;
  lk.EventsListener<lk.RoomEvent>? _ecoute;
  bool actif = false, muet = true, parler = false, sonCoupe = false, demande = false;
  /// L'hôte a coupé mon micro (je suis éliminé), pour toute la table, jusqu'à la fin de la partie.
  bool coupeHote = false;
  /// Identifiants (= comptes) de ceux qui parlent ; joueurs rendus muets pour moi seul
  /// (gardés sur le téléphone, d'une partie à l'autre, comme sur le site).
  /// LiveKit redit « qui parle » plusieurs fois par seconde quand toute la table parle (le volume change), même
  /// quand ce sont les mêmes personnes. Avant, chaque fois redessinait tout l'écran de la partie (main, table…) et
  /// le jeu ralentissait : maintenant seuls les sièges et le bandeau « qui parle » écoutent, et seulement quand la
  /// liste change vraiment.
  final ValueNotifier<Set<String>> quiParle = ValueNotifier(const {});
  Set<String> get parleurs => quiParle.value;
  set parleurs(Set<String> s) { if (!setEquals(s, quiParle.value)) quiParle.value = s; }
  final Set<String> coupes = {...((Stock.lire('kopo-micros-coupes') as List?) ?? const []).map((e) => e.toString())};

  /// Couper le son, c'est seulement pour moi : les autres joueurs s'entendent toujours.
  bool entendPas(String id) => sonCoupe || coupes.contains(id) || (bloque?.call(id) ?? false);

  /// Icône du micro d'un joueur : barré quand il a coupé son micro, haut-parleur barré quand je ne l'entends pas.
  String? icone(Map j, Object? moi) {
    if (j['voix'] != true) return null;
    if (j['micCoupe'] == true) return 'micro-coupe';
    if (j['id'] != moi && entendPas(j['id'].toString())) return 'son-coupe';
    return j['muet'] == true ? 'micro-coupe' : 'micro';
  }

  void activer() {
    if (demande) return;
    demande = true;
    maj();
    envoyer({'type': 'vocal'});
    Future.delayed(const Duration(seconds: 8), () { if (demande) { demande = false; maj(); } });
  }

  /// Réponse du serveur : le jeton du salon vocal, ou la raison du refus.
  Future<void> recevoir(Map d) async {
    demande = false;
    maj();
    if (d.containsKey('coupeHote') && d['jeton'] == null) { await coupeParHote(d['coupeHote'] == true, d['parler'] != false); return; }
    if (d['fin'] != null) {
      final etait = _salle != null;
      await couper();
      signaler();
      maj();
      if (etait) toast('Ton abonnement Kopo+ est terminé : micro coupé.', 'info');
      return;
    }
    final refus = d['refuse'];
    if (refus != null) {
      if (refus == 'abonnement') { inviterAbonnement?.call(d); return; }
      if (refus == 'bientot') { toast('Le micro des abonnés arrive bientôt.', 'info'); return; }
      if (refus == 'seul') { toast('Le micro sert à parler avec les autres joueurs de la table.', 'info'); return; }
      toast('Micro indisponible pour l\'instant. Réessaie dans un moment.', 'echec');
      return;
    }
    await couper();
    final salle = lk.Room();
    _salle = salle;
    final ecoute = salle.createListener();
    _ecoute = ecoute;
    ecoute
      ..on<lk.ActiveSpeakersChangedEvent>((e) => parleurs = e.speakers.map((p) => p.identity).toSet())
      ..on<lk.TrackSubscribedEvent>((e) { if (entendPas(e.participant.identity)) e.publication.disable(); })
      ..on<lk.RoomDisconnectedEvent>((_) {
        if (_salle != salle) return;
        _salle = null; actif = false; muet = true; parleurs = {};
        signaler(); maj();
      });
    try {
      await salle.connect(d['url'].toString(), d['jeton'].toString());
    } catch (e) {
      if (_salle == salle) _salle = null;
      final r = e.toString();
      toast('Micro : connexion au salon vocal impossible. (${r.length > 90 ? r.substring(0, 90) : r})', 'echec');
      return;
    }
    if (_salle != salle) { await salle.disconnect(); return; }
    actif = true; parler = d['parler'] == true; muet = true; coupeHote = d['coupeHote'] == true;
    if (parler) {
      try { await salle.localParticipant?.setMicrophoneEnabled(true); muet = false; }
      catch (_) { toast('Micro non autorisé : tu entends les autres abonnés mais ils ne t\'entendent pas.', 'alerte'); }
    } else if (coupeHote) {
      toast(_msgCoupeHote, 'alerte');
    } else {
      toast('Ton micro a été coupé par la modération : tu entends les autres abonnés.', 'alerte');
    }
    signaler();
    maj();
  }

  static const _msgCoupeHote = 'L\'hôte a coupé ton micro jusqu\'à la fin de la partie : tu entends toujours la table.';

  /// L'hôte coupe le micro d'un joueur éliminé (pour toute la table), ou le lui rend. Le serveur retire aussi le droit
  /// de parler dans le salon vocal : ce n'est pas seulement un bouton caché. Comme sur le site.
  Future<void> coupeParHote(bool coupe, bool peutParler) async {
    final avant = coupeHote;
    coupeHote = coupe;
    final s = _salle;
    if (s != null) {
      if (coupe && !muet) { try { await s.localParticipant?.setMicrophoneEnabled(false); } catch (_) {} }
      if (coupe) { muet = true; parler = false; } else { parler = peutParler; }
      signaler();
    }
    maj();
    if (coupe && !avant) toast(_msgCoupeHote, 'alerte');
    if (!coupe && avant && peutParler) toast('L\'hôte t\'a rendu la parole : touche le micro pour parler.', 'info');
  }

  /// Hôte : couper (ou rendre) le micro d'un joueur éliminé, pour toute la table.
  void couperPourTous(String id, String nom, bool coupe) {
    envoyer({'type': 'couperMicro', 'cible': id, 'coupe': coupe});
    final n = nom.isEmpty ? 'ce joueur' : nom;
    toast(coupe ? 'Micro de $n coupé pour toute la table.' : '${n[0].toUpperCase()}${n.substring(1)} peut de nouveau parler.', 'info');
  }

  Future<void> basculerMicro() async {
    final s = _salle;
    if (s == null || !parler) return;
    try { await s.localParticipant?.setMicrophoneEnabled(muet); muet = !muet; }
    catch (_) { toast('Micro non autorisé sur ce téléphone.', 'alerte'); }
    signaler();
    maj();
  }

  void appliquerSon() {
    for (final p in _salle?.remoteParticipants.values ?? const <lk.RemoteParticipant>[]) {
      for (final pub in p.audioTrackPublications) {
        if (entendPas(p.identity)) { pub.disable(); } else { pub.enable(); }
      }
    }
  }

  /// Tout le monde d'un coup, pour moi seul.
  void basculerSon([bool? coupe]) {
    sonCoupe = coupe ?? !sonCoupe;
    garderSonCoupe?.call(sonCoupe);
    appliquerSon();
    maj();
    toast(sonCoupe ? "Tu n'entends plus les autres joueurs. Eux s'entendent toujours." : 'Tu entends de nouveau les autres joueurs.', 'info');
  }

  /// Un joueur précis, pour moi seul (les autres l'entendent toujours).
  void basculerJoueur(String id, [String nom = '']) {
    final coupe = !coupes.remove(id);
    if (coupe) coupes.add(id);
    final liste = coupes.toList();
    Stock.ecrire('kopo-micros-coupes', liste.length > 200 ? liste.sublist(liste.length - 200) : liste);
    appliquerSon();
    maj();
    final n = nom.isEmpty ? 'ce joueur' : nom;
    toast(coupe ? "Tu n'entends plus $n. Les autres l'entendent toujours." : 'Tu entends de nouveau $n.', 'info');
  }

  void signaler() => envoyer({'type': 'micro', 'voix': actif, 'muet': muet});

  Future<void> couper() async {
    final s = _salle;
    _salle = null;
    _ecoute?.dispose();
    _ecoute = null;
    actif = false; muet = true; parleurs = {};
    if (s != null) { try { await s.disconnect(); await s.dispose(); } catch (_) {} }
  }

  /// En quittant la table.
  Future<void> arreter() async { demande = false; coupeHote = false; await couper(); maj(); }
}

/// Initiale d'un pseudo, quand il ne tient pas à l'écran.
String initiale(String nom) {
  final t = nom.trim();
  return t.isEmpty ? '?' : String.fromCharCode(t.runes.first).toUpperCase();
}
