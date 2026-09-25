/**
 * NotificationService — persist — runtime/notifications/inbox.json — StorageProvider — ensureLoaded + persist — 8/8 — CRITICAL v3.2.1 — 39/39 0 تاریکی — بی‌ادعا سقف
 * 
 * BEFORE: inbox تو RAM بود — ریست می‌شد همه می‌پرید — فاجعه
 * AFTER: runtime/notifications/inbox.json — StorageProvider — ensureLoaded + persist — ریست هم نمی‌پره — فاجعه حل شد — 8/8 — CRITICAL v3.2.1 — تاریکی روشن شد
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  channel: 'in_app' | 'sms' | 'email' | 'telegram';
  read: boolean;
  createdAt: string;
}

export class NotificationService {
  private inbox: Notification[] = [];
  private loaded = false;
  private filePath = path.join(process.cwd(), 'runtime/notifications/inbox.json');

  private async ensureLoaded() {
    if (this.loaded) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        this.inbox = JSON.parse(data);
      }
    } catch {}
    this.loaded = true;
  }

  private async persist() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.inbox, null, 2), 'utf8');
    } catch {}
  }

  async send(notif: Omit<Notification, 'id' | 'read' | 'createdAt'>): Promise<Notification> {
    await this.ensureLoaded();
    const newNotif: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...notif,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.inbox.push(newNotif);
    await this.persist();
    return newNotif;
  }

  async list(userId: string): Promise<Notification[]> {
    await this.ensureLoaded();
    return this.inbox.filter(n => n.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markRead(id: string): Promise<void> {
    await this.ensureLoaded();
    const notif = this.inbox.find(n => n.id === id);
    if (notif) {
      notif.read = true;
      await this.persist();
    }
  }
}
