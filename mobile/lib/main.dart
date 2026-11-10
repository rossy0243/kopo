// Masano : Kopo et Inter (8), entre amis, en ligne ou contre les robots.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'commun/sons.dart';
import 'commun/stock.dart';
import 'commun/theme.dart';
import 'ecrans/racine.dart';
import 'etat.dart';
import 'fenetres/branchement.dart';
import 'reseau/google.dart';
import 'reseau/push.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Stock.init();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.light, systemNavigationBarColor: K.table));
  brancherFenetres();
  runApp(const Masano());
  Google.brancher();
  Push.initialiser().then((_) => Push.synchroniser());
  app.demarrer();
}

class Masano extends StatefulWidget {
  const Masano({super.key});
  @override
  State<Masano> createState() => _MasanoState();
}

class _MasanoState extends State<Masano> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    Sons.pause(s != AppLifecycleState.resumed);
    if (s == AppLifecycleState.resumed) app.relireConfig();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Masano',
        debugShowCheckedModeBanner: false,
        theme: K.theme(),
        navigatorKey: app.navigateur,
        scaffoldMessengerKey: app.messager,
        locale: const Locale('fr'),
        supportedLocales: const [Locale('fr')],
        localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const Racine(),
      );
}
