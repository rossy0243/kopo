// Branche les fenêtres sur l'état de l'appli (etat.dart ne connaît pas l'interface) et sur les notifications.
import 'dart:async';

import '../ecrans/accueil.dart' show proposerLienBande, lienBandeVu;
import '../etat.dart';
import '../reseau/google.dart';
import '../reseau/push.dart';
import 'accueil_fenetres.dart';
import 'compet.dart';
import 'partie_fenetres.dart';
import 'progres.dart';
import 'social.dart';
import 'vocal_ui.dart';

void brancherFenetres() {
  // Après le bonus du jour : la nouveauté, le tutoriel la toute première fois, sinon le cadeau de bienvenue du jour.
  app.suiteAccueilUi = () {
    if (annonceNouveaute() || proposerTutoriel() || proposerBienvenue7()) return;
    proposerLienBande();
  };
  app.fenetrePiecesUi = fenetrePieces;
  app.cadeauFondateurUi = cadeauFondateur;
  app.notificationUi = montrerNotification;
  app.exigerGoogleUi = fenetreJouerEnLigne;
  app.finMancheUi = afficherFinManche;
  app.finPartieUi = afficherFinPartie;
  app.resultatMatchJourUi = resultatMatchJour;
  app.vocal.inviterAbonnement = (offre) => ouvrirAbonnement(offre);
  app.vocal.annoncer = () => ouvrirAbonnement(null, true);
  app.onConnecte = () { Push.synchroniser(); };

  // Notification reçue appli ouverte (Android) : un toast, le joueur est déjà dans le jeu.
  Push.surRecevoir = (titre, texte, d) {
    final t = [titre, texte].where((x) => x.isNotEmpty).join(' : ');
    if (t.isNotEmpty) app.toast(t);
  };

  // Lien du jeu (table, Bande, parrainage, kopo/ ou inter8/) : comme sur le site, la table s'ouvre dans « Rejoindre »
  // avec son code déjà tapé, la Bande propose d'entrer, le jeu du lien est choisi sur l'accueil.
  Google.surLienJeu = (u) {
    final q = u.queryParameters;
    final code = (u.fragment.isNotEmpty ? u.fragment : (q['code'] ?? '')).toUpperCase();
    final chemin = u.path.replaceAll(RegExp(r'/+$'), '');
    final jeu = (q['jeu'] == 'kopo' || q['jeu'] == 'inter8') ? q['jeu'] : chemin.endsWith('/inter8') ? 'inter8' : chemin.endsWith('/kopo') ? 'kopo' : null;
    final parrain = (q['parrain'] ?? '').toUpperCase();
    final bande = (q['bande'] ?? '').toUpperCase();
    final table = RegExp(r'^[A-Z]{4}$').hasMatch(code);
    if (RegExp(r'^[A-Z0-9]{6}$').hasMatch(parrain)) app.noterParrain(parrain);
    final avecBande = RegExp(r'^[A-Z0-9]{6}$').hasMatch(bande);
    if (avecBande) app.noterBande(bande);
    void ouvrir() {
      if (jeu != null && app.ecran == 'accueil') app.jeu = jeu;
      if (table) {
        if (app.ecran != 'accueil') { app.toast("Invitation à la table $code : termine ta partie d'abord.", Niv.alerte); return; }
        app.fermerFenetre();
        ouvrirRejoindre(code0: code);
      } else if (avecBande) {
        lienBandeVu = false;
        proposerLienBande();
      }
    }
    if (!table && !avecBande && jeu == null) return;
    // Au lancement, on attend que l'accueil soit prêt.
    if (app.ecran == 'splash') {
      var n = 0;
      Timer.periodic(const Duration(milliseconds: 500), (t) { if (app.ecran != 'splash' || ++n > 40) { t.cancel(); ouvrir(); } });
    } else {
      ouvrir();
    }
  };

  // Notification touchée : l'appli s'ouvre sur la bonne fenêtre.
  Push.surToucher = (d) {
    void ouvrir() {
      final code = (d['code'] ?? '').toString().toUpperCase();
      final action = d['action'];
      if (action == 'table' && RegExp(r'^[A-Z]{4}$').hasMatch(code)) {
        if (app.ecran != 'accueil') { app.toast("Invitation à la table $code : termine ta partie d'abord.", Niv.alerte); return; }
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
