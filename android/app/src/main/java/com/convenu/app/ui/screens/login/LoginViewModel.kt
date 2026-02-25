package com.convenu.app.ui.screens.login

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.convenu.app.BuildConfig
import com.convenu.app.data.repository.AuthRepository
import com.convenu.app.util.MwaWalletManager
import com.convenu.app.util.WalletOption
import com.convenu.app.util.WalletResult
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

data class LoginUiState(
    val isLoading: Boolean = false,
    val isLoggedIn: Boolean = false,
    val error: String? = null,
    val loadingMethod: LoginMethod? = null,
    val showWalletPicker: Boolean = false,
)

enum class LoginMethod { WALLET, GOOGLE, TELEGRAM }

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val walletManager: MwaWalletManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun showWalletPicker() {
        if (_uiState.value.isLoading) return
        _uiState.value = _uiState.value.copy(showWalletPicker = true, error = null)
    }

    fun dismissWalletPicker() {
        _uiState.value = _uiState.value.copy(showWalletPicker = false)
    }

    /**
     * Wallet login: authorize + sign message in single MWA interaction,
     * then exchange signed message with server for a session.
     */
    fun loginWithWallet(sender: ActivityResultSender, wallet: WalletOption) {
        if (_uiState.value.isLoading) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true, error = null, loadingMethod = LoginMethod.WALLET,
                showWalletPicker = false,
            )

            when (val walletResult = walletManager.authorizeAndSign(sender, wallet)) {
                is WalletResult.Success -> {
                    val authData = walletResult.data
                    val result = authRepository.authWithWallet(
                        walletAddress = authData.walletAddress,
                        signature = authData.signatureBase58,
                        message = authData.message,
                        txMessage = authData.txMessage,
                    )
                    result.onSuccess {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false, isLoggedIn = true, loadingMethod = null,
                        )
                    }.onFailure {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = it.message ?: "Wallet authentication failed",
                            loadingMethod = null,
                        )
                    }
                }

                is WalletResult.NoWallet -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = "No Solana wallet found. Install Phantom, Solflare, or use Seeker wallet.",
                        loadingMethod = null,
                    )
                }

                is WalletResult.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = walletResult.message,
                        loadingMethod = null,
                    )
                }

                is WalletResult.Cancelled -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false, loadingMethod = null,
                    )
                }
            }
        }
    }

    /**
     * Google Sign-In via Credential Manager, then Supabase ID token grant.
     */
    fun loginWithGoogle(context: Context) {
        if (_uiState.value.isLoading) return

        val googleClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
        if (googleClientId.isBlank()) {
            _uiState.value = _uiState.value.copy(
                error = "Google Sign-In is not configured",
            )
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true, error = null, loadingMethod = LoginMethod.GOOGLE,
            )

            try {
                val googleIdOption = GetGoogleIdOption.Builder()
                    .setServerClientId(googleClientId)
                    .setFilterByAuthorizedAccounts(false)
                    .build()

                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(googleIdOption)
                    .build()

                val credentialManager = CredentialManager.create(context)
                val credentialResult = credentialManager.getCredential(context, request)

                val credential = credentialResult.credential
                if (credential is CustomCredential &&
                    credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                ) {
                    val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
                    val result = authRepository.authWithGoogle(idToken)
                    result.onSuccess {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false, isLoggedIn = true, loadingMethod = null,
                        )
                    }.onFailure {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = it.message ?: "Google sign-in failed",
                            loadingMethod = null,
                        )
                    }
                } else {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = "Unexpected credential type",
                        loadingMethod = null,
                    )
                }
            } catch (e: GetCredentialCancellationException) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false, loadingMethod = null,
                )
            } catch (e: NoCredentialException) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = "No Google account found on this device",
                    loadingMethod = null,
                )
            } catch (e: Exception) {
                Timber.e(e, "Google sign-in exception")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Google sign-in failed",
                    loadingMethod = null,
                )
            }
        }
    }

    fun loginWithTelegram(initData: String) {
        if (_uiState.value.isLoading) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true, error = null, loadingMethod = LoginMethod.TELEGRAM,
            )

            val authResult = authRepository.authTelegram(initData)
            val authResponse = authResult.getOrElse {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = it.message ?: "Telegram auth failed",
                    loadingMethod = null,
                )
                return@launch
            }

            val tokenResult = authRepository.exchangeTokenHash(authResponse.tokenHash)
            tokenResult.onSuccess {
                _uiState.value = _uiState.value.copy(
                    isLoading = false, isLoggedIn = true, loadingMethod = null,
                )
            }.onFailure {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = it.message ?: "Token exchange failed",
                    loadingMethod = null,
                )
            }
        }
    }

    fun loginWithTokenHash(tokenHash: String) {
        if (_uiState.value.isLoading) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true, error = null, loadingMethod = LoginMethod.TELEGRAM,
            )

            val result = authRepository.exchangeTokenHash(tokenHash)
            result.onSuccess {
                _uiState.value = _uiState.value.copy(
                    isLoading = false, isLoggedIn = true, loadingMethod = null,
                )
            }.onFailure {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = it.message ?: "Login failed",
                    loadingMethod = null,
                )
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
