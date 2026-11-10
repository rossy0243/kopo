// MessagePack minimal (encodage et décodage), suffisant pour les messages des salles Masano.
// Les salles Masano n'envoient que du JSON simple : null, booléens, nombres, textes, listes, objets.
// Dans une appli, on peut aussi utiliser un paquet pub.dev (msgpack_dart) : le format est standard.
import 'dart:convert';
import 'dart:typed_data';

class MsgPackEncodeur {
  final BytesBuilder _b = BytesBuilder(copy: false);

  Uint8List get octets => _b.toBytes();

  void ecrire(Object? v) {
    if (v == null) {
      _b.addByte(0xc0);
    } else if (v is bool) {
      _b.addByte(v ? 0xc3 : 0xc2);
    } else if (v is int) {
      _entier(v);
    } else if (v is double) {
      final d = ByteData(9)..setUint8(0, 0xcb)..setFloat64(1, v);
      _b.add(d.buffer.asUint8List());
    } else if (v is String) {
      texte(v);
    } else if (v is List) {
      final n = v.length;
      if (n < 16) {
        _b.addByte(0x90 | n);
      } else if (n < 0x10000) {
        _b.add([0xdc, n >> 8, n & 0xff]);
      } else {
        _b.add([0xdd, (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
      }
      for (final x in v) {
        ecrire(x);
      }
    } else if (v is Map) {
      final n = v.length;
      if (n < 16) {
        _b.addByte(0x80 | n);
      } else if (n < 0x10000) {
        _b.add([0xde, n >> 8, n & 0xff]);
      } else {
        _b.add([0xdf, (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
      }
      v.forEach((k, x) {
        ecrire(k.toString());
        ecrire(x);
      });
    } else {
      throw ArgumentError('Type non pris en charge : ${v.runtimeType}');
    }
  }

  // Texte au format MessagePack « str » (c'est aussi le format du type de message Colyseus).
  void texte(String s) {
    final u = utf8.encode(s);
    final n = u.length;
    if (n < 32) {
      _b.addByte(0xa0 | n);
    } else if (n < 0x100) {
      _b.add([0xd9, n]);
    } else if (n < 0x10000) {
      _b.add([0xda, n >> 8, n & 0xff]);
    } else {
      _b.add([0xdb, (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
    }
    _b.add(u);
  }

  void _entier(int v) {
    if (v >= 0 && v < 0x80) {
      _b.addByte(v);
    } else if (v < 0 && v >= -32) {
      _b.addByte(v & 0xff);
    } else if (v >= 0 && v < 0x100) {
      _b.add([0xcc, v]);
    } else if (v >= 0 && v < 0x10000) {
      _b.add([0xcd, v >> 8, v & 0xff]);
    } else if (v >= 0 && v < 0x100000000) {
      _b.add([0xce, (v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
    } else if (v >= -0x80000000 && v < 0) {
      final d = ByteData(5)..setUint8(0, 0xd2)..setInt32(1, v);
      _b.add(d.buffer.asUint8List());
    } else {
      final d = ByteData(9)..setUint8(0, 0xd3)..setInt64(1, v);
      _b.add(d.buffer.asUint8List());
    }
  }
}

class MsgPackDecodeur {
  final ByteData _d;
  int position;

  MsgPackDecodeur(Uint8List octets, [this.position = 0]) : _d = ByteData.sublistView(octets);

  bool get fini => position >= _d.lengthInBytes;

  int _u8() => _d.getUint8(position++);
  int _u16() { final v = _d.getUint16(position); position += 2; return v; }
  int _u32() { final v = _d.getUint32(position); position += 4; return v; }

  String _utf8(int n) {
    final s = utf8.decode(Uint8List.sublistView(_d, position, position + n));
    position += n;
    return s;
  }

  Object? lire() {
    final p = _u8();
    if (p < 0x80) return p;
    if (p >= 0xe0) return p - 0x100;
    if (p >= 0xa0 && p <= 0xbf) return _utf8(p & 0x1f);
    if (p >= 0x90 && p <= 0x9f) return _liste(p & 0x0f);
    if (p >= 0x80 && p <= 0x8f) return _objet(p & 0x0f);
    switch (p) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return _octets(_u8());
      case 0xc5: return _octets(_u16());
      case 0xc6: return _octets(_u32());
      case 0xca: { final v = _d.getFloat32(position); position += 4; return v; }
      case 0xcb: { final v = _d.getFloat64(position); position += 8; return v; }
      case 0xcc: return _u8();
      case 0xcd: return _u16();
      case 0xce: return _u32();
      case 0xcf: { final v = _d.getUint64(position); position += 8; return v; }
      case 0xd0: { final v = _d.getInt8(position); position += 1; return v; }
      case 0xd1: { final v = _d.getInt16(position); position += 2; return v; }
      case 0xd2: { final v = _d.getInt32(position); position += 4; return v; }
      case 0xd3: { final v = _d.getInt64(position); position += 8; return v; }
      // Extensions : le serveur (msgpackr) code « undefined » en fixext 1 (d4 00 00). On les lit comme null.
      case 0xd4: return _ext(1);
      case 0xd5: return _ext(2);
      case 0xd6: return _ext(4);
      case 0xd7: return _ext(8);
      case 0xd8: return _ext(16);
      case 0xc7: return _ext(_u8());
      case 0xc8: return _ext(_u16());
      case 0xc9: return _ext(_u32());
      case 0xd9: return _utf8(_u8());
      case 0xda: return _utf8(_u16());
      case 0xdb: return _utf8(_u32());
      case 0xdc: return _liste(_u16());
      case 0xdd: return _liste(_u32());
      case 0xde: return _objet(_u16());
      case 0xdf: return _objet(_u32());
    }
    throw FormatException('MessagePack : préfixe inconnu 0x${p.toRadixString(16)}');
  }

  Uint8List _octets(int n) {
    final b = Uint8List.fromList(Uint8List.sublistView(_d, position, position + n));
    position += n;
    return b;
  }

  Object? _ext(int n) {
    position += 1 + n; // type de l'extension, puis ses octets
    return null;
  }

  List<Object?> _liste(int n) => List<Object?>.generate(n, (_) => lire());

  Map<String, Object?> _objet(int n) {
    final m = <String, Object?>{};
    for (var i = 0; i < n; i++) {
      final k = lire();
      m[k.toString()] = lire();
    }
    return m;
  }
}

Uint8List msgpackEncoder(Object? v) => (MsgPackEncodeur()..ecrire(v)).octets;
Object? msgpackDecoder(Uint8List o) => MsgPackDecodeur(o).lire();
