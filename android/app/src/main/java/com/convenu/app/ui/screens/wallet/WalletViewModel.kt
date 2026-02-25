package com.convenu.app.ui.screens.wallet

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.convenu.app.data.repository.WalletRepository
import com.convenu.app.util.Base58
import com.convenu.app.util.MwaWalletManager
import com.convenu.app.util.WalletOption
import com.convenu.app.util.WalletResult
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

data class WalletUiState(
    val walletAddress: String? = null,
    val isConnecting: Boolean = false,
    val isVerifying: Boolean = false,
    val isVerified: Boolean = false,
    val error: String? = null,
    val showWalletPicker: Boolean = false,
)

@HiltViewModel
class WalletViewModel @Inject constructor(
    private val walletManager: MwaWalletManager,
    private val walletRepository: WalletRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(WalletUiState())
    val uiState: StateFlow<WalletUiState> = _uiState.asStateFlow()

    fun showWalletPicker() {
        if (_uiState.value.isConnecting) return
        _uiState.value = _uiState.value.copy(showWalletPicker = true, error = null)
    }

    fun dismissWalletPicker() {
        _uiState.value = _uiState.value.copy(showWalletPicker = false)
    }

    fun connectWallet(sender: ActivityResultSender, wallet: WalletOption) {
        if (_uiState.value.isConnecting) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isConnecting = true, error = null, showWalletPicker = false,
            )

            when (val result = walletManager.authorize(sender, wallet)) {
                is WalletResult.Success -> {
                    _uiState.value = _uiState.value.copy(
                        walletAddress = result.data.publicKeyBase58,
                        isConnecting = false,
                    )
                }

                is WalletResult.NoWallet -> {
                    _uiState.value = _uiState.value.copy(
                        isConnecting = false,
                        error = "No Solana wallet found. Please install Phantom.",
                    )
                }

                is WalletResult.Cancelled -> {
                    _uiState.value = _uiState.value.copy(isConnecting = false)
                }

                is WalletResult.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isConnecting = false,
                        error = result.message,
                    )
                }
            }
        }
    }

    fun verifyWallet(sender: ActivityResultSender) {
        val address = _uiState.value.walletAddress ?: return
        if (_uiState.value.isVerifying) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isVerifying = true, error = null)

            // Step 1: Create wallet row in Supabase
            val walletIdResult = walletRepository.createWalletRow(address)
            val walletId = walletIdResult.getOrElse {
                _uiState.value = _uiState.value.copy(
                    isVerifying = false,
                    error = "Failed to register wallet: ${it.message}",
                )
                return@launch
            }

            // Step 2: Sign verification message
            val timestamp = System.currentTimeMillis()
            val message = "Please sign this message to verify wallet ownership. Timestamp: $timestamp"
            val messageBytes = message.toByteArray(Charsets.UTF_8)

            when (val signResult = walletManager.signMessage(sender, messageBytes)) {
                is WalletResult.Success -> {
                    val signatureBase58 = Base58.encode(signResult.data)

                    // Step 3: POST /wallet/verify
                    val verifyResult = walletRepository.verifyWallet(
                        walletId = walletId,
                        signature = signatureBase58,
                        message = message,
                        walletAddress = address,
                    )

                    verifyResult.onSuccess {
                        _uiState.value = _uiState.value.copy(
                            isVerifying = false,
                            isVerified = it.verified,
                        )
                    }.onFailure {
                        _uiState.value = _uiState.value.copy(
                            isVerifying = false,
                            error = it.message ?: "Verification failed",
                        )
                    }
                }

                is WalletResult.NoWallet -> {
                    _uiState.value = _uiState.value.copy(
                        isVerifying = false,
                        error = "No wallet found",
                    )
                }

                is WalletResult.Cancelled -> {
                    _uiState.value = _uiState.value.copy(isVerifying = false)
                }

                is WalletResult.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isVerifying = false,
                        error = signResult.message,
                    )
                }
            }
        }
    }

    fun disconnectWallet() {
        walletManager.disconnect()
        _uiState.value = WalletUiState()
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
