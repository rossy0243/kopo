// Micro des abonnés Kopo+ : seuls les abonnés parlent et s'entendent, comme sur le site (src/source.html, « vocal »).
// La voix passe par un serveur LiveKit ; le serveur du jeu donne l'accès au salon vocal de la table seulement à un
// abonné assis (message « vocal »). Un non-abonné qui touche le micro voit l'invitation à s'abonner, avec les prix.
import 'package:livekit_client/livekit_client.dart' as lk;

class Vocal {
  /// Envoie un message à la salle (`vocal`, `micro`), rafraîchit l'écran, affiche une notification.
  final void Function(Map<String, dynamic> msg) envoyer;
  final void Function() maj;
  final void Function(String texte, String niveau) toast;
  /// Non-abonné : la fenêtre « Le micro en partie » avec les prix (fenetres/progres.dart).
  void Function(Map offre)? inviterAbonnement;
  Vocal({required this.envoyer, required this.maj, required this.toast});

  lk.Room? _salle;
  lk.EventsListener<lk.RoomEvent>? _ecoute;
  bool actif = false, muet = true, parler = false, sonCoupe = false, demande = false;
  /// Identifiants (= comptes) de ceux qui parlent ; joueurs rendus muets pour moi seul.
  Set<String> parleurs = {};
  final Set<String> coupes = {};

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
      ..on<lk.ActiveSpeakersChangedEvent>((e) { parleurs = e.speakers.map((p) => p.identity).toSet(); maj(); })
      ..on<lk.TrackSubscribedEvent>((e) { if (sonCoupe || coupes.contains(e.participant.identity)) e.publication.disable(); })
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
    actif = true; parler = d['parler'] == true; muet = true;
    if (parler) {
      try { await salle.localParticipant?.setMicrophoneEnabled(true); muet = false; }
      catch (_) { toast('Micro non autorisé : tu entends les autres abonnés mais ils ne t\'entendent pas.', 'alerte'); }
    } else {
      toast('Ton micro a été coupé par la modération : tu entends les autres abonnés.', 'alerte');
    }
    signaler();
    maj();
  }

  Future<void> basculerMicro() async {
    final s = _salle;
    if (s == null || !parler) return;
    try { await s.localParticipant?.setMicrophoneEnabled(muet); muet = !muet; }
    catch (_) { toast('Micro non autorisé sur ce téléphone.', 'alerte'); }
    signaler();
    maj();
  }

  void _appliquerSon() {
    for (final p in _salle?.remoteParticipants.values ?? const <lk.RemoteParticipant>[]) {
      for (final pub in p.audioTrackPublications) {
        if (sonCoupe || coupes.contains(p.identity)) { pub.disable(); } else { pub.enable(); }
      }
    }
  }

  void basculerSon() { sonCoupe = !sonCoupe; _appliquerSon(); maj(); }

  /// Rendre muet un abonné pour moi seul (les autres l'entendent toujours).
  void basculerJoueur(String id) { if (!coupes.remove(id)) coupes.add(id); _appliquerSon(); maj(); }

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
  Future<void> arreter() async { demande = false; coupes.clear(); await couper(); maj(); }
}

/// Initiale d'un pseudo, quand il ne tient pas à l'écran.
String initiale(String nom) {
  final t = nom.trim();
  return t.isEmpty ? '?' : String.fromCharCode(t.runes.first).toUpperCase();
}
