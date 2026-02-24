package com.convenu.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import com.convenu.app.ui.navigation.ConvenuNavHost
import com.convenu.app.ui.theme.ConvenuTheme
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import dagger.hilt.android.AndroidEntryPoint

val LocalActivityResultSender = staticCompositionLocalOf<ActivityResultSender> {
    error("No ActivityResultSender provided — must be created in Activity.onCreate()")
}

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Must be created before STARTED — registerForActivityResult restriction
        val sender = ActivityResultSender(this)
        enableEdgeToEdge()
        setContent {
            CompositionLocalProvider(LocalActivityResultSender provides sender) {
                ConvenuTheme {
                    ConvenuNavHost()
                }
            }
        }
    }
}
