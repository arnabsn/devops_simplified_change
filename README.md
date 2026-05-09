# servicenow/devops-change-action

GitHub Action that collects pipeline evidence (artifact, tests, quality scan, security scan, commits, pipeline run), pushes it to ServiceNow DevOps, creates a `change_request` with the evidence package attached, and blocks the workflow until the change is approved or rejected.

## Usage

```yaml
- uses: servicenow/devops-change-action@v1
  with:
    sn-instance: ${{ secrets.SN_INSTANCE }}
    sn-username: ${{ secrets.SN_USERNAME }}
    sn-password: ${{ secrets.SN_PASSWORD }}
    artifacts: '[{"name":"payment-service","version":"${{ github.sha }}"}]'
    test-results: junit.xml
    sonar-project-key: my-org_payment-service
    sonar-host-url: https://sonar.example.com
    sonar-token: ${{ secrets.SONAR_TOKEN }}
    security-scanner: snyk
    security-results: snyk.json
    ci: payment-service-api
    block-until-approved: 'true'
    approval-timeout-seconds: '3600'
```

## Outputs

- `change-number` — `CHG0087423`
- `change-sys-id` — 32-char sys_id
- `change-status` — `approved | rejected | timeout | created`

## How it works

1. Parse inputs (artifacts JSON, JUnit XML, Sonar/Snyk results, git log).
2. Push evidence to SN: `/agent/artifact`, `/agent/test-results`, `/agent/quality`, `/agent/pipeline-run`, `/agent/commits`.
3. Create change with attached evidence: `/agent/change-reference`.
4. Poll `/agent/change/{id}/state` until `approval = approved | rejected` or timeout.
5. Set GitHub commit status `servicenow/change-gate` → `success | failure`.
