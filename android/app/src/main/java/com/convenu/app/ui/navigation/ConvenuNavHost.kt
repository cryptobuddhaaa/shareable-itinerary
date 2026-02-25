package com.convenu.app.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.convenu.app.ui.screens.contacts.ContactsScreen
import com.convenu.app.ui.screens.dashboard.DashboardScreen
import com.convenu.app.ui.screens.handshake.HandshakeDetailScreen
import com.convenu.app.ui.screens.handshake.HandshakeListScreen
import com.convenu.app.ui.screens.itinerary.ItineraryDetailScreen
import com.convenu.app.ui.screens.itinerary.ItineraryListScreen
import com.convenu.app.ui.screens.login.LoginScreen
import com.convenu.app.ui.screens.wallet.WalletScreen

@Composable
fun ConvenuNavHost() {
    val viewModel: NavHostViewModel = hiltViewModel()
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val token by viewModel.tokenManager.tokenFlow.collectAsState(initial = null)

    val startDestination = if (token.isNullOrBlank()) Routes.LOGIN else Routes.DASHBOARD

    val showBottomBar = currentRoute in listOf(
        Routes.DASHBOARD,
        Routes.CONTACTS,
        Routes.HANDSHAKES,
        Routes.WALLET,
        Routes.ITINERARIES,
    )

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            if (showBottomBar) {
                BottomNavBar(
                    currentRoute = currentRoute,
                    onNavigate = { route ->
                        navController.navigate(route) {
                            popUpTo(Routes.DASHBOARD) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                )
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(Routes.LOGIN) {
                LoginScreen(
                    onLoginSuccess = {
                        navController.navigate(Routes.DASHBOARD) {
                            popUpTo(Routes.LOGIN) { inclusive = true }
                        }
                    },
                )
            }

            composable(Routes.DASHBOARD) {
                DashboardScreen(
                    onNavigateToHandshakes = {
                        navController.navigate(Routes.HANDSHAKES)
                    },
                    onNavigateToWallet = {
                        navController.navigate(Routes.WALLET)
                    },
                    onLogout = {
                        navController.navigate(Routes.LOGIN) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                )
            }

            composable(Routes.CONTACTS) {
                ContactsScreen()
            }

            composable(Routes.HANDSHAKES) {
                HandshakeListScreen(
                    onHandshakeClick = { handshakeId ->
                        navController.navigate(Routes.handshakeDetail(handshakeId))
                    },
                )
            }

            composable(
                route = Routes.HANDSHAKE_DETAIL,
                arguments = listOf(navArgument("handshakeId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val handshakeId = backStackEntry.arguments?.getString("handshakeId") ?: return@composable
                HandshakeDetailScreen(
                    handshakeId = handshakeId,
                    onBack = { navController.popBackStack() },
                )
            }

            composable(Routes.WALLET) {
                WalletScreen()
            }

            composable(Routes.ITINERARIES) {
                ItineraryListScreen(
                    onItineraryClick = { itineraryId ->
                        navController.navigate(Routes.itineraryDetail(itineraryId))
                    },
                )
            }

            composable(
                route = Routes.ITINERARY_DETAIL,
                arguments = listOf(navArgument("itineraryId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val itineraryId = backStackEntry.arguments?.getString("itineraryId") ?: return@composable
                ItineraryDetailScreen(
                    onBack = { navController.popBackStack() },
                )
            }
        }
    }
}
