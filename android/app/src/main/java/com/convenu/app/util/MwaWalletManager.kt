package com.convenu.app.util

import android.net.Uri
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

data class WalletConnection(
    val publicKey: ByteArray,
    val publicKeyBase58: String,
    val authToken: String,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is WalletConnection) return false
        return publicKeyBase58 == other.publicKeyBase58
    }

    override fun hashCode(): Int = publicKeyBase58.hashCode()
}

/** Data returned from [MwaWalletManager.authorizeAndSign] for server-side wallet auth. */
data class WalletAuthData(
    val walletAddress: String,
    val message: String,
    val signatureBase58: String,
)

sealed class WalletResult<out T> {
    data class Success<T>(val data: T) : WalletResult<T>()
    data class Error(val message: String) : WalletResult<Nothing>()
    data object NoWallet : WalletResult<Nothing>()
    data object Cancelled : WalletResult<Nothing>()
}

@Singleton
class MwaWalletManager @Inject constructor() {

    private val mwa = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = Uri.parse("https://app.convenu.xyz"),
            iconUri = Uri.parse("favicon.ico"),
            identityName = "Convenu",
        ),
    )

    var currentConnection: WalletConnection? = null
        private set

    suspend fun authorize(sender: ActivityResultSender): WalletResult<WalletConnection> {
        return try {
            val result = mwa.transact(sender) { authResult ->
                authResult
            }

            when (result) {
                is TransactionResult.Success -> {
                    val authResult = result.payload
                    val publicKey = authResult.accounts.firstOrNull()?.publicKey
                    val authToken = authResult.authToken

                    if (publicKey == null || authToken.isNullOrBlank()) {
                        WalletResult.Error("No account returned from wallet")
                    } else {
                        val connection = WalletConnection(
                            publicKey = publicKey,
                            publicKeyBase58 = Base58.encode(publicKey),
                            authToken = authToken,
                        )
                        currentConnection = connection
                        WalletResult.Success(connection)
                    }
                }

                is TransactionResult.NoWalletFound -> {
                    Timber.w("No MWA wallet found")
                    WalletResult.NoWallet
                }

                is TransactionResult.Failure -> {
                    Timber.e("MWA authorize failed: ${result.message}")
                    WalletResult.Error(result.message)
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "MWA authorize exception")
            WalletResult.Error(e.message ?: "Wallet authorization failed")
        }
    }

    /**
     * Authorize AND sign a login message in a single wallet interaction.
     * Returns everything needed to authenticate with the server.
     */
    suspend fun authorizeAndSign(sender: ActivityResultSender): WalletResult<WalletAuthData> {
        return try {
            val timestamp = System.currentTimeMillis()
            val loginMessage = "Sign in to Convenu with this wallet. Timestamp: $timestamp"

            val result = mwa.transact(sender) { authResult ->
                val pubkey = authResult.accounts.first().publicKey
                val signResult = signMessagesDetached(
                    messages = arrayOf(loginMessage.toByteArray()),
                    addresses = arrayOf(pubkey),
                )
                Pair(pubkey, signResult.messages.first().signatures.first())
            }

            when (result) {
                is TransactionResult.Success -> {
                    val (pubkeyBytes, signatureBytes) = result.payload
                    val walletAddress = Base58.encode(pubkeyBytes)
                    val signatureBase58 = Base58.encode(signatureBytes)

                    // Also save as current connection
                    currentConnection = WalletConnection(
                        publicKey = pubkeyBytes,
                        publicKeyBase58 = walletAddress,
                        authToken = result.authResult.authToken,
                    )

                    WalletResult.Success(
                        WalletAuthData(
                            walletAddress = walletAddress,
                            message = loginMessage,
                            signatureBase58 = signatureBase58,
                        ),
                    )
                }

                is TransactionResult.NoWalletFound -> {
                    Timber.w("No MWA wallet found")
                    WalletResult.NoWallet
                }

                is TransactionResult.Failure -> {
                    Timber.e("MWA authorizeAndSign failed: ${result.message}")
                    WalletResult.Error(result.message)
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "MWA authorizeAndSign exception")
            WalletResult.Error(e.message ?: "Wallet login failed")
        }
    }

    suspend fun signMessage(
        sender: ActivityResultSender,
        message: ByteArray,
    ): WalletResult<ByteArray> {
        val connection = currentConnection
            ?: return WalletResult.Error("Wallet not connected")

        return try {
            val result = mwa.transact(sender) { _ ->
                signMessagesDetached(
                    messages = arrayOf(message),
                    addresses = arrayOf(connection.publicKey),
                )
            }

            when (result) {
                is TransactionResult.Success -> {
                    val signResult = result.payload
                    if (signResult.messages.isNotEmpty() && signResult.messages[0].signatures.isNotEmpty()) {
                        WalletResult.Success(signResult.messages[0].signatures[0])
                    } else {
                        WalletResult.Error("No signature returned")
                    }
                }

                is TransactionResult.NoWalletFound -> WalletResult.NoWallet
                is TransactionResult.Failure -> {
                    Timber.e("MWA signMessage failed: ${result.message}")
                    WalletResult.Error(result.message)
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "MWA signMessage exception")
            WalletResult.Error(e.message ?: "Message signing failed")
        }
    }

    suspend fun signTransactions(
        sender: ActivityResultSender,
        transactions: Array<ByteArray>,
    ): WalletResult<Array<ByteArray>> {
        val connection = currentConnection
            ?: return WalletResult.Error("Wallet not connected")

        return try {
            val result = mwa.transact(sender) { _ ->
                @Suppress("DEPRECATION")
                signTransactions(transactions = transactions)
            }

            when (result) {
                is TransactionResult.Success -> {
                    WalletResult.Success(result.payload.signedPayloads)
                }

                is TransactionResult.NoWalletFound -> WalletResult.NoWallet
                is TransactionResult.Failure -> {
                    Timber.e("MWA signTransactions failed: ${result.message}")
                    WalletResult.Error(result.message)
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "MWA signTransactions exception")
            WalletResult.Error(e.message ?: "Transaction signing failed")
        }
    }

    fun disconnect() {
        currentConnection = null
    }
}
