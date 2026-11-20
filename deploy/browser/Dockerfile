# The sandbox browser: headless Chromium driven by run.mjs, one throwaway container per browse_preview call
# (lib/sandbox/browser.ts) or link capture (capture.mjs, lib/sandbox/capture.ts). Build it on the sandbox host, from
# the repository root:
#   docker build --pull -t techteam-browser:1.64.1-3 deploy/browser
# The tag is Playwright's version, then a revision of this folder (bump it when anything here changes: run.mjs,
# capture.mjs, net-guard.mjs, fonts.conf or this file, so an app never runs an image older than it expects). Bump the
# base image, playwright-core in package.json and BROWSER_IMAGE in lib/sandbox/browser-config.ts together:
# playwright-core only drives the browser build of its own version. New files here also go in .dockerignore.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

# Real weights for system UI stacks: the base image's default UI font (WenQuanYi Zen Hei) has no bold face, so
# `system-ui` headings and 700-weight text rendered regular. Inter's variable font (100–900, under 1 MB) takes the
# platform UI names (system-ui, -apple-system, Segoe UI …); fonts.conf says which family gets what.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-inter-variable \
  && rm -rf /var/lib/apt/lists/*
COPY fonts.conf /etc/fonts/local.conf
RUN fc-cache -f

WORKDIR /opt/techteam-browser
COPY package.json run.mjs capture.mjs net-guard.mjs ./
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force

# The browsers live in /ms-playwright (PLAYWRIGHT_BROWSERS_PATH, set by the base image). The root filesystem is
# read-only at run time, so everything Chromium writes (profile, caches, crash dumps) goes to the /tmp tmpfs.
ENV HOME=/tmp NODE_ENV=production
USER pwuser
CMD ["node", "/opt/techteam-browser/run.mjs"]
