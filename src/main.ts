import * as core from '@actions/core';
import * as fs from 'fs';
import {
  SNClient,
  ArtifactInput,
  CommitInput,
  QualityInput
} from './sn-client';
import { parseJUnit } from './evidence/junit';
import { collectSonar } from './evidence/sonar';
import { collectSecurity } from './evidence/security';
import { collectCommitsAuto } from './evidence/git';
import { setCommitStatus } from './github-status';

interface RunInputs {
  instance: string;
  clientId: string;
  clientSecret: string;
  artifacts: ArtifactInput[];
  testResultsPath?: string;
  sonarProjectKey?: string;
  sonarHostUrl?: string;
  sonarToken?: string;
  securityScanner?: string;
  securityResultsPath?: string;
  commitsRaw: string;
  ci: string;
  changeType: string;
  changeDescription?: string;
  blockUntilApproved: boolean;
  approvalTimeoutSeconds: number;
  pollIntervalSeconds: number;
  githubToken?: string;
}

function readInputs(): RunInputs {
  return {
    instance: core.getInput('sn-instance', { required: true }),
    clientId: core.getInput('sn-client-id', { required: true }),
    clientSecret: core.getInput('sn-client-secret', { required: true }),
    artifacts: JSON.parse(core.getInput('artifacts', { required: true })) as ArtifactInput[],
    testResultsPath: core.getInput('test-results') || undefined,
    sonarProjectKey: core.getInput('sonar-project-key') || undefined,
    sonarHostUrl: core.getInput('sonar-host-url') || process.env.SONAR_HOST_URL || undefined,
    sonarToken: core.getInput('sonar-token') || process.env.SONAR_TOKEN || undefined,
    securityScanner: core.getInput('security-scanner') || undefined,
    securityResultsPath: core.getInput('security-results') || undefined,
    commitsRaw: core.getInput('commits') || 'auto',
    ci: core.getInput('ci', { required: true }),
    changeType: core.getInput('change-type') || 'normal',
    changeDescription: core.getInput('change-description') || undefined,
    blockUntilApproved: (core.getInput('block-until-approved') || 'true').toLowerCase() === 'true',
    approvalTimeoutSeconds: parseInt(core.getInput('approval-timeout-seconds') || '3600', 10),
    pollIntervalSeconds: parseInt(core.getInput('poll-interval-seconds') || '30', 10),
    githubToken: core.getInput('github-token') || process.env.GITHUB_TOKEN || undefined
  };
}

async function run(): Promise<void> {
  const inputs = readInputs();
  const sn = new SNClient(inputs.instance, inputs.clientId, inputs.clientSecret);

  // Step 1: artifacts (push every entry — keep first as primary)
  const artifactVersionSysIds: string[] = [];
  for (const a of inputs.artifacts) {
    const r = await sn.pushArtifact(a);
    artifactVersionSysIds.push(r.artifactVersionSysId);
    core.info(`Artifact ${a.name}@${a.version} → ${r.artifactVersionSysId}`);
  }
  if (!artifactVersionSysIds.length) throw new Error('At least one artifact required');

  // Step 2: tests
  let testSummarySysId: string | undefined;
  if (inputs.testResultsPath && fs.existsSync(inputs.testResultsPath)) {
    const summary = parseJUnit(inputs.testResultsPath, 'JUnit');
    const r = await sn.pushTestResults(summary);
    testSummarySysId = r.testSummarySysId;
    core.info(`Tests ${summary.passed}/${summary.total} passed → ${testSummarySysId}`);
  } else if (inputs.testResultsPath) {
    core.warning(`test-results path not found: ${inputs.testResultsPath}`);
  }

  // Step 3: sonar
  const qualitySysIds: string[] = [];
  if (inputs.sonarProjectKey) {
    if (!inputs.sonarHostUrl || !inputs.sonarToken) {
      core.warning('sonar-project-key set but sonar-host-url or sonar-token missing — skipping Sonar');
    } else {
      const sonarPayload: QualityInput = await collectSonar({
        hostUrl: inputs.sonarHostUrl,
        token: inputs.sonarToken,
        projectKey: inputs.sonarProjectKey
      });
      const r = await sn.pushQuality(sonarPayload);
      qualitySysIds.push(r.qualitySummarySysId);
      core.info(`Sonar quality → ${r.qualitySummarySysId}`);
    }
  }

  // Step 4: security
  if (inputs.securityScanner && inputs.securityResultsPath) {
    if (!fs.existsSync(inputs.securityResultsPath)) {
      core.warning(`security-results path not found: ${inputs.securityResultsPath}`);
    } else {
      const secPayload = collectSecurity({
        scanner: inputs.securityScanner,
        resultsPath: inputs.securityResultsPath,
        projectName: inputs.artifacts[0].name
      });
      const r = await sn.pushQuality(secPayload);
      qualitySysIds.push(r.qualitySummarySysId);
      core.info(`Security ${inputs.securityScanner} → ${r.qualitySummarySysId}`);
    }
  }

  // Step 5: commits
  let commits: CommitInput[] = [];
  if (inputs.commitsRaw === 'auto') {
    const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
    const repo = process.env.GITHUB_REPOSITORY || '';
    if (repo) commits = collectCommitsAuto(serverUrl, repo);
  } else {
    try {
      commits = JSON.parse(inputs.commitsRaw) as CommitInput[];
    } catch {
      core.warning('commits input not "auto" and not valid JSON — skipping');
    }
  }
  let commitSysIds: string[] = [];
  if (commits.length) {
    const r = await sn.pushCommits(commits);
    commitSysIds = r.commitSysIds;
    core.info(`Commits pushed: ${commitSysIds.length}`);
  }

  // Step 6: pipeline run
  const runId = process.env.GITHUB_RUN_ID;
  const pipelineExec = await sn.pushPipelineRun({
    pipelineName: process.env.GITHUB_WORKFLOW || 'unknown-workflow',
    executionUrl:
      runId && process.env.GITHUB_REPOSITORY
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`
        : 'unknown',
    buildNumber: process.env.GITHUB_RUN_NUMBER,
    totalSteps: 0,
    currentStep: 0,
    startTime: new Date().toISOString()
  });
  core.info(`Pipeline run → ${pipelineExec.pipelineExecutionSysId}`);

  // Step 7: change-reference
  const change = await sn.createChange({
    dataType: 'sn_devops_artifact_version',
    dataValues: artifactVersionSysIds,
    initiatedBy: 'pipeline',
    changeAttributes: {
      ciName: inputs.ci,
      changeType: inputs.changeType,
      description: inputs.changeDescription || `Pipeline change for ${inputs.ci}`
    },
    additionalEvidence: {
      testSummaries: testSummarySysId ? [testSummarySysId] : [],
      qualitySummaries: qualitySysIds,
      pipelineExecutions: [pipelineExec.pipelineExecutionSysId],
      commits: commitSysIds
    }
  });

  core.info(`Change ${change.changeNumber} created (sys_id ${change.changeSysId})`);
  if (change.warnings.length) for (const w of change.warnings) core.warning(w);

  core.setOutput('change-number', change.changeNumber);
  core.setOutput('change-sys-id', change.changeSysId);

  // Step 8: poll
  let status: 'approved' | 'rejected' | 'timeout' | 'created' = 'created';
  if (inputs.blockUntilApproved) {
    status = await pollUntilDecided(sn, change.changeNumber, inputs);
  }
  core.setOutput('change-status', status);

  // Step 9: GitHub commit status
  await maybeSetGithubStatus(inputs, change.changeNumber, status);

  if (status === 'rejected' || status === 'timeout') {
    core.setFailed(`Change ${change.changeNumber} ${status}`);
  }
}

async function pollUntilDecided(
  sn: SNClient,
  changeId: string,
  inputs: RunInputs
): Promise<'approved' | 'rejected' | 'timeout'> {
  const deadline = Date.now() + inputs.approvalTimeoutSeconds * 1000;
  const intervalMs = inputs.pollIntervalSeconds * 1000;

  while (Date.now() < deadline) {
    const s = await sn.getChangeState(changeId);
    const approval = (s.approval || '').toLowerCase();
    core.info(`Poll ${changeId}: state=${s.stateDisplayValue} approval=${s.approvalDisplayValue}`);

    if (approval === 'approved') return 'approved';
    if (approval === 'rejected') return 'rejected';
    if (s.state === 'cancelled' || s.state === 'closed') return 'rejected';

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return 'timeout';
}

async function maybeSetGithubStatus(
  inputs: RunInputs,
  changeNumber: string,
  status: string
): Promise<void> {
  if (!inputs.githubToken) {
    core.info('No github-token — skipping commit status update');
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  if (!repo || !sha) {
    core.info('GITHUB_REPOSITORY or GITHUB_SHA missing — skipping commit status');
    return;
  }
  const [owner, name] = repo.split('/');
  const stateMap: Record<string, 'success' | 'failure' | 'pending'> = {
    approved: 'success',
    rejected: 'failure',
    timeout: 'failure',
    created: 'pending'
  };
  const ghState = stateMap[status] ?? 'pending';
  const host = inputs.instance.replace(/^https?:\/\//, '').replace(/\/$/, '');
  await setCommitStatus({
    token: inputs.githubToken,
    owner,
    repo: name,
    sha,
    state: ghState,
    context: 'servicenow/change-gate',
    description: `${changeNumber} ${status}`,
    targetUrl: `https://${host}/nav_to.do?uri=change_request.do?sysparm_query=number=${changeNumber}`
  });
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  core.setFailed(msg);
});
