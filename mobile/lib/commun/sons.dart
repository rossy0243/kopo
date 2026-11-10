// Effets sonores et musique d'ambiance : les sons du site (src/kopo-sons.js), rendus d'avance en WAV
// par outils/sons.js et joués ici. Plusieurs lecteurs pour que les effets se chevauchent.
import 'dart:async';

import 'package:audioplayers/audioplayers.dart';

class Sons {
  static bool effets = true;
  static bool _musique = false;
  static final List<AudioPlayer> _lecteurs = [];
  static int _suivant = 0;
  static AudioPlayer? _fond;

  static const noms = {
    'carte', 'distribution', 'distribution8', 'ramasse', 'tour', 'tic', 'decompte', 'qualifie', 'katapss',
    'elimine', 'victoire', 'defaite', 'chat', 'clic', 'essai',
  };

  static AudioPlayer _lecteur() {
    if (_lecteurs.length < 6) {
      final p = AudioPlayer()..setReleaseMode(ReleaseMode.stop);
      _lecteurs.add(p);
      return p;
    }
    _suivant = (_suivant + 1) % _lecteurs.length;
    return _lecteurs[_suivant];
  }

  /// nom : un effet du site ; moi : variante « c'est moi » (qualifié, éliminé) ; delai en ms.
  static void jouer(String nom, {bool moi = false, int delai = 0}) {
    if (!effets || !noms.contains(nom)) return;
    final fichier = (nom == 'qualifie' || nom == 'elimine') && moi ? '${nom}_moi' : nom;
    void go() {
      try { _lecteur().play(AssetSource('sons/$fichier.wav'), mode: PlayerMode.lowLatency).catchError((_) {}); } catch (_) {}
    }
    if (delai > 0) { Timer(Duration(milliseconds: delai), go); } else { go(); }
  }

  static void regler({bool? effets, bool? musique}) {
    if (effets != null) Sons.effets = effets;
    if (musique != null && musique != _musique) {
      _musique = musique;
      if (musique) {
        _fond ??= AudioPlayer()..setReleaseMode(ReleaseMode.loop);
        _fond!.setVolume(.8);
        _fond!.play(AssetSource('sons/musique.wav')).catchError((_) {});
      } else {
        _fond?.stop();
      }
    }
  }

  /// Appli en arrière-plan : on coupe la musique, on la reprend au retour.
  static void pause(bool enPause) {
    if (!_musique || _fond == null) return;
    if (enPause) { _fond!.pause(); } else { _fond!.resume(); }
  }
}
