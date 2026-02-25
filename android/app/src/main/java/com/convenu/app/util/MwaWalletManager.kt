package com.convenu.app.util

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import com.convenu.app.BuildConfig
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import timber.log.Timber
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton

/** Wallet apps supported by Convenu. */
enum class WalletOption(
    val displayName: String,
    val description: String,
    val packageName: String,
    /** HTTPS URI base for targeting this wallet via MWA deep link. Null = default solana-wallet: scheme. */
    val walletUriBase: Uri?,
    val playStoreUri: String?,
) {
    SEED_VAULT(
        displayName = "Seed Vault",
        description = "Built-in wallet on Seeker devices",
        packageName = "com.solanamobile.seedvault",
        walletUriBase = null,
        playStoreUri = null,
    ),
    PHANTOM(
        displayName = "Phantom",
        description = "Popular Solana wallet",
        packageName = "app.phantom",
        walletUriBase = Uri.parse("https://phantom.app"),
        playStoreUri = "https://play.google.com/store/apps/details?id=app.phantom",
    ),
    SOLFLARE(
        displayName = "Solflare",
        description = "Solana wallet with DeFi features",
        packageName = "com.solflare.mobile",
        walletUriBase = Uri.parse("https://solflare.com"),
        playStoreUri = "https://play.google.com/store/apps/details?id=com.solflare.mobile",
    );

    fun isInstalled(context: Context): Boolean {
        // SeedVault is detected by checking if any app handles the solana-wallet: scheme
        if (this == SEED_VAULT) {
            val intent = android.content.Intent(
                android.content.Intent.ACTION_VIEW,
                Uri.parse("solana-wallet:/"),
            ).addCategory(android.content.Intent.CATEGORY_BROWSABLE)
            val resolved = context.packageManager.resolveActivity(
                intent, PackageManager.MATCH_DEFAULT_ONLY,
            )
            return resolved != null
        }
        return try {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(packageName, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }
}

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
    /** Base58-encoded transaction message bytes for backend signature verification. */
    val txMessage: String,
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

    suspend fun authorize(
        sender: ActivityResultSender,
        wallet: WalletOption? = null,
    ): WalletResult<WalletConnection> {
        return try {
            setWalletTarget(wallet)
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
     *
     * Uses signTransactions with a Memo instruction instead of signMessagesDetached,
     * because sign_messages is optional in MWA and not supported by Seeker/SeedVault.
     * Uses NonCancellable to prevent the outer coroutine scope from cancelling the
     * MWA session during wallet user interaction.
     * Retries once on cancellation as a fallback.
     */
    suspend fun authorizeAndSign(
        sender: ActivityResultSender,
        wallet: WalletOption? = null,
    ): WalletResult<WalletAuthData> {
        val timestamp = System.currentTimeMillis()
        val loginMessage = "Sign in to Convenu with this wallet. Timestamp: $timestamp"

        // Fetch latest blockhash so the wallet accepts the transaction
        val blockhash = try {
            fetchLatestBlockhash()
        } catch (e: Exception) {
            Timber.e(e, "Failed to fetch blockhash")
            return WalletResult.Error("Network error: could not reach Solana. Please try again.")
        }

        setWalletTarget(wallet)

        for (attempt in 1..MAX_TRANSACT_ATTEMPTS) {
            try {
                val result = withContext(NonCancellable) {
                    mwa.transact(sender) { authResult ->
                        val pubkey = authResult.accounts.first().publicKey

                        // Build a memo transaction containing the login message
                        val unsignedTx = buildMemoTransaction(
                            walletPubkey = pubkey,
                            blockhash = blockhash,
                            memoData = loginMessage.toByteArray(Charsets.UTF_8),
                        )

                        @Suppress("DEPRECATION")
                        val signResult = signTransactions(
                            transactions = arrayOf(unsignedTx),
                        )

                        Pair(pubkey, signResult.signedPayloads.first())
                    }
                }

                when (result) {
                    is TransactionResult.Success -> {
                        val (pubkeyBytes, signedTxBytes) = result.payload
                        val walletAddress = Base58.encode(pubkeyBytes)

                        // Signed transaction layout: [01][64-byte signature][message bytes...]
                        val signatureBytes = signedTxBytes.copyOfRange(1, 65)
                        val txMessageBytes = signedTxBytes.copyOfRange(65, signedTxBytes.size)

                        currentConnection = WalletConnection(
                            publicKey = pubkeyBytes,
                            publicKeyBase58 = walletAddress,
                            authToken = result.authResult.authToken,
                        )

                        return WalletResult.Success(
                            WalletAuthData(
                                walletAddress = walletAddress,
                                message = loginMessage,
                                signatureBase58 = Base58.encode(signatureBytes),
                                txMessage = Base58.encode(txMessageBytes),
                            ),
                        )
                    }

                    is TransactionResult.NoWalletFound -> {
                        Timber.w("No MWA wallet found")
                        return WalletResult.NoWallet
                    }

                    is TransactionResult.Failure -> {
                        if (attempt < MAX_TRANSACT_ATTEMPTS &&
                            "cancelled" in result.message.lowercase()
                        ) {
                            Timber.w("MWA attempt $attempt cancelled, retrying...")
                            delay(RETRY_DELAY_MS)
                            continue
                        }
                        Timber.e("MWA authorizeAndSign failed: ${result.message}")
                        return WalletResult.Error(
                            "Wallet connection interrupted. Please try again.",
                        )
                    }
                }
            } catch (e: Exception) {
                if (attempt < MAX_TRANSACT_ATTEMPTS &&
                    e.message?.contains("cancelled", ignoreCase = true) == true
                ) {
                    Timber.w(e, "MWA attempt $attempt exception, retrying...")
                    delay(RETRY_DELAY_MS)
                    continue
                }
                Timber.e(e, "MWA authorizeAndSign exception")
                return WalletResult.Error(e.message ?: "Wallet login failed")
            }
        }

        return WalletResult.Error("Wallet connection failed. Please try again.")
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

    // ---- Private helpers ----

    /**
     * Set the wallet URI base on the MWA instance via reflection to target a specific wallet app.
     * When [wallet] is null or has no URI base, clears it so MWA uses the default solana-wallet: scheme.
     */
    private fun setWalletTarget(wallet: WalletOption?) {
        try {
            val field = MobileWalletAdapter::class.java.getDeclaredField("walletUriBase")
            field.isAccessible = true
            field.set(mwa, wallet?.walletUriBase)
        } catch (e: Exception) {
            Timber.w(e, "Could not set wallet target for ${wallet?.displayName}")
        }
    }

    /**
     * Build an unsigned Solana transaction with a single Memo v1 instruction.
     * The wallet will sign this via signTransactions (required MWA method),
     * unlike signMessagesDetached which is optional and unsupported on Seeker.
     */
    private fun buildMemoTransaction(
        walletPubkey: ByteArray,
        blockhash: ByteArray,
        memoData: ByteArray,
    ): ByteArray {
        require(walletPubkey.size == 32) { "Wallet pubkey must be 32 bytes" }
        require(blockhash.size == 32) { "Blockhash must be 32 bytes" }

        // Build the transaction message
        val parts = mutableListOf<ByteArray>()

        // Header: [num_required_sigs, num_readonly_signed, num_readonly_unsigned]
        parts.add(byteArrayOf(1, 0, 1))
        // Account keys: [wallet_pubkey, memo_program_v1_id]
        parts.add(encodeCompactU16(2))
        parts.add(walletPubkey)
        parts.add(MEMO_PROGRAM_V1_ID)
        // Recent blockhash
        parts.add(blockhash)
        // Instructions: 1 instruction
        parts.add(encodeCompactU16(1))
        // Memo instruction: program_id_index=1, no accounts, data=memoData
        parts.add(byteArrayOf(1)) // program_id_index
        parts.add(encodeCompactU16(0)) // num_accounts
        parts.add(encodeCompactU16(memoData.size)) // data_length
        parts.add(memoData) // data

        val messageSize = parts.sumOf { it.size }
        val message = ByteArray(messageSize)
        var offset = 0
        for (part in parts) {
            System.arraycopy(part, 0, message, offset, part.size)
            offset += part.size
        }

        // Full unsigned transaction: [compact(1)][64 zero bytes for signature][message]
        val unsignedTx = ByteArray(1 + 64 + message.size)
        unsignedTx[0] = 1 // compact_u16: 1 signature
        // Bytes 1..64 are zero (empty signature placeholder)
        System.arraycopy(message, 0, unsignedTx, 65, message.size)

        return unsignedTx
    }

    /** Fetch the latest blockhash from the Solana RPC. */
    private suspend fun fetchLatestBlockhash(): ByteArray {
        return withContext(Dispatchers.IO) {
            val rpcUrl = BuildConfig.SOLANA_RPC_URL
            val url = URL(rpcUrl)
            val connection = url.openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                connection.doOutput = true

                val body =
                    """{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"finalized"}]}"""
                connection.outputStream.use { os ->
                    OutputStreamWriter(os, Charsets.UTF_8).use { it.write(body) }
                }

                val response = connection.inputStream.bufferedReader(Charsets.UTF_8).readText()
                val json = Json { ignoreUnknownKeys = true }
                val root = json.parseToJsonElement(response).jsonObject
                val blockhashStr = root["result"]!!
                    .jsonObject["value"]!!
                    .jsonObject["blockhash"]!!
                    .jsonPrimitive.content
                Base58.decode(blockhashStr)
            } finally {
                connection.disconnect()
            }
        }
    }

    /** Solana compact-u16 encoding for small values. */
    private fun encodeCompactU16(value: Int): ByteArray {
        if (value < 0x80) return byteArrayOf(value.toByte())
        if (value < 0x4000) return byteArrayOf(
            ((value and 0x7f) or 0x80).toByte(),
            ((value shr 7) and 0x7f).toByte(),
        )
        return byteArrayOf(
            ((value and 0x7f) or 0x80).toByte(),
            (((value shr 7) and 0x7f) or 0x80).toByte(),
            ((value shr 14) and 0x03).toByte(),
        )
    }

    companion object {
        private const val MAX_TRANSACT_ATTEMPTS = 2
        private const val RETRY_DELAY_MS = 1000L

        /** Memo Program v1 — no account requirements in instruction data. */
        private val MEMO_PROGRAM_V1_ID =
            Base58.decode("Memo1UhkJBfCVP4kyu4UhFNhVv7Y9JkXm5J1RW7Z9DX")
    }
}
