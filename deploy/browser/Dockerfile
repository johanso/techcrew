# The sandbox browser: headless Chromium driven by run.mjs, one throwaway container per browse_preview call
# (lib/sandbox/browser.ts) or link capture (capture.mjs, lib/sandbox/capture.ts). Build it on the sandbox host, from
# the repository root:
#   docker build --pull -t techteam-browser:1.64.1-2 deploy/browser
# The tag is Playwright's version, then a revision of these scripts (bump it when run.mjs, capture.mjs or
# net-guard.mjs change, so an app never runs scripts older than it expects). Bump the base image, playwright-core in
# package.json and BROWSER_IMAGE in lib/sandbox/browser-config.ts together: playwright-core only drives the browser
# build of its own version.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /opt/techteam-browser
COPY package.json run.mjs capture.mjs net-guard.mjs ./
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force

# The browsers live in /ms-playwright (PLAYWRIGHT_BROWSERS_PATH, set by the base image). The root filesystem is
# read-only at run time, so everything Chromium writes (profile, caches, crash dumps) goes to the /tmp tmpfs.
ENV HOME=/tmp NODE_ENV=production
USER pwuser
CMD ["node", "/opt/techteam-browser/run.mjs"]
