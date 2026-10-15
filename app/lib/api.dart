import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Web build is served by the backend itself, so it calls its own origin.
/// Override with `--dart-define=API=...` (flutter run -d chrome: http://localhost:8000, Android emulator: http://10.0.2.2:8000).
const apiBase = String.fromEnvironment('API', defaultValue: kIsWeb ? '' : 'http://localhost:8000');

/// An error that is safe to show the user as-is: always one plain sentence.
class ApiError implements Exception {
  ApiError(this.message);
  final String message;
  @override
  String toString() => message;
}

class Api {
  final _c = http.Client();
  static const _timeout = Duration(seconds: 60); // the AI planner can take a while; nothing should hang forever

  Future<dynamic> get(String path, [Map<String, String>? query]) =>
      _send(() => _c.get(Uri.parse('$apiBase$path').replace(queryParameters: query)));

  Future<dynamic> post(String path, Object body) => _send(() => _c.post(Uri.parse('$apiBase$path'),
      headers: {'content-type': 'application/json'}, body: jsonEncode(body)));

  Future<dynamic> _send(Future<http.Response> Function() request) async {
    final http.Response r;
    try {
      r = await request().timeout(_timeout);
    } on TimeoutException {
      throw ApiError('The server is taking too long. Please try again.');
    } catch (_) {
      throw ApiError("Can't reach the LeafIt server. Check your connection and try again.");
    }
    dynamic body;
    try {
      body = jsonDecode(utf8.decode(r.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (r.statusCode < 400) return body;
    final detail = body is Map ? body['detail'] : null;
    if (detail is String && (r.statusCode < 500 || r.statusCode == 503)) throw ApiError(detail); // one readable sentence
    if (r.statusCode >= 500) throw ApiError('Something went wrong on our side. Please try again.');
    throw ApiError('Please check your input and try again.');
  }
}

final api = Api();
