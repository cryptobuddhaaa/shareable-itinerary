package com.convenu.app.ui.screens.handshake

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.convenu.app.BuildConfig
import com.convenu.app.ui.components.HandshakeStatusBadge
import com.convenu.app.ui.theme.ConvenuBlue
import com.convenu.app.ui.theme.ConvenuGreen

@Composable
fun HandshakeDetailScreen(
    handshakeId: String,
    onBack: () -> Unit,
    viewModel: HandshakeViewModel = hiltViewModel(),
) {
    val listState by viewModel.listState.collectAsState()
    val actionState by viewModel.actionState.collectAsState()
    val context = LocalContext.current

    val handshake = remember(listState.handshakes, handshakeId) {
        listState.handshakes.find { it.id == handshakeId }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        // Back button
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                )
            }
            Text(
                text = "Handshake Details",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }

        Spacer(Modifier.height(16.dp))

        if (handshake == null) {
            Text(
                text = "Handshake not found",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.error,
            )
            return@Column
        }

        // Status
        HandshakeStatusBadge(status = handshake.status)
        Spacer(Modifier.height(16.dp))

        // Info card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
            ),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                DetailRow(
                    icon = Icons.Filled.Person,
                    label = "Contact",
                    value = handshake.initiatorName ?: handshake.receiverIdentifier,
                )
                handshake.eventTitle?.let {
                    Spacer(Modifier.height(8.dp))
                    DetailRow(
                        icon = Icons.Filled.CalendarToday,
                        label = "Event",
                        value = it,
                    )
                }
                Spacer(Modifier.height(8.dp))
                DetailRow(
                    label = "Created",
                    value = handshake.createdAt.take(10),
                )
                Spacer(Modifier.height(8.dp))
                DetailRow(
                    label = "Expires",
                    value = handshake.expiresAt.take(10),
                )
                if (handshake.pointsAwarded > 0) {
                    Spacer(Modifier.height(8.dp))
                    DetailRow(
                        label = "Points",
                        value = "+${handshake.pointsAwarded}",
                    )
                }

                // Wallet addresses
                handshake.initiatorWallet?.let {
                    Spacer(Modifier.height(8.dp))
                    DetailRow(label = "Initiator Wallet", value = "${it.take(6)}...${it.takeLast(4)}")
                }
                handshake.receiverWallet?.let {
                    Spacer(Modifier.height(8.dp))
                    DetailRow(label = "Receiver Wallet", value = "${it.take(6)}...${it.takeLast(4)}")
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        // Solana Explorer links for minted handshakes
        if (handshake.status == "minted") {
            val cluster = BuildConfig.SOLANA_NETWORK
            val clusterParam = if (cluster != "mainnet-beta") "?cluster=$cluster" else ""

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Blockchain Proof", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                    Spacer(Modifier.height(8.dp))

                    handshake.initiatorTxSignature?.let { tx ->
                        ExplorerLink("Initiator TX", "https://explorer.solana.com/tx/$tx$clusterParam", context)
                    }
                    handshake.receiverTxSignature?.let { tx ->
                        ExplorerLink("Receiver TX", "https://explorer.solana.com/tx/$tx$clusterParam", context)
                    }
                    handshake.initiatorNftAddress?.let { nft ->
                        ExplorerLink("Initiator NFT", "https://explorer.solana.com/address/$nft$clusterParam", context)
                    }
                    handshake.receiverNftAddress?.let { nft ->
                        ExplorerLink("Receiver NFT", "https://explorer.solana.com/address/$nft$clusterParam", context)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        // Action buttons based on status
        when (handshake.status) {
            "pending" -> {
                // Receiver can claim
                Text(
                    "This handshake is waiting to be claimed. If you are the receiver, tap Claim below.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        // Claim requires wallet address — user needs to connect wallet first
                        // For now show the action state
                        viewModel.clearActionState()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !actionState.isProcessing,
                ) {
                    Text("Claim Handshake")
                }
            }

            "matched" -> {
                Button(
                    onClick = { viewModel.mintHandshake(handshake.id) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !actionState.isProcessing,
                ) {
                    if (actionState.isProcessing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(actionState.currentAction ?: "Processing...")
                    } else {
                        Text("Mint Proof of Handshake")
                    }
                }
            }

            "minted" -> {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                ) {
                    Text(
                        text = "This handshake has been minted as an on-chain proof. ${handshake.pointsAwarded} points were awarded.",
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
            }
        }

        // Action feedback
        actionState.success?.let { success ->
            Spacer(Modifier.height(16.dp))
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                ),
            ) {
                Text(
                    text = success,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
        }

        actionState.error?.let { error ->
            Spacer(Modifier.height(16.dp))
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Text(
                    text = error,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
        }
    }
}

@Composable
private fun ExplorerLink(label: String, url: String, context: android.content.Context) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.AutoMirrored.Filled.OpenInNew, null, Modifier.size(14.dp), tint = ConvenuBlue)
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.bodySmall, color = ConvenuBlue)
    }
}

@Composable
private fun DetailRow(
    label: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(8.dp))
        }
        Text(
            text = "$label: ",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
