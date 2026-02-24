package com.convenu.app.ui.screens.itinerary

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.convenu.app.data.model.ItineraryDay
import com.convenu.app.data.model.ItineraryDto
import com.convenu.app.data.model.ItineraryEvent
import com.convenu.app.ui.theme.*
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItineraryDetailScreen(
    onBack: () -> Unit,
    viewModel: ItineraryDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var showDeleteConfirm by remember { mutableStateOf<String?>(null) }
    var showEditItinerary by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize()) {
        // Top bar
        TopAppBar(
            title = { Text(uiState.itinerary?.title ?: "Itinerary") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.Filled.ArrowBack, "Back")
                }
            },
            actions = {
                IconButton(onClick = { showEditItinerary = true }) {
                    Icon(Icons.Filled.Edit, "Edit Itinerary")
                }
                IconButton(onClick = { viewModel.loadItinerary() }) {
                    Icon(Icons.Filled.Refresh, "Refresh")
                }
            },
        )

        when {
            uiState.isLoading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            uiState.error != null -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(uiState.error!!, color = MaterialTheme.colorScheme.error)
                }
            }
            uiState.itinerary != null -> {
                val itinerary = uiState.itinerary!!

                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(vertical = 16.dp),
                ) {
                    // Header card
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(itinerary.title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                                Spacer(Modifier.height(4.dp))
                                Text(itinerary.location, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(
                                    "${formatDateLong(itinerary.startDate)} - ${formatDateLong(itinerary.endDate)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    // Search bar
                    if (itinerary.data.days.any { it.events.isNotEmpty() }) {
                        item {
                            OutlinedTextField(
                                value = uiState.eventSearch,
                                onValueChange = { viewModel.setEventSearch(it) },
                                placeholder = { Text("Search events...") },
                                leadingIcon = { Icon(Icons.Filled.Search, null) },
                                trailingIcon = {
                                    if (uiState.eventSearch.isNotEmpty()) {
                                        IconButton(onClick = { viewModel.setEventSearch("") }) {
                                            Icon(Icons.Filled.Clear, "Clear")
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                            )
                        }
                    }

                    // Day cards
                    val searchQuery = uiState.eventSearch.lowercase().trim()
                    items(itinerary.data.days) { day ->
                        val filteredEvents = if (searchQuery.isNotEmpty()) {
                            day.events.filter { event ->
                                event.title.lowercase().contains(searchQuery) ||
                                event.location.name.lowercase().contains(searchQuery) ||
                                event.eventType.lowercase().contains(searchQuery)
                            }
                        } else day.events

                        if (searchQuery.isEmpty() || filteredEvents.isNotEmpty()) {
                            DayCard(
                                day = day,
                                filteredEvents = filteredEvents,
                                isExpanded = uiState.expandedDays.contains(day.date) || searchQuery.isNotEmpty(),
                                isToday = day.date == LocalDate.now().toString(),
                                onToggleExpansion = { viewModel.toggleDayExpansion(day.date) },
                                onAddEvent = { viewModel.showAddEventForm(day.date) },
                                onEditEvent = { event -> viewModel.showEditEventForm(event, day.date) },
                                onDeleteEvent = { eventId -> showDeleteConfirm = eventId },
                                onOpenMaps = { url ->
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    // Event form dialog
    if (uiState.showEventForm) {
        EventFormDialog(
            editingEvent = uiState.editingEvent,
            onDismiss = { viewModel.hideEventForm() },
            onSave = { title, startTime, endTime, locationName, locationAddress, eventType, description ->
                val dayDate = uiState.selectedDayDate ?: return@EventFormDialog
                if (uiState.editingEvent != null) {
                    viewModel.updateEvent(uiState.editingEvent!!.id, title, startTime, endTime, locationName, locationAddress, eventType, description)
                } else {
                    viewModel.addEvent(dayDate, title, startTime, endTime, locationName, locationAddress, eventType, description)
                }
            },
        )
    }

    // Edit itinerary dialog
    if (showEditItinerary && uiState.itinerary != null) {
        EditItineraryDialog(
            itinerary = uiState.itinerary!!,
            onDismiss = { showEditItinerary = false },
            onSave = { title, location, startDate, endDate ->
                viewModel.updateItinerary(title, location, startDate, endDate)
                showEditItinerary = false
            },
        )
    }

    // Delete event confirmation
    showDeleteConfirm?.let { eventId ->
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = null },
            title = { Text("Delete Event?") },
            text = { Text("This event will be permanently deleted.") },
            confirmButton = {
                TextButton(onClick = { viewModel.deleteEvent(eventId); showDeleteConfirm = null }, colors = ButtonDefaults.textButtonColors(contentColor = ConvenuRed)) {
                    Text("Delete")
                }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = null }) { Text("Cancel") } },
        )
    }

    // Snackbar for action messages
    uiState.actionMessage?.let { message ->
        LaunchedEffect(message) {
            kotlinx.coroutines.delay(2000)
            viewModel.clearMessage()
        }
        Snackbar(modifier = Modifier.padding(16.dp)) { Text(message) }
    }
}

@Composable
private fun DayCard(
    day: ItineraryDay,
    filteredEvents: List<ItineraryEvent>,
    isExpanded: Boolean,
    isToday: Boolean,
    onToggleExpansion: () -> Unit,
    onAddEvent: () -> Unit,
    onEditEvent: (ItineraryEvent) -> Unit,
    onDeleteEvent: (String) -> Unit,
    onOpenMaps: (String) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        border = if (isToday) CardDefaults.outlinedCardBorder().copy(brush = androidx.compose.ui.graphics.SolidColor(ConvenuBlue)) else null,
    ) {
        Column {
            // Day header
            Row(
                modifier = Modifier.fillMaxWidth().clickable { onToggleExpansion() }.padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Day ${day.dayNumber}: ${formatDateLong(day.date)}",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        if (isToday) {
                            Spacer(Modifier.width(8.dp))
                            Badge(containerColor = ConvenuBlue) { Text("Today", color = MaterialTheme.colorScheme.onPrimary) }
                        }
                    }
                    Text(
                        "${filteredEvents.size} event${if (filteredEvents.size != 1) "s" else ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row {
                    IconButton(onClick = onAddEvent) {
                        Icon(Icons.Filled.Add, "Add Event", tint = ConvenuBlue)
                    }
                    Icon(
                        imageVector = if (isExpanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                        contentDescription = "Toggle",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Events list (expanded)
            if (isExpanded) {
                if (filteredEvents.isEmpty()) {
                    Text(
                        "No events scheduled",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    val sorted = filteredEvents.sortedBy { it.startTime }
                    sorted.forEach { event ->
                        HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
                        EventRow(
                            event = event,
                            onEdit = { onEditEvent(event) },
                            onDelete = { onDeleteEvent(event.id) },
                            onOpenMaps = onOpenMaps,
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun EventRow(
    event: ItineraryEvent,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onOpenMaps: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        // Time + blue left border indicator
        Box(
            modifier = Modifier.width(4.dp).height(48.dp).padding(end = 0.dp),
        ) {
            Spacer(modifier = Modifier.fillMaxSize().then(
                Modifier.padding(0.dp)
            ))
        }

        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(event.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.width(8.dp))
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = MaterialTheme.shapes.extraSmall,
                ) {
                    Text(
                        event.eventType,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Text(
                "${formatTime(event.startTime)} - ${formatTime(event.endTime)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (event.location.name.isNotBlank()) {
                val mapsUrl = event.location.mapsUrl
                    ?: "https://www.google.com/maps/search/?api=1&query=${Uri.encode(event.location.name + " " + event.location.address)}"
                Row(
                    modifier = Modifier.clickable { onOpenMaps(mapsUrl) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.LocationOn, null, Modifier.size(14.dp), tint = ConvenuBlue)
                    Spacer(Modifier.width(4.dp))
                    Text(
                        buildString {
                            append(event.location.name)
                            if (event.location.address.isNotBlank()) append(" (${event.location.address})")
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = ConvenuBlue,
                    )
                }
            }

            event.description?.let { desc ->
                if (desc.isNotBlank()) {
                    Text(desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        Column {
            IconButton(onClick = onEdit, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Edit, "Edit", Modifier.size(18.dp), tint = ConvenuBlue)
            }
            IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Delete, "Delete", Modifier.size(18.dp), tint = ConvenuRed)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventFormDialog(
    editingEvent: ItineraryEvent?,
    onDismiss: () -> Unit,
    onSave: (title: String, startTime: String, endTime: String, locationName: String, locationAddress: String, eventType: String, description: String?) -> Unit,
) {
    var title by remember { mutableStateOf(editingEvent?.title ?: "") }
    var startTime by remember { mutableStateOf(editingEvent?.startTime ?: "") }
    var endTime by remember { mutableStateOf(editingEvent?.endTime ?: "") }
    var locationName by remember { mutableStateOf(editingEvent?.location?.name ?: "") }
    var locationAddress by remember { mutableStateOf(editingEvent?.location?.address ?: "") }
    var eventType by remember { mutableStateOf(editingEvent?.eventType ?: "meeting") }
    var description by remember { mutableStateOf(editingEvent?.description ?: "") }

    val eventTypes = listOf("meeting", "travel", "meal", "buffer", "accommodation", "activity", "side-event", "main-conference")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (editingEvent != null) "Edit Event" else "Add Event") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = startTime, onValueChange = { startTime = it }, label = { Text("Start Time (ISO8601)") }, placeholder = { Text("2025-03-01T09:00:00") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = endTime, onValueChange = { endTime = it }, label = { Text("End Time (ISO8601)") }, placeholder = { Text("2025-03-01T10:00:00") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = locationName, onValueChange = { locationName = it }, label = { Text("Location Name") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = locationAddress, onValueChange = { locationAddress = it }, label = { Text("Location Address") }, modifier = Modifier.fillMaxWidth(), singleLine = true)

                // Event type dropdown
                var expanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                    OutlinedTextField(
                        value = eventType,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Event Type") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(),
                    )
                    ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        eventTypes.forEach { type ->
                            DropdownMenuItem(
                                text = { Text(type) },
                                onClick = { eventType = type; expanded = false },
                            )
                        }
                    }
                }

                OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("Description (optional)") }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(title, startTime, endTime, locationName, locationAddress, eventType, description.ifBlank { null }) },
                enabled = title.isNotBlank() && startTime.isNotBlank() && endTime.isNotBlank(),
            ) {
                Text(if (editingEvent != null) "Update" else "Add")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun EditItineraryDialog(
    itinerary: ItineraryDto,
    onDismiss: () -> Unit,
    onSave: (title: String, location: String, startDate: String, endDate: String) -> Unit,
) {
    var title by remember { mutableStateOf(itinerary.title) }
    var location by remember { mutableStateOf(itinerary.location) }
    var startDate by remember { mutableStateOf(itinerary.startDate) }
    var endDate by remember { mutableStateOf(itinerary.endDate) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit Itinerary") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = location, onValueChange = { location = it }, label = { Text("Location") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = startDate, onValueChange = { startDate = it }, label = { Text("Start Date (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = endDate, onValueChange = { endDate = it }, label = { Text("End Date (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            }
        },
        confirmButton = {
            Button(onClick = { onSave(title, location, startDate, endDate) }, enabled = title.isNotBlank()) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun formatDateLong(dateStr: String): String {
    return try {
        val date = LocalDate.parse(dateStr)
        date.format(DateTimeFormatter.ofPattern("EEE, MMM d, yyyy"))
    } catch (e: Exception) { dateStr }
}

private fun formatTime(timeStr: String): String {
    return try {
        val dt = LocalDateTime.parse(timeStr)
        dt.format(DateTimeFormatter.ofPattern("h:mm a"))
    } catch (e: Exception) {
        try {
            val dt = LocalDateTime.parse(timeStr, DateTimeFormatter.ISO_DATE_TIME)
            dt.format(DateTimeFormatter.ofPattern("h:mm a"))
        } catch (e2: Exception) { timeStr }
    }
}
