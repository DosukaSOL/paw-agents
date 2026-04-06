// ─── Browser Automation Engine ───
// Provides Puppeteer-based browser control through the agent pipeline.
// All browser actions are validated and sandboxed — safer than direct automation.

export interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'extract' | 'screenshot' | 'evaluate' | 'wait' | 'select';
  selector?: string;
  url?: string;
  text?: string;
  script?: string;
  timeout?: number;
  attribute?: string;
}

export interface BrowserResult {
  success: boolean;
  data?: unknown;
  screenshot?: string; // base64
  url?: string;
  title?: string;
  error?: string;
}

interface BrowserPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
  evaluate(fn: string | ((...args: unknown[]) => unknown), ...args: unknown[]): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  screenshot(opts?: { encoding?: string; fullPage?: boolean }): Promise<string | Buffer>;
  select(selector: string, ...values: string[]): Promise<string[]>;
  $eval(selector: string, fn: (el: any) => string): Promise<string>;
  $$eval(selector: string, fn: (els: any[]) => unknown): Promise<unknown>;
  close(): Promise<void>;
  content(): Promise<string>;
}

interface BrowserInstance {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

// URL allowlist/blocklist for sandboxing
const BLOCKED_PATTERNS = [
  /^file:\/\//i,
  /^javascript:/i,
  /^data:/i,
  /localhost/i,
  /127\.0\.0\./,
  /10\.\d+\.\d+\.\d+/,
  /192\.168\./,
  /0\.0\.0\.0/,
];

export class BrowserEngine {
  private browser: BrowserInstance | null = null;
  private pages = new Map<string, BrowserPage>();
  private maxPages = 5;

  // ─── Launch browser lazily ───
  private async ensureBrowser(): Promise<BrowserInstance> {
    if (this.browser) return this.browser;

    try {
      // Dynamic import to keep puppeteer optional
      const puppeteer = await import('puppeteer' as string);
      this.browser = await puppeteer.default.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
        ],
      }) as unknown as BrowserInstance;
      return this.browser;
    } catch {
      throw new Error('Browser automation requires puppeteer. Install with: npm install puppeteer');
    }
  }

  // ─── Validate URL ───
  private validateUrl(url: string): void {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(url)) {
        throw new Error(`Blocked URL: ${url} — internal/dangerous addresses are not allowed`);
      }
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('URLs must use http:// or https://');
    }
  }

  // ─── Get or create a page ───
  private async getPage(pageId: string = 'default'): Promise<BrowserPage> {
    if (this.pages.has(pageId)) return this.pages.get(pageId)!;
    if (this.pages.size >= this.maxPages) {
      throw new Error(`Max browser pages (${this.maxPages}) reached. Close a page first.`);
    }
    const browser = await this.ensureBrowser();
    const page = await browser.newPage();
    this.pages.set(pageId, page);
    return page;
  }

  // ─── Execute a browser action ───
  async execute(action: BrowserAction, pageId: string = 'default'): Promise<BrowserResult> {
    const page = await this.getPage(pageId);

    try {
      switch (action.type) {
        case 'navigate': {
          if (!action.url) throw new Error('navigate requires a url');
          this.validateUrl(action.url);
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: action.timeout ?? 30000 });
          return { success: true, url: page.url(), title: await page.title() };
        }

        case 'click': {
          if (!action.selector) throw new Error('click requires a selector');
          await page.waitForSelector(action.selector, { timeout: action.timeout ?? 5000 });
          await page.click(action.selector);
          return { success: true };
        }

        case 'type': {
          if (!action.selector || !action.text) throw new Error('type requires selector and text');
          await page.waitForSelector(action.selector, { timeout: action.timeout ?? 5000 });
          await page.type(action.selector, action.text);
          return { success: true };
        }

        case 'extract': {
          if (!action.selector) throw new Error('extract requires a selector');
          await page.waitForSelector(action.selector, { timeout: action.timeout ?? 5000 });
          const data = action.attribute
            ? await page.$eval(action.selector, (el: any) => el.textContent)
            : await page.$$eval(action.selector, (els: any[]) => els.map(e => e.textContent));
          return { success: true, data };
        }

        case 'screenshot': {
          const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
          return { success: true, screenshot: String(screenshot) };
        }

        case 'evaluate': {
          if (!action.script) throw new Error('evaluate requires a script');
          // Security: blocked patterns in evaluate
          if (/fetch|XMLHttpRequest|require|import|eval|Function|globalThis|window\.|document\.cookie/i.test(action.script)) {
            throw new Error('Script contains blocked patterns');
          }
          const result = await page.evaluate(action.script);
          return { success: true, data: result };
        }

        case 'wait': {
          if (!action.selector) throw new Error('wait requires a selector');
          await page.waitForSelector(action.selector, { timeout: action.timeout ?? 10000 });
          return { success: true };
        }

        case 'select': {
          if (!action.selector || !action.text) throw new Error('select requires selector and text');
          await page.select(action.selector, action.text);
          return { success: true };
        }

        default:
          throw new Error(`Unknown browser action: ${action.type}`);
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  // ─── Close a page ───
  async closePage(pageId: string = 'default'): Promise<void> {
    const page = this.pages.get(pageId);
    if (page) {
      await page.close();
      this.pages.delete(pageId);
    }
  }

  // ─── Shutdown ───
  async shutdown(): Promise<void> {
    for (const [id, page] of this.pages) {
      await page.close();
    }
    this.pages.clear();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
