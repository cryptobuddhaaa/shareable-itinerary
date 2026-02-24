package com.convenu.app.ui.screens.contacts

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.convenu.app.data.model.ContactModel
import com.convenu.app.data.model.UserTag
import com.convenu.app.ui.theme.*

@Composable
fun ContactsScreen(
    viewModel: ContactsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val filteredContacts = remember(uiState) { viewModel.filteredAndSortedContacts() }
    val context = LocalContext.current
    var showDeleteConfirm by remember { mutableStateOf<String?>(null) }
    var showSortMenu by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        // Header
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("My Contacts", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onBackground)
                Text("People you've connected with", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row {
                IconButton(onClick = { viewModel.refresh() }) {
                    Icon(Icons.Filled.Refresh, "Refresh", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        // Action buttons
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.showAddForm() }, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.Add, null, Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Add Contact")
            }
            if (uiState.contacts.isNotEmpty()) {
                OutlinedButton(onClick = {
                    val csv = viewModel.exportCsv()
                    val sendIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "text/csv"
                        putExtra(Intent.EXTRA_TEXT, csv)
                        putExtra(Intent.EXTRA_SUBJECT, "Contacts Export")
                    }
                    context.startActivity(Intent.createChooser(sendIntent, "Export Contacts"))
                }) {
                    Icon(Icons.Filled.FileDownload, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("CSV")
                }
            }
        }

        Spacer(Modifier.height(12.dp))

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
            else -> {
                if (uiState.contacts.isNotEmpty()) {
                    // Search + Sort
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = uiState.searchQuery,
                            onValueChange = { viewModel.setSearchQuery(it) },
                            placeholder = { Text("Search contacts...") },
                            leadingIcon = { Icon(Icons.Filled.Search, null) },
                            trailingIcon = {
                                if (uiState.searchQuery.isNotEmpty()) {
                                    IconButton(onClick = { viewModel.setSearchQuery("") }) { Icon(Icons.Filled.Clear, "Clear") }
                                }
                            },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                        )
                        Box {
                            IconButton(onClick = { showSortMenu = true }) {
                                Icon(Icons.AutoMirrored.Filled.Sort, "Sort")
                            }
                            DropdownMenu(expanded = showSortMenu, onDismissRequest = { showSortMenu = false }) {
                                ContactSortOption.entries.forEach { option ->
                                    DropdownMenuItem(
                                        text = { Text(option.label) },
                                        onClick = { viewModel.setSortBy(option); showSortMenu = false },
                                        leadingIcon = {
                                            if (uiState.sortBy == option) Icon(Icons.Filled.Check, null, tint = MaterialTheme.colorScheme.primary)
                                        },
                                    )
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(8.dp))

                    // Tag filter chips
                    if (uiState.tags.isNotEmpty()) {
                        Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FilterChip(
                                selected = uiState.filterTag == null,
                                onClick = { viewModel.setFilterTag(null) },
                                label = { Text("All") },
                            )
                            uiState.tags.forEach { tag ->
                                FilterChip(
                                    selected = uiState.filterTag == tag.name,
                                    onClick = { viewModel.setFilterTag(tag.name) },
                                    label = { Text(tag.name) },
                                )
                            }
                        }
                        Spacer(Modifier.height(4.dp))
                    }

                    // Tag manager toggle
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { viewModel.toggleTagManager() }) {
                            Text(if (uiState.showTagManager) "Done" else "Manage Labels", style = MaterialTheme.typography.labelMedium)
                        }
                    }

                    // Tag manager
                    if (uiState.showTagManager || uiState.tags.isEmpty()) {
                        TagManager(
                            tags = uiState.tags,
                            onAddTag = { viewModel.addTag(it) },
                            onDeleteTag = { viewModel.deleteTag(it) },
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                }

                // Contact list
                if (uiState.contacts.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Filled.People, null, Modifier.size(64.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(16.dp))
                            Text("No contacts yet", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Add contacts from events or the Telegram bot", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(16.dp))
                            Button(onClick = { viewModel.showAddForm() }) {
                                Icon(Icons.Filled.Add, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Add Your First Contact")
                            }
                        }
                    }
                } else if (filteredContacts.isEmpty()) {
                    Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Filled.SearchOff, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(8.dp))
                            Text("No contacts found", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Try adjusting your search", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(filteredContacts, key = { it.id }) { contact ->
                            ContactCard(
                                contact = contact,
                                onEdit = { viewModel.showEditForm(contact) },
                                onDelete = { showDeleteConfirm = contact.id },
                            )
                        }
                    }
                }
            }
        }
    }

    // Add contact dialog
    if (uiState.showAddForm) {
        ContactFormDialog(
            title = "Add Contact",
            tags = uiState.tags,
            isSubmitting = uiState.isSubmitting,
            error = uiState.submitError,
            onDismiss = { viewModel.hideAddForm() },
            onSave = { fn, ln, pc, pos, tg, em, li, notes, tags ->
                viewModel.addContact(fn, ln, pc, pos, tg, em, li, notes, tags)
            },
        )
    }

    // Edit contact dialog
    uiState.editingContact?.let { contact ->
        ContactFormDialog(
            title = "Edit Contact",
            tags = uiState.tags,
            initial = contact,
            isSubmitting = uiState.isSubmitting,
            error = uiState.submitError,
            onDismiss = { viewModel.hideEditForm() },
            onSave = { fn, ln, pc, pos, tg, em, li, notes, tags ->
                viewModel.updateContact(contact.id, fn, ln, pc, pos, tg, em, li, notes, tags)
            },
        )
    }

    // Delete confirmation
    showDeleteConfirm?.let { id ->
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = null },
            title = { Text("Delete Contact?") },
            text = { Text("This contact will be permanently deleted.") },
            confirmButton = {
                TextButton(onClick = { viewModel.deleteContact(id); showDeleteConfirm = null }, colors = ButtonDefaults.textButtonColors(contentColor = ConvenuRed)) {
                    Text("Delete")
                }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = null }) { Text("Cancel") } },
        )
    }

    // Snackbar message
    uiState.actionMessage?.let { message ->
        LaunchedEffect(message) {
            kotlinx.coroutines.delay(2000)
            viewModel.clearMessage()
        }
    }
}

@Composable
private fun ContactCard(
    contact: ContactModel,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Person, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(contact.fullName, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                    contact.projectCompany?.let { company ->
                        Text(
                            buildString {
                                append(company)
                                contact.position?.let { append(" · $it") }
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                IconButton(onClick = onEdit, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.Edit, "Edit", Modifier.size(18.dp), tint = ConvenuBlue)
                }
                IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.Delete, "Delete", Modifier.size(18.dp), tint = ConvenuRed)
                }
            }

            // Contact info row
            Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                contact.telegramHandle?.let {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.AlternateEmail, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(2.dp))
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                contact.email?.let {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Email, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(2.dp))
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                }
            }

            // Tags
            contact.tags?.let { tags ->
                if (tags.isNotEmpty()) {
                    Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        tags.forEach { tag ->
                            Surface(color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.small) {
                                Text(tag, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }

            // Event info
            contact.eventTitle?.let {
                Text("Event: $it", modifier = Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun TagManager(
    tags: List<UserTag>,
    onAddTag: (String) -> Unit,
    onDeleteTag: (String) -> Unit,
) {
    var newTagName by remember { mutableStateOf("") }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text("Labels", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (tags.isEmpty()) {
                Text("Create labels to categorize contacts (e.g. investor, developer). Up to 10 labels.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = newTagName,
                    onValueChange = { newTagName = it },
                    placeholder = { Text("New label...") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                Button(
                    onClick = { onAddTag(newTagName.trim()); newTagName = "" },
                    enabled = newTagName.isNotBlank() && tags.size < 10,
                ) { Text("Add") }
                Text("${tags.size}/10", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (tags.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                    tags.forEach { tag ->
                        InputChip(
                            selected = false,
                            onClick = {},
                            label = { Text(tag.name) },
                            trailingIcon = {
                                IconButton(onClick = { onDeleteTag(tag.id) }, modifier = Modifier.size(18.dp)) {
                                    Icon(Icons.Filled.Close, "Delete ${tag.name}", Modifier.size(14.dp))
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ContactFormDialog(
    title: String,
    tags: List<UserTag>,
    initial: ContactModel? = null,
    isSubmitting: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSave: (firstName: String, lastName: String, projectCompany: String?, position: String?,
             telegramHandle: String?, email: String?, linkedin: String?, notes: String?, selectedTags: List<String>) -> Unit,
) {
    var firstName by remember { mutableStateOf(initial?.firstName ?: "") }
    var lastName by remember { mutableStateOf(initial?.lastName ?: "") }
    var projectCompany by remember { mutableStateOf(initial?.projectCompany ?: "") }
    var position by remember { mutableStateOf(initial?.position ?: "") }
    var telegramHandle by remember { mutableStateOf(initial?.telegramHandle ?: "") }
    var email by remember { mutableStateOf(initial?.email ?: "") }
    var linkedin by remember { mutableStateOf(initial?.linkedin ?: "") }
    var notes by remember { mutableStateOf(initial?.notes ?: "") }
    var selectedTags by remember { mutableStateOf(initial?.tags ?: emptyList()) }

    AlertDialog(
        onDismissRequest = { if (!isSubmitting) onDismiss() },
        title = { Text(title) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = firstName, onValueChange = { firstName = it }, label = { Text("First Name *") }, modifier = Modifier.weight(1f), singleLine = true, enabled = !isSubmitting)
                    OutlinedTextField(value = lastName, onValueChange = { lastName = it }, label = { Text("Last Name *") }, modifier = Modifier.weight(1f), singleLine = true, enabled = !isSubmitting)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = projectCompany, onValueChange = { projectCompany = it }, label = { Text("Project/Company") }, modifier = Modifier.weight(1f), singleLine = true, enabled = !isSubmitting)
                    OutlinedTextField(value = position, onValueChange = { position = it }, label = { Text("Position") }, modifier = Modifier.weight(1f), singleLine = true, enabled = !isSubmitting)
                }
                OutlinedTextField(value = telegramHandle, onValueChange = { telegramHandle = it }, label = { Text("Telegram Handle") }, placeholder = { Text("username") }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !isSubmitting, leadingIcon = { Text("@", color = MaterialTheme.colorScheme.onSurfaceVariant) })
                OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !isSubmitting)
                OutlinedTextField(value = linkedin, onValueChange = { linkedin = it }, label = { Text("LinkedIn") }, placeholder = { Text("username or URL") }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !isSubmitting)
                OutlinedTextField(value = notes, onValueChange = { if (it.length <= 100) notes = it }, label = { Text("Notes (${notes.length}/100)") }, modifier = Modifier.fillMaxWidth(), maxLines = 2, enabled = !isSubmitting)

                // Tag selection
                if (tags.isNotEmpty()) {
                    Text("Tags (${selectedTags.size}/3)", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                        tags.forEach { tag ->
                            val isSelected = selectedTags.contains(tag.name)
                            FilterChip(
                                selected = isSelected,
                                onClick = {
                                    selectedTags = if (isSelected) selectedTags - tag.name
                                    else if (selectedTags.size < 3) selectedTags + tag.name
                                    else selectedTags
                                },
                                label = { Text(tag.name) },
                                enabled = isSelected || selectedTags.size < 3,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(firstName, lastName, projectCompany, position, telegramHandle, email, linkedin, notes, selectedTags) },
                enabled = !isSubmitting && firstName.isNotBlank() && lastName.isNotBlank(),
            ) {
                if (isSubmitting) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
                Text(if (isSubmitting) "Saving..." else if (initial != null) "Update" else "Add")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !isSubmitting) { Text("Cancel") } },
    )
}
