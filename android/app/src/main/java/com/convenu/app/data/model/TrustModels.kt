package com.convenu.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Response from POST /api/trust/compute — matches the JSON returned by the endpoint.
 */
@Serializable
data class TrustComputeResponse(
    @SerialName("trustScore") val trustScore: Int = 0,
    @SerialName("scoreHandshakes") val scoreHandshakes: Int = 0,
    @SerialName("scoreWallet") val scoreWallet: Int = 0,
    @SerialName("scoreSocials") val scoreSocials: Int = 0,
    @SerialName("scoreEvents") val scoreEvents: Int = 0,
    @SerialName("scoreCommunity") val scoreCommunity: Int = 0,
    @SerialName("totalHandshakes") val totalHandshakes: Int = 0,
    @SerialName("walletConnected") val walletConnected: Boolean = false,
)
