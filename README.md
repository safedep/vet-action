# SafeDep GitHub Action

<!-- markdownlint-disable MD033 -->

> Created and maintained by
> <b><a href="https://safedep.io/">https://safedep.io</a></b> with contributions
> from the community 🚀

<!-- markdownlint-enable MD033 -->

![CodeQL Analysis](https://github.com/safedep/vet-action/actions/workflows/codeql-analysis.yml/badge.svg)
![Continue Integration](https://github.com/safedep/vet-action/actions/workflows/ci.yml/badge.svg)
![vet OSS Components](https://github.com/safedep/vet-action/actions/workflows/vet.yml/badge.svg)

GitHub Action for integrating [vet](https://github.com/safedep/vet) in your
workflow. Provides active protection against vulnerable, outdated, unpopular and
malicious OSS dependencies using policy as code based guardrails.

![Example Screenshot](./docs/assets/vet-action-malysis-1.png)

## Usage

> Follow [setup instructions](#setup-instructions) for step by step guide on how
> to integrate `vet` in your GitHub repository with customizable policies

### Quick Start

> Follow _quickstart_ if you want to integrate `vet` as a step in your existing
> GitHub actions workflow. Look at [Setup Instructions](#setup-instructions) for
> step by step guide on how to integrate `vet` in your GitHub repository

TLDR; add this GitHub action to vet your changed dependencies during pull
request

```yaml
- name: Run vet
  id: vet
  permissions:
    contents: read
    issues: write
    pull-requests: write
  uses: safedep/vet-action@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The output of `vet-action` is a
[SARIF](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) report
that can be uploaded to GitHub Code Scanning

> **Note**: `upload-sarif` action requires GitHub Code Scanning to be enabled.
> This is available for public repositories and for private repositories with
> GitHub Advanced Security enabled.

```yaml
- name: Upload SARIF
  permissions:
    contents: read
    security-events: write
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: ${{ steps.vet.outputs.report }}
    category: vet
```

### Setup Instructions

> Follow this instruction to integrate `vet` as a GitHub action in your GitHub
> repository

- Go to the root directory of your GitHub repository
- Create the workflow and policy directory

```bash
mkdir -p .github/workflows .github/vet
```

- Download the policy file into the policy directory

```bash
curl -o .github/vet/policy.yml -L https://raw.githubusercontent.com/safedep/vet-action/main/example/policy.yml
```

- Download `vet` GitHub Action workflow

```bash
curl -o .github/workflows/vet-ci.yml -L https://raw.githubusercontent.com/safedep/vet-action/main/example/vet-ci.yml
```

- Review the policy file in `.github/vet/policy.yml` and edit as required
- Push / PR your changes into the repository

## Cloud Mode

<!-- markdownlint-disable MD013 -->

`vet-action` provides integration with
[SafeDep Cloud](https://docs.safedep.io/cloud). By leveraging SafeDep Cloud,
`vet` and `vet-action` provides additional services such as
[Malicious Package Analysis](https://docs.safedep.io/cloud/malware-analysis).

<!-- markdownlint-enable MD013 -->

To use SafeDep Cloud integration, you need

- SafeDep Cloud Tenant Domain (e.g. `default-team.example-org.safedep.io`)
- SafeDep Cloud API Key (e.g. `sfd_01234567890abcdefghijk`)

Refer to [SafeDep Cloud Quickstart](https://docs.safedep.io/cloud/quickstart)
guide on getting the required information for activating cloud integration.

## Configuration

`vet-action` accepts following additional configuration for customizing how
`vet` is invoked during scan

<!-- markdownlint-disable MD013 -->

| GitHub Action Input     | Example Value                         | Notes                                                         |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------- |
| `policy`                | `policies/sample.yml`                 | Path to `vet` YAML policy file (filter suite)                 |
| `exception-file`        | `config/exceptions.yml`               | Path to `vet` exception YAML file                             |
| `trusted-registries`    | `https://r1.org, https://r2.org`      | `,` separated string of registry base URLs                    |
| `timeout`               | `300`                                 | Max time in seconds to wait for external services             |
| `cloud`                 | `true`                                | Enable integration with SafeDep Cloud                         |
| `cloud-tenant`          | `default-team.example-org.safedep.io` | SafeDep Cloud Tenant Domain                                   |
| `cloud-key`             | `sfd_xxxx`                            | SafeDep Cloud API Key                                         |
| `upload-sarif`          | `true`                                | Upload SARIF report as artifact on push                       |
| `add-step-summary`      | `true`                                | Add job step summary report on push                           |
| `enable-comments-proxy` | `false`                               | Enable Comments Proxy Server to create comments on GitHub PRs |

- Refer to [vet policy as code](https://docs.safedep.io/advanced/polic-as-code)
  for details on `policy` format
- Refer to [vet exceptions](https://docs.safedep.io/advanced/exceptions) for
details on `exception-file` format
<!-- markdownlint-enable MD013 -->

### Comments Proxy Server

The `enable-comments-proxy` configuration can be used to enable Comments Proxy
Server to create comments on GitHub PRs. This is required when the action is
invoked in a PR from a forked repository due to limitation on `$GITHUB_TOKEN`.
See [ghcp](https://github.com/safedep/ghcp) for more details.

**SECURITY NOTE**: Comments proxy uses `$GITHUB_TOKEN` for authentication to
verify the request is from a GitHub Actions workflow associated with the
repository. When enable, `vet-action` will call Comments Proxy Server with
`$GITHUB_TOKEN` available in the workflow. This will be used _ONLY_ when
`vet-action` fails to call GitHub API due to the limitation on `$GITHUB_TOKEN`.

### Trusted Registries

The `trusted-registries` configuration can be used to add specific registry URLs
into allow list while checking for lockfile inconsistencies. Example:

```yaml
trusted-registries: |
  https://registry.npmjs.org/strip-ansi
  https://registry.npmjs.org/string-width
  https://private.self-hosted.local
```

## Support

- Raise issues related to GitHub Action at
  [https://github.com/safedep/vet-action/issues](https://github.com/safedep/vet-action/issues)
- Raise issues related to `vet` tool at
  [https://github.com/safedep/vet/issues](https://github.com/safedep/vet/issues)

## Development

Refer to [development documentation](docs/development.md)
