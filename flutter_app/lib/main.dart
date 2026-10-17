import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'screens/blocks.dart';
import 'ui/theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: Leaf.page,
    systemNavigationBarIconBrightness: Brightness.light,
  ));
  runApp(const LeafItApp());
}

class LeafItApp extends StatelessWidget {
  const LeafItApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'LeafIt',
        debugShowCheckedModeBanner: false,
        theme: leafTheme(), // one editorial dark theme, like the portfolio (decisions #27)
        home: const BlocksScreen(),
      );
}
