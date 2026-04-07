// ─── PAW Deep Research Engine ───
// Multi-step web research with source synthesis, citations, and structured reports.
// Inspired by OpenAI's o3-deep-research but provider-agnostic.

import { v4 as uuid } from 'uuid';

// ─── Types ───

export type ResearchDepth = 'quick' | 'standard' | 'deep' | 'exhaustive';

export interface ResearchQuery {
  topic: string;
  depth: ResearchDepth;
  focus?: string[];
  excludeSources?: string[];
  maxSources?: number;
  outputFormat?: 'report' | 'bullets' | 'json';
  language?: string;
}

export interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  relevanceScore: number;
  fetchedAt: string;
  contentLength?: number;
}

export interface ResearchCitation {
  id: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  pageSection?: string;
}

export interface ResearchSection {
  heading: string;
  content: string;
  citations: ResearchCitation[];
  confidence: number;
}

export interface ResearchReport {
  id: string;
  query: ResearchQuery;
  title: string;
  summary: string;
  sections: ResearchSection[];
  sources: ResearchSource[];
  citations: ResearchCitation[];
  methodology: string;
  totalSourcesConsulted: number;
  depth: ResearchDepth;
  duration_ms: number;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ResearchStep {
  step: number;
  action: 'search' | 'fetch' | 'analyze' | 'synthesize' | 'refine';
  query?: string;
  url?: string;
  result?: string;
  duration_ms: number;
}

// ─── Search + Fetch Adapters ───

export type SearchAdapter = (query: string, maxResults: number) => Promise<ResearchSource[]>;
export type FetchAdapter = (url: string) => Promise<{ content: string; title: string }>;
export type LLMAdapter = (systemPrompt: string, userPrompt: string) => Promise<string>;

// ─── Depth Configuration ───

const DEPTH_CONFIG: Record<ResearchDepth, { maxSearches: number; maxSources: number; refinementRounds: number }> = {
  quick: { maxSearches: 2, maxSources: 5, refinementRounds: 0 },
  standard: { maxSearches: 5, maxSources: 15, refinementRounds: 1 },
  deep: { maxSearches: 10, maxSources: 30, refinementRounds: 2 },
  exhaustive: { maxSearches: 20, maxSources: 50, refinementRounds: 3 },
};

// ─── Research Engine ───

export class DeepResearchEngine {
  private searchAdapter: SearchAdapter;
  private fetchAdapter: FetchAdapter;
  private llmAdapter: LLMAdapter;
  private steps: ResearchStep[] = [];
  private verbose: boolean;

  constructor(
    searchAdapter: SearchAdapter,
    fetchAdapter: FetchAdapter,
    llmAdapter: LLMAdapter,
    verbose?: boolean,
  ) {
    this.searchAdapter = searchAdapter;
    this.fetchAdapter = fetchAdapter;
    this.llmAdapter = llmAdapter;
    this.verbose = verbose ?? false;
  }

  async research(query: ResearchQuery): Promise<ResearchReport> {
    const startTime = Date.now();
    const id = uuid();
    this.steps = [];
    const depthCfg = DEPTH_CONFIG[query.depth];
    const allSources: ResearchSource[] = [];
    const allCitations: ResearchCitation[] = [];

    this.log(`[Research] Starting "${query.topic}" at ${query.depth} depth`);

    // ─── Phase 1: Generate Search Queries ───
    const searchQueries = await this.generateSearchQueries(query, depthCfg.maxSearches);
    this.log(`[Research] Generated ${searchQueries.length} search queries`);

    // ─── Phase 2: Execute Searches ───
    for (const sq of searchQueries) {
      const stepStart = Date.now();
      try {
        const results = await this.searchAdapter(sq, Math.ceil(depthCfg.maxSources / searchQueries.length));
        allSources.push(...results);
        this.steps.push({ step: this.steps.length + 1, action: 'search', query: sq, duration_ms: Date.now() - stepStart });
      } catch (err) {
        this.log(`[Research] Search failed for "${sq}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Deduplicate sources
    const uniqueSources = this.deduplicateSources(allSources, query.maxSources ?? depthCfg.maxSources);
    this.log(`[Research] Found ${uniqueSources.length} unique sources`);

    // ─── Phase 3: Fetch Top Sources ───
    const fetchedContent: { source: ResearchSource; content: string }[] = [];
    const topSources = uniqueSources.slice(0, Math.min(uniqueSources.length, 10));

    for (const source of topSources) {
      const stepStart = Date.now();
      try {
        const { content } = await this.fetchAdapter(source.url);
        fetchedContent.push({ source, content: content.slice(0, 5000) }); // Cap per-source content
        this.steps.push({ step: this.steps.length + 1, action: 'fetch', url: source.url, duration_ms: Date.now() - stepStart });
      } catch {
        this.log(`[Research] Fetch failed for ${source.url}`);
      }
    }

    // ─── Phase 4: Analyze and Extract ───
    const stepStart = Date.now();
    const analysis = await this.analyzeContent(query, fetchedContent);
    this.steps.push({ step: this.steps.length + 1, action: 'analyze', result: analysis.slice(0, 200), duration_ms: Date.now() - stepStart });

    // ─── Phase 5: Synthesize Report ───
    const synthStart = Date.now();
    const reportContent = await this.synthesizeReport(query, analysis, fetchedContent, uniqueSources);
    this.steps.push({ step: this.steps.length + 1, action: 'synthesize', duration_ms: Date.now() - synthStart });

    // ─── Phase 6: Refinement Rounds ───
    let refinedContent = reportContent;
    for (let i = 0; i < depthCfg.refinementRounds; i++) {
      const refineStart = Date.now();
      refinedContent = await this.refineReport(query, refinedContent, fetchedContent);
      this.steps.push({ step: this.steps.length + 1, action: 'refine', duration_ms: Date.now() - refineStart });
      this.log(`[Research] Refinement round ${i + 1} complete`);
    }

    // ─── Build Structured Report ───
    const sections = this.parseReportSections(refinedContent, uniqueSources, allCitations);
    const summary = await this.generateSummary(query, refinedContent);

    const report: ResearchReport = {
      id,
      query,
      title: `Research Report: ${query.topic}`,
      summary,
      sections,
      sources: uniqueSources,
      citations: allCitations,
      methodology: `Conducted ${this.steps.filter(s => s.action === 'search').length} web searches, fetched ${fetchedContent.length} sources, performed ${depthCfg.refinementRounds} refinement rounds.`,
      totalSourcesConsulted: allSources.length,
      depth: query.depth,
      duration_ms: Date.now() - startTime,
      createdAt: new Date().toISOString(),
      metadata: { steps: this.steps },
    };

    this.log(`[Research] Complete — ${report.sections.length} sections, ${report.sources.length} sources, ${report.duration_ms}ms`);
    return report;
  }

  // ─── Query Generation ───

  private async generateSearchQueries(query: ResearchQuery, maxQueries: number): Promise<string[]> {
    const systemPrompt = `You are a research query generator. Given a topic, generate ${maxQueries} diverse search queries that would comprehensively cover the topic. Return ONLY a JSON array of strings.`;
    const userPrompt = `Topic: ${query.topic}${query.focus ? `\nFocus areas: ${query.focus.join(', ')}` : ''}`;

    try {
      const response = await this.llmAdapter(systemPrompt, userPrompt);
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const queries = JSON.parse(match[0]) as string[];
        return queries.slice(0, maxQueries);
      }
    } catch {
      // Fallback
    }

    // Fallback: generate basic variations
    return [
      query.topic,
      `${query.topic} latest developments`,
      `${query.topic} analysis`,
    ].slice(0, maxQueries);
  }

  // ─── Content Analysis ───

  private async analyzeContent(
    query: ResearchQuery,
    content: { source: ResearchSource; content: string }[],
  ): Promise<string> {
    const systemPrompt = `You are a research analyst. Analyze the following source materials about "${query.topic}" and extract key findings, data points, trends, and insights. Organize them thematically.`;

    const contentSummary = content.map((c, i) =>
      `[Source ${i + 1}: ${c.source.title}]\n${c.content.slice(0, 2000)}`
    ).join('\n\n---\n\n');

    return this.llmAdapter(systemPrompt, contentSummary);
  }

  // ─── Report Synthesis ───

  private async synthesizeReport(
    query: ResearchQuery,
    analysis: string,
    content: { source: ResearchSource; content: string }[],
    sources: ResearchSource[],
  ): Promise<string> {
    const format = query.outputFormat ?? 'report';
    const sourceList = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n');

    const systemPrompt = `You are a research report writer. Create a comprehensive ${format} about "${query.topic}".
Rules:
- Use inline citations like [1], [2] referring to source numbers
- Include specific data, statistics, and quotes where available
- Structure with clear headings: ## Heading
- Be thorough, analytical, and evidence-based
- Each section should have a confidence indicator (high/medium/low)
${query.language ? `- Write in ${query.language}` : ''}`;

    const userPrompt = `ANALYSIS:\n${analysis}\n\nSOURCES:\n${sourceList}\n\nCreate the ${format} now.`;

    void content;
    return this.llmAdapter(systemPrompt, userPrompt);
  }

  // ─── Report Refinement ───

  private async refineReport(
    query: ResearchQuery,
    currentReport: string,
    content: { source: ResearchSource; content: string }[],
  ): Promise<string> {
    const systemPrompt = `You are a research editor. Review and improve the following research report about "${query.topic}".
Check for:
- Factual accuracy and consistency
- Missing important aspects
- Clarity and structure
- Proper citation usage
Return the improved report.`;

    void content;
    return this.llmAdapter(systemPrompt, `CURRENT REPORT:\n${currentReport}`);
  }

  // ─── Summary Generation ───

  private async generateSummary(query: ResearchQuery, report: string): Promise<string> {
    const systemPrompt = `Write a concise 2-3 paragraph executive summary of this research report about "${query.topic}". Include the key findings and main conclusions.`;
    return this.llmAdapter(systemPrompt, report.slice(0, 4000));
  }

  // ─── Parse Sections ───

  private parseReportSections(report: string, sources: ResearchSource[], citations: ResearchCitation[]): ResearchSection[] {
    const sectionRegex = /##\s+(.+)\n([\s\S]*?)(?=##\s+|$)/g;
    const sections: ResearchSection[] = [];
    let match;

    while ((match = sectionRegex.exec(report)) !== null) {
      const heading = match[1].trim();
      const content = match[2].trim();

      // Extract citation references
      const citationRefs = [...content.matchAll(/\[(\d+)\]/g)];
      const sectionCitations: ResearchCitation[] = [];

      for (const ref of citationRefs) {
        const sourceIdx = parseInt(ref[1], 10) - 1;
        if (sourceIdx >= 0 && sourceIdx < sources.length) {
          const source = sources[sourceIdx];
          const citation: ResearchCitation = {
            id: uuid(),
            sourceUrl: source.url,
            title: source.title,
            excerpt: source.snippet,
            pageSection: heading,
          };
          sectionCitations.push(citation);
          citations.push(citation);
        }
      }

      sections.push({
        heading,
        content,
        citations: sectionCitations,
        confidence: sectionCitations.length >= 3 ? 0.9 : sectionCitations.length >= 1 ? 0.7 : 0.5,
      });
    }

    // If no sections parsed, create a single section
    if (sections.length === 0 && report.trim()) {
      sections.push({
        heading: 'Findings',
        content: report,
        citations: [],
        confidence: 0.6,
      });
    }

    return sections;
  }

  // ─── Deduplication ───

  private deduplicateSources(sources: ResearchSource[], max: number): ResearchSource[] {
    const seen = new Set<string>();
    const unique: ResearchSource[] = [];

    // Sort by relevance
    sources.sort((a, b) => b.relevanceScore - a.relevanceScore);

    for (const source of sources) {
      const domain = this.extractDomain(source.url);
      const key = `${domain}:${source.title.toLowerCase().slice(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(source);
      }
      if (unique.length >= max) break;
    }

    return unique;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private log(msg: string): void {
    if (this.verbose) console.log(msg);
  }

  getSteps(): ResearchStep[] {
    return [...this.steps];
  }
}
