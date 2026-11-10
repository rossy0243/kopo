// Stockage du téléphone, comme localStorage sur le site (mêmes clés « kopo-… », valeurs en JSON).
// Tout est lu au démarrage : lire() est immédiat, écrire() enregistre en arrière-plan.
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

class Stock {
  static SharedPreferences? _p;
  static final Map<String, Object?> _cache = {};

  static Future<void> init() async {
    _p = await SharedPreferences.getInstance();
    for (final k in _p!.getKeys()) {
      final t = _p!.getString(k);
      if (t == null) continue;
      try { _cache[k] = jsonDecode(t); } catch (_) { _cache[k] = t; }
    }
  }

  static dynamic lire(String k) => _cache[k];
  static void ecrire(String k, Object? v) {
    _cache[k] = v == null ? null : jsonDecode(jsonEncode(v)); // copie : ce qu'on garde ne bouge plus
    _p?.setString(k, jsonEncode(v));
  }
  static void effacer(String k) { _cache.remove(k); _p?.remove(k); }
  static Iterable<String> get cles => _cache.keys;
  static Future<void> toutEffacer() async {
    for (final k in _cache.keys.toList()) { if (k.startsWith('kopo')) effacer(k); }
  }
}
