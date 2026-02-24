package com.convenu.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PointEntry(
    val id: String,
    val points: Int,
    val reason: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("handshake_id") val handshakeId: String? = null,
)

/**
 * Full trust_scores row from Supabase — matches the current DB schema.
 */
@Serializable
data class TrustScoreFull(
    @SerialName("user_id") val userId: String,
    @SerialName("trust_score") val trustScore: Int = 0,
    @SerialName("trust_level") val trustLevel: Int = 1,
    @SerialName("score_handshakes") val scoreHandshakes: Int = 0,
    @SerialName("score_wallet") val scoreWallet: Int = 0,
    @SerialName("score_socials") val scoreSocials: Int = 0,
    @SerialName("score_events") val scoreEvents: Int = 0,
    @SerialName("score_community") val scoreCommunity: Int = 0,
    @SerialName("telegram_premium") val telegramPremium: Boolean = false,
    @SerialName("has_username") val hasUsername: Boolean = false,
    @SerialName("telegram_account_age_days") val telegramAccountAgeDays: Int? = null,
    @SerialName("wallet_connected") val walletConnected: Boolean = false,
    @SerialName("wallet_age_days") val walletAgeDays: Int? = null,
    @SerialName("wallet_tx_count") val walletTxCount: Int? = null,
    @SerialName("wallet_has_tokens") val walletHasTokens: Boolean = false,
    @SerialName("x_verified") val xVerified: Boolean = false,
    @SerialName("x_premium") val xPremium: Boolean = false,
    @SerialName("total_handshakes") val totalHandshakes: Int = 0,
    @SerialName("updated_at") val updatedAt: String? = null,
)
