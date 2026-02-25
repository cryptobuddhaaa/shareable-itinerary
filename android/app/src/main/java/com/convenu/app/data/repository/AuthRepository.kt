package com.convenu.app.data.repository

import com.convenu.app.BuildConfig
import com.convenu.app.data.api.ConvenuApi
import com.convenu.app.data.model.ErrorResponse
import com.convenu.app.data.model.GoogleIdTokenRequest
import com.convenu.app.data.model.SupabaseTokenExchangeRequest
import com.convenu.app.data.model.SupabaseTokenExchangeResponse
import com.convenu.app.data.model.TelegramAuthRequest
import com.convenu.app.data.model.TelegramAuthResponse
import com.convenu.app.data.model.WalletAuthRequest
import com.convenu.app.data.model.WalletAuthResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: ConvenuApi,
    private val tokenManager: TokenManager,
    private val json: Json,
    private val okHttpClient: OkHttpClient,
) {
    suspend fun authTelegram(initData: String): Result<TelegramAuthResponse> {
        return try {
            val response = api.authTelegram(TelegramAuthRequest(initData))
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                val errorBody = response.errorBody()?.string()
                val errorMsg = errorBody?.let {
                    runCatching { json.decodeFromString<ErrorResponse>(it).error }.getOrNull()
                } ?: "Auth failed (${response.code()})"
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Timber.e(e, "authTelegram failed")
            Result.failure(e)
        }
    }

    suspend fun exchangeTokenHash(tokenHash: String): Result<String> {
        val supabaseUrl = BuildConfig.SUPABASE_URL
        val supabaseKey = BuildConfig.SUPABASE_ANON_KEY

        if (supabaseUrl.isBlank() || supabaseKey.isBlank()) {
            return Result.failure(Exception("Supabase configuration is missing"))
        }

        return try {
            withContext(Dispatchers.IO) {
                val requestBody = json.encodeToString(
                    SupabaseTokenExchangeRequest.serializer(),
                    SupabaseTokenExchangeRequest(tokenHash = tokenHash),
                )

                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/verify")
                    .post(requestBody.toRequestBody("application/json".toMediaType()))
                    .header("apikey", supabaseKey)
                    .header("Content-Type", "application/json")
                    .build()

                val response = okHttpClient.newCall(request).execute()
                val body = response.body?.string()

                if (response.isSuccessful && body != null) {
                    val tokenResponse = json.decodeFromString<SupabaseTokenExchangeResponse>(body)
                    tokenManager.saveSession(
                        jwt = tokenResponse.accessToken,
                        userId = tokenResponse.user?.id ?: "",
                        refreshToken = tokenResponse.refreshToken,
                    )
                    Result.success(tokenResponse.accessToken)
                } else {
                    Result.failure(Exception("Token exchange failed (${response.code})"))
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "exchangeTokenHash failed")
            Result.failure(e)
        }
    }

    /**
     * Google Sign-In: send ID token directly to Supabase's id_token grant.
     * No custom server endpoint needed — Supabase verifies with Google.
     */
    suspend fun authWithGoogle(idToken: String): Result<String> {
        val supabaseUrl = BuildConfig.SUPABASE_URL
        val supabaseKey = BuildConfig.SUPABASE_ANON_KEY

        if (supabaseUrl.isBlank() || supabaseKey.isBlank()) {
            return Result.failure(Exception("Supabase configuration is missing"))
        }

        return try {
            withContext(Dispatchers.IO) {
                val requestBody = json.encodeToString(
                    GoogleIdTokenRequest.serializer(),
                    GoogleIdTokenRequest(idToken = idToken),
                )

                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/token?grant_type=id_token")
                    .post(requestBody.toRequestBody("application/json".toMediaType()))
                    .header("apikey", supabaseKey)
                    .header("Content-Type", "application/json")
                    .build()

                val response = okHttpClient.newCall(request).execute()
                val body = response.body?.string()

                if (response.isSuccessful && body != null) {
                    val tokenResponse = json.decodeFromString<SupabaseTokenExchangeResponse>(body)
                    tokenManager.saveSession(
                        jwt = tokenResponse.accessToken,
                        userId = tokenResponse.user?.id ?: "",
                        refreshToken = tokenResponse.refreshToken,
                    )
                    Result.success(tokenResponse.accessToken)
                } else {
                    val errorMsg = body?.let {
                        runCatching { json.decodeFromString<ErrorResponse>(it).error }.getOrNull()
                    } ?: "Google sign-in failed (${response.code})"
                    Result.failure(Exception(errorMsg))
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "authWithGoogle failed")
            Result.failure(e)
        }
    }

    /**
     * Wallet auth: send signed message to server, get token_hash, exchange for JWT.
     */
    suspend fun authWithWallet(
        walletAddress: String,
        signature: String,
        message: String,
        txMessage: String? = null,
    ): Result<String> {
        return try {
            val response = api.authWallet(
                request = WalletAuthRequest(
                    walletAddress = walletAddress,
                    signature = signature,
                    message = message,
                    txMessage = txMessage,
                ),
            )

            if (response.isSuccessful && response.body() != null) {
                val authResponse = response.body()!!
                // Exchange the token_hash for a Supabase JWT
                exchangeTokenHash(authResponse.tokenHash)
            } else {
                val errorBody = response.errorBody()?.string()
                val errorMsg = errorBody?.let {
                    runCatching { json.decodeFromString<ErrorResponse>(it).error }.getOrNull()
                } ?: "Wallet auth failed (${response.code()})"
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Timber.e(e, "authWithWallet failed")
            Result.failure(e)
        }
    }

    suspend fun logout() {
        tokenManager.clearSession()
    }
}
