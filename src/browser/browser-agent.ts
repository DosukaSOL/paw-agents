// ─── PAW Browser Agent ───
// AI-guided browser automation. Natural language navigation + intelligent interaction.
// Powered by the LiveBrowser engine + PAW's AI providers.

import { LiveBrowser, ElementInfo } from './live-browser';
import { ModelRouter } from '../models/router';
import { TraceLogger } from '../trace/index';
import { config } from '../core/config';

export interface BrowseInstruction {
  action: 'navigate' | 'find' | 'click' | 'fill' | 'extract' | 'screenshot' | 'edit-element';
  target?: string;       // Natural language description
  url?: string;
  text?: string;         // Text to type or instruction for AI
  selector?: string;     // CSS selector (if known)
}

export interface BrowseResult {
  success: boolean;
  action: string;
  url?: string;
  title?: string;
  extracted?: string;
  screenshot?: Buffer;
  element?: ElementInfo | null;
  error?: string;
}

export class BrowserAgent {
  private browser: LiveBrowser;
  private router: ModelRouter;
  private trace: TraceLogger;

  constructor(browser: LiveBrowser, router: ModelRouter) {
    this.browser = browser;
    this.router = router;
    this.trace = new TraceLogger();
  }

  // ─── Process natural language browser instruction ───
  async execute(instruction: string): Promise<BrowseResult> {
    const startTime = Date.now();

    // Ensure browser is running
    if (!this.browser.isRunning()) {
      await this.browser.launch();
    }

    // Use AI to understand the instruction and generate steps
    const plan = await this.planBrowsing(instruction);

    this.trace.log('execution', {
      input: instruction,
      reasoning: `Browser agent plan: ${plan.action} → ${plan.target ?? plan.url ?? ''}`,
      duration_ms: Date.now() - startTime,
    });

    try {
      switch (plan.action) {
        case 'navigate':
          return await this.handleNavigate(plan);
        case 'find':
          return await this.handleFind(plan);
        case 'click':
          return await this.handleClick(plan);
        case 'fill':
          return await this.handleFill(plan);
        case 'extract':
          return await this.handleExtract(plan);
        case 'screenshot':
          return await this.handleScreenshot();
        case 'edit-element':
          return await this.handleEditElement(plan);
        default:
          return { success: false, action: 'unknown', error: `Unknown browser action: ${plan.action}` };
      }
    } catch (err) {
      return { success: false, action: plan.action, error: (err as Error).message };
    }
  }

  // ─── Click-to-Edit: AI modifies a specific element ───
  async editElement(elementInfo: ElementInfo, instruction: string): Promise<{
    success: boolean;
    changes: string;
    error?: string;
  }> {
    const prompt = `You are a web development expert. A user has selected an HTML element and wants to modify it.

ELEMENT:
  Tag: ${elementInfo.tagName}
  ID: ${elementInfo.id}
  Classes: ${elementInfo.classes.join(' ')}
  Text: ${elementInfo.text}
  HTML: ${elementInfo.outerHTML}
  Styles: ${JSON.stringify(elementInfo.computedStyles)}
  Parent: ${elementInfo.parentContext}

USER INSTRUCTION: ${instruction}

Respond with ONLY the JavaScript code to modify this element in the page. Use document.querySelector with the most specific selector. Do not include markdown formatting or explanation.`;

    try {
      const { text: code } = await this.router.generate(
        'You are a precise web DOM manipulation assistant. Output only valid JavaScript code.',
        prompt
      );

      // Execute the AI-generated code in the browser
      await this.browser.evaluate(code);

      return {
        success: true,
        changes: code,
      };
    } catch (err) {
      return {
        success: false,
        changes: '',
        error: (err as Error).message,
      };
    }
  }

  // ─── AI plans which browser actions to take ───
  private async planBrowsing(instruction: string): Promise<BrowseInstruction> {
    const prompt = `Given this browser instruction, determine the action to take.
    
Instruction: "${instruction}"

Respond with a JSON object (no markdown) with these fields:
- action: one of "navigate", "find", "click", "fill", "extract", "screenshot", "edit-element"
- url: (if navigate) the URL to go to
- target: natural language description of the target element
- text: text to type or fill
- selector: CSS selector if obvious from the instruction

Example: {"action":"navigate","url":"https://google.com"}
Example: {"action":"click","target":"submit button"}
Example: {"action":"fill","target":"search box","text":"best laptops 2026"}`;

    try {
      const { text } = await this.router.generate(
        'You are a browser automation planner. Output only valid JSON.',
        prompt,
      );

      // Parse the AI response
      const cleaned = text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned) as BrowseInstruction;
    } catch {
      // Fallback: try to extract URL from instruction
      const urlMatch = instruction.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        return { action: 'navigate', url: urlMatch[0] };
      }
      return { action: 'extract', target: instruction };
    }
  }

  // ─── Navigate to URL ───
  private async handleNavigate(plan: BrowseInstruction): Promise<BrowseResult> {
    if (!plan.url) {
      // AI didn't give us a URL — try to construct one
      const { text } = await this.router.generate(
        'Output only a URL, nothing else.',
        `What URL should I navigate to for: "${plan.target}"?`,
      );
      plan.url = text.trim();
    }

    const result = await this.browser.navigate(plan.url);
    return { success: true, action: 'navigate', url: result.url, title: result.title };
  }

  // ─── Find element ───
  private async handleFind(plan: BrowseInstruction): Promise<BrowseResult> {
    const selector = plan.selector ?? await this.findSelector(plan.target ?? '');
    const element = await this.browser.getElementInfo(selector);
    return { success: !!element, action: 'find', element };
  }

  // ─── Click element ───
  private async handleClick(plan: BrowseInstruction): Promise<BrowseResult> {
    const selector = plan.selector ?? await this.findSelector(plan.target ?? '');
    await this.browser.click(selector);
    return { success: true, action: 'click' };
  }

  // ─── Fill form field ───
  private async handleFill(plan: BrowseInstruction): Promise<BrowseResult> {
    const selector = plan.selector ?? await this.findSelector(plan.target ?? '');
    await this.browser.type(selector, plan.text ?? '');
    return { success: true, action: 'fill' };
  }

  // ─── Extract page content ───
  private async handleExtract(plan: BrowseInstruction): Promise<BrowseResult> {
    const content = await this.browser.evaluate(`
      document.body.innerText.substring(0, 5000)
    `) as string;

    // If specific extraction target, use AI to filter
    if (plan.target) {
      const { text } = await this.router.generate(
        'Extract the requested information from the page content. Be concise.',
        `Extract "${plan.target}" from this page content:\n\n${content}`,
      );
      return { success: true, action: 'extract', extracted: text };
    }

    return { success: true, action: 'extract', extracted: content };
  }

  // ─── Take screenshot ───
  private async handleScreenshot(): Promise<BrowseResult> {
    const buffer = await this.browser.screenshot();
    return { success: true, action: 'screenshot', screenshot: buffer };
  }

  // ─── Edit element via click-to-edit ───
  private async handleEditElement(plan: BrowseInstruction): Promise<BrowseResult> {
    const selector = plan.selector ?? await this.findSelector(plan.target ?? '');
    const elementInfo = await this.browser.getElementInfo(selector);
    if (!elementInfo) {
      return { success: false, action: 'edit-element', error: 'Element not found' };
    }

    const result = await this.editElement(elementInfo, plan.text ?? plan.target ?? '');
    return {
      success: result.success,
      action: 'edit-element',
      element: elementInfo,
      error: result.error,
    };
  }

  // ─── Use AI to find the right CSS selector ───
  private async findSelector(description: string): Promise<string> {
    // First try: get page HTML and ask AI for selector
    const pageHtml = await this.browser.evaluate(`
      document.body.innerHTML.substring(0, 10000)
    `) as string;

    const { text } = await this.router.generate(
      'You are a CSS selector expert. Output ONLY a valid CSS selector string, nothing else.',
      `Find the CSS selector for "${description}" in this HTML:\n\n${pageHtml.substring(0, 5000)}`,
    );

    return text.trim().replace(/^['"`]|['"`]$/g, '');
  }
}
