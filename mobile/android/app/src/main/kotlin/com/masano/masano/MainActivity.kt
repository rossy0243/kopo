package com.masano.masano

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        creerCanaux()
    }

    // Canaux de notification (Android 8+) : le serveur envoie channel_id = type du message.
    // Sans eux, Android range tout dans un canal « Divers » sans son ni bandeau.
    private fun creerCanaux() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val gestion = getSystemService(NotificationManager::class.java) ?: return
        val canaux = listOf(
            NotificationChannel("invitation", "Invitations à jouer", NotificationManager.IMPORTANCE_HIGH).apply { description = "Un ami t'invite à sa table" },
            NotificationChannel("ami", "Amis", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Demandes d'ami reçues et acceptées" },
            NotificationChannel("match", "Match du jour", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Rappel du Match du jour à 19 h" },
            NotificationChannel("annonce", "Annonces", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Nouveautés et messages de Masano" },
        )
        gestion.createNotificationChannels(canaux)
    }
}
