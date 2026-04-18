// ─── Observable Mission Control Metrics & Observability ───
// Enhanced mission control with detailed metrics, tracing, and observability.
// Provides real-time visibility into agent behavior, performance, and anomalies.
// Follows agentforge pattern: instrument everything, expose metrics, enable debugging.

import { v4 as uuid } from 'uuid';

export interface MetricPoint {
  timestamp: string;
  value: number;
  tags?: Record<string, string>;
}

export interface TraceSpan {
  id: string;
  parent_id?: string;
  name: string;
  start_time: string;
  end_time?: string;
  duration_ms?: number;
  status: 'pending' | 'success' | 'error';
  attributes?: Record<string, unknown>;
  events?: Array<{ name: string; timestamp: string; attributes?: Record<string, unknown> }>;
}

export interface AnomalyAlert {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  message: string;
  affected_metric: string;
  threshold: number;
  current_value: number;
  timestamp: string;
  resolved_at?: string;
}

export interface ObservabilityMetrics {
  request_latency_p50_ms: number;
  request_latency_p99_ms: number;
  error_rate: number; // 0-1
  active_agents: number;
  queued_tasks: number;
  agent_success_rate: number; // 0-1
  token_usage_total: number;
  cost_usd_total: number;
  memory_usage_mb: number;
  uptime_seconds: number;
}

export class MissionControlObservability {
  private metrics = new Map<string, MetricPoint[]>();
  private traces = new Map<string, TraceSpan>();
  private activeTraces = new Map<string, TraceSpan>();
  private anomalies: AnomalyAlert[] = [];
  private requestLatencies: number[] = [];
  private startTime = Date.now();

  private thresholds = {
    latency_p99_ms: 5000,
    error_rate: 0.1,
    memory_usage_mb: 500,
  };

  // ─── Record metric ───
  recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push({
      timestamp: new Date().toISOString(),
      value,
      tags,
    });

    // Prune old metrics (keep last 1000 per metric)
    const history = this.metrics.get(name)!;
    if (history.length > 1000) {
      this.metrics.set(name, history.slice(-1000));
    }

    // Check for anomalies
    this.checkAnomaly(name, value);
  }

  // ─── Record request latency ───
  recordLatency(latencyMs: number): void {
    this.requestLatencies.push(latencyMs);
    this.recordMetric('request_latency_ms', latencyMs);

    // Keep rolling window
    if (this.requestLatencies.length > 1000) {
      this.requestLatencies.shift();
    }
  }

  // ─── Start trace span ───
  startSpan(name: string, parentId?: string): string {
    const spanId = `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const span: TraceSpan = {
      id: spanId,
      parent_id: parentId,
      name,
      start_time: new Date().toISOString(),
      status: 'pending',
    };
    this.activeTraces.set(spanId, span);
    return spanId;
  }

  // ─── End trace span ───
  endSpan(spanId: string, status: 'success' | 'error' = 'success', attributes?: Record<string, unknown>): void {
    const span = this.activeTraces.get(spanId);
    if (span) {
      span.end_time = new Date().toISOString();
      span.duration_ms = new Date(span.end_time).getTime() - new Date(span.start_time).getTime();
      span.status = status;
      span.attributes = attributes;

      this.activeTraces.delete(spanId);
      this.traces.set(spanId, span);

      // Keep rolling window of traces
      if (this.traces.size > 5000) {
        const firstKey = this.traces.keys().next().value as string | undefined;
        if (firstKey) {
          this.traces.delete(firstKey);
        }
      }

      this.recordMetric('span_duration_ms', span.duration_ms ?? 0, { span_name: span.name || 'unknown' } as Record<string, string>);
    }
  }

  // ─── Add event to span ───
  addSpanEvent(spanId: string, eventName: string, attributes?: Record<string, unknown>): void {
    const span = this.activeTraces.get(spanId) || this.traces.get(spanId);
    if (span) {
      if (!span.events) span.events = [];
      span.events.push({
        name: eventName,
        timestamp: new Date().toISOString(),
        attributes,
      });
    }
  }

  // ─── Check for anomalies ───
  private checkAnomaly(metricName: string, value: number): void {
    let alertTriggered = false;
    let threshold = 0;

    if (metricName === 'request_latency_ms' && value > this.thresholds.latency_p99_ms) {
      alertTriggered = true;
      threshold = this.thresholds.latency_p99_ms ?? 5000;
    }

    if (metricName === 'error_rate' && value > this.thresholds.error_rate) {
      alertTriggered = true;
      threshold = this.thresholds.error_rate;
    }

    if (metricName === 'memory_usage_mb' && value > this.thresholds.memory_usage_mb) {
      alertTriggered = true;
      threshold = this.thresholds.memory_usage_mb;
    }

    if (alertTriggered) {
      const alert: AnomalyAlert = {
        id: uuid(),
        severity: value > threshold * 2 ? 'critical' : value > threshold * 1.5 ? 'high' : 'medium',
        type: `ANOMALY_${metricName.toUpperCase()}`,
        message: `Metric ${metricName} exceeded threshold: ${value} > ${threshold}`,
        affected_metric: metricName,
        threshold,
        current_value: value,
        timestamp: new Date().toISOString(),
      };
      this.anomalies.push(alert);

      // Keep rolling window
      if (this.anomalies.length > 100) {
        this.anomalies.shift();
      }
    }
  }

  // ─── Compute aggregated metrics ───
  getMetrics(): ObservabilityMetrics {
    const p50 = this.percentile(this.requestLatencies, 50);
    const p99 = this.percentile(this.requestLatencies, 99);
    const uptime = (Date.now() - this.startTime) / 1000;

    return {
      request_latency_p50_ms: Math.round(p50),
      request_latency_p99_ms: Math.round(p99),
      error_rate: this.computeErrorRate(),
      active_agents: this.metrics.get('active_agents')?.[this.metrics.get('active_agents')!.length - 1]?.value ?? 0,
      queued_tasks: this.metrics.get('queued_tasks')?.[this.metrics.get('queued_tasks')!.length - 1]?.value ?? 0,
      agent_success_rate: this.computeSuccessRate(),
      token_usage_total: this.sumMetric('tokens_used'),
      cost_usd_total: this.sumMetric('cost_usd'),
      memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      uptime_seconds: Math.round(uptime),
    };
  }

  // ─── Get traces for debugging ───
  getTraces(limit: number = 100, filter?: { span_name?: string; status?: string }): TraceSpan[] {
    let traces = Array.from(this.traces.values());

    if (filter?.span_name) {
      traces = traces.filter(t => t.name.includes(filter.span_name!));
    }
    if (filter?.status) {
      traces = traces.filter(t => t.status === filter.status);
    }

    return traces.slice(-limit);
  }

  // ─── Get unresolved anomalies ───
  getAnomalies(): AnomalyAlert[] {
    return this.anomalies.filter(a => !a.resolved_at);
  }

  // ─── Resolve anomaly ───
  resolveAnomaly(anomalyId: string): void {
    const anomaly = this.anomalies.find(a => a.id === anomalyId);
    if (anomaly) {
      anomaly.resolved_at = new Date().toISOString();
    }
  }

  // ─── Helper: percentile ───
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // ─── Helper: compute error rate ───
  private computeErrorRate(): number {
    const errorMetrics = this.metrics.get('errors_total')?.slice(-100) ?? [];
    const totalMetrics = this.metrics.get('requests_total')?.slice(-100) ?? [];
    if (totalMetrics.length === 0) return 0;
    const recentErrors = errorMetrics[errorMetrics.length - 1]?.value ?? 0;
    const recentTotal = totalMetrics[totalMetrics.length - 1]?.value ?? 1;
    return recentTotal > 0 ? recentErrors / recentTotal : 0;
  }

  // ─── Helper: compute success rate ───
  private computeSuccessRate(): number {
    const successMetrics = this.metrics.get('tasks_succeeded')?.slice(-100) ?? [];
    const totalMetrics = this.metrics.get('tasks_total')?.slice(-100) ?? [];
    if (totalMetrics.length === 0) return 1;
    const recentSuccess = successMetrics[successMetrics.length - 1]?.value ?? 0;
    const recentTotal = totalMetrics[totalMetrics.length - 1]?.value ?? 1;
    return recentTotal > 0 ? recentSuccess / recentTotal : 1;
  }

  // ─── Helper: sum metric values ───
  private sumMetric(name: string): number {
    const history = this.metrics.get(name) ?? [];
    return history.reduce((sum, p) => sum + p.value, 0);
  }
}
