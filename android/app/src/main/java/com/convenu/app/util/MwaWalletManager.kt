package com.convenu.app.util

import android.net.Uri
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
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

sealed class WalletResult<out T> {
    data class Success<T>(val data: T) : WalletResult<T>()
    data class Error(val message: String) : WalletResult<Nothing>()
    data object NoWallet : WalletResult<Nothing>()
    data object Cancelled : WalletResult<Nothing>()
}

@Singleton
class MwaWalletManager @Inject constructor() {

    private val mwa = MobileWalletAdapter()

    var currentConnection: WalletConnection? = null
        private set

    suspend fun authorize(sender: ActivityResultSender): WalletResult<WalletConnection> {
        return try {
            val result = mwa.transact(sender) {
                authorize(
                    identityUri = Uri.parse("https://convenu.xyz"),
                    iconUri = Uri.parse("favicon.ico"),
                    identityName = "Convenu",
                )
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
                    WalletResult.Error(result.message ?: "Authorization failed")
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "MWA authorize exception")
            WalletResult.Error(e.message ?: "Wallet authorization failed")
        }
    }

    suspend fun signMessage(
        sender: ActivityResultSender,
        message: ByteArray,
    ): WalletResult<ByteArray> {
        val connection = currentConnection
            ?: return WalletResult.Error("Wallet not connected")

        return try {
            val result = mwa.transact(sender) {
                reauthorize(
                    identityUri = Uri.parse("https://convenu.xyz"),
                    iconUri = Uri.parse("favicon.ico"),
                    identityName = "Convenu",
                    authToken = connection.authToken,
                )
                signMessages(
                    messages = arrayOf(message),
                    addresses = arrayOf(connection.publicKey),
                )
            }

            when (result) {
                is TransactionResult.Success -> {
                    val signatures = result.payload.messages
                    if (signatures.isNotEmpty() && signatures[0].signatures.isNotEmpty()) {
                        WalletResult.Success(signatures[0].signatures[0])
                    } else {
                        WalletResult.Error("No signature returned")
                    }
                }

                is TransactionResult.NoWalletFound -> WalletResult.NoWallet
                is TransactionResult.Failure -> {
                    Timber.e("MWA signMessage failed: ${result.message}")
                    WalletResult.Error(result.message ?: "Signing failed")
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
            val result = mwa.transact(sender) {
                reauthorize(
                    identityUri = Uri.parse("https://convenu.xyz"),
                    iconUri = Uri.parse("favicon.ico"),
                    identityName = "Convenu",
                    authToken = connection.authToken,
                )
                signTransactions(transactions = transactions)
            }

            when (result) {
                is TransactionResult.Success -> {
                    WalletResult.Success(result.payload.signedPayloads)
                }

                is TransactionResult.NoWalletFound -> WalletResult.NoWallet
                is TransactionResult.Failure -> {
                    Timber.e("MWA signTransactions failed: ${result.message}")
                    WalletResult.Error(result.message ?: "Transaction signing failed")
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
