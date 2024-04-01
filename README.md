# vet GitHub Action

[![GitHub Super-Linter](https://github.com/actions/typescript-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

[vet](https://github.com/safedep/vet) is a tool for finding security risks
in OSS components. For more details, refer to `vet` GitHub repository
[https://github.com/safedep/vet](https://github.com/safedep/vet)

## Usage

> Follow [setup instructions](#setup-instructions) for step by step guide
> on how to integrate `vet` in your GitHub repository with customizable policies

### Quick Start

> Follow *quickstart* if you want to integrate `vet` as a step in your
> existing GitHub actions workflow

TLDR; add this GitHub action to vet your changed dependencies during pull request

```yaml
- name: Run vet
  permissions:
    contents: read
    issues: write
    pull-requests: write
  uses: safedep/vet-action@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Setup Instructions

> Follow this instruction to integrate `vet` as a GitHub action in your
> GitHub repository

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

## Support

- Raise issues related to GitHub Action at [https://github.com/safedep/vet-action/issues](https://github.com/safedep/vet-action/issues)
- Raise issues related to `vet` tool at [https://github.com/safedep/vet/issues](https://github.com/safedep/vet/issues)

## Development

Refer to [development documentation](docs/development.md)
