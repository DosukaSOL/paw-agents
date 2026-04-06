// ─── User Profiler — Long-term Preference Learning ───
// Tracks user behavior, learns preferences, and personalizes agent responses.
// Profiles persist to disk and survive across sessions.

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../core/config';
import { UserProfile, UserPreferences, BehaviorPattern, TaskType } from '../core/types';

const DEFAULT_PREFERENCES: UserPreferences = {
  preferred_language: 'en',
  verbosity: 'normal',
  confirmation_style: 'detailed',
  custom: {},
};

export class UserProfiler {
  private profiles = new Map<string, UserProfile>();
  private storePath: string;
  private dirty = new Set<string>();

  constructor(storePath?: string) {
    this.storePath = path.resolve(storePath ?? config.intelligence.profileStorePath);
    this.ensureDir();
  }

  // ─── Get or create a user profile ───
  getProfile(userId: string): UserProfile {
    const cached = this.profiles.get(userId);
    if (cached) return cached;

    // Try loading from disk
    const diskProfile = this.loadFromDisk(userId);
    if (diskProfile) {
      this.profiles.set(userId, diskProfile);
      return diskProfile;
    }

    // Create new profile
    const profile: UserProfile = {
      user_id: userId,
      preferences: { ...DEFAULT_PREFERENCES },
      behavior_patterns: [],
      skill_usage: {},
      model_preferences: {},
      interaction_count: 0,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      avg_risk_tolerance: 50,
      topics_of_interest: [],
    };

    this.profiles.set(userId, profile);
    this.dirty.add(userId);
    return profile;
  }

  // ─── Record an interaction (called after every agent.process) ───
  recordInteraction(userId: string, data: {
    intent: string;
    tools_used: string[];
    task_type?: TaskType;
    risk_score: number;
    model_used: string;
    success: boolean;
    duration_ms: number;
  }): void {
    const profile = this.getProfile(userId);
    profile.interaction_count++;
    profile.last_seen = new Date().toISOString();

    // Update skill usage counts
    for (const tool of data.tools_used) {
      profile.skill_usage[tool] = (profile.skill_usage[tool] ?? 0) + 1;
    }

    // Rolling average risk tolerance
    profile.avg_risk_tolerance = Math.round(
      (profile.avg_risk_tolerance * (profile.interaction_count - 1) + data.risk_score)
      / profile.interaction_count,
    );

    // Track model preference (which model the user's tasks end up using most)
    if (data.task_type) {
      const currentPref = profile.model_preferences[data.task_type];
      if (!currentPref || data.success) {
        profile.model_preferences[data.task_type] = data.model_used;
      }
    }

    // Extract topics from intent
    this.updateTopics(profile, data.intent);

    // Detect behavior patterns
    this.detectPatterns(profile, data);

    this.dirty.add(userId);
    this.flushIfNeeded();
  }

  // ─── Update user preferences explicitly ───
  updatePreferences(userId: string, update: Partial<UserPreferences>): UserProfile {
    const profile = this.getProfile(userId);
    profile.preferences = { ...profile.preferences, ...update };
    this.dirty.add(userId);
    this.flush(userId);
    return profile;
  }

  // ─── Get personalization hints for the LLM system prompt ───
  getPersonalizationHints(userId: string): string {
    const profile = this.getProfile(userId);

    if (profile.interaction_count < 3) {
      return ''; // Not enough data to personalize
    }

    const hints: string[] = [];

    // Verbosity preference
    if (profile.preferences.verbosity === 'concise') {
      hints.push('User prefers concise, brief responses.');
    } else if (profile.preferences.verbosity === 'detailed') {
      hints.push('User prefers detailed, thorough explanations.');
    }

    // Top tools/skills
    const topTools = Object.entries(profile.skill_usage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tool]) => tool);
    if (topTools.length > 0) {
      hints.push(`User frequently uses: ${topTools.join(', ')}.`);
    }

    // Topics of interest
    if (profile.topics_of_interest.length > 0) {
      hints.push(`User is interested in: ${profile.topics_of_interest.slice(0, 5).join(', ')}.`);
    }

    // Risk tolerance
    if (profile.avg_risk_tolerance < 30) {
      hints.push('User is risk-averse — prefer safer plans with confirmations.');
    } else if (profile.avg_risk_tolerance > 70) {
      hints.push('User is comfortable with higher-risk actions.');
    }

    return hints.join(' ');
  }

  // ─── Flush all dirty profiles to disk ───
  flushAll(): void {
    for (const userId of this.dirty) {
      this.flush(userId);
    }
    this.dirty.clear();
  }

  // ─── Private: Detect behavior patterns ───
  private detectPatterns(profile: UserProfile, data: {
    intent: string;
    tools_used: string[];
    task_type?: TaskType;
    success: boolean;
  }): void {
    const maxPatterns = config.intelligence.maxBehaviorPatterns;

    // Pattern: repeated task types
    if (data.task_type) {
      const existing = profile.behavior_patterns.find(
        p => p.pattern_type === `task:${data.task_type}`,
      );
      if (existing) {
        existing.frequency++;
        existing.last_observed = new Date().toISOString();
        existing.confidence = Math.min(1, existing.frequency / 10);
      } else if (profile.behavior_patterns.length < maxPatterns) {
        profile.behavior_patterns.push({
          pattern_type: `task:${data.task_type}`,
          frequency: 1,
          last_observed: new Date().toISOString(),
          confidence: 0.1,
        });
      }
    }

    // Pattern: repeated tool combinations
    if (data.tools_used.length >= 2) {
      const combo = data.tools_used.sort().join('+');
      const existing = profile.behavior_patterns.find(
        p => p.pattern_type === `combo:${combo}`,
      );
      if (existing) {
        existing.frequency++;
        existing.last_observed = new Date().toISOString();
        existing.confidence = Math.min(1, existing.frequency / 5);
      } else if (profile.behavior_patterns.length < maxPatterns) {
        profile.behavior_patterns.push({
          pattern_type: `combo:${combo}`,
          frequency: 1,
          last_observed: new Date().toISOString(),
          confidence: 0.1,
        });
      }
    }

    // Prune old low-confidence patterns
    if (profile.behavior_patterns.length > maxPatterns) {
      profile.behavior_patterns.sort((a, b) => b.confidence - a.confidence);
      profile.behavior_patterns = profile.behavior_patterns.slice(0, maxPatterns);
    }
  }

  // ─── Private: Update topics of interest ───
  private updateTopics(profile: UserProfile, intent: string): void {
    const keywords = intent.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4); // Only meaningful words

    const topicKeywords = new Set([
      'solana', 'transfer', 'balance', 'defi', 'swap', 'token', 'nft',
      'deploy', 'contract', 'stake', 'browser', 'scrape', 'email',
      'schedule', 'workflow', 'memory', 'search', 'analyze', 'code',
      'write', 'build', 'create', 'debug', 'monitor', 'alert',
    ]);

    for (const word of keywords) {
      if (topicKeywords.has(word) && !profile.topics_of_interest.includes(word)) {
        profile.topics_of_interest.push(word);
        if (profile.topics_of_interest.length > 20) {
          profile.topics_of_interest.shift(); // Keep most recent 20
        }
      }
    }
  }

  // ─── Persistence ───
  private flush(userId: string): void {
    const profile = this.profiles.get(userId);
    if (!profile) return;

    try {
      const filePath = this.profilePath(userId);
      fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');
    } catch {
      // Silent fail — profile still works in-memory
    }
  }

  private flushIfNeeded(): void {
    // Batch flush every 10 dirty profiles
    if (this.dirty.size >= 10) {
      this.flushAll();
    }
  }

  private loadFromDisk(userId: string): UserProfile | null {
    try {
      const filePath = this.profilePath(userId);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data as UserProfile;
      }
    } catch {
      // Corrupted file — return null to create fresh profile
    }
    return null;
  }

  private profilePath(userId: string): string {
    // Sanitize userId for filesystem safety
    const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    return path.join(this.storePath, `${safeId}.json`);
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.storePath)) {
        fs.mkdirSync(this.storePath, { recursive: true });
      }
    } catch {
      // Non-fatal — profiles work in-memory
    }
  }
}
