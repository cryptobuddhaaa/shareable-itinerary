// Shared types for the Telegram bot

export interface BotState {
  state: string;
  data: Record<string, unknown>;
}

export interface EventInfo {
  id: string;
  title: string;
  date: string;
}

export interface LumaEventData {
  title: string;
  startTime?: string;
  endTime?: string;
  location: { name: string; address?: string };
  description?: string;
}

export interface ParsedEvent {
  title: string;
  startTime: string;
  endTime: string;
  location?: { name?: string; address?: string; mapsUrl?: string };
  lumaEventUrl?: string;
  eventType?: string;
  dayDate: string;
  itineraryTitle: string;
}

export interface FieldConfig {
  state: string;
  field: string;
  prompt: string;
  required: boolean;
}
