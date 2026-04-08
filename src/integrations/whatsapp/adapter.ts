// ─── WhatsApp Channel Adapter ───
// Connects PAW Agents to WhatsApp via Baileys.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { config } from '../../core/config';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class WhatsAppAdapter implements ChannelAdapter {
  name: ChannelType = 'whatsapp';
  private handler: MessageHandler | null = null;
  private socket: unknown = null;

  async start(): Promise<void> {
    const sessionPath = config.whatsapp.sessionPath;

    try {
      // Dynamic import to avoid requiring Baileys if not used
      const baileys = await import('@whiskeysockets/baileys');
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
      });

      sock.ev.on('creds.update', saveCreds);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sock.ev.on('messages.upsert', async (m: any) => {
        for (const msg of m.messages) {
          const key = msg.key;
          if (!key || key.fromMe) continue;
          const jid = key.remoteJid as string | undefined;
          if (!jid) continue;
          const text = (msg.message?.conversation as string) ?? (msg.message?.extendedTextMessage?.text as string);
          if (!text) continue;

          if (this.handler) {
            await this.handler(`whatsapp:${jid}`, text, 'whatsapp').catch(err =>
              console.error('[PAW:WhatsApp] Handler error:', (err as Error).message)
            );
          }
        }
      });

      this.socket = sock;
      console.log('[PAW:WhatsApp] 📱 WhatsApp adapter initialized. Scan QR code if not authenticated.');
    } catch (err) {
      console.warn('[PAW:WhatsApp] Failed to start:', (err as Error).message);
      console.warn('[PAW:WhatsApp] Install @whiskeysockets/baileys to enable WhatsApp.');
    }
  }

  async stop(): Promise<void> {
    if (this.socket && typeof (this.socket as { end: (reason?: unknown) => void }).end === 'function') {
      (this.socket as { end: (reason?: unknown) => void }).end();
    }
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.socket) return;
    const jid = userId.replace('whatsapp:', '');
    try {
      await (this.socket as { sendMessage: (jid: string, msg: { text: string }) => Promise<void> }).sendMessage(jid, { text: message });
    } catch (err) {
      console.error('[PAW:WhatsApp] Send failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
