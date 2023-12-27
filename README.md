# vet Github Action

[![GitHub Super-Linter](https://github.com/actions/typescript-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

## Usage

TLDR; add the vet action and upload the report to Github Security tab. For a full example, continue reading

```yaml
- name: Run vet
      id: vet
      uses: safedep/vet-action@v1
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Upload SARIF file
  uses: github/codeql-action/upload-sarif@v2
  with:
    sarif_file: ${{ steps.vet.outputs.report }}
    category: vet
```

Create a Github Action workflow in your repository at `.github/workflows/vet.yml` with the following content

```yaml
name: vet OSS Components

on:
  pull_request:
  push:
    branches:
      - main
      - master

permissions:
  contents: read
  issues: read
  security-events: write

jobs:
  scan:
    name: vet OSS Components
    runs-on: ubuntu-latest
    steps:
    - name: Checkout repository
      uses: actions/checkout@v4

    - name: Run vet
      id: vet
      uses: safedep/vet-action@v1

    - name: Upload SARIF file
      uses: github/codeql-action/upload-sarif@v2
      with:
        sarif_file: ${{ steps.vet.outputs.report }}
        category: vet
```

## Development

Refer to [development documentation](docs/development.md)