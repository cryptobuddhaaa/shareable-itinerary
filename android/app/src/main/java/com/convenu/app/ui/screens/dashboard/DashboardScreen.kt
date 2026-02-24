package com.convenu.app.ui.screens.dashboard

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.convenu.app.BuildConfig
import com.convenu.app.data.model.HandshakeDto
import com.convenu.app.data.model.PointEntry
import com.convenu.app.data.model.TrustScoreFull
import com.convenu.app.ui.components.HandshakeStatusBadge
import com.convenu.app.ui.theme.*

@Composable
fun DashboardScreen(
    onNavigateToHandshakes: () -> Unit,
    onNavigateToWallet: () -> Unit,
    onLogout: () -> Unit = {},
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var showLogoutConfirm by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        // Header
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Dashboard", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onBackground)
            Row {
                IconButton(onClick = { viewModel.refresh() }) {
                    Icon(Icons.Filled.Refresh, "Refresh", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { showLogoutConfirm = true }) {
                    Icon(Icons.AutoMirrored.Filled.Logout, "Logout", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        if (uiState.isLoading) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            // Stat cards row
            val trust = uiState.trust
            val full = uiState.trustFull
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatCard("Trust Score", if (trust != null) "${trust.trustScore}/100" else "--", ConvenuPurple, Modifier.weight(1f))
                StatCard("Points", "${uiState.totalPoints}", ConvenuGreen, Modifier.weight(1f))
                StatCard("Handshakes", "${trust?.totalHandshakes ?: 0}", ConvenuBlue, Modifier.weight(1f))
            }

            Spacer(Modifier.height(16.dp))

            // Trust Score Breakdown Card
            Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Shield, null, Modifier.size(24.dp), tint = ConvenuPurple)
                        Spacer(Modifier.width(8.dp))
                        Text("Trust Score", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                        if (trust != null) {
                            Spacer(Modifier.weight(1f))
                            Text("${trust.trustScore}/100", style = MaterialTheme.typography.titleLarge, color = ConvenuPurple, fontWeight = FontWeight.Bold)
                        }
                    }

                    if (full != null) {
                        Spacer(Modifier.height(16.dp))

                        // Handshakes (max 30)
                        CategoryHeader("Handshakes", full.scoreHandshakes, 30, ConvenuBlue)
                        TrustSignalRow("Minted handshakes (${full.totalHandshakes}/30)", full.totalHandshakes > 0, "+${full.scoreHandshakes}")
                        SignalNote("1 point per successful handshake, max 30")

                        Spacer(Modifier.height(12.dp))

                        // Wallet (max 20)
                        CategoryHeader("Wallet", full.scoreWallet, 20, ConvenuGreen)
                        TrustSignalRow("Wallet connected", full.walletConnected, "+5")
                        TrustSignalRow(
                            "Wallet age > 90 days${if (full.walletAgeDays != null) " (${full.walletAgeDays}d)" else ""}",
                            full.walletAgeDays != null && full.walletAgeDays > 90,
                            "+5",
                        )
                        TrustSignalRow(
                            "Transaction count > 10${if (full.walletTxCount != null) " (${full.walletTxCount})" else ""}",
                            full.walletTxCount != null && full.walletTxCount > 10,
                            "+5",
                        )
                        TrustSignalRow("Holds tokens/NFTs", full.walletHasTokens, "+5")
                        if (!full.walletConnected) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Connect wallet",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.clickable { onNavigateToWallet() },
                            )
                        }

                        Spacer(Modifier.height(12.dp))

                        // Socials (max 20)
                        CategoryHeader("Socials", full.scoreSocials, 20, ConvenuPurple)
                        TrustSignalRow("Telegram Premium", full.telegramPremium, "+4")
                        TrustSignalRow("Telegram username", full.hasUsername, "+4")
                        TrustSignalRow(
                            "Telegram account age > 1yr${if (full.telegramAccountAgeDays != null) " (${full.telegramAccountAgeDays / 365}y)" else ""}",
                            full.telegramAccountAgeDays != null && full.telegramAccountAgeDays > 365,
                            "+4",
                        )
                        TrustSignalRow("Verified X account", full.xVerified, "+4")
                        TrustSignalRow("X Premium", full.xPremium, "+4")

                        Spacer(Modifier.height(12.dp))

                        // Events (max 20) — placeholder
                        CategoryHeader("Events", full.scoreEvents, 20, ConvenuYellow)
                        SignalNote("Coming soon: Proof of Attendance soulbound NFTs from event organizers.")

                        Spacer(Modifier.height(12.dp))

                        // Community (max 10) — placeholder
                        CategoryHeader("Community", full.scoreCommunity, 10, Slate400)
                        SignalNote("Coming soon: Community vouches from registered organizations.")
                    } else if (trust == null) {
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Link your socials and wallet to get started.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Points Card
            if (uiState.totalPoints > 0 || uiState.pointsHistory.isNotEmpty()) {
                Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.EmojiEvents, null, Modifier.size(24.dp), tint = ConvenuYellow)
                            Spacer(Modifier.width(8.dp))
                            Text("Points", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                            Spacer(Modifier.weight(1f))
                            Text("${uiState.totalPoints} total", style = MaterialTheme.typography.titleMedium, color = ConvenuGreen)
                        }
                        if (uiState.pointsHistory.isNotEmpty()) {
                            Spacer(Modifier.height(12.dp))
                            uiState.pointsHistory.take(5).forEach { entry ->
                                PointEntryRow(entry)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }

            // Recent Handshakes
            Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("Recent Handshakes", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                        Text("View All", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.clickable { onNavigateToHandshakes() })
                    }
                    Spacer(Modifier.height(12.dp))
                    if (uiState.recentHandshakes.isEmpty()) {
                        Text("No handshakes yet. Start by connecting with a contact!", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        uiState.recentHandshakes.take(5).forEach { handshake ->
                            HandshakeRow(handshake, context)
                        }
                    }
                }
            }

            // Error
            uiState.error?.let { error ->
                Spacer(Modifier.height(16.dp))
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Text(error, modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }
        }
    }

    // Logout confirmation
    if (showLogoutConfirm) {
        AlertDialog(
            onDismissRequest = { showLogoutConfirm = false },
            title = { Text("Logout?") },
            text = { Text("You'll need to log in again via Telegram.") },
            confirmButton = {
                TextButton(onClick = { viewModel.logout(); onLogout(); showLogoutConfirm = false }, colors = ButtonDefaults.textButtonColors(contentColor = ConvenuRed)) {
                    Text("Logout")
                }
            },
            dismissButton = { TextButton(onClick = { showLogoutConfirm = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun StatCard(label: String, value: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleLarge, color = color, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CategoryHeader(title: String, score: Int, max: Int, color: androidx.compose.ui.graphics.Color) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
        Text("$score/$max", style = MaterialTheme.typography.labelLarge, color = color, fontWeight = FontWeight.Bold)
    }
    Spacer(Modifier.height(4.dp))
}

@Composable
private fun TrustSignalRow(label: String, active: Boolean, points: String = "") {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(
            if (active) Icons.Filled.CheckCircle else Icons.Filled.Cancel,
            null, Modifier.size(16.dp),
            tint = if (active) ConvenuGreen else Slate500,
        )
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.bodySmall, color = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        if (points.isNotEmpty()) {
            Text(points, style = MaterialTheme.typography.labelSmall, color = if (active) ConvenuGreen else Slate500)
        }
    }
}

@Composable
private fun SignalNote(text: String) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = Slate500, modifier = Modifier.padding(start = 24.dp, top = 2.dp))
}

@Composable
private fun PointEntryRow(entry: PointEntry) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(entry.reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface)
            Text(entry.createdAt.take(10), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("+${entry.points}", style = MaterialTheme.typography.titleSmall, color = ConvenuGreen)
    }
}

@Composable
private fun HandshakeRow(handshake: HandshakeDto, context: android.content.Context) {
    val cluster = BuildConfig.SOLANA_NETWORK
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                handshake.initiatorName ?: handshake.receiverIdentifier,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            handshake.eventTitle?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (handshake.pointsAwarded > 0) {
                Text("+${handshake.pointsAwarded} pts", style = MaterialTheme.typography.bodySmall, color = ConvenuGreen)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            HandshakeStatusBadge(status = handshake.status)
            // Solana Explorer link for minted
            if (handshake.status == "minted") {
                val nft = handshake.initiatorNftAddress ?: handshake.receiverNftAddress
                if (nft != null) {
                    val clusterParam = if (cluster != "mainnet-beta") "?cluster=$cluster" else ""
                    Text(
                        "View on Explorer",
                        style = MaterialTheme.typography.labelSmall,
                        color = ConvenuBlue,
                        modifier = Modifier.clickable {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://explorer.solana.com/tx/$nft$clusterParam")))
                        },
                    )
                }
            }
        }
    }
}
