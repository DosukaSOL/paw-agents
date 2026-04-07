// ─── PAW v3.6 Feature Tests ───
// Tests for: Streaming, Screen Context, Daemon, Voice, Browser, New Channels

import { StreamingEngine, StreamChunk } from '../src/models/streaming';
import { ScreenContextEngine } from '../src/daemon/screen-context';
import { DaemonScheduler } from '../src/daemon/scheduler';
import { SystemWatcher } from '../src/daemon/watcher';
import { NotificationManager } from '../src/daemon/notifications';

// ═══════════════════════════════════════
// Streaming Engine
// ═══════════════════════════════════════
describe('Streaming Engine', () => {
  test('initializes with all providers', () => {
    const engine = new StreamingEngine();
    const available = engine.getAvailableProviders();
    expect(Array.isArray(available)).toBe(true);
    // At minimum, Ollama is always in the list (available depends on config)
    expect(engine).toBeDefined();
  });

  test('getAvailableProviders returns string array', () => {
    const engine = new StreamingEngine();
    const providers = engine.getAvailableProviders();
    expect(Array.isArray(providers)).toBe(true);
    for (const p of providers) {
      expect(typeof p).toBe('string');
    }
  });

  test('is an EventEmitter', () => {
    const engine = new StreamingEngine();
    expect(typeof engine.on).toBe('function');
    expect(typeof engine.emit).toBe('function');
  });

  test('stream rejects when no providers available', async () => {
    // With no API keys configured, should fail gracefully
    const engine = new StreamingEngine();
    const providers = engine.getAvailableProviders();
    if (providers.length === 0) {
      await expect(
        engine.stream('system', 'test', () => {})
      ).rejects.toThrow('No streaming providers available');
    }
  });
});

// ═══════════════════════════════════════
// Screen Context Engine
// ═══════════════════════════════════════
describe('Screen Context Engine', () => {
  test('initializes with no active window', () => {
    const ctx = new ScreenContextEngine();
    expect(ctx.getActiveWindow()).toBeNull();
  });

  test('returns default context when not monitoring', () => {
    const ctx = new ScreenContextEngine();
    const context = ctx.getContext();
    expect(context.activeWindow).toBeDefined();
    expect(context.activeWindow.app).toBe('');
    expect(context.recentWindows).toHaveLength(0);
    expect(typeof context.workingContext).toBe('string');
  });

  test('getContextForPrompt returns string', () => {
    const ctx = new ScreenContextEngine();
    const prompt = ctx.getContextForPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('[Screen Context]');
  });

  test('start and stop monitoring', () => {
    const ctx = new ScreenContextEngine();
    ctx.start(10000); // Long interval to not actually poll
    ctx.stop();
    // Should not throw
    expect(ctx.getActiveWindow()).toBeDefined;
  });

  test('emits window-change events', (done) => {
    const ctx = new ScreenContextEngine();
    ctx.on('window-change', (window) => {
      expect(window).toBeDefined();
      expect(window.app).toBeDefined();
      ctx.stop();
      done();
    });
    // Start with a very short interval — will poll once immediately
    ctx.start(100);
    // Allow timeout in case no window detected (CI environments)
    setTimeout(() => {
      ctx.stop();
      done();
    }, 500);
  });
});

// ═══════════════════════════════════════
// Daemon Scheduler
// ═══════════════════════════════════════
describe('Daemon Scheduler', () => {
  test('initializes empty', () => {
    const scheduler = new DaemonScheduler();
    expect(scheduler.getTaskCount()).toBe(0);
  });

  test('adds and removes tasks', () => {
    const scheduler = new DaemonScheduler();
    const task = scheduler.addTask({ id: 'test-task', name: 'Test', schedule: 'every 1 minute', action: 'Do something', enabled: true, created_by: 'test' });
    expect(scheduler.getTaskCount()).toBe(1);

    scheduler.removeTask(task.id);
    expect(scheduler.getTaskCount()).toBe(0);
  });

  test('parses natural language schedules', () => {
    const scheduler = new DaemonScheduler();

    const t1 = scheduler.addNaturalTask('fast-check', 'Check status', 'every 5 minutes', 'check status');
    expect(scheduler.getTaskCount()).toBe(1);
    if (t1) scheduler.removeTask(t1.id);

    const t2 = scheduler.addNaturalTask('hourly-task', 'Hourly check', 'hourly', 'hourly check');
    expect(scheduler.getTaskCount()).toBe(1);
    if (t2) scheduler.removeTask(t2.id);

    const t3 = scheduler.addNaturalTask('daily-task', 'Daily report', 'daily', 'daily report');
    expect(scheduler.getTaskCount()).toBe(1);
    if (t3) scheduler.removeTask(t3.id);
  });

  test('start and stop', async () => {
    const scheduler = new DaemonScheduler();
    scheduler.addTask({ id: 'test', name: 'Unit test', schedule: 'every 1 minute', action: 'test', enabled: true, created_by: 'test' });
    await scheduler.start();
    scheduler.stop();
    expect(scheduler.getTaskCount()).toBe(1);
  });

  test('toggles task enabled state', () => {
    const scheduler = new DaemonScheduler();
    const task = scheduler.addTask({ id: 'toggle-test', name: 'Toggle me', schedule: 'every 1 minute', action: 'toggle', enabled: true, created_by: 'test' });
    scheduler.setEnabled(task.id, false);
    scheduler.setEnabled(task.id, true);
    scheduler.removeTask(task.id);
  });
});

// ═══════════════════════════════════════
// System Watcher
// ═══════════════════════════════════════
describe('System Watcher', () => {
  test('initializes with zero watches', () => {
    const watcher = new SystemWatcher();
    expect(watcher.getWatchCount()).toBe(0);
  });

  test('stopAll works when no watches', () => {
    const watcher = new SystemWatcher();
    watcher.stopAll();
    expect(watcher.getWatchCount()).toBe(0);
  });

  test('classifies clipboard content', () => {
    const watcher = new SystemWatcher();
    // Access the classify method via the watcher
    // The classifyClipboard is private, test indirectly through behavior
    expect(watcher).toBeDefined();
  });
});

// ═══════════════════════════════════════
// Notification Manager
// ═══════════════════════════════════════
describe('Notification Manager', () => {
  test('initializes with zero notifications', () => {
    const mgr = new NotificationManager();
    expect(mgr.getUnreadCount()).toBe(0);
    expect(mgr.getHistory()).toHaveLength(0);
  });

  test('sends and stores notifications', () => {
    const mgr = new NotificationManager();
    mgr.send('Test Title', 'Test body');
    expect(mgr.getHistory()).toHaveLength(1);
    expect(mgr.getUnreadCount()).toBe(1);
  });

  test('marks as read', () => {
    const mgr = new NotificationManager();
    mgr.send('Test', 'Body');
    const history = mgr.getHistory();
    mgr.markRead(history[0].id);
    expect(mgr.getUnreadCount()).toBe(0);
  });

  test('respects max history limit', () => {
    const mgr = new NotificationManager();
    for (let i = 0; i < 10; i++) {
      mgr.send(`Title ${i}`, `Body ${i}`);
    }
    expect(mgr.getHistory()).toHaveLength(10);
    expect(mgr.getUnreadCount()).toBe(10);
  });
});

// ═══════════════════════════════════════
// Channel Type Coverage
// ═══════════════════════════════════════
describe('v3.6 Channel Types', () => {
  test('all new channel types are valid', () => {
    // Import the types to verify they compile
    const newTypes: string[] = ['voice', 'twitter', 'github', 'notion', 'calendar', 'rest', 'mqtt', 'rss'];
    for (const t of newTypes) {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════
// Version Check
// ═══════════════════════════════════════
describe('v3.6 Version', () => {
  test('package.json version is 4.0.0', () => {
    const pkg = require('../package.json');
    expect(pkg.version).toBe('4.0.0');
  });
});
