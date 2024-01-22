---
title: Introduction and Overview
slug: backend/introduction
sidebar:
  order: 1
---

## Conventions
  A few shorthands used in the document:

  * Backend: the whole software stack including the Fastpath, API, tools
  that transfer data around

  * FSN: The backend-fsn.ooni.org host, running most of the
  **production** backend infrastructure.

  * ams-pg-test: The ams-pg-test.ooni.org host, running a **test**
  backend infrastructure.

  Usually backend components have names that are kept consistent across:

  * Journald unit name

  * Systemd service name

  * Systemd timer name

  * StatsD metrics prefix

  When linking to the backend codebase a specific commit is used in order
  to avoid breaking links when the codebase changes:
  <https://github.com/ooni/backend/blob/0ec9fba0eb9c4c440dcb7456f2aab529561104ae/>

  Internal links across the document are indicated with small icons to
  illustrate the type of element they are linking to, as done in technical
  wikis.

  The icons in use are listed below:

  * API: 🐝

  * Bug: 🐞

  * Backend component: ⚙

  * Grafana dashboard: 📊

  * Backend host: 🖥

  * Jupyter notebook: 📔

  * Debian package: 📦

  * Runbook: 📒

  * Database table: ⛁

  * Network test: Ⓣ

  * Systemd timer: ⏲

  * Python script: 🐍

  * Tool: 🔧

  * Web UI: 🖱

  * General topic: 💡

