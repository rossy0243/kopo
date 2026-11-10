// Branche les fenêtres sur l'état de l'appli (etat.dart ne connaît pas l'interface) et sur les notifications.
import 'dart:async';

import '../ecrans/accueil.dart' show proposerLienBande;
import '../etat.dart';
import '../reseau/push.dart';
import 'accueil_fenetres.dart';
import 'compet.dart';
import 'partie_fenetres.dart';
import 'progres.dart';
import 'social.dart';

void brancherFenetres() {
  // Après le bonus du jour : la nouveauté, le tutoriel la toute première fois, sinon le cadeau de bienvenue du jour.
  app.suiteAccueilUi = () {
    if (annonceNouveaute() || proposerTutoriel() || proposerBienvenue7()) return;
    proposerLienBande();
  };
  app.fenetrePiecesUi = fenetrePieces;
  app.cadeauFondateurUi = cadeauFondateur;
  app.remiseAFlotUi = fenetreRemiseAFlot;
  app.notificationUi = montrerNotification;
  app.exigerGoogleUi = fenetreJouerEnLigne;
  app.finMancheUi = afficherFinManche;
  app.finPartieUi = afficherFinPartie;
  app.resultatMatchJourUi = resultatMatchJour;
  app.onConnecte = () { Push.synchroniser(); };

  // Notification touchée : l'appli s'ouvre sur la bonne fenêtre.
  Push.surToucher = (d) {
    void ouvrir() {
      final code = (d['code'] ?? '').toString().toUpperCase();
      final action = d['action'];
      if (action == 'table' && RegExp(r'^[A-Z]{4}$').hasMatch(code)) {
        if (app.ecran != 'accueil') { app.toast("Invitation à la table $code : termine ta partie d'abord."); return; }
        app.fermerFenetre();
        app.rejoindreCode(code);
      } else if (action == 'amis' && app.ecran == 'accueil') {
        ouvrirAmis();
      } else if (action == 'match' && app.ecran == 'accueil') {
        ouvrirMatchJour();
      }
    }
    // Au lancement, on attend que l'accueil soit prêt.
    if (app.ecran == 'splash') {
      var n = 0;
      Timer.periodic(const Duration(milliseconds: 500), (t) { if (app.ecran != 'splash' || ++n > 40) { t.cancel(); ouvrir(); } });
    } else {
      ouvrir();
    }
  };
}
