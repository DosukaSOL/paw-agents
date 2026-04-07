// ─── Calendar Channel Adapter ───
// Connects PAW to Google Calendar / iCal for scheduling and reminders.
// User provides their own Google Calendar API key.

import { ChannelAdapter, ChannelType } from '../../core/types';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class CalendarAdapter implements ChannelAdapter {
  name: ChannelType = 'calendar';
  private handler: MessageHandler | null = null;
  private apiKey: string;
  private calendarId: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private notifiedEvents = new Set<string>();

  constructor() {
    this.apiKey = process.env.GOOGLE_CALENDAR_API_KEY ?? '';
    this.calendarId = process.env.GOOGLE_CALENDAR_ID ?? 'primary';
  }

  async start(): Promise<void> {
    if (!this.apiKey) {
      console.log('[PAW:Calendar] No GOOGLE_CALENDAR_API_KEY configured, skipping.');
      return;
    }

    // Check for upcoming events every 5 minutes
    this.pollInterval = setInterval(() => this.checkUpcoming(), 300000);
    this.pollInterval.unref();
    // Initial check
    await this.checkUpcoming();

    console.log('[PAW:Calendar] 📅 Calendar channel connected');
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async send(userId: string, message: string): Promise<void> {
    // Calendar "sends" are event creation
    console.log(`[PAW:Calendar] Response for ${userId}: ${message}`);
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── Create a calendar event ───
  async createEvent(summary: string, startTime: Date, endTime: Date, description?: string): Promise<string | null> {
    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary,
            description,
            start: { dateTime: startTime.toISOString() },
            end: { dateTime: endTime.toISOString() },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Calendar API error: ${response.status}`);
      }

      const data = await response.json() as { id: string };
      return data.id;
    } catch (err) {
      console.error('[PAW:Calendar] Create event failed:', (err as Error).message);
      return null;
    }
  }

  private async checkUpcoming(): Promise<void> {
    try {
      const now = new Date();
      const soon = new Date(now.getTime() + 15 * 60 * 1000); // Next 15 minutes

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events?key=${encodeURIComponent(this.apiKey)}&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(soon.toISOString())}&singleEvents=true&orderBy=startTime`
      );

      if (!response.ok) return;

      const data = await response.json() as { items?: Array<{ id: string; summary: string; start: { dateTime: string } }> };

      for (const event of data.items ?? []) {
        if (this.notifiedEvents.has(event.id)) continue;
        this.notifiedEvents.add(event.id);

        if (this.handler) {
          await this.handler('calendar:upcoming', `Upcoming event in 15 minutes: ${event.summary}`, 'api');
        }
      }

      // Clean old entries
      if (this.notifiedEvents.size > 1000) {
        const entries = Array.from(this.notifiedEvents);
        this.notifiedEvents = new Set(entries.slice(-500));
      }
    } catch {
      // Silent fail on poll
    }
  }
}
