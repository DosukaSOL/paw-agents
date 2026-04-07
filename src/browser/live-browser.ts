// @ts-nocheck — DOM types used inside page.evaluate() callbacks (run in browser, not Node)
// ─── PAW Live Browser Engine ───
// Playwright-based browser automation in HEADED mode.
// Users watch the agent browse in real-time. Supports sessions, recording, multi-tab.

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../core/config';

export interface LiveBrowserAction {
  type: 'navigate' | 'click' | 'type' | 'select' | 'scroll' | 'screenshot' | 'evaluate' | 'wait' | 'back' | 'forward' | 'close-tab';
  selector?: string;
  url?: string;
  text?: string;
  script?: string;
  timeout?: number;
  tabId?: string;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  active: boolean;
  created_at: string;
}

export interface BrowserActionLog {
  action: LiveBrowserAction;
  result: unknown;
  screenshot?: string; // base64
  timestamp: string;
  duration_ms: number;
}

export interface ElementInfo {
  selector: string;
  tagName: string;
  id: string;
  classes: string[];
  text: string;
  href?: string;
  src?: string;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  outerHTML: string;
  computedStyles: Record<string, string>;
  parentContext: string;
}

export class LiveBrowser extends EventEmitter {
  private browser: any = null;
  private context: any = null;
  private pages = new Map<string, any>();
  private activeTabId: string = '';
  private actionLog: BrowserActionLog[] = [];
  private maxLogEntries = 500;
  private tabCounter = 0;
  private sessionDir: string;
  private recording = false;

  constructor() {
    super();
    this.sessionDir = config.browser?.sessionDir ?? './data/browser-sessions';
  }

  // ─── Launch browser (headed mode by default) ───
  async launch(): Promise<void> {
    if (this.browser) return;

    const { chromium } = await import('playwright');

    const headless = config.browser?.headless ?? false;

    // Restore session if persistent
    if (config.browser?.persistSessions) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
      this.context = await chromium.launchPersistentContext(this.sessionDir, {
        headless,
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      this.browser = { close: () => this.context.close() };
    } else {
      this.browser = await chromium.launch({
        headless,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
      });
    }

    // Listen for new pages
    this.context.on('page', (page: any) => {
      const tabId = `tab-${++this.tabCounter}`;
      this.pages.set(tabId, page);
      this.activeTabId = tabId;
      this.emit('tab-opened', { id: tabId, url: page.url() });
    });

    // Open initial tab
    const page = this.context.pages()[0] ?? await this.context.newPage();
    const tabId = `tab-${++this.tabCounter}`;
    this.pages.set(tabId, page);
    this.activeTabId = tabId;

    // Start recording if enabled
    if (config.browser?.recordActions) {
      this.recording = true;
    }

    console.log(`[LiveBrowser] 🌐 Browser launched (headless: ${headless})`);
    this.emit('launched');
  }

  // ─── Navigate to URL ───
  async navigate(url: string, tabId?: string): Promise<{ url: string; title: string }> {
    const page = this.getPage(tabId);
    const startTime = Date.now();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();
    const finalUrl = page.url();

    this.logAction({ type: 'navigate', url }, { url: finalUrl, title }, startTime);
    this.emit('navigated', { url: finalUrl, title, tabId: tabId ?? this.activeTabId });

    return { url: finalUrl, title };
  }

  // ─── Click element ───
  async click(selector: string, tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    const startTime = Date.now();

    await page.click(selector, { timeout: 10000 });
    this.logAction({ type: 'click', selector }, { clicked: true }, startTime);
    this.emit('action', { type: 'click', selector });
  }

  // ─── Type text ───
  async type(selector: string, text: string, tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    const startTime = Date.now();

    await page.fill(selector, text);
    this.logAction({ type: 'type', selector, text: text.substring(0, 50) }, { typed: true }, startTime);
    this.emit('action', { type: 'type', selector });
  }

  // ─── Take screenshot ───
  async screenshot(tabId?: string, fullPage: boolean = false): Promise<Buffer> {
    const page = this.getPage(tabId);
    const startTime = Date.now();

    const buffer = await page.screenshot({ fullPage, type: 'png' });
    this.logAction({ type: 'screenshot' }, { bytes: buffer.length }, startTime);

    return buffer;
  }

  // ─── Execute JavaScript in page ───
  async evaluate(script: string, tabId?: string): Promise<unknown> {
    const page = this.getPage(tabId);
    const startTime = Date.now();

    const result = await page.evaluate(script);
    this.logAction({ type: 'evaluate', script: script.substring(0, 100) }, result, startTime);

    return result;
  }

  // ─── Get element info (for click-to-edit) ───
  async getElementInfo(selector: string, tabId?: string): Promise<ElementInfo | null> {
    const page = this.getPage(tabId);

    try {
      return await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;

        const rect = el.getBoundingClientRect();
        const computed = window.getComputedStyle(el);

        // Build a unique selector path
        function getSelector(element: Element): string {
          if (element.id) return `#${element.id}`;
          let path = '';
          let current: Element | null = element;
          while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
              selector = `#${current.id}`;
              path = selector + (path ? ' > ' + path : '');
              break;
            }
            if (current.className && typeof current.className === 'string') {
              const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.');
              if (classes) selector += `.${classes}`;
            }
            path = selector + (path ? ' > ' + path : '');
            current = current.parentElement;
          }
          return path;
        }

        return {
          selector: getSelector(el),
          tagName: el.tagName.toLowerCase(),
          id: el.id || '',
          classes: Array.from(el.classList),
          text: (el.textContent || '').trim().substring(0, 200),
          href: (el as HTMLAnchorElement).href || undefined,
          src: (el as HTMLImageElement).src || undefined,
          boundingBox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          outerHTML: el.outerHTML.substring(0, 500),
          computedStyles: {
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            fontSize: computed.fontSize,
            fontFamily: computed.fontFamily,
            display: computed.display,
            position: computed.position,
          },
          parentContext: el.parentElement?.outerHTML.substring(0, 300) ?? '',
        };
      }, selector);
    } catch {
      return null;
    }
  }

  // ─── Inject click-to-edit overlay script ───
  async injectClickToEditOverlay(tabId?: string): Promise<void> {
    const page = this.getPage(tabId);

    await page.evaluate(() => {
      // Remove existing overlay if present
      const existing = document.getElementById('paw-click-overlay');
      if (existing) existing.remove();

      // Create overlay highlight element
      const overlay = document.createElement('div');
      overlay.id = 'paw-click-overlay';
      overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #7c3aed;background:rgba(124,58,237,0.1);z-index:999999;display:none;border-radius:4px;transition:all 0.1s ease;';
      document.body.appendChild(overlay);

      // Create info tooltip
      const tooltip = document.createElement('div');
      tooltip.id = 'paw-click-tooltip';
      tooltip.style.cssText = 'position:fixed;background:#1e1e2e;color:#cdd6f4;padding:6px 10px;border-radius:6px;font-size:12px;font-family:monospace;z-index:999999;display:none;border:1px solid #7c3aed;max-width:300px;pointer-events:none;';
      document.body.appendChild(tooltip);

      // Hover handler
      document.addEventListener('mousemove', (e) => {
        const target = e.target as HTMLElement;
        if (!target || target.id === 'paw-click-overlay' || target.id === 'paw-click-tooltip') return;

        const rect = target.getBoundingClientRect();
        overlay.style.left = rect.left + 'px';
        overlay.style.top = rect.top + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        overlay.style.display = 'block';

        tooltip.textContent = `<${target.tagName.toLowerCase()}${target.id ? '#' + target.id : ''}${target.className && typeof target.className === 'string' ? '.' + target.className.trim().split(' ').slice(0, 2).join('.') : ''}>`;
        tooltip.style.left = Math.min(rect.left, window.innerWidth - 310) + 'px';
        tooltip.style.top = Math.max(0, rect.top - 30) + 'px';
        tooltip.style.display = 'block';
      });

      // Store clicked element info for PAW to retrieve
      (window as any).__paw_clicked_element = null;
      document.addEventListener('click', (e) => {
        if ((e as any).__paw_handled) return;
        const target = e.target as HTMLElement;
        if (!target || target.id?.startsWith('paw-click')) return;

        const rect = target.getBoundingClientRect();
        const computed = window.getComputedStyle(target);

        (window as any).__paw_clicked_element = {
          tagName: target.tagName.toLowerCase(),
          id: target.id || '',
          classes: Array.from(target.classList),
          text: (target.textContent || '').trim().substring(0, 200),
          outerHTML: target.outerHTML.substring(0, 500),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          styles: {
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            fontSize: computed.fontSize,
          },
        };
      }, true);
    });

    console.log('[LiveBrowser] 🎯 Click-to-Edit overlay injected');
    this.emit('overlay-injected', tabId ?? this.activeTabId);
  }

  // ─── Get last clicked element info ───
  async getClickedElement(tabId?: string): Promise<unknown> {
    const page = this.getPage(tabId);
    return page.evaluate(() => (window as any).__paw_clicked_element);
  }

  // ─── Open new tab ───
  async newTab(url?: string): Promise<string> {
    const maxTabs = config.browser?.maxTabs ?? 10;
    if (this.pages.size >= maxTabs) {
      throw new Error(`Max tabs (${maxTabs}) reached. Close a tab first.`);
    }

    const page = await this.context.newPage();
    const tabId = `tab-${++this.tabCounter}`;
    this.pages.set(tabId, page);
    this.activeTabId = tabId;

    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    return tabId;
  }

  // ─── Close tab ───
  async closeTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) return;

    await page.close();
    this.pages.delete(tabId);

    // Switch to another tab
    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.pages.keys());
      this.activeTabId = remaining[remaining.length - 1] ?? '';
    }

    this.emit('tab-closed', tabId);
  }

  // ─── Get all tabs ───
  getTabs(): BrowserTab[] {
    const tabs: BrowserTab[] = [];
    for (const [id, page] of this.pages) {
      tabs.push({
        id,
        url: page.url(),
        title: '', // Would need async call
        active: id === this.activeTabId,
        created_at: new Date().toISOString(),
      });
    }
    return tabs;
  }

  // ─── Get action log ───
  getActionLog(limit: number = 50): BrowserActionLog[] {
    return this.actionLog.slice(-limit);
  }

  // ─── Close browser ───
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this.activeTabId = '';
      this.emit('closed');
    }
  }

  // ─── Check if browser is running ───
  isRunning(): boolean {
    return this.browser !== null;
  }

  // ─── Internal: get page by tab ID ───
  private getPage(tabId?: string): any {
    const id = tabId ?? this.activeTabId;
    const page = this.pages.get(id);
    if (!page) throw new Error(`No browser tab: ${id}. Call launch() first.`);
    return page;
  }

  // ─── Internal: log browser action ───
  private logAction(action: LiveBrowserAction, result: unknown, startTime: number): void {
    if (!this.recording) return;

    const entry: BrowserActionLog = {
      action,
      result,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    };

    this.actionLog.push(entry);
    if (this.actionLog.length > this.maxLogEntries) {
      this.actionLog = this.actionLog.slice(-this.maxLogEntries);
    }

    this.emit('action-logged', entry);
  }
}
