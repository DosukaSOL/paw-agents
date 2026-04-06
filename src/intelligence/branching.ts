// ─── Conversation Branching & Rollback ───
// Enables users to branch conversations at any point and roll back to previous states.
// Each user has a conversation tree with multiple branches.

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../core/config';
import { ConversationBranch, ConversationTree, ConversationMessage } from '../core/types';

export class ConversationBranching {
  private trees = new Map<string, ConversationTree>();
  private storePath: string;
  private dirty = new Set<string>();

  constructor(storePath?: string) {
    this.storePath = path.resolve(storePath ?? config.intelligence.branchStorePath);
    this.ensureDir();
  }

  // ─── Get or create a conversation tree for a user ───
  getTree(userId: string): ConversationTree {
    const cached = this.trees.get(userId);
    if (cached) return cached;

    // Try loading from disk
    const diskTree = this.loadFromDisk(userId);
    if (diskTree) {
      this.trees.set(userId, diskTree);
      return diskTree;
    }

    // Create new tree with a root branch
    const rootBranchId = `branch_${Date.now()}_root`;
    const tree: ConversationTree = {
      user_id: userId,
      root_branch_id: rootBranchId,
      branches: {
        [rootBranchId]: {
          branch_id: rootBranchId,
          branch_point_index: 0,
          messages: [],
          created_at: new Date().toISOString(),
          label: 'main',
          is_active: true,
        },
      },
      active_branch_id: rootBranchId,
    };

    this.trees.set(userId, tree);
    this.dirty.add(userId);
    return tree;
  }

  // ─── Add a message to the active branch ───
  addMessage(userId: string, message: ConversationMessage): void {
    const tree = this.getTree(userId);
    const branch = tree.branches[tree.active_branch_id];
    if (!branch) return;

    branch.messages.push(message);
    this.dirty.add(userId);
    this.flushIfNeeded();
  }

  // ─── Get messages from the active branch ───
  getMessages(userId: string): ConversationMessage[] {
    const tree = this.getTree(userId);
    const branch = tree.branches[tree.active_branch_id];
    return branch?.messages ?? [];
  }

  // ─── Create a new branch from a specific message index ───
  createBranch(userId: string, branchPointIndex: number, label?: string): ConversationBranch | null {
    const tree = this.getTree(userId);
    const currentBranch = tree.branches[tree.active_branch_id];
    if (!currentBranch) return null;

    // Validate branch point
    if (branchPointIndex < 0 || branchPointIndex > currentBranch.messages.length) {
      return null;
    }

    // Check max branches limit
    const branchCount = Object.keys(tree.branches).length;
    if (branchCount >= config.intelligence.maxBranchesPerUser) {
      return null;
    }

    const newBranchId = `branch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Copy messages up to branch point
    const branchedMessages = currentBranch.messages.slice(0, branchPointIndex);

    const newBranch: ConversationBranch = {
      branch_id: newBranchId,
      parent_branch_id: tree.active_branch_id,
      branch_point_index: branchPointIndex,
      messages: branchedMessages,
      created_at: new Date().toISOString(),
      label: label ?? `branch-${branchCount + 1}`,
      is_active: true,
    };

    // Deactivate current branch
    currentBranch.is_active = false;

    // Add new branch and switch to it
    tree.branches[newBranchId] = newBranch;
    tree.active_branch_id = newBranchId;

    this.dirty.add(userId);
    this.flush(userId);

    return newBranch;
  }

  // ─── Switch to an existing branch ───
  switchBranch(userId: string, branchId: string): boolean {
    const tree = this.getTree(userId);
    const targetBranch = tree.branches[branchId];
    if (!targetBranch) return false;

    // Deactivate current
    const current = tree.branches[tree.active_branch_id];
    if (current) current.is_active = false;

    // Activate target
    targetBranch.is_active = true;
    tree.active_branch_id = branchId;

    this.dirty.add(userId);
    this.flush(userId);
    return true;
  }

  // ─── Roll back to a specific message index in the active branch ───
  rollback(userId: string, messageIndex: number): boolean {
    const tree = this.getTree(userId);
    const branch = tree.branches[tree.active_branch_id];
    if (!branch) return false;

    if (messageIndex < 0 || messageIndex >= branch.messages.length) return false;

    // Truncate messages after the rollback point
    branch.messages = branch.messages.slice(0, messageIndex);

    this.dirty.add(userId);
    this.flush(userId);
    return true;
  }

  // ─── List all branches for a user ───
  listBranches(userId: string): Array<{
    branch_id: string;
    label: string;
    message_count: number;
    is_active: boolean;
    created_at: string;
    parent_branch_id?: string;
  }> {
    const tree = this.getTree(userId);
    return Object.values(tree.branches).map(b => ({
      branch_id: b.branch_id,
      label: b.label ?? b.branch_id,
      message_count: b.messages.length,
      is_active: b.is_active,
      created_at: b.created_at,
      parent_branch_id: b.parent_branch_id,
    }));
  }

  // ─── Delete a branch (cannot delete active or root) ───
  deleteBranch(userId: string, branchId: string): boolean {
    const tree = this.getTree(userId);

    // Cannot delete active branch
    if (tree.active_branch_id === branchId) return false;

    // Cannot delete root branch
    if (tree.root_branch_id === branchId) return false;

    if (!tree.branches[branchId]) return false;

    delete tree.branches[branchId];
    this.dirty.add(userId);
    this.flush(userId);
    return true;
  }

  // ─── Get conversation history with branch context for LLM ───
  getContextHistory(userId: string, maxMessages: number = 50): ConversationMessage[] {
    const messages = this.getMessages(userId);
    return messages.slice(-maxMessages);
  }

  // ─── Flush all dirty trees ───
  flushAll(): void {
    for (const userId of this.dirty) {
      this.flush(userId);
    }
    this.dirty.clear();
  }

  // ─── Persistence ───
  private flush(userId: string): void {
    const tree = this.trees.get(userId);
    if (!tree) return;

    try {
      const filePath = this.treePath(userId);
      fs.writeFileSync(filePath, JSON.stringify(tree, null, 2), 'utf-8');
    } catch {
      // Silent fail
    }
  }

  private flushIfNeeded(): void {
    if (this.dirty.size >= 5) {
      this.flushAll();
    }
  }

  private loadFromDisk(userId: string): ConversationTree | null {
    try {
      const filePath = this.treePath(userId);
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ConversationTree;
      }
    } catch {
      // Corrupted — return null
    }
    return null;
  }

  private treePath(userId: string): string {
    const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    return path.join(this.storePath, `${safeId}.json`);
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.storePath)) {
        fs.mkdirSync(this.storePath, { recursive: true });
      }
    } catch {
      // Non-fatal
    }
  }
}
