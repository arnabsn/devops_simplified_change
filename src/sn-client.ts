import * as core from '@actions/core';

export interface ArtifactInput {
  name: string;
  version: string;
  repositoryName?: string;
  builtOn?: string;
}

export interface TestSummaryInput {
  total: number;
  passed: number;
  failed?: number;
  skipped?: number;
  duration?: number;
  toolName?: string;
}

export interface QualitySubcategory {
  subcategory: string;
  value?: string | number;
}

export interface QualityCategory {
  category: string;
  value?: string | number;
  subcategoryDetails?: QualitySubcategory[];
}

export interface QualityInput {
  scannerName: string;
  projectName: string;
  scanId?: string;
  scanUrl?: string;
  lastScanned?: string;
  shortDescription?: string;
  details?: QualityCategory[];
}

export interface PipelineRunInput {
  pipelineName: string;
  pipelineUrl?: string;
  executionUrl: string;
  buildNumber?: string;
  startTime?: string;
  endTime?: string;
  totalSteps: number;
  currentStep: number;
  buildTestPassingPercent?: number;
  failedStepName?: string;
}

export interface CommitInput {
  sha: string;
  message?: string;
  author?: string;
  timestamp?: string;
  url?: string;
}

export interface ChangeReferenceInput {
  dataType?: string;
  dataValues: string[];
  initiatedBy?: string;
  changeAttributes: {
    ciName?: string;
    changeType?: string;
    description?: string;
  };
  additionalEvidence?: {
    testSummaries?: string[];
    qualitySummaries?: string[];
    pipelineExecutions?: string[];
    commits?: string[];
  };
}

export interface ChangeReferenceResult {
  changeNumber: string;
  changeSysId: string;
  packageSysId: string;
  changeReferenceSysId: string;
  linked: Record<string, number>;
  warnings: string[];
}

export interface ChangeStateResult {
  changeNumber: string;
  changeSysId: string;
  state: string;
  stateDisplayValue: string;
  approval: string;
  approvalDisplayValue: string;
}

export class SNClient {
  private readonly base: string;
  private readonly authHeader: string;

  constructor(instance: string, username: string, password: string) {
    const host = instance.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.base = `https://${host}`;
    this.authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  private async post<TIn, TOut>(path: string, payload: TIn): Promise<TOut> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return this.parse<TOut>(res, path);
  }

  private async get<TOut>(path: string): Promise<TOut> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'GET',
      headers: { 'Authorization': this.authHeader, 'Accept': 'application/json' }
    });
    return this.parse<TOut>(res, path);
  }

  private async parse<TOut>(res: Response, path: string): Promise<TOut> {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`SN ${path} failed: ${res.status} — ${text}`);
    }
    let json: { result?: TOut } & TOut;
    try {
      json = text ? JSON.parse(text) : ({} as { result?: TOut } & TOut);
    } catch (e) {
      throw new Error(`SN ${path} returned non-JSON: ${text.slice(0, 200)}`);
    }
    // ServiceNow scripted REST APIs typically wrap the body in `result`.
    return (json.result ?? json) as TOut;
  }

  pushArtifact(input: ArtifactInput) {
    core.debug(`POST /agent/artifact ${input.name}@${input.version}`);
    return this.post<ArtifactInput, { artifactSysId: string; artifactVersionSysId: string }>(
      '/api/sn_devops/v1/agent/artifact',
      input
    );
  }

  pushTestResults(input: TestSummaryInput) {
    core.debug(`POST /agent/test-results total=${input.total} passed=${input.passed}`);
    return this.post<TestSummaryInput, { testSummarySysId: string }>(
      '/api/sn_devops/v1/agent/test-results',
      input
    );
  }

  pushQuality(input: QualityInput) {
    core.debug(`POST /agent/quality scanner=${input.scannerName}`);
    return this.post<QualityInput, { qualitySummarySysId: string; detailsCreated: number; subdetailsCreated: number }>(
      '/api/sn_devops/v1/agent/quality',
      input
    );
  }

  pushPipelineRun(input: PipelineRunInput) {
    core.debug(`POST /agent/pipeline-run ${input.pipelineName}`);
    return this.post<PipelineRunInput, { pipelineSysId: string; pipelineExecutionSysId: string }>(
      '/api/sn_devops/v1/agent/pipeline-run',
      input
    );
  }

  pushCommits(commits: CommitInput[]) {
    core.debug(`POST /agent/commits count=${commits.length}`);
    return this.post<CommitInput[], { commitSysIds: string[]; skipped: number }>(
      '/api/sn_devops/v1/agent/commits',
      commits
    );
  }

  createChange(input: ChangeReferenceInput) {
    core.debug(`POST /agent/change-reference ci=${input.changeAttributes.ciName ?? '-'}`);
    return this.post<ChangeReferenceInput, ChangeReferenceResult>(
      '/api/sn_devops/v1/agent/change-reference',
      input
    );
  }

  getChangeState(changeId: string) {
    return this.get<ChangeStateResult>(`/api/sn_devops/v1/agent/change/${encodeURIComponent(changeId)}/state`);
  }
}
