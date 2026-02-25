package com.convenu.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TelegramAuthRequest(
    @SerialName("initData") val initData: String,
)

@Serializable
data class TelegramAuthResponse(
    @SerialName("token_hash") val tokenHash: String,
    @SerialName("user_id") val userId: String,
    @SerialName("telegram_user") val telegramUser: TelegramUser,
)

@Serializable
data class TelegramUser(
    val id: Long,
    @SerialName("first_name") val firstName: String,
    @SerialName("last_name") val lastName: String? = null,
    val username: String? = null,
)

@Serializable
data class WalletLoginRequest(
    @SerialName("wallet_address") val walletAddress: String,
    val signature: String,
    val message: String,
)

@Serializable
data class SupabaseTokenExchangeRequest(
    @SerialName("token_hash") val tokenHash: String,
    val type: String = "magiclink",
)

@Serializable
data class SupabaseTokenExchangeResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String = "bearer",
    @SerialName("expires_in") val expiresIn: Long = 3600,
    @SerialName("refresh_token") val refreshToken: String? = null,
    val user: SupabaseUser? = null,
)

@Serializable
data class SupabaseUser(
    val id: String,
    val email: String? = null,
)

// --- Google Auth (direct Supabase ID token grant) ---

@Serializable
data class GoogleIdTokenRequest(
    val provider: String = "google",
    @SerialName("id_token") val idToken: String,
)

// --- Wallet Auth (server-side signature verification) ---

@Serializable
data class WalletAuthRequest(
    @SerialName("wallet_address") val walletAddress: String,
    val signature: String,
    val message: String,
    @SerialName("tx_message") val txMessage: String? = null,
)

@Serializable
data class WalletAuthResponse(
    @SerialName("token_hash") val tokenHash: String,
    @SerialName("user_id") val userId: String,
    @SerialName("new_account") val newAccount: Boolean = false,
)
